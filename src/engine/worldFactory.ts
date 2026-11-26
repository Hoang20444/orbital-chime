import type { LevelDef, PresetDef, WorldState } from "./types.ts";

export function createWorldFromLevel(
  level: LevelDef,
  applyHint = false
): WorldState {
  const fixedBars = level.fixedBars.map((b) => ({ ...b, locked: true }));
  const playerBars = applyHint
    ? (level.hintSolution.bars ?? []).map((b) => ({ ...b, locked: false }))
    : level.initialBars.map((b) => ({ ...b, locked: false }));

  const fixedBumpers = level.fixedBumpers.map((b) => ({ ...b, locked: true }));
  const playerBumpers = applyHint
    ? (level.hintSolution.bumpers ?? []).map((b) => ({ ...b, locked: false }))
    : [];

  const fixedSplitters = level.fixedSplitters.map((s) => ({
    ...s,
    locked: true,
  }));
  const playerSplitters = applyHint
    ? (level.hintSolution.splitters ?? []).map((s) => ({ ...s, locked: false }))
    : [];

  return {
    bars: [...fixedBars, ...playerBars],
    bumpers: [...fixedBumpers, ...playerBumpers],
    splitters: [...fixedSplitters, ...playerSplitters],
    rails: [],
    emitters: level.emitters.map((e) => ({
      ...e,
      locked: true,
      nextEmitBeat: e.phaseOffset,
    })),
    rings: level.rings.map((r) => ({ ...r, charge: 0 })),
    marbles: [],
    ripples: [],
    popups: [],
    bpm: level.bpm,
    scaleId: level.scaleId,
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };
}

export function createWorldFromPreset(preset: PresetDef): WorldState {
  return {
    bars: preset.bars.map((b) => ({ ...b, locked: false })),
    bumpers: preset.bumpers.map((b) => ({ ...b, locked: false })),
    splitters: preset.splitters.map((s) => ({ ...s, locked: false })),
    rails: (preset.rails ?? []).map((r) => ({ ...r, locked: false })),
    emitters: preset.emitters.map((e) => ({
      ...e,
      locked: false,
      nextEmitBeat: e.phaseOffset,
    })),
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    bpm: preset.bpm,
    scaleId: preset.scaleId,
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };
}
