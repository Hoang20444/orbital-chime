import { AudioScheduler, type ScheduledStepEvent } from "../../audio/AudioScheduler.ts";
import type { InstrumentManager } from "../../audio/InstrumentManager.ts";
import type { DrumId } from "../../audio/instruments/types.ts";
import type { LoopBars, Subdivision, TimeSignature } from "../clock/MusicClock.ts";
import { Transport } from "../clock/Transport.ts";
import { evaluateStepHit } from "./GrooveGenerator.ts";
import { RHYTHM_STYLES } from "./PatternLibrary.ts";
import type { RhythmStyleId, RhythmTrackState } from "./types.ts";

const DRUM_TRACK_ORDER: DrumId[] = [
  "kick",
  "snare",
  "hihat_closed",
  "hihat_open",
  "clap",
  "shaker",
];

export interface RhythmStateSnapshot {
  styleId: RhythmStyleId;
  humanize: number;
  tracks: RhythmTrackState[];
}

export class RhythmEngine {
  public readonly transport = new Transport();
  public readonly scheduler: AudioScheduler;

  private readonly instrumentManager: InstrumentManager;
  private styleId: RhythmStyleId = "lofi";
  private humanize = 0.45;
  private tracks: Map<DrumId, RhythmTrackState> = new Map();
  private stateListeners = new Set<() => void>();
  private rng: () => number;

  constructor(
    instrumentManager: InstrumentManager,
    rng: () => number = Math.random
  ) {
    this.instrumentManager = instrumentManager;
    this.rng = rng;

    this.scheduler = new AudioScheduler(this.transport, () =>
      this.instrumentManager.getCurrentTime()
    );

    this.scheduler.onStep((ev) => this.handleScheduledStep(ev));
    this.loadStyle("lofi", false);
  }

  public subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    const unsubTransport = this.transport.subscribe((_, reason) => {
      if (reason !== "tick") listener();
    });
    return () => {
      this.stateListeners.delete(listener);
      unsubTransport();
    };
  }

  private emit(): void {
    for (const fn of this.stateListeners) {
      fn();
    }
  }

  public getSnapshot(): RhythmStateSnapshot {
    return {
      styleId: this.styleId,
      humanize: this.humanize,
      tracks: DRUM_TRACK_ORDER.map((id) => {
        const tr = this.tracks.get(id)!;
        return {
          ...tr,
          steps: tr.steps.map((s) => ({ ...s })),
        };
      }),
    };
  }

  public loadStyle(styleId: RhythmStyleId, syncTransport = true): void {
    const preset = RHYTHM_STYLES[styleId] ?? RHYTHM_STYLES.lofi;
    this.styleId = preset.id;

    for (const id of DRUM_TRACK_ORDER) {
      const prev = this.tracks.get(id);
      this.tracks.set(id, {
        id,
        steps: preset.tracks[id].map((c) => ({ ...c })),
        muted: prev?.muted ?? false,
        solo: prev?.solo ?? false,
        volume: prev?.volume ?? 1,
      });
    }

    if (syncTransport) {
      this.transport.setBpm(preset.bpm);
      this.transport.setSwing(preset.swing);
      this.transport.setTimeSignature(preset.timeSignature);
    }

    this.emit();
  }

  public toggleStep(trackId: DrumId, stepIndex: number): void {
    const tr = this.tracks.get(trackId);
    if (!tr) return;
    const cell = tr.steps[stepIndex % tr.steps.length];
    if (!cell) return;
    cell.active = !cell.active;
    if (cell.active && cell.velocity < 0.3) cell.velocity = 0.75;
    this.emit();
  }

  public cycleStepVelocity(trackId: DrumId, stepIndex: number): void {
    const tr = this.tracks.get(trackId);
    if (!tr) return;
    const cell = tr.steps[stepIndex % tr.steps.length];
    if (!cell) return;
    if (!cell.active) {
      cell.active = true;
      cell.velocity = 0.45;
      cell.ghost = true;
      cell.accent = false;
    } else if (cell.ghost) {
      cell.velocity = 0.76;
      cell.ghost = false;
      cell.accent = false;
    } else if (!cell.accent) {
      cell.velocity = 0.96;
      cell.accent = true;
    } else {
      cell.active = false;
      cell.accent = false;
      cell.ghost = false;
    }
    this.emit();
  }

  public setTrackMute(trackId: DrumId, muted: boolean): void {
    const tr = this.tracks.get(trackId);
    if (!tr) return;
    tr.muted = muted;
    this.emit();
  }

  public setTrackSolo(trackId: DrumId, solo: boolean): void {
    const tr = this.tracks.get(trackId);
    if (!tr) return;
    tr.solo = solo;
    this.emit();
  }

  public setHumanize(amount: number): void {
    this.humanize = Math.max(0, Math.min(1, amount));
    this.emit();
  }

  public setBpm(bpm: number): void {
    this.transport.setBpm(bpm);
    this.instrumentManager.setBpm(this.transport.getBpm());
  }

  public setSwing(swing: number): void {
    this.transport.setSwing(swing);
  }

  public setTimeSignature(ts: TimeSignature): void {
    this.transport.setTimeSignature(ts);
  }

  public setSubdivision(sub: Subdivision): void {
    this.transport.setSubdivision(sub);
  }

  public setLoopBars(bars: LoopBars): void {
    this.transport.setLoopBars(bars);
  }

  public start(): void {
    this.instrumentManager.unlock();
    this.transport.start();
  }

  public pause(): void {
    this.transport.pause();
  }

  public resume(): void {
    this.instrumentManager.unlock();
    this.transport.resume();
  }

  public stop(): void {
    this.transport.stop();
  }

  public seek(bar: number, beat = 1, step = 1): void {
    this.transport.seek(bar, beat, step);
  }

  private handleScheduledStep(ev: ScheduledStepEvent): void {
    const anySolo = DRUM_TRACK_ORDER.some((id) => this.tracks.get(id)?.solo);

    for (const id of DRUM_TRACK_ORDER) {
      const tr = this.tracks.get(id);
      if (!tr) continue;
      const audible = anySolo ? tr.solo && !tr.muted : !tr.muted;
      if (!audible) continue;

      const cellIdx = ev.position.stepInBar % tr.steps.length;
      const cell = tr.steps[cellIdx];
      if (!cell || !cell.active) continue;

      const hit = evaluateStepHit(
        id,
        cell,
        ev.audioTime,
        this.humanize,
        tr.volume,
        this.rng
      );
      if (!hit) continue;

      this.instrumentManager.playDrum(id, {
        velocity: hit.velocity,
        when: hit.when,
        pan: hit.pan,
      });
    }
  }
}
