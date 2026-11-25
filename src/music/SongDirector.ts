import { AudioScheduler, type ScheduledStepEvent } from "../audio/AudioScheduler.ts";
import type { InstrumentManager } from "../audio/InstrumentManager.ts";
import { midiToFreq } from "../audio/scales.ts";
import type { Marble, WorldState } from "../engine/types.ts";
import { getStepDurationSec } from "./clock/MusicClock.ts";
import { Transport } from "./clock/Transport.ts";
import {
  arrangeSong,
  SHOWCASE_SONGS,
  type SongGenerationOptions,
} from "./arrangement/ArrangementEngine.ts";
import type {
  GeneratedSong,
  MusicalEvent,
  MusicalRole,
  SectionType,
} from "./events/MusicalEvent.ts";
import {
  buildKineticStageForSong,
  createCueMarbleForEvent,
  CUE_LEAD_SEC,
  type StageCueTargets,
} from "./events/PhysicsAdapter.ts";

export interface SongDirectorState {
  song: GeneratedSong;
  status: "stopped" | "playing" | "paused";
  currentBar: number;
  currentSection: SectionType;
  loopEnabled: boolean;
  roleMutes: Record<MusicalRole, boolean>;
}

export class SongDirector {
  public readonly transport = new Transport();
  public readonly scheduler: AudioScheduler;

  private readonly instrumentManager: InstrumentManager;
  private song: GeneratedSong = SHOWCASE_SONGS[0];
  private eventsByStep: Map<number, MusicalEvent[]> = new Map();
  private stageWorld: WorldState | null = null;
  private stageTargets: StageCueTargets | null = null;
  private loopEnabled = true;
  private roleMutes: Record<MusicalRole, boolean> = {
    drums: false,
    bass: false,
    chords: false,
    melody: false,
  };

  private listeners = new Set<() => void>();
  private cueListeners = new Set<(marble: Marble) => void>();
  private stageListeners = new Set<(world: WorldState) => void>();

  constructor(instrumentManager: InstrumentManager) {
    this.instrumentManager = instrumentManager;
    this.scheduler = new AudioScheduler(this.transport, () =>
      this.instrumentManager.getCurrentTime()
    );
    this.scheduler.onStep((ev) => this.handleStep(ev));
    this.loadSong(SHOWCASE_SONGS[0], false);
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    const unsub = this.transport.subscribe((_, reason) => {
      if (reason !== "tick") fn();
    });
    return () => {
      this.listeners.delete(fn);
      unsub();
    };
  }

  public onSpawnCue(fn: (marble: Marble) => void): () => void {
    this.cueListeners.add(fn);
    return () => {
      this.cueListeners.delete(fn);
    };
  }

  public onStageLoad(fn: (world: WorldState) => void): () => void {
    this.stageListeners.add(fn);
    return () => {
      this.stageListeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  public getState(): SongDirectorState {
    const pos = this.transport.getSnapshot().position;
    const bar = Math.max(1, Math.min(this.song.totalBars, pos.bar));
    const sec =
      this.song.sections.find((s) => bar >= s.startBar && bar <= s.endBar)
        ?.name ?? "intro";
    return {
      song: this.song,
      status: this.transport.getStatus(),
      currentBar: bar,
      currentSection: sec,
      loopEnabled: this.loopEnabled,
      roleMutes: { ...this.roleMutes },
    };
  }

  public loadSong(song: GeneratedSong, emitStage = true): void {
    this.transport.stop();
    this.song = song;
    this.eventsByStep.clear();
    for (const ev of song.events) {
      const list = this.eventsByStep.get(ev.globalStep) ?? [];
      list.push(ev);
      this.eventsByStep.set(ev.globalStep, list);
    }

    this.transport.setBpm(song.bpm);
    this.transport.setSwing(song.swing);
    this.transport.setTimeSignature("4/4");
    this.transport.setLoopBars(16);
    this.instrumentManager.setBpm(song.bpm);

    const built = buildKineticStageForSong(song);
    this.stageWorld = built.world;
    this.stageTargets = built.targets;

    if (emitStage) {
      for (const fn of this.stageListeners) fn(built.world);
    }
    this.emit();
  }

  public generateAndLoad(opts: SongGenerationOptions, emitStage = true): GeneratedSong {
    const song = arrangeSong(opts);
    this.loadSong(song, emitStage);
    return song;
  }

  public attachExternalWorld(world: WorldState): void {
    this.stageWorld = world;
  }

  public setRoleMute(role: MusicalRole, muted: boolean): void {
    this.roleMutes[role] = muted;
    this.emit();
  }

  public setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
    this.emit();
  }

  public start(): void {
    this.instrumentManager.unlock();
    if (this.stageWorld) {
      for (const fn of this.stageListeners) fn(this.stageWorld);
    }
    this.transport.start();
    this.emit();
  }

  public pause(): void {
    this.transport.pause();
    this.emit();
  }

  public resume(): void {
    this.instrumentManager.unlock();
    this.transport.resume();
    this.emit();
  }

  public stop(): void {
    this.transport.stop();
    this.emit();
  }

  private handleStep(sched: ScheduledStepEvent): void {
    const totalSteps = this.song.totalBars * 16;

    // Auto-stop gracefully after bar 16 if loop is disabled
    if (!this.loopEnabled && sched.position.stepIndex >= totalSteps) {
      this.transport.stop();
      this.emit();
      return;
    }

    const curStep = sched.position.stepInLoop;
    const stepSec = getStepDurationSec(this.transport.getBpm(), "1/16");

    // 1. Trigger scheduled musical events at exact AudioContext time
    const eventsHere = this.eventsByStep.get(curStep) ?? [];
    for (const ev of eventsHere) {
      if (this.roleMutes[ev.role]) continue;

      if (ev.role === "drums" && ev.drumId) {
        this.instrumentManager.playDrum(ev.drumId, {
          velocity: ev.velocity,
          when: sched.audioTime,
          pan: ev.drumId === "shaker" ? 0.25 : ev.drumId === "hihat_closed" ? -0.2 : 0,
        });
      } else if (ev.midi !== undefined && ev.instrument) {
        const pan =
          ev.role === "melody"
            ? (((ev.midi - 64) / 20) * 2 - 1) * 0.45
            : ev.role === "chords"
              ? -0.15
              : 0;
        this.instrumentManager.playNote(ev.instrument, {
          freq: midiToFreq(ev.midi),
          velocity: ev.velocity,
          when: sched.audioTime,
          duration: Math.max(0.18, ev.durationSteps * stepSec * 0.95),
          pan,
        });
      }
    }

    // 2. Look ahead CUE_LEAD_SEC steps to launch synchronized visual marbles
    if (this.stageWorld && this.stageTargets && this.cueListeners.size > 0) {
      const leadSteps = Math.max(1, Math.round(CUE_LEAD_SEC / stepSec));
      const futureRaw = sched.position.stepIndex + leadSteps;
      if (this.loopEnabled || futureRaw < totalSteps) {
        const futureStep = futureRaw % totalSteps;
        const futureEvents = this.eventsByStep.get(futureStep) ?? [];
        for (const fev of futureEvents) {
          if (this.roleMutes[fev.role]) continue;
          const marble = createCueMarbleForEvent(
            fev,
            this.stageWorld,
            this.stageTargets,
            leadSteps * stepSec
          );
          if (marble) {
            for (const cb of this.cueListeners) cb(marble);
          }
        }
      }
    }

    if (sched.position.stepInBar === 0) {
      this.emit();
    }
  }
}
