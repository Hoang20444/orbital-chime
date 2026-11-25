import type { DrumId, MelodicInstrumentId } from "../../audio/instruments/types.ts";
import type { ScaleId } from "../../engine/types.ts";
import type { RhythmStyleId } from "../rhythm/types.ts";

export type SectionType = "intro" | "verse" | "chorus" | "outro";

export type MusicalRole = "drums" | "bass" | "chords" | "melody";

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "maj7"
  | "min7"
  | "dom7"
  | "maj9"
  | "min9"
  | "add9"
  | "sus4"
  | "6"
  | "9";

export interface ChordSpec {
  symbol: string;
  rootMidi: number; // e.g. 57 = A3
  quality: ChordQuality;
  voicedNotes: number[]; // close-voiced MIDI notes around 55..74
}

export interface SongSection {
  name: SectionType;
  startBar: number; // 1-based
  endBar: number; // inclusive
}

export interface MusicalEvent {
  id: string;
  bar: number; // 1..16
  stepInBar: number; // 0..15
  globalStep: number; // 0..255
  durationSteps: number;
  midi?: number;
  velocity: number; // 0..1
  role: MusicalRole;
  instrument?: MelodicInstrumentId;
  drumId?: DrumId;
  chordSymbol?: string;
}

export interface GeneratedSong {
  id: string;
  titleEn: string;
  titleVi: string;
  bpm: number;
  swing: number;
  styleId: RhythmStyleId;
  progressionId: string;
  scaleId: ScaleId;
  totalBars: 16;
  sections: SongSection[];
  chordsByBar: ChordSpec[]; // length 16 (or 4 repeated)
  events: MusicalEvent[];
}
