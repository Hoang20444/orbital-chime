import {
  clampBpm,
  clampSwing,
  getPositionFromStep,
  getStepsPerBar,
  getStepsPerBeat,
  type LoopBars,
  type MusicPosition,
  type Subdivision,
  type TimeSignature,
} from "./MusicClock.ts";

export type TransportStatus = "stopped" | "playing" | "paused";

export interface TransportSnapshot {
  status: TransportStatus;
  bpm: number;
  timeSignature: TimeSignature;
  subdivision: Subdivision;
  swing: number;
  loopBars: LoopBars;
  currentStep: number;
  position: MusicPosition;
}

export type TransportChangeReason =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "seek"
  | "bpm"
  | "signature"
  | "subdivision"
  | "swing"
  | "loopBars"
  | "tick";

export type TransportListener = (
  snapshot: TransportSnapshot,
  reason: TransportChangeReason
) => void;

export class Transport {
  private status: TransportStatus = "stopped";
  private bpm = 104;
  private timeSignature: TimeSignature = "4/4";
  private subdivision: Subdivision = "1/16";
  private swing = 0.08;
  private loopBars: LoopBars = 4;
  private currentStep = 0;
  private listeners = new Set<TransportListener>();

  public subscribe(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(reason: TransportChangeReason): void {
    const snap = this.getSnapshot();
    for (const fn of this.listeners) {
      fn(snap, reason);
    }
  }

  public getSnapshot(): TransportSnapshot {
    return {
      status: this.status,
      bpm: this.bpm,
      timeSignature: this.timeSignature,
      subdivision: this.subdivision,
      swing: this.swing,
      loopBars: this.loopBars,
      currentStep: this.currentStep,
      position: getPositionFromStep(
        this.currentStep,
        this.timeSignature,
        this.loopBars,
        this.subdivision
      ),
    };
  }

  public getStatus(): TransportStatus {
    return this.status;
  }

  public getBpm(): number {
    return this.bpm;
  }

  public getTimeSignature(): TimeSignature {
    return this.timeSignature;
  }

  public getSubdivision(): Subdivision {
    return this.subdivision;
  }

  public getSwing(): number {
    return this.swing;
  }

  public getLoopBars(): LoopBars {
    return this.loopBars;
  }

  public getCurrentStep(): number {
    return this.currentStep;
  }

  public start(): void {
    if (this.status === "playing") return;
    if (this.status === "stopped") {
      this.currentStep = 0;
    }
    this.status = "playing";
    this.emit("start");
  }

  public pause(): void {
    if (this.status !== "playing") return;
    this.status = "paused";
    this.emit("pause");
  }

  public resume(): void {
    if (this.status === "playing") return;
    if (this.status === "stopped") {
      this.currentStep = 0;
    }
    this.status = "playing";
    this.emit("resume");
  }

  public stop(): void {
    this.status = "stopped";
    this.currentStep = 0;
    this.emit("stop");
  }

  public seek(bar = 1, beat = 1, step = 1): void {
    const stepsPerBar = getStepsPerBar(this.timeSignature, this.subdivision);
    const stepsPerBeat = getStepsPerBeat(this.subdivision);
    const clampedBar = Math.max(1, Math.min(this.loopBars, Math.floor(bar)));
    const clampedBeat = Math.max(1, Math.floor(beat));
    const clampedSub = Math.max(1, Math.floor(step));
    this.currentStep =
      (clampedBar - 1) * stepsPerBar +
      (clampedBeat - 1) * stepsPerBeat +
      (clampedSub - 1);
    this.emit("seek");
  }

  public advanceStep(): number {
    const step = this.currentStep;
    this.currentStep++;
    this.emit("tick");
    return step;
  }

  public setBpm(nextBpm: number): void {
    const clamped = clampBpm(nextBpm);
    if (clamped === this.bpm) return;
    this.bpm = clamped;
    this.emit("bpm");
  }

  public setTimeSignature(ts: TimeSignature): void {
    if (ts === this.timeSignature) return;
    this.timeSignature = ts;
    this.currentStep = 0;
    this.emit("signature");
  }

  public setSubdivision(sub: Subdivision): void {
    if (sub === this.subdivision) return;
    this.subdivision = sub;
    this.currentStep = 0;
    this.emit("subdivision");
  }

  public setSwing(swing: number): void {
    const clamped = clampSwing(swing);
    if (Math.abs(clamped - this.swing) < 1e-6) return;
    this.swing = clamped;
    this.emit("swing");
  }

  public setLoopBars(bars: LoopBars): void {
    if (bars === this.loopBars) return;
    this.loopBars = bars;
    const total = getStepsPerBar(this.timeSignature, this.subdivision) * bars;
    this.currentStep = this.currentStep % total;
    this.emit("loopBars");
  }
}
