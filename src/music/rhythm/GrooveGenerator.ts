import type { DrumId } from "../../audio/instruments/types.ts";
import type { StepCell } from "./types.ts";

export interface HumanizedDrumHit {
  when: number;
  velocity: number;
  pan: number;
}

interface TrackFeelProfile {
  maxTimingJitterSec: number;
  maxVelocityJitter: number;
  basePan: number;
}

/**
 * Differentiated per-track humanization:
 * - Kick remains rock-solid (<= 1.5ms) to anchor the groove
 * - Snare & Clap sit slightly relaxed in the pocket (<= 4ms)
 * - Hi-hats & Shaker breathe naturally (<= 9ms) with gentle stereo spread
 */
const TRACK_FEEL: Record<DrumId, TrackFeelProfile> = {
  kick: { maxTimingJitterSec: 0.0014, maxVelocityJitter: 0.03, basePan: 0 },
  snare: { maxTimingJitterSec: 0.0038, maxVelocityJitter: 0.06, basePan: 0 },
  clap: { maxTimingJitterSec: 0.0042, maxVelocityJitter: 0.08, basePan: 0.08 },
  hihat_closed: { maxTimingJitterSec: 0.0085, maxVelocityJitter: 0.13, basePan: -0.22 },
  hihat_open: { maxTimingJitterSec: 0.008, maxVelocityJitter: 0.11, basePan: -0.26 },
  shaker: { maxTimingJitterSec: 0.009, maxVelocityJitter: 0.14, basePan: 0.28 },
};

export function evaluateStepHit(
  trackId: DrumId,
  cell: StepCell,
  baseAudioTime: number,
  humanizeAmount: number, // 0..1
  trackVolume = 1,
  rng: () => number = Math.random
): HumanizedDrumHit | null {
  if (!cell.active) return null;

  const prob = cell.probability ?? 1;
  if (prob < 1 && rng() > prob) {
    return null;
  }

  const feel = TRACK_FEEL[trackId];
  const h = Math.max(0, Math.min(1, humanizeAmount));

  // Keep timing offset >= 0 or tiny +/- while never scheduling before baseAudioTime - 0.001
  const rawJitter = (rng() * 2 - 1) * feel.maxTimingJitterSec * h;
  const when = Math.max(0, baseAudioTime + Math.max(0, rawJitter));

  let vel = cell.velocity * trackVolume;
  if (cell.accent) vel *= 1.15;
  if (cell.ghost) vel *= 0.55;
  const velNoise = 1 + (rng() * 2 - 1) * feel.maxVelocityJitter * h;
  vel = Math.max(0.08, Math.min(1, vel * velNoise));

  const pan =
    feel.basePan === 0
      ? 0
      : Math.max(-0.65, Math.min(0.65, feel.basePan + (rng() * 2 - 1) * 0.08 * h));

  return { when, velocity: vel, pan };
}
