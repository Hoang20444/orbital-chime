import { SCALES } from "../../audio/scales.ts";
import type { ScaleId } from "../../engine/types.ts";
import type { ChordSpec, MusicalEvent } from "../events/MusicalEvent.ts";
import { getChordPitchClasses } from "../harmony/ChordEngine.ts";

export interface PhraseStepTemplate {
  stepInBar: number;
  degreeOffset: number;
  durationSteps: number;
  velocity: number;
}

function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function getScalePool(scaleId: ScaleId, minMidi = 64, maxMidi = 84): number[] {
  const base = SCALES[scaleId] ?? SCALES.c_pentatonic;
  const pitchClasses = new Set(base.map((n) => ((n % 12) + 12) % 12));
  const pool: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (pitchClasses.has(m % 12)) pool.push(m);
  }
  return pool;
}

function snapToNearestChordTone(
  targetMidi: number,
  chord: ChordSpec,
  minMidi = 64,
  maxMidi = 84
): number {
  const pcs = getChordPitchClasses(chord.rootMidi, chord.quality);
  let best = targetMidi;
  let bestDist = Infinity;
  for (let m = minMidi; m <= maxMidi; m++) {
    if (!pcs.includes(m % 12)) continue;
    const d = Math.abs(m - targetMidi);
    if (d < bestDist) {
      bestDist = d;
      best = m;
    }
  }
  return best;
}

/**
 * Generates a coherent 4-bar Call-and-Response melody phrase:
 * Bar 1 = Motif A
 * Bar 2 = Motif A' (exact rhythmic skeleton of A adapted to Bar 2's chord)
 * Bar 3 = Motif B (lifted contrasting development)
 * Bar 4 = Resolution (stepwise descent resolving cleanly onto a Bar 4 chord tone)
 */
export function generateFourBarPhrase(opts: {
  startBar: number;
  chords: ChordSpec[]; // 4 chords for bars 1..4
  scaleId: ScaleId;
  seed: number;
  instrument: MusicalEvent["instrument"];
  energy: number; // 0.6..1.0
}): MusicalEvent[] {
  const { startBar, chords, scaleId, seed, instrument, energy } = opts;
  const rng = makeRng(seed);
  const pool = getScalePool(scaleId, 64, 84);
  const events: MusicalEvent[] = [];

  // Build rhythmic skeleton for Motif A (5..6 notes across 16 steps)
  const motifCandidates: number[][] = [
    [0, 3, 6, 10, 12],
    [0, 2, 6, 8, 12, 14],
    [0, 4, 6, 10, 14],
    [2, 4, 8, 10, 12],
  ];
  const motifSteps = motifCandidates[seed % motifCandidates.length];

  // Bar 1 (Motif A): anchor start & end on chord tones, passing notes in between
  const anchor1 = snapToNearestChordTone(72, chords[0]);
  let anchorIdx = Math.max(2, pool.indexOf(anchor1));
  if (anchorIdx < 0) anchorIdx = Math.floor(pool.length / 2);

  const motifAIntervals: number[] = [];
  let curIdx = anchorIdx;
  motifSteps.forEach((step, i) => {
    const delta = i === 0 ? 0 : Math.round((rng() - 0.38) * 3);
    curIdx = Math.max(0, Math.min(pool.length - 1, curIdx + delta));
    motifAIntervals.push(curIdx - anchorIdx);

    const rawPitch = pool[curIdx];
    const midi =
      i === 0 || i === motifSteps.length - 1
        ? snapToNearestChordTone(rawPitch, chords[0])
        : rawPitch;
    const nextStep = motifSteps[i + 1] ?? 16;
    events.push({
      id: `mel_${startBar}_${step}`,
      bar: startBar,
      stepInBar: step,
      globalStep: (startBar - 1) * 16 + step,
      durationSteps: Math.max(2, Math.min(6, nextStep - step)),
      midi,
      velocity: (0.72 + (i === 0 ? 0.1 : 0)) * energy,
      role: "melody",
      instrument,
    });
  });

  // Bar 2 (Motif A'): reuse EXACT same step grid, transpose anchor to Bar 2 chord + subtle tail twist
  const bar2 = startBar + 1;
  const anchor2 = snapToNearestChordTone(pool[anchorIdx], chords[1]);
  const anchor2Idx = Math.max(
    0,
    pool.findIndex((p) => p >= anchor2)
  );
  motifSteps.forEach((step, i) => {
    const twist = i === motifSteps.length - 1 ? 1 : 0;
    const idx = Math.max(
      0,
      Math.min(pool.length - 1, anchor2Idx + motifAIntervals[i] + twist)
    );
    const midi =
      i === 0 || i === motifSteps.length - 1
        ? snapToNearestChordTone(pool[idx], chords[1])
        : pool[idx];
    const nextStep = motifSteps[i + 1] ?? 16;
    events.push({
      id: `mel_${bar2}_${step}`,
      bar: bar2,
      stepInBar: step,
      globalStep: (bar2 - 1) * 16 + step,
      durationSteps: Math.max(2, Math.min(6, nextStep - step)),
      midi,
      velocity: 0.74 * energy,
      role: "melody",
      instrument,
    });
  });

  // Bar 3 (Motif B): contrasting higher-register climax
  const bar3 = startBar + 2;
  const bSteps = [0, 2, 4, 8, 10, 14];
  let bIdx = Math.min(pool.length - 2, anchorIdx + 3);
  bSteps.forEach((step, i) => {
    if (i > 0) {
      bIdx = Math.max(2, Math.min(pool.length - 1, bIdx + (i < 3 ? 1 : -1)));
    }
    const midi =
      i === 0 || i === 3
        ? snapToNearestChordTone(pool[bIdx], chords[2], 66, 86)
        : pool[bIdx];
    const nextStep = bSteps[i + 1] ?? 16;
    events.push({
      id: `mel_${bar3}_${step}`,
      bar: bar3,
      stepInBar: step,
      globalStep: (bar3 - 1) * 16 + step,
      durationSteps: Math.max(2, nextStep - step),
      midi,
      velocity: (i === 3 ? 0.88 : 0.78) * energy,
      role: "melody",
      instrument,
    });
  });

  // Bar 4 (Resolution): gentle stepwise descent landing squarely on a chord tone with sustained hold
  const bar4 = startBar + 3;
  const rSteps = [0, 3, 6, 8];
  let rIdx = Math.min(pool.length - 2, anchorIdx + 2);
  rSteps.forEach((step, i) => {
    rIdx = Math.max(1, rIdx - 1);
    const isFinal = i === rSteps.length - 1;
    const midi = isFinal
      ? snapToNearestChordTone(chords[3].rootMidi + 12, chords[3], 62, 82)
      : pool[rIdx];
    events.push({
      id: `mel_${bar4}_${step}`,
      bar: bar4,
      stepInBar: step,
      globalStep: (bar4 - 1) * 16 + step,
      durationSteps: isFinal ? 8 : 3,
      midi,
      velocity: (isFinal ? 0.84 : 0.72) * energy,
      role: "melody",
      instrument,
    });
  });

  return events;
}
