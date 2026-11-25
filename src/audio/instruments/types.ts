import type { MaterialType } from "../../engine/types.ts";

export type MelodicInstrumentId =
  | MaterialType
  | "piano"
  | "musicBox"
  | "synthLead"
  | "subBass";

export type DrumId =
  | "kick"
  | "snare"
  | "hihat_closed"
  | "hihat_open"
  | "clap"
  | "shaker";

export interface NoteTriggerOptions {
  freq: number;
  velocity: number; // 0..1
  when?: number;
  duration?: number;
  pan?: number; // -1..1
}

export interface DrumTriggerOptions {
  velocity: number; // 0..1
  when?: number;
  pan?: number; // -1..1
}
