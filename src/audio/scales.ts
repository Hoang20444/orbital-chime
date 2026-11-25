import type { MaterialType, ScaleId } from "../engine/types.ts";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

export const SCALES: Record<ScaleId, number[]> = {
  // Warm bright C Major Pentatonic (C4 -> G6)
  c_pentatonic: [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 88],
  // Airy dreamy F Lydian (F3 -> E6)
  f_lydian: [53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 72, 76],
  // Delicate Japanese D Hirajoshi (D4 -> A6)
  d_hirajoshi: [62, 64, 65, 69, 70, 74, 76, 77, 81, 82, 86, 89],
  // Lush reflective A Minor 9 (A3 -> B5)
  a_minor9: [57, 59, 60, 64, 67, 69, 71, 72, 76, 79, 81, 83],
  // Grounded groovy G Dorian (G3 -> F6)
  g_dorian: [55, 57, 58, 62, 65, 67, 69, 70, 74, 77, 79, 81],
};

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export function lengthToNote(
  length: number,
  scaleId: ScaleId,
  material: MaterialType = "marimba"
): { freq: number; noteName: string; midi: number; degree: number } {
  const notes = SCALES[scaleId] ?? SCALES.c_pentatonic;
  const clamped = Math.max(55, Math.min(265, length));
  // Shorter bar => higher pitch, longer bar => deeper pitch
  const t = 1 - (clamped - 55) / (265 - 55);
  const degree = Math.max(0, Math.min(notes.length - 1, Math.round(t * (notes.length - 1))));
  const baseMidi = notes[degree];
  const midi = material === "bass" ? baseMidi - 12 : baseMidi;

  return {
    freq: midiToFreq(midi),
    noteName: midiToName(midi),
    midi,
    degree,
  };
}
