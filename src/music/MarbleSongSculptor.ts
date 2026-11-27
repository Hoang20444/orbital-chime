import type { MelodicInstrumentId } from "../audio/instruments/types.ts";
import type {
  MarbleSongDef,
  SongHitNote,
  SongPhraseChain,
} from "../data/marbleSongs.ts";
import {
  closestPointOnSegment,
  FIXED_DT,
  MARBLE_RADIUS,
  MAX_SPEED,
  resolveMarbleOnDualRail,
  stepFixed,
} from "../engine/physics.ts";
import {
  buildRailGeometry,
  projectPointOntoRail,
  type RailGeometry,
} from "../engine/railGeometry.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  RailVariant,
  TransferRailPiece,
  WorldState,
} from "../engine/types.ts";
import { MATERIALS } from "../theme/tokens.ts";

const SUB_STEPS = 2;
const SUB_DT = FIXED_DT / SUB_STEPS;
export const SONG_LEAD_IN_TICKS = 90; // 0.75s synchronized lead-in across all parallel chains
export const SONG_GRAVITY = 940; // Deep parabolic gravity for visibly rounded bounce arcs

export function computeSongOneLoopTicks(loopBeats: number, bpm: number): number {
  const loopSec = (loopBeats * 60) / bpm;
  return Math.floor(loopSec / FIXED_DT) + SONG_LEAD_IN_TICKS - 7;
}

interface SimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface WaypointNote extends SongHitNote {
  silent?: boolean;
  pieceKind?: "bar" | "bumper";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clampVel(s: SimState): void {
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > MAX_SPEED) {
    const k = MAX_SPEED / sp;
    s.vx *= k;
    s.vy *= k;
  }
}

function solveExactBounce(
  inState: SimState,
  targetNextX: number,
  targetNextY: number,
  substepsAfterBounce: number
): {
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  restitution: number;
  penetration: number;
} {
  let nx = 0;
  let ny = -1;
  let restitution = 0.85;
  let penetration = 0.35;

  const N = substepsAfterBounce;
  const totalTime = N * SUB_DT;
  const gravDisp = 0.5 * N * (N + 1) * SUB_DT * SUB_DT * SONG_GRAVITY;

  for (let iter = 0; iter < 6; iter++) {
    const vnEstimate = inState.vx * nx + inState.vy * ny;
    penetration = Math.min(0.85, Math.max(0.06, Math.abs(vnEstimate) * SUB_DT * 0.62));
    const pushedX = inState.x + nx * penetration;
    const pushedY = inState.y + ny * penetration;

    const reqVxPost = (targetNextX - pushedX) / totalTime;
    const reqVyPost = (targetNextY - pushedY - gravDisp) / totalTime;

    const rawVxOut = reqVxPost / 0.996;
    const rawVyOut = reqVyPost / 0.996;

    let ux = rawVxOut - inState.vx;
    let uy = rawVyOut - inState.vy;
    let uLen = Math.hypot(ux, uy);
    if (uLen < 1e-4) {
      ux = 0;
      uy = -100;
      uLen = 100;
    }
    nx = ux / uLen;
    ny = uy / uLen;

    const vn = inState.vx * nx + inState.vy * ny;
    if (vn < -10) {
      restitution = uLen / -vn - 1;
    } else {
      nx = 0;
      ny = -1;
      restitution = 0.85;
    }
    restitution = Math.max(0.05, Math.min(4.8, restitution));
  }

  return {
    tx: -ny,
    ty: nx,
    nx,
    ny,
    restitution,
    penetration,
  };
}

function buildContinuousWaypoints(
  chain: SongPhraseChain,
  bpm: number,
  allowExtraMidRelays: boolean
): WaypointNote[] {
  const maxGapBeats = Math.max(0.95, (0.86 * bpm) / 60);
  const minHalfBeats = Math.max(0.42, (18 * FIXED_DT * bpm) / 60);
  const out: WaypointNote[] = [];
  let notesSinceRelay = 0;
  let extraRelays = 0;

  for (let i = 0; i < chain.notes.length; i++) {
    const curr = chain.notes[i];
    out.push({ ...curr, pieceKind: "bar" });
    notesSinceRelay++;

    if (i < chain.notes.length - 1) {
      const next = chain.notes[i + 1];
      const gap = next.beat - curr.beat;
      if (gap > maxGapBeats) {
        const segments = Math.ceil(gap / maxGapBeats);
        for (let s = 1; s < segments; s++) {
          const midBeat = curr.beat + (gap * s) / segments;
          out.push({
            beat: Math.round(midBeat * 100) / 100,
            material: curr.material,
            silent: true,
            pieceKind: "bumper",
          });
        }
        notesSinceRelay = 0;
      } else if (
        allowExtraMidRelays &&
        gap >= 0.85 &&
        gap * 0.5 >= minHalfBeats &&
        notesSinceRelay >= 2 &&
        extraRelays < 9
      ) {
        out.push({
          beat: Math.round((curr.beat + gap * 0.5) * 100) / 100,
          material: curr.material,
          silent: true,
          pieceKind: "bumper",
        });
        notesSinceRelay = 0;
        extraRelays++;
      }
    }
  }
  return out;
}

function layoutZigzagX(
  chain: SongPhraseChain,
  waypoints: WaypointNote[],
  halfLen: number,
  chainIndex: number,
  bpm: number
): number[] {
  const pad = halfLen + 14;
  const minBound = (chain.minX ?? Math.min(chain.startX, 90)) + pad * 0.5;
  const maxBound = Math.max(minBound + 150, chain.maxX - pad * 0.5);
  const corridorW = maxBound - minBound;

  const nominalMinStep = Math.min(corridorW * 0.36, Math.max(halfLen + 52, 108));
  const baseStep = Math.min(corridorW * 0.46, Math.max(nominalMinStep + 16, chain.stepX * 1.08));
  const stepMod = [0.94, 1.18, 0.86, 1.12, 1.02, 0.9];

  let x = Math.max(minBound, Math.min(maxBound, chain.startX));
  let dir = x > (minBound + maxBound) * 0.5 ? -1 : 1;
  let stepsInLeg = 0;

  const xs: number[] = [x];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const dtBeat = Math.max(0.2, waypoints[i + 1].beat - waypoints[i].beat);
    const dtSec = (dtBeat * 60) / bpm;

    const maxSafeDist = Math.max(46, Math.min(corridorW * 0.58, dtSec * 385));
    const minStep = Math.min(maxSafeDist * 0.85, dtBeat <= 0.35 ? 46 : nominalMinStep);
    const mod = stepMod[(i + chainIndex * 2) % stepMod.length];
    const beatScale = Math.min(1.2, Math.max(0.78, Math.sqrt(dtBeat * 1.06)));
    const desiredDist = Math.max(
      minStep,
      Math.min(maxSafeDist, baseStep * beatScale * mod)
    );

    // Sweep in 2-hop staggered diagonal waves across the corridor (turning at walls or after 2 hops)
    // so bars neither line up in flat horizontal rows NOR stack in 2 rigid vertical columns
    const legCap = corridorW >= 340 && (i + chainIndex) % 4 !== 2 ? 2 : 1;
    const roomAhead = dir > 0 ? maxBound - x : x - minBound;
    if (stepsInLeg >= legCap || roomAhead < minStep * 0.92) {
      dir *= -1;
      stepsInLeg = 0;
    }

    const jitterPad = ((i * 23 + chainIndex * 13) % 34) + 6;
    let nextX = x + dir * desiredDist;
    if (nextX > maxBound - jitterPad * 0.4) {
      nextX = maxBound - jitterPad * 0.4;
      stepsInLeg = legCap;
    } else if (nextX < minBound + jitterPad * 0.4) {
      nextX = minBound + jitterPad * 0.4;
      stepsInLeg = legCap;
    }

    if (Math.abs(nextX - x) < minStep * 0.88) {
      dir *= -1;
      stepsInLeg = 0;
      nextX = Math.max(minBound, Math.min(maxBound, x + dir * desiredDist));
    }

    x = nextX;
    stepsInLeg++;
    xs.push(x);
  }
  return xs;
}

function buildLeadInDualRail(
  songId: string,
  chain: SongPhraseChain,
  cIdx: number,
  dir0: number,
  targetX: number,
  targetY: number,
  phaseOffset: number,
  loopBeats: number
): {
  emitter: Emitter;
  rail: TransferRailPiece;
} | null {
  const variants: RailVariant[] = cIdx % 2 === 0 ? ["v", "straight"] : ["straight", "v"];
  const rotScales = [1.0, 1.18, 0.84];

  for (const variant of variants) {
    for (const rs of rotScales) {
      const baseRot = variant === "v" ? 0.64 : 0.82;
      const localRail: TransferRailPiece = {
        id: `song_${songId}_${chain.id}_leadrail`,
        variant,
        x: 0,
        y: 0,
        rotation: (dir0 > 0 ? baseRot : -baseRot) * rs,
        armLength: 48,
        openingAngle: variant === "v" ? 112 : 90,
        curvature: variant === "v" ? 0.62 : 0.5,
        slopeBias: variant === "v" ? 0.08 : 0,
        railSpacing: 12.8,
        bridgeSpacing: 38,
        boost: variant === "v" ? 0.24 : 0.26,
        flipped: dir0 < 0,
        trackChannel: chain.trackChannel,
      };

      const localGeom = buildRailGeometry(localRail);
      const emLocalX =
        localGeom.entryPoint.x +
        localGeom.entryTangent.x * 12 +
        localGeom.entryUpNormal.x * (localGeom.supportHeight + 5);
      const emLocalY =
        localGeom.entryPoint.y +
        localGeom.entryTangent.y * 12 +
        localGeom.entryUpNormal.y * (localGeom.supportHeight + 5);
      const emVx = round2(localGeom.entryTangent.x * 58);
      const emVy = round2(localGeom.entryTangent.y * 58);

      const substepsTotal = SONG_LEAD_IN_TICKS * SUB_STEPS;
      const simBody = {
        x: emLocalX,
        y: emLocalY,
        vx: emVx,
        vy: emVy,
        radius: MARBLE_RADIUS,
      };
      let wasOnRail = false;
      let entered = false;
      let exited = false;
      let enterSub = -1;
      let exitSub = -1;

      for (let s = 0; s < substepsTotal; s++) {
        simBody.vy += SONG_GRAVITY * SUB_DT;
        clampVel(simBody);
        simBody.x += simBody.vx * SUB_DT;
        simBody.y += simBody.vy * SUB_DT;
        const res = resolveMarbleOnDualRail(simBody, localRail, localGeom, SUB_DT);
        clampVel(simBody);
        if (res.onRail) {
          if (!entered) enterSub = s;
          entered = true;
          wasOnRail = true;
        } else if (wasOnRail) {
          wasOnRail = false;
          exited = true;
          exitSub = s;
        }
      }

      if (
        !entered ||
        !exited ||
        exitSub - enterSub < 22 ||
        exitSub > substepsTotal - 42 ||
        simBody.vy <= 120 ||
        Math.hypot(simBody.vx, simBody.vy) > MAX_SPEED - 40
      ) {
        continue;
      }

      const shiftX = targetX - simBody.x;
      const shiftY = targetY - simBody.y;

      const rail: TransferRailPiece = {
        ...localRail,
        x: round2(shiftX),
        y: round2(shiftY),
        rotation: round3(localRail.rotation),
      };
      const emitter: Emitter = {
        id: `song_em_${chain.id}`,
        x: round2(emLocalX + shiftX),
        y: round2(emLocalY + shiftY),
        vx: emVx,
        vy: emVy,
        beatInterval: loopBeats,
        phaseOffset,
        locked: false,
        trackChannel: chain.trackChannel,
        nextEmitBeat: phaseOffset,
        pulse: 0,
      };

      return { emitter, rail };
    }
  }
  return null;
}

function makeChainWorld(
  song: MarbleSongDef,
  emitter: Emitter,
  rails: TransferRailPiece[]
): WorldState {
  return {
    bpm: song.bpm,
    gravity: SONG_GRAVITY,
    scaleId: song.scaleId,
    bars: [
      {
        id: "__sculpt_floor__",
        ax: -9999,
        ay: 18000,
        bx: -9900,
        by: 18000,
        material: "bass",
        trackChannel: "__sculpt_floor__",
        silent: true,
      },
    ],
    bumpers: [],
    splitters: [],
    rails: rails.map((r) => ({ ...r })),
    emitters: [{ ...emitter }],
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };
}

function cloneWorldForProbe(w: WorldState): WorldState {
  return {
    ...w,
    bars: w.bars.map((b) => ({ ...b })),
    bumpers: w.bumpers.map((b) => ({ ...b })),
    splitters: [],
    rails: w.rails.map((r) => ({ ...r })),
    emitters: w.emitters.map((e) => ({ ...e })),
    rings: [],
    marbles: w.marbles.map((m) => ({
      ...m,
      trail: [...m.trail],
      cooldowns: { ...m.cooldowns },
      splitHistory: { ...m.splitHistory },
    })),
    ripples: [],
    popups: [],
  };
}

interface MidRailCandidateSpec {
  variant: RailVariant;
  armLength: number;
  rotMag: number;
  openingAngle: number;
  curvature: number;
  slopeBias: number;
  bridgeSpacing: number;
  boost: number;
  catchTicks: number;
  catchDx: number;
  catchDy: number;
}

function buildMidRailCandidates(
  totalBridgeTicks: number,
  seed: number
): MidRailCandidateSpec[] {
  const order: RailVariant[] =
    seed % 3 === 0
      ? ["v", "straight", "s"]
      : seed % 3 === 1
        ? ["straight", "v", "s"]
        : ["v", "s", "straight"];

  const specs: MidRailCandidateSpec[] = [];
  const baseArm =
    totalBridgeTicks < 76 ? 37 : totalBridgeTicks <= 125 ? 50 : 62;
  const bridgeSp =
    totalBridgeTicks < 76 ? 26 : totalBridgeTicks <= 125 ? 34 : 42;

  for (const catchFrac of [0.38, 0.26]) {
    const catchTicks = Math.max(12, Math.min(72, Math.round(totalBridgeTicks * catchFrac)));
    const catchSec = catchTicks * FIXED_DT;
    const catchDrop = 0.5 * SONG_GRAVITY * catchSec * catchSec;
    const catchDx = Math.min(130, Math.max(38, Math.round(catchTicks * 1.75)));
    const catchDy = Math.max(16, Math.min(115, Math.round(catchDrop * 0.76)));

    for (const v of order) {
      specs.push(
        {
          variant: v,
          armLength: v === "v" ? baseArm + 2 : baseArm,
          rotMag: v === "v" ? 0.68 : 0.48,
          openingAngle: 114,
          curvature: 0.64,
          slopeBias: v === "v" ? 0.12 : 0.05,
          bridgeSpacing: bridgeSp,
          boost: v === "v" ? 0.28 : 0.2,
          catchTicks,
          catchDx,
          catchDy,
        },
        {
          variant: v,
          armLength: v === "v" ? baseArm + 8 : baseArm + 6,
          rotMag: v === "v" ? 0.78 : 0.58,
          openingAngle: 110,
          curvature: 0.62,
          slopeBias: v === "v" ? 0.1 : 0.05,
          bridgeSpacing: bridgeSp + 4,
          boost: v === "v" ? 0.22 : 0.15,
          catchTicks,
          catchDx,
          catchDy,
        }
      );
    }
  }
  return specs;
}

function tryPlaceMidSongDualRail(
  song: MarbleSongDef,
  chain: SongPhraseChain,
  cIdx: number,
  midRailCount: number,
  barNote: WaypointNote,
  musicIdx: number,
  timbreOverride: MelodicInstrumentId | undefined,
  midSnapshot: WorldState,
  midTick: number,
  curTick: number,
  curState: SimState,
  prevDtTicks: number,
  halfLen: number,
  totalBridgeTicks: number,
  minBound: number,
  maxBound: number,
  existingRailGeoms: RailGeometry[]
): {
  bar: BarPiece;
  rail: TransferRailPiece;
  railGeom: RailGeometry;
  endX: number;
} | null {
  if (totalBridgeTicks < 52 || totalBridgeTicks > 220) return null;

  const midCorridor = (minBound + maxBound) * 0.5;
  const primaryDir = curState.x > midCorridor ? -1 : 1;
  const dirs = [primaryDir, -primaryDir];
  const candidates = buildMidRailCandidates(totalBridgeTicks, cIdx + midRailCount);

  const spec = MATERIALS[barNote.material];
  const minDist = MARBLE_RADIUS + spec.thickness * 0.5;
  const minDistSq = (minDist - 0.05) * (minDist - 0.05);
  const maxBackSteps = Math.max(32, Math.min(90, prevDtTicks * SUB_STEPS - 6));

  const resolvedInst: MelodicInstrumentId | undefined = barNote.drum
    ? undefined
    : timbreOverride ?? barNote.instrument ?? chain.defaultInstrument;

  for (const railDir of dirs) {
    for (const cand of candidates) {
      if (cand.catchTicks >= totalBridgeTicks - 22) continue;

      const candidateRail: TransferRailPiece = {
        id: `song_${song.id}_${chain.id}_midrail_${midRailCount}`,
        variant: cand.variant,
        x: 0,
        y: 0,
        rotation: railDir > 0 ? cand.rotMag : -cand.rotMag,
        armLength: cand.armLength,
        openingAngle: cand.variant === "v" ? cand.openingAngle : 90,
        curvature: cand.curvature,
        slopeBias: cand.slopeBias,
        railSpacing: 12.8,
        bridgeSpacing: cand.bridgeSpacing,
        boost: cand.boost,
        flipped: railDir < 0,
        trackChannel: chain.trackChannel,
      };

      const localGeom = buildRailGeometry(candidateRail);
      const catchLocalX =
        localGeom.entryPoint.x +
        localGeom.entryTangent.x * 10 +
        localGeom.entryUpNormal.x * (localGeom.supportHeight + 0.45);
      const catchLocalY =
        localGeom.entryPoint.y +
        localGeom.entryTangent.y * 10 +
        localGeom.entryUpNormal.y * (localGeom.supportHeight + 0.45);

      const catchWorldX = round2(curState.x + railDir * cand.catchDx);
      const catchWorldY = round2(curState.y + cand.catchDy);

      const rail: TransferRailPiece = {
        ...candidateRail,
        x: round2(catchWorldX - catchLocalX),
        y: round2(catchWorldY - catchLocalY),
        rotation: round3(candidateRail.rotation),
      };
      const railGeom = buildRailGeometry(rail);

      if (railGeom.bounds.minX < minBound - 28 || railGeom.bounds.maxX > maxBound + 28) {
        continue;
      }

      let overlapsExisting = false;
      for (const eg of existingRailGeoms) {
        if (
          !(
            railGeom.bounds.maxX + 20 < eg.bounds.minX ||
            railGeom.bounds.minX - 20 > eg.bounds.maxX ||
            railGeom.bounds.maxY + 20 < eg.bounds.minY ||
            railGeom.bounds.minY - 20 > eg.bounds.maxY
          )
        ) {
          overlapsExisting = true;
          break;
        }
      }
      if (overlapsExisting) continue;

      for (const eb of midSnapshot.bars) {
        if (eb.id === "__sculpt_floor__") continue;
        const bMinX = Math.min(eb.ax, eb.bx) - 14;
        const bMaxX = Math.max(eb.ax, eb.bx) + 14;
        const bMinY = Math.min(eb.ay, eb.by) - 14;
        const bMaxY = Math.max(eb.ay, eb.by) + 14;
        if (
          !(
            railGeom.bounds.maxX < bMinX ||
            railGeom.bounds.minX > bMaxX ||
            railGeom.bounds.maxY < bMinY ||
            railGeom.bounds.minY > bMaxY
          )
        ) {
          overlapsExisting = true;
          break;
        }
      }
      if (overlapsExisting) continue;

      const catchSubsteps = cand.catchTicks * SUB_STEPS;
      const solved = solveExactBounce(curState, catchWorldX, catchWorldY, catchSubsteps);
      let maxBarHalf = halfLen;
      if (Math.abs(solved.ny) < 0.72) maxBarHalf = Math.min(maxBarHalf, 24);

      const cx = curState.x - solved.nx * (minDist - solved.penetration);
      const cy = curState.y - solved.ny * (minDist - solved.penetration);
      const barId = `song_${song.id}_${chain.id}_${musicIdx}`;

      const makeBarWithHalf = (hl: number): BarPiece => ({
        id: barId,
        ax: round2(cx - solved.tx * hl),
        ay: round2(cy - solved.ty * hl),
        bx: round2(cx + solved.tx * hl),
        by: round2(cy + solved.ty * hl),
        material: barNote.material,
        locked: false,
        fixedMidi: barNote.midi,
        instrumentOverride: resolvedInst,
        drumOverride: barNote.drum,
        customRestitution: round4(solved.restitution),
        noteLabel: barNote.label,
        trackChannel: chain.trackChannel,
      });

      const halfOptions = [maxBarHalf, 24, 20, 16].filter(
        (v, idx, arr) => v <= maxBarHalf + 0.01 && arr.indexOf(v) === idx
      );
      let chosenBar: BarPiece | null = null;
      for (const hl of halfOptions) {
        const testBar = makeBarWithHalf(hl);
        let clipsEarly = false;
        for (let k = 1; k <= maxBackSteps; k++) {
          const dtBack = k * SUB_DT;
          const px = curState.x - curState.vx * dtBack;
          const py = curState.y - curState.vy * dtBack + 0.5 * SONG_GRAVITY * dtBack * dtBack;
          const cp = closestPointOnSegment(px, py, testBar.ax, testBar.ay, testBar.bx, testBar.by);
          if ((px - cp.cx) ** 2 + (py - cp.cy) ** 2 < minDistSq) {
            clipsEarly = true;
            break;
          }
        }
        if (!clipsEarly) {
          chosenBar = testBar;
          break;
        }
      }
      if (!chosenBar) continue;

      // Simulate from midSnapshot -> nextTargetTick in real stepFixed for 100% bit-exact parity
      const probe = cloneWorldForProbe(midSnapshot);
      probe.bars.push({ ...chosenBar });
      probe.rails.push({ ...rail });

      const nextTargetTick = curTick + totalBridgeTicks;
      let barHitCount = 0;
      let barHitTick = -1;
      let otherBarHits = 0;
      let bumperHits = 0;
      let entered = false;
      let exited = false;
      let enterTick = -1;
      let exitTick = -1;

      for (let t = midTick; t < nextTargetTick; t++) {
        const evs = stepFixed(probe, true);
        for (const ev of evs) {
          if (ev.type === "bar_hit") {
            if (ev.barId === chosenBar.id) {
              barHitCount++;
              barHitTick = t;
            } else {
              otherBarHits++;
            }
          } else if (ev.type === "bumper_hit") {
            bumperHits++;
          } else if (ev.type === "rail_enter" && ev.railId === rail.id) {
            if (!entered) enterTick = t;
            entered = true;
          } else if (ev.type === "rail_exit" && ev.railId === rail.id) {
            exited = true;
            exitTick = t;
          }
        }
      }

      const m = probe.marbles[0];
      const endRailClear = m ? projectPointOntoRail(railGeom, m.x, m.y).dist : 0;
      if (
        !m ||
        barHitCount !== 1 ||
        Math.abs(barHitTick - curTick) > 1 ||
        otherBarHits > 0 ||
        bumperHits > 0 ||
        !entered ||
        !exited ||
        exitTick - enterTick < 11 ||
        exitTick > nextTargetTick - 12 ||
        m.vy <= 135 ||
        Math.hypot(m.vx, m.vy) > MAX_SPEED - 35 ||
        endRailClear < 38 ||
        m.y < railGeom.bounds.maxY - 2 ||
        m.x < minBound - 20 ||
        m.x > maxBound + 20
      ) {
        continue;
      }

      return {
        bar: chosenBar,
        rail,
        railGeom,
        endX: m.x,
      };
    }
  }

  return null;
}

function buildChainSculpture(
  song: MarbleSongDef,
  chain: SongPhraseChain,
  cIdx: number,
  masterTopY: number,
  yPerBeat: number,
  timbreOverride: MelodicInstrumentId | undefined,
  allowMidRails: boolean,
  allowExtraMidRelays: boolean
): {
  emitter: Emitter;
  bars: BarPiece[];
  bumpers: BumperPiece[];
  rails: TransferRailPiece[];
} {
  const beatPerTick = (song.bpm / 60) * FIXED_DT;
  const waypoints = buildContinuousWaypoints(chain, song.bpm, allowExtraMidRelays);
  const baseBarLen = Math.max(56, Math.min(96, chain.barLen || 64));
  const xs = layoutZigzagX(chain, waypoints, baseBarLen * 0.5, cIdx, song.bpm);
  const pad = baseBarLen * 0.5 + 14;
  const minBound = (chain.minX ?? Math.min(chain.startX, 90)) + pad * 0.5;
  const maxBound = Math.max(minBound + 150, chain.maxX - pad * 0.5);

  const railGeoms: RailGeometry[] = [];
  const firstNote = waypoints[0];
  const phaseOffset = Math.max(0, firstNote.beat);
  const emitTick = Math.round(phaseOffset / beatPerTick);
  const note0TargetX = round2(xs[0]);
  const note0TargetY = round2(masterTopY + firstNote.beat * yPerBeat * 0.65);
  const dir0 = xs.length > 1 && xs[1] < xs[0] ? -1 : 1;

  let emitter: Emitter;
  const initialRails: TransferRailPiece[] = [];

  const leadIn = buildLeadInDualRail(
    song.id,
    chain,
    cIdx,
    dir0,
    note0TargetX,
    note0TargetY,
    phaseOffset,
    song.loopBeats
  );

  if (leadIn) {
    emitter = leadIn.emitter;
    initialRails.push(leadIn.rail);
    railGeoms.push(buildRailGeometry(leadIn.rail));
  } else {
    const dropDist = 0.5 * SONG_GRAVITY * Math.pow(SONG_LEAD_IN_TICKS * FIXED_DT, 2);
    emitter = {
      id: `song_em_${chain.id}`,
      x: note0TargetX,
      y: round2(note0TargetY - dropDist),
      vx: 0,
      vy: 0,
      beatInterval: song.loopBeats,
      phaseOffset,
      locked: false,
      trackChannel: chain.trackChannel,
      nextEmitBeat: phaseOffset,
      pulse: 0,
    };
  }

  // Live physics-synchronized world + mid-flight snapshot for 100% bit-exact collision replay
  const chainWorld = makeChainWorld(song, emitter, initialRails);
  let curTick = emitTick + SONG_LEAD_IN_TICKS;
  const leadMidGap = 16;
  const preMidTick = Math.max(0, curTick - leadMidGap);
  for (let t = 0; t < preMidTick; t++) {
    stepFixed(chainWorld, true);
  }
  let midSnapshot = cloneWorldForProbe(chainWorld);
  let midTick = preMidTick;
  for (let t = preMidTick; t < curTick; t++) {
    stepFixed(chainWorld, true);
  }

  let musicIdx = 0;
  let bumperCount = 0;
  let midRailCount = 0;
  let relaySlotIndex = 0;
  let barsSinceRail = 0;
  let sameDirStreak = 0;
  let prevDtTicks = 30;
  const minBarsBetweenDirectRails = chain.notes.length <= 16 ? 2 : 3;

  for (let i = 0; i < waypoints.length; i++) {
    const activeMarble = chainWorld.marbles[0];
    if (!activeMarble) break;
    const curState: SimState = {
      x: activeMarble.x,
      y: activeMarble.y,
      vx: activeMarble.vx,
      vy: activeMarble.vy,
    };

    const note = waypoints[i];
    const spec = MATERIALS[note.material];
    const isBumper = note.pieceKind === "bumper";
    const radiusBumper = 14;
    const minDist = MARBLE_RADIUS + (isBumper ? radiusBumper : spec.thickness * 0.5);

    // 1. Relay-bridged Mid-Song Dual-Support Rail (converts 2 out of 3 relay gaps into Dual-Support Rails, keeping 1/3 as Elastic Bumpers)
    if (
      allowMidRails &&
      !note.silent &&
      i + 2 < waypoints.length &&
      waypoints[i + 1]?.pieceKind === "bumper"
    ) {
      const nextReal = waypoints[i + 2];
      const nextRealTick = Math.round(nextReal.beat / beatPerTick) + SONG_LEAD_IN_TICKS;
      const totalBridgeTicks = nextRealTick - curTick;
      const preferRailHere = relaySlotIndex % 3 !== 2;
      relaySlotIndex++;

      if (preferRailHere && totalBridgeTicks >= 56 && totalBridgeTicks <= 220) {
        const res = tryPlaceMidSongDualRail(
          song,
          chain,
          cIdx,
          midRailCount,
          note,
          musicIdx,
          timbreOverride,
          midSnapshot,
          midTick,
          curTick,
          curState,
          prevDtTicks,
          baseBarLen * 0.5,
          totalBridgeTicks,
          minBound,
          maxBound,
          railGeoms
        );
        if (res) {
          const replayWorld = cloneWorldForProbe(midSnapshot);
          replayWorld.bars.push(res.bar);
          replayWorld.rails.push(res.rail);
          railGeoms.push(res.railGeom);
          musicIdx++;
          midRailCount++;
          barsSinceRail = 0;

          const newMidTick = curTick + Math.max(10, totalBridgeTicks - 10);
          for (let t = midTick; t < newMidTick; t++) {
            stepFixed(replayWorld, true);
          }
          midSnapshot = cloneWorldForProbe(replayWorld);
          midTick = newMidTick;
          for (let t = newMidTick; t < nextRealTick; t++) {
            stepFixed(replayWorld, true);
          }
          Object.assign(chainWorld, replayWorld);
          curTick = nextRealTick;
          prevDtTicks = totalBridgeTicks;
          xs[i + 2] = chainWorld.marbles[0]?.x ?? res.endX;
          i++; // skip bumper relay slot consumed by Dual-Support Rail
          continue;
        }
      }
    }

    // 2. Direct Bar-to-Bar Mid-Song Dual-Support Rail on >= 0.75-1.0 beat musical intervals
    if (
      allowMidRails &&
      !note.silent &&
      i + 1 < waypoints.length &&
      !waypoints[i + 1]?.silent &&
      barsSinceRail >= minBarsBetweenDirectRails
    ) {
      const nextReal = waypoints[i + 1];
      const nextRealTick = Math.round(nextReal.beat / beatPerTick) + SONG_LEAD_IN_TICKS;
      const totalBridgeTicks = nextRealTick - curTick;
      if (totalBridgeTicks >= 54 && totalBridgeTicks <= 185) {
        const res = tryPlaceMidSongDualRail(
          song,
          chain,
          cIdx,
          midRailCount,
          note,
          musicIdx,
          timbreOverride,
          midSnapshot,
          midTick,
          curTick,
          curState,
          prevDtTicks,
          baseBarLen * 0.5,
          totalBridgeTicks,
          minBound,
          maxBound,
          railGeoms
        );
        if (res) {
          const replayWorld = cloneWorldForProbe(midSnapshot);
          replayWorld.bars.push(res.bar);
          replayWorld.rails.push(res.rail);
          railGeoms.push(res.railGeom);
          musicIdx++;
          midRailCount++;
          barsSinceRail = 0;

          const newMidTick = curTick + Math.max(10, totalBridgeTicks - 10);
          for (let t = midTick; t < newMidTick; t++) {
            stepFixed(replayWorld, true);
          }
          midSnapshot = cloneWorldForProbe(replayWorld);
          midTick = newMidTick;
          for (let t = newMidTick; t < nextRealTick; t++) {
            stepFixed(replayWorld, true);
          }
          Object.assign(chainWorld, replayWorld);
          curTick = nextRealTick;
          prevDtTicks = totalBridgeTicks;
          xs[i + 1] = chainWorld.marbles[0]?.x ?? res.endX;
          continue;
        }
      }
    }

    let nextX: number;
    let nextY: number;
    let dtTicks: number;
    let halfLen = baseBarLen * 0.5;

    if (i < waypoints.length - 1) {
      const nextNote = waypoints[i + 1];
      const nextTargetTick = Math.round(nextNote.beat / beatPerTick) + SONG_LEAD_IN_TICKS;
      dtTicks = Math.max(8, nextTargetTick - curTick);

      const dtSec = dtTicks * FIXED_DT;
      const arcDropBudget = 0.5 * SONG_GRAVITY * dtSec * dtSec;
      const dtBeat = nextNote.beat - note.beat;
      const isRapid16th = dtBeat <= 0.35;
      const corridorW = maxBound - minBound;

      // Weave across varied multi-station X offsets (never stacking in 2 rigid vertical columns
      // and never lining up in flat horizontal rows), while reversing vx for clean upward arcs
      const incomingDir =
        curState.vx > 35
          ? 1
          : curState.vx < -35
            ? -1
            : curState.x > (minBound + maxBound) * 0.5
              ? 1
              : -1;
      const wantDir = i === 0 ? dir0 : -incomingDir;
      const roomWant = wantDir > 0 ? maxBound - curState.x : curState.x - minBound;
      const useDir = roomWant >= 76 ? wantDir : -wantDir;
      sameDirStreak = i > 0 && useDir === incomingDir ? sameDirStreak + 1 : 0;

      const spanTable = [0.68, 0.98, 0.76, 0.92, 0.64, 0.86];
      const spanFactor = spanTable[(i + cIdx * 2) % spanTable.length];
      const minLiveSpan = isRapid16th ? 46 : Math.min(98, corridorW * 0.36);
      const maxLiveSpan = Math.max(48, Math.min(corridorW * 0.74, dtSec * 385));
      const liveSpan = Math.max(
        minLiveSpan,
        Math.min(maxLiveSpan, maxLiveSpan * spanFactor)
      );
      const wallInset = ((i * 23 + cIdx * 11) % 36) + 4;
      nextX = Math.max(
        minBound + wallInset * 0.5,
        Math.min(maxBound - wallInset * 0.5, curState.x + useDir * liveSpan)
      );

      const dxNext = nextX - curState.x;
      const dxAbs = Math.abs(dxNext);
      const dxPrev = i > 0 ? curState.x - xs[i - 1] : dxNext;

      const durationBonus = dtBeat >= 1.4 ? 18 : dtBeat >= 0.9 ? 10 : 0;
      const roleLen = isRapid16th
        ? Math.min(46, Math.max(38, baseBarLen * 0.72))
        : note.silent
          ? Math.min(74, Math.max(60, baseBarLen))
          : note.material === "bass"
            ? Math.max(baseBarLen, 74) + durationBonus * 0.4
            : baseBarLen + durationBonus;
      const spanMin = Math.max(48, Math.min(dxAbs, Math.max(48, Math.abs(dxPrev))));
      const maxSafeLen = isRapid16th
        ? Math.min(46, Math.max(36, (spanMin - minDist - 12) * 0.75))
        : Math.min(92, Math.max(54, (spanMin - minDist - 14) * 0.84));
      halfLen = Math.min(92, Math.max(36, Math.min(roleLen, maxSafeLen))) * 0.5;
      if (i === 0 || useDir === incomingDir) {
        halfLen = Math.min(halfLen, 26);
      }

      const staggerPhase = (i + cIdx) % 3;
      let targetDy: number;
      if (isRapid16th) {
        targetDy = staggerPhase === 1 ? 26 : 20;
      } else if (i === 0) {
        targetDy = Math.max(42, Math.min(82, Math.round(arcDropBudget * 0.64)));
      } else if (useDir === incomingDir) {
        targetDy = Math.max(40, Math.min(68, Math.round(arcDropBudget * 0.7)));
      } else if (barsSinceRail === 0) {
        targetDy = Math.max(42, Math.min(88, Math.round(arcDropBudget * 0.78)));
      } else if (dtBeat < 0.82) {
        const ratio = staggerPhase === 0 ? 0.76 : staggerPhase === 1 ? 0.9 : 0.82;
        targetDy = Math.max(38, Math.min(74, Math.round(arcDropBudget * ratio)));
      } else {
        // Longer beat intervals: graceful upward parabolic arch with safe apex clearance
        const maxUpSpeed = 125;
        const minApexSafeDy = Math.round(arcDropBudget - maxUpSpeed * dtSec);
        const desiredLongDy = Math.round(arcDropBudget * (staggerPhase === 1 ? 0.82 : 0.7));
        targetDy = Math.max(58, minApexSafeDy, Math.min(156, desiredLongDy));
      }

      const maxPhysicalDy = Math.floor(arcDropBudget + Math.max(-20, curState.vy - 135) * dtSec);
      if (maxPhysicalDy > 26) {
        targetDy = Math.min(targetDy, maxPhysicalDy);
      }
      targetDy = Math.max(isRapid16th ? 20 : 38, targetDy);

      nextY = curState.y + targetDy;
    } else {
      halfLen = Math.min(34, Math.max(baseBarLen, 64) * 0.5);
      dtTicks = 36;
      const dirSign = curState.vx > 15 ? -1 : 1;
      const exitVx = dirSign * Math.max(210, Math.min(310, Math.abs(curState.vx)));
      nextX = curState.x + exitVx * (dtTicks * FIXED_DT);
      nextY = curState.y + 18;
    }

    const solved = solveExactBounce(
      curState,
      nextX,
      nextY,
      Math.max(2, dtTicks * SUB_STEPS - 1)
    );

    const replayWorld = cloneWorldForProbe(midSnapshot);
    if (isBumper) {
      const bumper: BumperPiece = {
        id: `song_${song.id}_${chain.id}_bmp_${bumperCount++}`,
        x: round2(curState.x - solved.nx * (minDist - solved.penetration)),
        y: round2(curState.y - solved.ny * (minDist - solved.penetration)),
        radius: radiusBumper,
        locked: false,
        customRestitution: round4(solved.restitution),
        trackChannel: chain.trackChannel,
        silent: true,
      };
      replayWorld.bumpers.push(bumper);
    } else {
      barsSinceRail++;
      if (Math.abs(solved.ny) < 0.72) {
        halfLen = Math.min(halfLen, 24);
      }

      const cx = curState.x - solved.nx * (minDist - solved.penetration);
      const cy = curState.y - solved.ny * (minDist - solved.penetration);

      const resolvedInst: MelodicInstrumentId | undefined =
        note.silent || note.drum
          ? undefined
          : timbreOverride ?? note.instrument ?? chain.defaultInstrument;

      const barId = `song_${song.id}_${chain.id}_${musicIdx++}`;
      const makeBarWithHalf = (hl: number): BarPiece => ({
        id: barId,
        ax: round2(cx - solved.tx * hl),
        ay: round2(cy - solved.ty * hl),
        bx: round2(cx + solved.tx * hl),
        by: round2(cy + solved.ty * hl),
        material: note.material,
        locked: false,
        fixedMidi: note.silent ? undefined : note.midi,
        instrumentOverride: resolvedInst,
        drumOverride: note.silent ? undefined : note.drum,
        customRestitution: round4(solved.restitution),
        noteLabel: note.silent ? undefined : note.label,
        trackChannel: chain.trackChannel,
        silent: note.silent ? true : undefined,
      });

      const minDistSq = (minDist - 0.05) * (minDist - 0.05);
      const maxBackSteps = Math.max(32, Math.min(90, prevDtTicks * SUB_STEPS - 6));
      const candidates = [halfLen, Math.min(halfLen, 22), 17, 12, 7, 3].filter(
        (v, idx, arr) => v <= halfLen + 0.01 && arr.indexOf(v) === idx
      );
      let chosenHalf = 3;
      for (const hl of candidates) {
        const cand = makeBarWithHalf(hl);
        let clipsEarly = false;
        for (let k = 1; k <= maxBackSteps; k++) {
          const dtBack = k * SUB_DT;
          const px = curState.x - curState.vx * dtBack;
          const py = curState.y - curState.vy * dtBack + 0.5 * SONG_GRAVITY * dtBack * dtBack;
          const cp = closestPointOnSegment(px, py, cand.ax, cand.ay, cand.bx, cand.by);
          if ((px - cp.cx) ** 2 + (py - cp.cy) ** 2 < minDistSq) {
            clipsEarly = true;
            break;
          }
        }
        if (!clipsEarly) {
          chosenHalf = hl;
          break;
        }
      }
      replayWorld.bars.push(makeBarWithHalf(chosenHalf));
    }

    const nextMidTick = curTick + Math.max(4, Math.floor(dtTicks * 0.55));
    for (let t = midTick; t < nextMidTick; t++) {
      stepFixed(replayWorld, true);
    }
    midSnapshot = cloneWorldForProbe(replayWorld);
    midTick = nextMidTick;
    for (let t = nextMidTick; t < curTick + dtTicks; t++) {
      stepFixed(replayWorld, true);
    }
    Object.assign(chainWorld, replayWorld);
    curTick += dtTicks;
    prevDtTicks = dtTicks;
  }

  // Finish every chain with a silent tactile Elastic Bumper accent angled away from the last bar
  if ((bumperCount === 0 || chain.notes.length >= 14) && chainWorld.marbles[0]) {
    const endM = chainWorld.marbles[0];
    const sideShift = endM.vx >= 0 ? -10 : 10;
    chainWorld.bumpers.push({
      id: `song_${song.id}_${chain.id}_bmp_end`,
      x: round2(endM.x + sideShift),
      y: round2(endM.y + MARBLE_RADIUS + 24),
      radius: 15,
      locked: false,
      customRestitution: 0.32,
      trackChannel: chain.trackChannel,
      silent: true,
    });
  }

  return {
    emitter,
    bars: chainWorld.bars
      .filter((b) => b.id !== "__sculpt_floor__")
      .map((b) => ({
        ...b,
        flexOffset: undefined,
        flexVel: undefined,
        hitNx: undefined,
        hitNy: undefined,
      })),
    bumpers: chainWorld.bumpers.map((b) => ({ ...b, pulse: undefined })),
    rails: chainWorld.rails.map((r) => ({
      ...r,
      activeGlow: undefined,
      pulseT: undefined,
      exitPulse: undefined,
      exitX: undefined,
      exitY: undefined,
      hitFlash: undefined,
      hitX: undefined,
      hitY: undefined,
    })),
  };
}

function verifySingleChainSculpture(
  song: MarbleSongDef,
  sculpt: {
    emitter: Emitter;
    bars: BarPiece[];
    bumpers: BumperPiece[];
    rails: TransferRailPiece[];
  }
): boolean {
  const testWorld: WorldState = {
    bpm: song.bpm,
    gravity: SONG_GRAVITY,
    scaleId: song.scaleId,
    bars: sculpt.bars.map((b) => ({ ...b })),
    bumpers: sculpt.bumpers.map((b) => ({ ...b })),
    splitters: [],
    rails: sculpt.rails.map((r) => ({ ...r })),
    emitters: [{ ...sculpt.emitter }],
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };

  const totalTicks = computeSongOneLoopTicks(song.loopBeats, song.bpm);
  const hits = new Map<string, number>();

  for (let t = 0; t < totalTicks; t++) {
    const evs = stepFixed(testWorld, true);
    for (const ev of evs) {
      if (ev.type === "bar_hit") {
        const nextCount = (hits.get(ev.barId) ?? 0) + 1;
        if (nextCount > 1) return false;
        hits.set(ev.barId, nextCount);
      }
    }
  }

  return sculpt.bars.every((b) => (hits.get(b.id) ?? 0) === 1);
}

export function sculptMarbleSong(
  song: MarbleSongDef,
  timbreOverride?: MelodicInstrumentId
): WorldState {
  const emitters: Emitter[] = [];
  const bars: BarPiece[] = [];
  const bumpers: BumperPiece[] = [];
  const rails: TransferRailPiece[] = [];
  const yPerBeat = Math.max(42, song.chains[0]?.dropPerHit ?? 46);
  const masterTopY = Math.max(225, (song.chains[0]?.startY ?? 132) + 95);

  for (let cIdx = 0; cIdx < song.chains.length; cIdx++) {
    const chain = song.chains[cIdx];
    if (chain.notes.length === 0) continue;

    let chosen = buildChainSculpture(
      song,
      chain,
      cIdx,
      masterTopY,
      yPerBeat,
      timbreOverride,
      true,
      true
    );

    if (!verifySingleChainSculpture(song, chosen)) {
      const midRailsOnly = buildChainSculpture(
        song,
        chain,
        cIdx,
        masterTopY,
        yPerBeat,
        timbreOverride,
        true,
        false
      );
      if (verifySingleChainSculpture(song, midRailsOnly)) {
        chosen = midRailsOnly;
      } else {
        const noMidRails = buildChainSculpture(
          song,
          chain,
          cIdx,
          masterTopY,
          yPerBeat,
          timbreOverride,
          false,
          true
        );
        chosen = verifySingleChainSculpture(song, noMidRails)
          ? noMidRails
          : buildChainSculpture(
              song,
              chain,
              cIdx,
              masterTopY,
              yPerBeat,
              timbreOverride,
              false,
              false
            );
      }
    }

    emitters.push(chosen.emitter);
    bars.push(...chosen.bars);
    bumpers.push(...chosen.bumpers);
    rails.push(...chosen.rails);
  }

  return {
    bpm: song.bpm,
    gravity: SONG_GRAVITY,
    scaleId: song.scaleId,
    bars,
    bumpers,
    splitters: [],
    rails,
    emitters,
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };
}
