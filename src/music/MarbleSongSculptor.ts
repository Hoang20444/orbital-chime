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
import { buildRailGeometry, type RailGeometry } from "../engine/railGeometry.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  TransferRailPiece,
  WorldState,
} from "../engine/types.ts";
import { MATERIALS } from "../theme/tokens.ts";

const SUB_STEPS = 2;
const SUB_DT = FIXED_DT / SUB_STEPS;
const SONG_LEAD_IN_TICKS = 110; // ~0.92s synchronized lead-in across all chains
export const SONG_GRAVITY = 415;

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
  const maxGapBeats = Math.max(1.0, (0.98 * bpm) / 60);
  const minHalfBeats = Math.max(0.45, (20 * FIXED_DT * bpm) / 60);
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
        gap >= 0.95 &&
        gap * 0.5 >= minHalfBeats &&
        notesSinceRelay >= 3 &&
        extraRelays < 5
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
  _chainIndex: number
): number[] {
  const pad = halfLen + 14;
  const minBound = (chain.minX ?? Math.min(chain.startX, 90)) + pad * 0.5;
  const maxBound = Math.max(minBound + 130, chain.maxX - pad * 0.5);
  const corridorW = maxBound - minBound;

  const minStep = Math.min(corridorW * 0.56, Math.max(halfLen + 40, 78));
  const baseStep = Math.min(corridorW * 0.68, Math.max(minStep, chain.stepX));

  let x = Math.max(minBound, Math.min(maxBound, chain.startX));
  let dir = x > (minBound + maxBound) * 0.5 ? -1 : 1;
  if (x + dir * minStep * 1.5 > maxBound) dir = -1;
  if (x + dir * minStep * 1.5 < minBound) dir = 1;

  const xs: number[] = [x];
  let stepsInLeg = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const dtBeat = Math.max(0.25, waypoints[i + 1].beat - waypoints[i].beat);
    const scale = Math.min(1.18, Math.max(0.72, Math.sqrt(dtBeat * 1.05)));
    const desiredDist = Math.max(minStep, Math.min(corridorW * 0.82, baseStep * scale));

    const maxLegNotes = corridorW > 300 ? 3 : 2;
    const roomAhead = dir > 0 ? maxBound - x : x - minBound;

    const shouldTurn =
      stepsInLeg >= 2 &&
      (roomAhead < minStep || stepsInLeg >= maxLegNotes || dtBeat >= 1.0);

    if (shouldTurn) {
      dir *= -1;
      stepsInLeg = 0;
    }

    let nextX = x + dir * desiredDist;
    if (nextX > maxBound) {
      dir = -1;
      stepsInLeg = 0;
      nextX = Math.max(minBound, x - desiredDist);
    } else if (nextX < minBound) {
      dir = 1;
      stepsInLeg = 0;
      nextX = Math.min(maxBound, x + desiredDist);
    }

    if (Math.abs(nextX - x) < minStep) {
      nextX = x + dir * minStep;
      if (nextX > maxBound) nextX = x - minStep;
      if (nextX < minBound) nextX = x + minStep;
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
  const variant = cIdx % 2 === 0 ? "v" : "straight";
  const localRail: TransferRailPiece = {
    id: `song_${songId}_${chain.id}_leadrail`,
    variant,
    x: 0,
    y: 0,
    rotation: variant === "v" ? (dir0 > 0 ? 0.72 : -0.72) : dir0 > 0 ? 0.95 : -0.95,
    armLength: 55,
    openingAngle: variant === "v" ? 112 : 90,
    curvature: variant === "v" ? 0.62 : 0.5,
    slopeBias: variant === "v" ? 0.06 : 0,
    railSpacing: 12.8,
    bridgeSpacing: 46,
    boost: variant === "v" ? 0.22 : 0.08,
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
  const emVx = round2(localGeom.entryTangent.x * 52);
  const emVy = round2(localGeom.entryTangent.y * 52);

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
  let exitSub = -1;

  for (let s = 0; s < substepsTotal; s++) {
    simBody.vy += SONG_GRAVITY * SUB_DT;
    clampVel(simBody);
    simBody.x += simBody.vx * SUB_DT;
    simBody.y += simBody.vy * SUB_DT;
    const res = resolveMarbleOnDualRail(simBody, localRail, localGeom, SUB_DT);
    clampVel(simBody);
    if (res.onRail) {
      entered = true;
      wasOnRail = true;
    } else if (wasOnRail) {
      wasOnRail = false;
      exited = true;
      exitSub = s;
    }
  }

  if (!entered || !exited || exitSub > substepsTotal - 16 || simBody.vy <= 45) {
    return null;
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
        ay: 9000,
        bx: -9900,
        by: 9000,
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

function tryMidSongDualRail(
  song: MarbleSongDef,
  chain: SongPhraseChain,
  cIdx: number,
  midRailCount: number,
  barNote: WaypointNote,
  musicIdx: number,
  timbreOverride: MelodicInstrumentId | undefined,
  chainWorld: WorldState,
  curState: SimState,
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
  if (totalBridgeTicks < 88 || totalBridgeTicks > 185) return null;

  const midCorridor = (minBound + maxBound) * 0.5;
  const railDir = curState.x > midCorridor ? -1 : 1;
  const variant = (cIdx + midRailCount) % 2 === 0 ? "straight" : "v";

  const candidateRail: TransferRailPiece = {
    id: `song_${song.id}_${chain.id}_midrail_${midRailCount}`,
    variant,
    x: 0,
    y: 0,
    rotation: variant === "v" ? (railDir > 0 ? 0.24 : -0.24) : railDir > 0 ? 0.4 : -0.4,
    armLength: 55,
    openingAngle: variant === "v" ? 108 : 90,
    curvature: variant === "v" ? 0.62 : 0.5,
    slopeBias: variant === "v" ? 0.06 : 0,
    railSpacing: 12.8,
    bridgeSpacing: 46,
    boost: variant === "v" ? 0.3 : 0.22,
    flipped: railDir < 0,
    trackChannel: chain.trackChannel,
  };

  const localGeom = buildRailGeometry(candidateRail);
  const catchLocalX =
    localGeom.entryPoint.x +
    localGeom.entryTangent.x * 14 +
    localGeom.entryUpNormal.x * (localGeom.supportHeight + 2);
  const catchLocalY =
    localGeom.entryPoint.y +
    localGeom.entryTangent.y * 14 +
    localGeom.entryUpNormal.y * (localGeom.supportHeight + 2);

  const catchWorldX = round2(curState.x + railDir * 68);
  const catchWorldY = round2(curState.y + 28);

  const rail: TransferRailPiece = {
    ...candidateRail,
    x: round2(catchWorldX - catchLocalX),
    y: round2(catchWorldY - catchLocalY),
    rotation: round3(candidateRail.rotation),
  };
  const railGeom = buildRailGeometry(rail);

  if (railGeom.bounds.minX < minBound - 36 || railGeom.bounds.maxX > maxBound + 36) {
    return null;
  }
  for (const eg of existingRailGeoms) {
    if (
      !(
        railGeom.bounds.maxX + 22 < eg.bounds.minX ||
        railGeom.bounds.minX - 22 > eg.bounds.maxX ||
        railGeom.bounds.maxY + 22 < eg.bounds.minY ||
        railGeom.bounds.minY - 22 > eg.bounds.maxY
      )
    ) {
      return null;
    }
  }

  const catchSubsteps = 36;
  const solved = solveExactBounce(curState, catchWorldX, catchWorldY, catchSubsteps);
  let barHalf = halfLen;
  if (Math.abs(solved.ny) < 0.72) barHalf = Math.min(barHalf, 22);

  const spec = MATERIALS[barNote.material];
  const minDist = MARBLE_RADIUS + spec.thickness * 0.5;
  const cx = curState.x - solved.nx * (minDist - solved.penetration);
  const cy = curState.y - solved.ny * (minDist - solved.penetration);

  const resolvedInst: MelodicInstrumentId | undefined = barNote.drum
    ? undefined
    : timbreOverride ?? barNote.instrument ?? chain.defaultInstrument;

  const bar: BarPiece = {
    id: `song_${song.id}_${chain.id}_${musicIdx}`,
    ax: round2(cx - solved.tx * barHalf),
    ay: round2(cy - solved.ty * barHalf),
    bx: round2(cx + solved.tx * barHalf),
    by: round2(cy + solved.ty * barHalf),
    material: barNote.material,
    locked: false,
    fixedMidi: barNote.midi,
    instrumentOverride: resolvedInst,
    drumOverride: barNote.drum,
    customRestitution: round4(solved.restitution),
    noteLabel: barNote.label,
    trackChannel: chain.trackChannel,
  };

  // Probe inside real stepFixed so every collision matches engine physics bit-for-bit
  const probe = cloneWorldForProbe(chainWorld);
  probe.bars.push({ ...bar });
  probe.rails.push({ ...rail });

  let barHitCount = 0;
  let otherBarHits = 0;
  let bumperHits = 0;
  let entered = false;
  let exited = false;
  let exitTick = -1;

  for (let t = 0; t < totalBridgeTicks; t++) {
    const evs = stepFixed(probe, true);
    for (const ev of evs) {
      if (ev.type === "bar_hit") {
        if (ev.barId === bar.id) barHitCount++;
        else otherBarHits++;
      } else if (ev.type === "bumper_hit") {
        bumperHits++;
      } else if (ev.type === "rail_enter" && ev.railId === rail.id) {
        entered = true;
      } else if (ev.type === "rail_exit" && ev.railId === rail.id) {
        exited = true;
        exitTick = t;
      }
    }
  }

  const m = probe.marbles[0];
  if (
    !m ||
    barHitCount !== 1 ||
    otherBarHits > 0 ||
    bumperHits > 0 ||
    !entered ||
    !exited ||
    exitTick > totalBridgeTicks - 8 ||
    m.vy <= 45 ||
    m.y < railGeom.bounds.maxY + 6 ||
    m.x < minBound - 32 ||
    m.x > maxBound + 32
  ) {
    return null;
  }

  return {
    bar,
    rail,
    railGeom,
    endX: m.x,
  };
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
  const baseBarLen = Math.max(54, Math.min(96, chain.barLen || 64));
  const xs = layoutZigzagX(chain, waypoints, baseBarLen * 0.5, cIdx);
  const pad = baseBarLen * 0.5 + 14;
  const minBound = (chain.minX ?? Math.min(chain.startX, 90)) + pad * 0.5;
  const maxBound = Math.max(minBound + 130, chain.maxX - pad * 0.5);

  const railGeoms: RailGeometry[] = [];
  const firstNote = waypoints[0];
  const phaseOffset = Math.max(0, firstNote.beat);
  const emitTick = Math.round(phaseOffset / beatPerTick);
  const note0TargetX = round2(xs[0]);
  const note0TargetY = round2(masterTopY + firstNote.beat * yPerBeat);
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
  const leadMidGap = 20;
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
  let railAlternator = 0;
  let prevDtTicks = 30;

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

    // Try bridging Bar -> Mid-Song Dual-Support Rail -> Next Bar on alternating relay slots
    if (
      allowMidRails &&
      !note.silent &&
      i + 2 < waypoints.length &&
      waypoints[i + 1]?.pieceKind === "bumper"
    ) {
      const nextReal = waypoints[i + 2];
      const nextRealTick = Math.round(nextReal.beat / beatPerTick) + SONG_LEAD_IN_TICKS;
      const totalBridgeTicks = nextRealTick - curTick;
      if (railAlternator % 2 === 0 && totalBridgeTicks >= 88 && totalBridgeTicks <= 185) {
        const res = tryMidSongDualRail(
          song,
          chain,
          cIdx,
          midRailCount,
          note,
          musicIdx,
          timbreOverride,
          chainWorld,
          curState,
          baseBarLen * 0.5,
          totalBridgeTicks,
          minBound,
          maxBound,
          railGeoms
        );
        if (res) {
          // Replay deterministically from midSnapshot -> nextRealTick saving next midSnapshot along exit descent
          const replayWorld = cloneWorldForProbe(midSnapshot);
          replayWorld.bars.push(res.bar);
          replayWorld.rails.push(res.rail);
          railGeoms.push(res.railGeom);
          musicIdx++;
          midRailCount++;
          railAlternator++;

          const newMidTick = curTick + Math.max(10, totalBridgeTicks - 12);
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
          i++; // skip bumper relay slot consumed by midRail
          continue;
        }
      }
      railAlternator++;
    }

    let nextX: number;
    let nextY: number;
    let dtTicks: number;
    let halfLen = baseBarLen * 0.5;

    if (i < waypoints.length - 1) {
      const nextNote = waypoints[i + 1];
      const nextTargetTick = Math.round(nextNote.beat / beatPerTick) + SONG_LEAD_IN_TICKS;
      dtTicks = Math.max(8, nextTargetTick - curTick);
      nextX = xs[i + 1];

      const dtSec = dtTicks * FIXED_DT;
      const arcDropBudget = 0.5 * SONG_GRAVITY * dtSec * dtSec;
      const dxNext = nextX - xs[i];
      const dxAbs = Math.abs(dxNext);
      const dxPrev = i > 0 ? xs[i] - xs[i - 1] : dxNext;
      const isZigzagTurn = i > 0 && dxNext * dxPrev < 0;

      const masterNextY = masterTopY + nextNote.beat * yPerBeat;
      const dtBeat = nextNote.beat - note.beat;

      const isNextBarTurn =
        i + 2 < waypoints.length && (xs[i + 2] - xs[i + 1]) * dxNext < 0;

      const durationBonus = dtBeat >= 1.4 ? 20 : dtBeat >= 0.9 ? 10 : 0;
      const isFastNote = dtBeat <= 0.6;
      const roleLen = isFastNote
        ? Math.min(44, Math.max(38, baseBarLen * 0.72))
        : note.silent
          ? Math.min(74, Math.max(62, baseBarLen))
          : note.material === "bass"
            ? Math.max(baseBarLen, 76) + durationBonus * 0.4
            : baseBarLen + durationBonus + (isZigzagTurn ? 10 : 0);
      const spanMin = Math.min(dxAbs, Math.abs(dxPrev));
      const maxSafeLen = isFastNote
        ? Math.min(44, Math.max(38, (spanMin - minDist - 22) * 0.68))
        : isZigzagTurn
          ? Math.min(82, Math.max(58, spanMin * 0.7))
          : isNextBarTurn
            ? Math.min(64, Math.max(50, (spanMin - minDist - 22) * 0.74))
            : Math.min(90, Math.max(58, (spanMin - minDist - 20) * 0.86));
      halfLen = Math.min(90, Math.max(38, Math.min(roleLen, maxSafeLen))) * 0.5;

      if (isZigzagTurn) {
        const turnDrop = Math.max(
          82,
          Math.ceil(arcDropBudget + 32),
          Math.min(155, masterNextY - curState.y)
        );
        nextY = curState.y + turnDrop;
      } else {
        const minCrossFrac = Math.min(0.85, (halfLen + minDist + 14) / Math.max(1, dxAbs));
        const cascadeFloor = Math.min(26, Math.max(14, arcDropBudget * 0.92));
        const maxSafeDy = Math.max(
          cascadeFloor,
          Math.min(28, arcDropBudget * (1 - minCrossFrac) * 0.92)
        );
        const minCascadeDy = Math.min(maxSafeDy, 14);
        const targetDy = isNextBarTurn
          ? Math.max(maxSafeDy * 0.85, Math.min(maxSafeDy, 24))
          : Math.max(minCascadeDy, Math.min(maxSafeDy, masterNextY - curState.y));
        nextY = curState.y + Math.max(minCascadeDy, Math.min(maxSafeDy, targetDy));
      }
    } else {
      halfLen = Math.max(baseBarLen, 74) * 0.5;
      dtTicks = 44;
      const dirSign = curState.vx < -10 ? -1 : 1;
      const exitVx = dirSign * Math.max(185, Math.abs(curState.vx));
      nextX = curState.x + exitVx * (dtTicks * FIXED_DT);
      nextY = curState.y - 10;
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
      if (Math.abs(solved.ny) < 0.72) {
        halfLen = Math.min(halfLen, 22);
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
      const candidates = [halfLen, Math.min(halfLen, 20), 15, 11, 7, 3].filter(
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

  // Guarantee every chain (even dense non-stop 8th notes) finishes with an Elastic Bumper
  if (bumperCount === 0 && chainWorld.marbles[0]) {
    const endM = chainWorld.marbles[0];
    chainWorld.bumpers.push({
      id: `song_${song.id}_${chain.id}_bmp_end`,
      x: round2(endM.x),
      y: round2(endM.y + MARBLE_RADIUS + 15),
      radius: 16,
      locked: false,
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

  const loopSec = (song.loopBeats * 60) / song.bpm;
  const totalTicks = Math.floor(loopSec / FIXED_DT) + 102;
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
  const yPerBeat = Math.max(30, song.chains[0]?.dropPerHit ?? 36);
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
