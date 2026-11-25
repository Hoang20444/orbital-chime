export type TimeSignature = "4/4" | "3/4" | "6/8";

export type Subdivision = "1/4" | "1/8" | "1/16" | "triplet";

export type LoopBars = 1 | 2 | 4 | 8 | 16;

export interface MusicPosition {
  stepIndex: number; // monotonic integer step since start/seek
  stepInLoop: number;
  stepInBar: number;
  bar: number; // 1-based within loop
  beat: number; // 1-based within bar
  subStep: number; // 1-based within beat
  stepsPerBar: number;
  totalLoopSteps: number;
}

export function clampBpm(bpm: number): number {
  return Math.max(60, Math.min(180, Math.round(bpm)));
}

export function clampSwing(swing: number): number {
  return Math.max(0, Math.min(0.75, swing));
}

export function getStepsPerBeat(subdivision: Subdivision = "1/16"): number {
  switch (subdivision) {
    case "1/4":
      return 1;
    case "1/8":
      return 2;
    case "triplet":
      return 3;
    case "1/16":
    default:
      return 4;
  }
}

export function getBeatsPerBar(ts: TimeSignature): number {
  switch (ts) {
    case "3/4":
      return 3;
    case "6/8":
      return 3; // 3 dotted-quarter / eighth-pair beats -> 12 sixteenth-grid steps
    case "4/4":
    default:
      return 4;
  }
}

export function getStepsPerBar(
  ts: TimeSignature,
  subdivision: Subdivision = "1/16"
): number {
  return getBeatsPerBar(ts) * getStepsPerBeat(subdivision);
}

export function getStepDurationSec(
  bpm: number,
  subdivision: Subdivision = "1/16"
): number {
  const beatSec = 60 / clampBpm(bpm);
  return beatSec / getStepsPerBeat(subdivision);
}

/**
 * Delays odd subdivisions smoothly for musical swing (0..0.75).
 * Downbeats (even steps) always remain locked on the grid.
 */
export function getSwingOffsetSec(
  stepInBar: number,
  swing: number,
  stepSec: number,
  subdivision: Subdivision = "1/16"
): number {
  if (subdivision === "1/4" || swing <= 0) return 0;
  if (stepInBar % 2 === 1) {
    return clampSwing(swing) * stepSec * 0.5;
  }
  return 0;
}

export function getPositionFromStep(
  stepIndex: number,
  ts: TimeSignature,
  loopBars: LoopBars,
  subdivision: Subdivision = "1/16"
): MusicPosition {
  const stepsPerBar = getStepsPerBar(ts, subdivision);
  const stepsPerBeat = getStepsPerBeat(subdivision);
  const totalLoopSteps = stepsPerBar * loopBars;
  const safeStep = Math.max(0, Math.floor(stepIndex));
  const stepInLoop = safeStep % totalLoopSteps;
  const stepInBar = stepInLoop % stepsPerBar;
  const bar = Math.floor(stepInLoop / stepsPerBar) + 1;
  const beat = Math.floor(stepInBar / stepsPerBeat) + 1;
  const subStep = (stepInBar % stepsPerBeat) + 1;

  return {
    stepIndex: safeStep,
    stepInLoop,
    stepInBar,
    bar,
    beat,
    subStep,
    stepsPerBar,
    totalLoopSteps,
  };
}
