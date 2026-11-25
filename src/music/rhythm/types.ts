import type { DrumId } from "../../audio/instruments/types.ts";
import type { TimeSignature } from "../clock/MusicClock.ts";

export type RhythmStyleId = "pop" | "hiphop" | "lofi" | "edm" | "funk";

export interface StepCell {
  active: boolean;
  velocity: number; // 0..1
  accent?: boolean;
  ghost?: boolean;
  probability?: number; // 0..1 (default 1)
}

export interface RhythmTrackState {
  id: DrumId;
  steps: StepCell[];
  muted: boolean;
  solo: boolean;
  volume: number;
}

export interface RhythmPatternPreset {
  id: RhythmStyleId;
  nameEn: string;
  nameVi: string;
  bpm: number;
  swing: number;
  timeSignature: TimeSignature;
  tracks: Record<DrumId, StepCell[]>;
}
