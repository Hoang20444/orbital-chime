import type { MelodicInstrumentId } from "../audio/instruments/types.ts";
import type {
  MarbleSongDef,
  SongHitNote,
  SongPhraseChain,
} from "../data/marbleSongs.ts";
import { FIXED_DT, MARBLE_RADIUS, MAX_SPEED } from "../engine/physics.ts";
import type { BarPiece, Emitter, WorldState } from "../engine/types.ts";
import { MATERIALS } from "../theme/tokens.ts";

const SUB_STEPS = 2;
const SUB_DT = FIXED_DT / SUB_STEPS;
const DROP_HEIGHT = 48;
export const SONG_GRAVITY = 415;

interface SimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface WaypointNote extends SongHitNote {
  silent?: boolean;
}

function clampVel(s: SimState): void {
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > MAX_SPEED) {
    const k = MAX_SPEED / sp;
    s.vx *= k;
    s.vy *= k;
  }
}

function stepSubsteps(s: SimState, substeps: number): SimState {
  const out = { ...s };
  for (let i = 0; i < substeps; i++) {
    out.vy += SONG_GRAVITY * SUB_DT;
    clampVel(out);
    out.x += out.vx * SUB_DT;
    out.y += out.vy * SUB_DT;
  }
  return out;
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
  pushedX: number;
  pushedY: number;
  postVx: number;
  postVy: number;
} {
  let nx = 0;
  let ny = -1;
  let restitution = 0.85;
  let penetration = 0.35;
  let pushedX = inState.x;
  let pushedY = inState.y;
  let postVx = inState.vx;
  let postVy = -inState.vy * 0.85;

  const N = substepsAfterBounce;
  const totalTime = N * SUB_DT;
  const gravDisp = 0.5 * N * (N + 1) * SUB_DT * SUB_DT * SONG_GRAVITY;

  for (let iter = 0; iter < 6; iter++) {
    const vnEstimate = inState.vx * nx + inState.vy * ny;
    penetration = Math.min(0.85, Math.max(0.06, Math.abs(vnEstimate) * SUB_DT * 0.62));
    pushedX = inState.x + nx * penetration;
    pushedY = inState.y + ny * penetration;

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

    const vPreNx = inState.vx * nx + inState.vy * ny;
    const rawPostX = inState.vx - (1 + restitution) * vPreNx * nx;
    const rawPostY = inState.vy - (1 + restitution) * vPreNx * ny;
    postVx = rawPostX * 0.996;
    postVy = rawPostY * 0.996;
  }

  return {
    tx: -ny,
    ty: nx,
    nx,
    ny,
    restitution,
    penetration,
    pushedX,
    pushedY,
    postVx,
    postVy,
  };
}

function buildContinuousWaypoints(chain: SongPhraseChain, bpm: number): WaypointNote[] {
  const maxGapBeats = Math.max(1.0, (0.98 * bpm) / 60);
  const out: WaypointNote[] = [];

  for (let i = 0; i < chain.notes.length; i++) {
    const curr = chain.notes[i];
    out.push(curr);
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
          });
        }
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

export function sculptMarbleSong(
  song: MarbleSongDef,
  timbreOverride?: MelodicInstrumentId
): WorldState {
  const beatPerTick = (song.bpm / 60) * FIXED_DT;
  const leadInSec = Math.sqrt((2 * DROP_HEIGHT) / SONG_GRAVITY);
  const leadInTicks = Math.round(leadInSec / FIXED_DT);

  const emitters: Emitter[] = [];
  const bars: BarPiece[] = [];
  const yPerBeat = Math.max(30, song.chains[0]?.dropPerHit ?? 36);
  const masterTopY = song.chains[0]?.startY ?? 132;

  for (let cIdx = 0; cIdx < song.chains.length; cIdx++) {
    const chain = song.chains[cIdx];
    if (chain.notes.length === 0) continue;

    const waypoints = buildContinuousWaypoints(chain, song.bpm);
    const baseBarLen = Math.max(54, Math.min(96, chain.barLen || 64));
    const xs = layoutZigzagX(chain, waypoints, baseBarLen * 0.5, cIdx);

    const firstNote = waypoints[0];
    const phaseOffset = Math.max(0, firstNote.beat);
    const emitTick = Math.round(phaseOffset / beatPerTick);

    const emX = xs[0];
    const note0TargetY = masterTopY + firstNote.beat * yPerBeat;
    const emY = Math.max(44, note0TargetY - DROP_HEIGHT);

    emitters.push({
      id: `song_em_${chain.id}`,
      x: emX,
      y: emY,
      vx: 0,
      vy: 0,
      beatInterval: song.loopBeats,
      phaseOffset,
      locked: false,
      trackChannel: chain.trackChannel,
      nextEmitBeat: phaseOffset,
      pulse: 0,
    });

    const hitTick0 = emitTick + leadInTicks;
    let curState = stepSubsteps({ x: emX, y: emY, vx: 0, vy: 0 }, leadInTicks * SUB_STEPS + 2);
    let curTick = hitTick0;

    let musicIdx = 0;
    let relayIdx = 0;

    for (let i = 0; i < waypoints.length; i++) {
      const note = waypoints[i];
      const spec = MATERIALS[note.material];
      const minDist = MARBLE_RADIUS + spec.thickness * 0.5;

      let nextX: number;
      let nextY: number;
      let dtTicks: number;
      let halfLen = baseBarLen * 0.5;

      if (i < waypoints.length - 1) {
        const nextNote = waypoints[i + 1];
        const nextTargetTick = Math.round(nextNote.beat / beatPerTick) + leadInTicks;
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

        // Expressive bar length variation by musical duration, material weight & turn anchors
        const isNextBarTurn =
          i + 2 < waypoints.length &&
          (xs[i + 2] - xs[i + 1]) * dxNext < 0;

        const durationBonus = dtBeat >= 1.4 ? 20 : dtBeat >= 0.9 ? 10 : 0;
        const isFastNote = dtBeat <= 0.6;
        const roleLen = isFastNote
          ? Math.min(50, Math.max(46, baseBarLen * 0.8))
          : note.silent
            ? Math.min(74, Math.max(62, baseBarLen))
            : note.material === "bass"
              ? Math.max(baseBarLen, 76) + durationBonus * 0.4
              : baseBarLen + durationBonus + (isZigzagTurn ? 10 : 0);
        const spanMin = Math.min(dxAbs, Math.abs(dxPrev));
        const maxSafeLen = isFastNote
          ? Math.min(50, Math.max(46, (spanMin - minDist - 22) * 0.72))
          : isZigzagTurn
            ? Math.min(82, Math.max(58, spanMin * 0.7))
            : isNextBarTurn
              ? Math.min(64, Math.max(50, (spanMin - minDist - 22) * 0.74))
              : Math.min(90, Math.max(58, (spanMin - minDist - 20) * 0.86));
        halfLen = Math.min(90, Math.max(52, Math.min(roleLen, maxSafeLen))) * 0.5;

        if (isZigzagTurn) {
          // On a zigzag corner reversal, keep vy_out well below horizontal so the return arc
          // passes cleanly underneath the upper leg's outer bar tip!
          const turnDrop = Math.max(
            82,
            Math.ceil(arcDropBudget + 32),
            Math.min(155, masterNextY - curState.y)
          );
          nextY = curState.y + turnDrop;
        } else {
          // Along a continuous sweep, keep marble clearing current bar tip cleanly before crossing bar plane
          const minCrossFrac = Math.min(
            0.9,
            (halfLen + minDist + 14) / Math.max(1, dxAbs)
          );
          const maxSafeDy = Math.min(24, Math.max(4, arcDropBudget * (1 - minCrossFrac) * 0.84));
          // Staircase downward cascade: never flatten consecutive bars into a dead-horizontal line
          const minCascadeDy = Math.min(maxSafeDy, 13);
          const targetDy = isNextBarTurn
            ? Math.max(maxSafeDy * 0.85, Math.min(maxSafeDy, 22))
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

      const substeps = dtTicks * SUB_STEPS;
      const solved = solveExactBounce(curState, nextX, nextY, substeps);

      // Steep/vertical rebound walls (|ny| < 0.72) should stay compact vertically so their upper
      // tip doesn't intercept the incoming downward arc early; horizontal/sloped bars stay long!
      if (Math.abs(solved.ny) < 0.72) {
        halfLen = Math.min(halfLen, 22);
      }

      const cx = curState.x - solved.nx * (minDist - solved.penetration);
      const cy = curState.y - solved.ny * (minDist - solved.penetration);

      const resolvedInst: MelodicInstrumentId | undefined =
        note.silent || note.drum
          ? undefined
          : timbreOverride ?? note.instrument ?? chain.defaultInstrument;

      const barId = note.silent
        ? `song_${song.id}_${chain.id}_relay_${relayIdx++}`
        : `song_${song.id}_${chain.id}_${musicIdx++}`;

      bars.push({
        id: barId,
        ax: cx - solved.tx * halfLen,
        ay: cy - solved.ty * halfLen,
        bx: cx + solved.tx * halfLen,
        by: cy + solved.ty * halfLen,
        material: note.material,
        locked: false,
        fixedMidi: note.silent ? undefined : note.midi,
        instrumentOverride: resolvedInst,
        drumOverride: note.silent ? undefined : note.drum,
        customRestitution: solved.restitution,
        noteLabel: note.silent ? undefined : note.label,
        trackChannel: chain.trackChannel,
        silent: note.silent ? true : undefined,
      });

      curState = stepSubsteps(
        {
          x: solved.pushedX,
          y: solved.pushedY,
          vx: solved.postVx,
          vy: solved.postVy,
        },
        substeps
      );
      curTick += dtTicks;
    }
  }

  return {
    bpm: song.bpm,
    gravity: SONG_GRAVITY,
    scaleId: song.scaleId,
    bars,
    bumpers: [],
    splitters: [],
    rails: [],
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
