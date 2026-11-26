import type {
  DrumId,
  MelodicInstrumentId,
} from "../audio/instruments/types.ts";

export type MaterialType = "marimba" | "brass" | "ceramic" | "bass";

export type ScaleId =
  | "c_pentatonic"
  | "f_lydian"
  | "d_hirajoshi"
  | "a_minor9"
  | "g_dorian";

export type ToolType = MaterialType | "bumper" | "splitter" | "tube" | "emitter";

export interface MaterialSpec {
  id: MaterialType;
  color: string;
  darkEdge: string;
  bevelColor: string;
  borderColor: string;
  highlightColor: string;
  grainColor: string;
  restitution: number;
  thickness: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface BarPiece {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  material: MaterialType;
  locked?: boolean;
  fixedMidi?: number;
  instrumentOverride?: MelodicInstrumentId;
  drumOverride?: DrumId;
  customRestitution?: number;
  noteLabel?: string;
  trackChannel?: string;
  silent?: boolean;
  // Transient visual oscillation state
  flexOffset?: number;
  flexVel?: number;
  hitNx?: number;
  hitNy?: number;
}

export interface BumperPiece {
  id: string;
  x: number;
  y: number;
  radius: number;
  locked?: boolean;
  trackChannel?: string;
  customRestitution?: number;
  pulse?: number;
}

export interface SplitterPiece {
  id: string;
  x: number;
  y: number;
  radius: number;
  locked?: boolean;
  trackChannel?: string;
  harmonicPass?: boolean;
  pulse?: number;
}

export interface TubePiece {
  id: string;
  points: Vec2[];
  radius?: number;
  trackChannel?: string;
  travelDuration?: number;
  exitVx?: number;
  exitVy?: number;
  locked?: boolean;
  pulse?: number;
}

export interface Emitter {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  beatInterval: number; // 1 = every beat, 2 = every 2 beats, 0.5 = eighth
  phaseOffset: number; // in beats
  locked?: boolean;
  trackChannel?: string;
  nextEmitBeat: number;
  pulse?: number;
}

export interface ResonanceRing {
  id: string;
  x: number;
  y: number;
  radius: number;
  charge: number; // 0..1
  pulse?: number;
}

export interface Marble {
  id: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  radius: number;
  age: number;
  trail: Vec2[];
  cooldowns: Record<string, number>;
  splitHistory: Record<string, boolean>;
  squash: number; // 0..1
  squashAngle: number;
  cueTargetId?: string;
  silentCue?: boolean;
  trackChannel?: string;
  activeTube?: {
    tubeId: string;
    progress: number;
    duration: number;
    exitVx: number;
    exitVy: number;
  };
}

export interface Ripple {
  x: number;
  y: number;
  color: string;
  age: number;
  duration: number;
  maxRadius: number;
  doubleRing: boolean;
}

export interface NotePopup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  duration: number;
}

export interface WorldState {
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
  tubes?: TubePiece[];
  emitters: Emitter[];
  rings: ResonanceRing[];
  marbles: Marble[];
  ripples: Ripple[];
  popups: NotePopup[];
  bpm: number;
  gravity?: number;
  scaleId: ScaleId;
  beatClock: number;
  nextMarbleId: number;
  allChargedTimer: number;
  levelSolved: boolean;
}

export type PhysicsEvent =
  | {
      type: "bar_hit";
      barId: string;
      material: MaterialType;
      length: number;
      x: number;
      y: number;
      speed: number;
      silentCue?: boolean;
      fixedMidi?: number;
      instrumentOverride?: MelodicInstrumentId;
      drumOverride?: DrumId;
      noteLabel?: string;
    }
  | {
      type: "bumper_hit";
      bumperId: string;
      x: number;
      y: number;
      speed: number;
      silentCue?: boolean;
    }
  | {
      type: "splitter_hit";
      splitterId: string;
      x: number;
      y: number;
    }
  | {
      type: "ring_hit";
      ringId: string;
      x: number;
      y: number;
      ringIndex: number;
    }
  | {
      type: "level_win";
    };

export type PieceBudget = Partial<Record<ToolType, number>>;

export interface LevelSolutionHint {
  bars?: Array<Omit<BarPiece, "flexOffset" | "flexVel" | "hitNx" | "hitNy">>;
  bumpers?: Array<Omit<BumperPiece, "pulse">>;
  splitters?: Array<Omit<SplitterPiece, "pulse">>;
}

export interface LevelDef {
  id: string;
  trackNumber: number;
  titleEn: string;
  titleVi: string;
  subtitleEn: string;
  subtitleVi: string;
  bpm: number;
  gravity?: number;
  scaleId: ScaleId;
  budget: PieceBudget;
  emitters: Array<Omit<Emitter, "nextEmitBeat" | "pulse">>;
  rings: Array<Omit<ResonanceRing, "charge" | "pulse">>;
  fixedBars: Array<Omit<BarPiece, "flexOffset" | "flexVel" | "hitNx" | "hitNy">>;
  initialBars: Array<Omit<BarPiece, "flexOffset" | "flexVel" | "hitNx" | "hitNy">>;
  fixedBumpers: Array<Omit<BumperPiece, "pulse">>;
  fixedSplitters: Array<Omit<SplitterPiece, "pulse">>;
  hintSolution: LevelSolutionHint;
}

export interface PresetDef {
  id: string;
  nameEn: string;
  nameVi: string;
  bpm: number;
  gravity?: number;
  scaleId: ScaleId;
  emitters: Array<Omit<Emitter, "nextEmitBeat" | "pulse">>;
  bars: Array<Omit<BarPiece, "flexOffset" | "flexVel" | "hitNx" | "hitNy">>;
  bumpers: Array<Omit<BumperPiece, "pulse">>;
  splitters: Array<Omit<SplitterPiece, "pulse">>;
}
