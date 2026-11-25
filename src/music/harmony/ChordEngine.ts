import type { ScaleId } from "../../engine/types.ts";
import type { ChordQuality, ChordSpec } from "../events/MusicalEvent.ts";

export type ProgressionId =
  | "lofi_am"
  | "pop_lift"
  | "royal_road"
  | "lydian_dream"
  | "dorian_groove";

export interface ProgressionPreset {
  id: ProgressionId;
  nameEn: string;
  nameVi: string;
  scaleId: ScaleId;
  chords: Array<{ symbol: string; rootMidi: number; quality: ChordQuality }>;
}

const QUALITY_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  maj9: [0, 4, 7, 11, 14],
  min9: [0, 3, 7, 10, 14],
  add9: [0, 4, 7, 14],
  sus4: [0, 5, 7],
  "6": [0, 4, 7, 9],
  "9": [0, 4, 7, 10, 14],
};

export const PROGRESSIONS: Record<ProgressionId, ProgressionPreset> = {
  lofi_am: {
    id: "lofi_am",
    nameEn: "Am9 · Dm9 · G7 · Cmaj9",
    nameVi: "Am9 · Dm9 · G7 · Cmaj9 (Lo-Fi)",
    scaleId: "a_minor9",
    chords: [
      { symbol: "Am9", rootMidi: 57, quality: "min9" },
      { symbol: "Dm9", rootMidi: 62, quality: "min9" },
      { symbol: "G7", rootMidi: 55, quality: "dom7" },
      { symbol: "Cmaj9", rootMidi: 60, quality: "maj9" },
    ],
  },
  pop_lift: {
    id: "pop_lift",
    nameEn: "Cmaj7 · Gadd9 · Am7 · Fmaj7",
    nameVi: "Cmaj7 · Gadd9 · Am7 · Fmaj7 (Pop)",
    scaleId: "c_pentatonic",
    chords: [
      { symbol: "Cmaj7", rootMidi: 60, quality: "maj7" },
      { symbol: "Gadd9", rootMidi: 55, quality: "add9" },
      { symbol: "Am7", rootMidi: 57, quality: "min7" },
      { symbol: "Fmaj7", rootMidi: 53, quality: "maj7" },
    ],
  },
  royal_road: {
    id: "royal_road",
    nameEn: "Fmaj7 · G7 · Em7 · Am9",
    nameVi: "Fmaj7 · G7 · Em7 · Am9 (Anime/City)",
    scaleId: "a_minor9",
    chords: [
      { symbol: "Fmaj7", rootMidi: 53, quality: "maj7" },
      { symbol: "G7", rootMidi: 55, quality: "dom7" },
      { symbol: "Em7", rootMidi: 52, quality: "min7" },
      { symbol: "Am9", rootMidi: 57, quality: "min9" },
    ],
  },
  lydian_dream: {
    id: "lydian_dream",
    nameEn: "Fmaj9 · G6 · Em7 · Am7",
    nameVi: "Fmaj9 · G6 · Em7 · Am7 (Lydian)",
    scaleId: "f_lydian",
    chords: [
      { symbol: "Fmaj9", rootMidi: 53, quality: "maj9" },
      { symbol: "G6", rootMidi: 55, quality: "6" },
      { symbol: "Em7", rootMidi: 52, quality: "min7" },
      { symbol: "Am7", rootMidi: 57, quality: "min7" },
    ],
  },
  dorian_groove: {
    id: "dorian_groove",
    nameEn: "Gm7 · C9 · Gm7 · Bbmaj7",
    nameVi: "Gm7 · C9 · Gm7 · Bbmaj7 (Dorian)",
    scaleId: "g_dorian",
    chords: [
      { symbol: "Gm7", rootMidi: 55, quality: "min7" },
      { symbol: "C9", rootMidi: 60, quality: "9" },
      { symbol: "Gm7", rootMidi: 55, quality: "min7" },
      { symbol: "Bbmaj7", rootMidi: 58, quality: "maj7" },
    ],
  },
};

export function getChordPitchClasses(
  rootMidi: number,
  quality: ChordQuality
): number[] {
  const intervals = QUALITY_INTERVALS[quality] ?? QUALITY_INTERVALS.maj;
  return intervals.map((iv) => (rootMidi + iv) % 12);
}

/**
 * Smooth close-position voice leading around MIDI 57..74 (A3..D5).
 * Minimizes total semitone distance from the previous chord's voicing.
 */
export function buildVoicedProgression(
  progressionId: ProgressionId
): ChordSpec[] {
  const preset = PROGRESSIONS[progressionId] ?? PROGRESSIONS.lofi_am;
  const result: ChordSpec[] = [];
  let prevCenter = 64;

  for (const ch of preset.chords) {
    const intervals = QUALITY_INTERVALS[ch.quality] ?? QUALITY_INTERVALS.maj;
    const rawNotes = intervals.slice(0, 4).map((iv) => ch.rootMidi + iv);

    // Fold each pitch class into the octave closest to prevCenter (clamped 55..75)
    const voiced = rawNotes
      .map((n) => {
        let candidate = n;
        while (candidate < prevCenter - 6) candidate += 12;
        while (candidate > prevCenter + 6) candidate -= 12;
        if (candidate < 54) candidate += 12;
        if (candidate > 76) candidate -= 12;
        return candidate;
      })
      .sort((a, b) => a - b);

    prevCenter =
      voiced.reduce((sum, v) => sum + v, 0) / Math.max(1, voiced.length);

    result.push({
      symbol: ch.symbol,
      rootMidi: ch.rootMidi,
      quality: ch.quality,
      voicedNotes: voiced,
    });
  }

  return result;
}
