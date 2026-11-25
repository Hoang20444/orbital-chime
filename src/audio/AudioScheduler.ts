import {
  getPositionFromStep,
  getStepDurationSec,
  getSwingOffsetSec,
  type MusicPosition,
} from "../music/clock/MusicClock.ts";
import type {
  Transport,
  TransportChangeReason,
} from "../music/clock/Transport.ts";

export interface ScheduledStepEvent {
  position: MusicPosition;
  gridAudioTime: number;
  audioTime: number;
  stepDurationSec: number;
  swingOffsetSec: number;
}

export type StepScheduleCallback = (ev: ScheduledStepEvent) => void;

const PUMP_INTERVAL_MS = 25;
const LOOKAHEAD_SEC = 0.11;
const STALE_GAP_SEC = 0.35;

export class AudioScheduler {
  private readonly transport: Transport;
  private readonly getAudioTime: () => number;
  private stepListeners = new Set<StepScheduleCallback>();

  private timerId: number | null = null;
  private anchorTime = 0;
  private anchorStep = 0;
  private nextStepIndex = 0;
  private lastScheduledGridTime = 0;
  private recentScheduledSteps: Array<{ stepInLoop: number; audioTime: number }> =
    [];

  constructor(transport: Transport, getAudioTime: () => number) {
    this.transport = transport;
    this.getAudioTime = getAudioTime;
    this.transport.subscribe((_, reason) => this.handleTransportChange(reason));
  }

  public onStep(cb: StepScheduleCallback): () => void {
    this.stepListeners.add(cb);
    return () => {
      this.stepListeners.delete(cb);
    };
  }

  private handleTransportChange(reason: TransportChangeReason): void {
    if (reason === "tick") return;

    const status = this.transport.getStatus();
    if (status !== "playing") {
      this.stopTimer();
      if (reason === "stop") {
        this.recentScheduledSteps = [];
        this.nextStepIndex = 0;
      }
      return;
    }

    const now = this.getAudioTime();
    if (reason === "start" || reason === "resume" || reason === "seek") {
      this.resetAnchor(now + 0.015, this.transport.getCurrentStep());
      this.startTimer();
      this.pump();
    } else if (reason === "bpm" || reason === "subdivision") {
      // Re-anchor smoothly from next unscheduled step so live tempo changes never jump position
      const baseTime = Math.max(now + 0.01, this.lastScheduledGridTime);
      this.resetAnchor(baseTime, this.nextStepIndex);
    } else if (reason === "signature" || reason === "loopBars") {
      this.resetAnchor(now + 0.015, this.transport.getCurrentStep());
    }
  }

  private resetAnchor(time: number, stepIndex: number): void {
    this.anchorTime = time;
    this.anchorStep = stepIndex;
    this.nextStepIndex = stepIndex;
    this.lastScheduledGridTime = time;
  }

  private startTimer(): void {
    if (this.timerId !== null || typeof window === "undefined") return;
    this.timerId = window.setInterval(() => {
      this.pump();
    }, PUMP_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timerId !== null && typeof window !== "undefined") {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Look-ahead scheduler pump: schedules steps up to `now + LOOKAHEAD_SEC`
   * using exact integer step multiples from `anchorTime` (zero accumulated drift).
   */
  public pump(): ScheduledStepEvent[] {
    if (this.transport.getStatus() !== "playing") return [];

    const now = this.getAudioTime();
    const bpm = this.transport.getBpm();
    const ts = this.transport.getTimeSignature();
    const sub = this.transport.getSubdivision();
    const swing = this.transport.getSwing();
    const loopBars = this.transport.getLoopBars();
    const stepSec = getStepDurationSec(bpm, sub);

    // Background-tab recovery: jump anchor forward cleanly without firing stale burst
    const expectedNext =
      this.anchorTime + (this.nextStepIndex - this.anchorStep) * stepSec;
    if (now - expectedNext > STALE_GAP_SEC) {
      this.resetAnchor(now + 0.025, this.nextStepIndex);
    }

    const scheduled: ScheduledStepEvent[] = [];
    const horizon = now + LOOKAHEAD_SEC;

    // Guard max iterations per pump against unexpected edge cases
    let safety = 0;
    while (safety < 32) {
      const gridTime =
        this.anchorTime + (this.nextStepIndex - this.anchorStep) * stepSec;
      if (gridTime > horizon) break;
      safety++;

      const stepIndex = this.transport.advanceStep();
      this.nextStepIndex = stepIndex + 1;
      this.lastScheduledGridTime = gridTime + stepSec;

      const position = getPositionFromStep(stepIndex, ts, loopBars, sub);
      const swingOffsetSec = getSwingOffsetSec(
        position.stepInBar,
        swing,
        stepSec,
        sub
      );
      const audioTime = gridTime + swingOffsetSec;

      const ev: ScheduledStepEvent = {
        position,
        gridAudioTime: gridTime,
        audioTime,
        stepDurationSec: stepSec,
        swingOffsetSec,
      };

      this.recentScheduledSteps.push({
        stepInLoop: position.stepInLoop,
        audioTime,
      });
      if (this.recentScheduledSteps.length > 48) {
        this.recentScheduledSteps.shift();
      }

      scheduled.push(ev);
      for (const cb of this.stepListeners) {
        cb(ev);
      }
    }

    return scheduled;
  }

  public getVisualStep(): number | null {
    if (this.transport.getStatus() === "stopped") return null;
    if (this.transport.getStatus() === "paused") {
      return this.transport.getSnapshot().position.stepInLoop;
    }

    const now = this.getAudioTime();
    let best: number | null = null;
    for (const item of this.recentScheduledSteps) {
      if (item.audioTime <= now + 0.015) {
        best = item.stepInLoop;
      }
    }
    return best;
  }

  public dispose(): void {
    this.stopTimer();
    this.stepListeners.clear();
  }
}
