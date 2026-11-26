import { GRAVITY, MARBLE_RADIUS } from "../../engine/physics.ts";
import type { BarPiece, Marble, WorldState } from "../../engine/types.ts";
import { MATERIALS } from "../../theme/tokens.ts";
import type { GeneratedSong, MusicalEvent } from "./MusicalEvent.ts";

export const CUE_LEAD_SEC = 0.42;

export interface StageCueTargets {
  melodyBarIds: string[];
  chordBarIds: string[];
  bassBarIds: string[];
  kickBumperId: string;
}

export function buildKineticStageForSong(song: GeneratedSong): {
  world: WorldState;
  targets: StageCueTargets;
} {
  const bars: BarPiece[] = [];
  const melodyBarIds: string[] = [];
  const chordBarIds: string[] = [];
  const bassBarIds: string[] = [];

  // 8 arched melody bars spanning left-to-right, progressively shorter = higher pitch
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const cx = 155 + t * 690;
    const cy = 285 - Math.sin(t * Math.PI) * 38;
    const len = 108 - i * 6.5;
    const tilt = (t - 0.5) * 0.22;
    const dx = Math.cos(tilt) * (len * 0.5);
    const dy = Math.sin(tilt) * (len * 0.5);
    const id = `song_mel_${i}`;
    melodyBarIds.push(id);
    bars.push({
      id,
      ax: cx - dx,
      ay: cy - dy,
      bx: cx + dx,
      by: cy + dy,
      material: i % 2 === 0 ? "marimba" : "ceramic",
    });
  }

  // 4 mid-tier Brass harmony bars
  [240, 415, 585, 760].forEach((cx, i) => {
    const id = `song_chd_${i}`;
    chordBarIds.push(id);
    const len = 120 - i * 8;
    const tilt = i < 2 ? 0.14 : -0.14;
    const dx = Math.cos(tilt) * (len * 0.5);
    const dy = Math.sin(tilt) * (len * 0.5);
    bars.push({
      id,
      ax: cx - dx,
      ay: 438 - dy,
      bx: cx + dx,
      by: 438 + dy,
      material: "brass",
    });
  });

  // 2 lower Slate Felt Bass slabs
  [
    { id: "song_bass_0", ax: 190, ay: 555, bx: 390, by: 542 },
    { id: "song_bass_1", ax: 610, ay: 542, bx: 810, by: 555 },
  ].forEach((b) => {
    bassBarIds.push(b.id);
    bars.push({ ...b, material: "bass" });
  });

  const kickBumperId = "song_kick_bmp";

  const world: WorldState = {
    bars,
    bumpers: [{ id: kickBumperId, x: 500, y: 565, radius: 24 }],
    splitters: [],
    rails: [],
    emitters: [
      // Rail emitters provide visual context; SongDirector drives beat-accurate cue launches
      {
        id: "song_rail_l",
        x: 280,
        y: 86,
        vx: 0,
        vy: 0,
        beatInterval: 9999,
        phaseOffset: 9999,
        nextEmitBeat: 9999,
      },
      {
        id: "song_rail_r",
        x: 720,
        y: 86,
        vx: 0,
        vy: 0,
        beatInterval: 9999,
        phaseOffset: 9999,
        nextEmitBeat: 9999,
      },
    ],
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    bpm: song.bpm,
    scaleId: song.scaleId,
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };

  return {
    world,
    targets: { melodyBarIds, chordBarIds, bassBarIds, kickBumperId },
  };
}

/**
 * Exact inverse-kinematics ballistic solver:
 * Launches a marble so its bottom surface contacts the target bar/bumper top
 * at exact `t = leadSec` after launch.
 */
export function computeCueMarbleLaunch(opts: {
  targetId: string;
  targetX: number;
  targetY: number;
  targetHalfThickness: number;
  leadSec?: number;
  marbleId: number;
  silentCue?: boolean;
  arcSide?: number; // -1..1 horizontal drift
}): Marble {
  const lead = opts.leadSec ?? CUE_LEAD_SEC;
  const contactY = opts.targetY - (MARBLE_RADIUS + opts.targetHalfThickness);
  const sy = Math.max(66, contactY - 145);
  const sx = opts.targetX + (opts.arcSide ?? 0) * 24;

  const vx = (opts.targetX - sx) / lead;
  const vy = (contactY - sy - 0.5 * GRAVITY * lead * lead) / lead;

  return {
    id: opts.marbleId,
    x: sx,
    y: sy,
    prevX: sx,
    prevY: sy,
    vx,
    vy,
    radius: MARBLE_RADIUS,
    age: 0,
    trail: [],
    cooldowns: {},
    splitHistory: {},
    squash: 0,
    squashAngle: 0,
    cueTargetId: opts.targetId,
    silentCue: opts.silentCue ?? true,
  };
}

export function createCueMarbleForEvent(
  ev: MusicalEvent,
  world: WorldState,
  targets: StageCueTargets,
  leadSec = CUE_LEAD_SEC
): Marble | null {
  if (ev.role === "melody" && ev.midi !== undefined) {
    const norm = Math.max(0, Math.min(1, (ev.midi - 64) / 20));
    const idx = Math.min(
      targets.melodyBarIds.length - 1,
      Math.round(norm * (targets.melodyBarIds.length - 1))
    );
    const barId = targets.melodyBarIds[idx];
    const bar = world.bars.find((b) => b.id === barId);
    if (!bar) return null;

    const midX = (bar.ax + bar.bx) * 0.5;
    const midY = (bar.ay + bar.by) * 0.5;
    const halfT = MATERIALS[bar.material].thickness * 0.5;
    return computeCueMarbleLaunch({
      targetId: bar.id,
      targetX: midX,
      targetY: midY,
      targetHalfThickness: halfT,
      leadSec,
      marbleId: world.nextMarbleId++,
      silentCue: true,
      arcSide: idx < 4 ? -0.6 : 0.6,
    });
  }

  if (ev.role === "chords" && ev.stepInBar === 0 && ev.id.endsWith("_0")) {
    const chdIdx = (ev.bar - 1) % targets.chordBarIds.length;
    const bar = world.bars.find((b) => b.id === targets.chordBarIds[chdIdx]);
    if (!bar) return null;
    const midX = (bar.ax + bar.bx) * 0.5;
    const midY = (bar.ay + bar.by) * 0.5;
    return computeCueMarbleLaunch({
      targetId: bar.id,
      targetX: midX,
      targetY: midY,
      targetHalfThickness: MATERIALS[bar.material].thickness * 0.5,
      leadSec,
      marbleId: world.nextMarbleId++,
      silentCue: true,
      arcSide: chdIdx < 2 ? -0.8 : 0.8,
    });
  }

  if (ev.role === "bass" && ev.stepInBar === 0) {
    const bassIdx = (ev.bar - 1) % targets.bassBarIds.length;
    const bar = world.bars.find((b) => b.id === targets.bassBarIds[bassIdx]);
    if (!bar) return null;
    const midX = (bar.ax + bar.bx) * 0.5;
    const midY = (bar.ay + bar.by) * 0.5;
    return computeCueMarbleLaunch({
      targetId: bar.id,
      targetX: midX,
      targetY: midY,
      targetHalfThickness: MATERIALS[bar.material].thickness * 0.5,
      leadSec,
      marbleId: world.nextMarbleId++,
      silentCue: true,
      arcSide: bassIdx === 0 ? -0.5 : 0.5,
    });
  }

  if (ev.role === "drums" && ev.drumId === "kick" && ev.stepInBar === 0) {
    const bmp = world.bumpers.find((b) => b.id === targets.kickBumperId);
    if (!bmp) return null;
    return computeCueMarbleLaunch({
      targetId: bmp.id,
      targetX: bmp.x,
      targetY: bmp.y,
      targetHalfThickness: bmp.radius,
      leadSec,
      marbleId: world.nextMarbleId++,
      silentCue: true,
      arcSide: 0,
    });
  }

  return null;
}
