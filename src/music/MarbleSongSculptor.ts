import type { MelodicInstrumentId } from "../audio/instruments/types.ts";
import type { MarbleSongDef, SongPhraseChain } from "../data/marbleSongs.ts";
import { FIXED_DT, GRAVITY, MARBLE_RADIUS, MAX_SPEED } from "../engine/physics.ts";
import type { BarPiece, Emitter, WorldState } from "../engine/types.ts";
import { MATERIALS } from "../theme/tokens.ts";

const SUB_STEPS = 2;
const SUB_DT = FIXED_DT / SUB_STEPS;
const DROP_HEIGHT = 68;

interface SimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
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
    out.vy += GRAVITY * SUB_DT;
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
  const gravDisp = 0.5 * N * (N + 1) * SUB_DT * SUB_DT * GRAVITY;

  // Iterate 6 times so penetration = 0.65 * (-vn) * SUB_DT AND pushed pos converge to machine precision
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
    restitution = Math.max(0.22, Math.min(4.8, restitution));

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

function layoutChainX(chain: SongPhraseChain): number[] {
  const xs: number[] = [];
  let x = chain.startX;
  const notes = chain.notes;
  const totalSpan = Math.max(240, chain.maxX - chain.startX);

  const rawSteps: number[] = [];
  for (let i = 0; i < notes.length - 1; i++) {
    const dt = Math.max(0.25, notes[i + 1].beat - notes[i].beat);
    const desired = chain.stepX * Math.min(1.65, Math.max(0.96, Math.sqrt(dt * 1.45)));
    rawSteps.push(desired);
  }
  const sumRaw = rawSteps.reduce((a, b) => a + b, 0);
  const scale = sumRaw > totalSpan ? totalSpan / sumRaw : 1;

  for (let i = 0; i < notes.length; i++) {
    xs.push(x);
    if (i < rawSteps.length) {
      x += Math.max(46, rawSteps[i] * scale);
    }
  }
  return xs;
}

export function sculptMarbleSong(
  song: MarbleSongDef,
  timbreOverride?: MelodicInstrumentId
): WorldState {
  const beatPerTick = (song.bpm / 60) * FIXED_DT;
  const leadInSec = Math.sqrt((2 * DROP_HEIGHT) / GRAVITY);
  const leadInTicks = Math.round(leadInSec / FIXED_DT);

  const emitters: Emitter[] = [];
  const bars: BarPiece[] = [];

  for (const chain of song.chains) {
    if (chain.notes.length === 0) continue;

    const firstNote = chain.notes[0];
    const phaseOffset = Math.max(0, firstNote.beat);
    const emitTick = Math.round(phaseOffset / beatPerTick);

    const xs = layoutChainX(chain);
    const emX = xs[0];
    const emY = Math.max(44, chain.startY - DROP_HEIGHT);

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

    // At tick `emitTick`: emitter spawns AND runs SUB_STEPS=2 sub-steps.
    // Advance (leadInTicks * SUB_STEPS + 2) sub-steps to hitTick0 = emitTick + leadInTicks (on sub-step 1).
    const hitTick0 = emitTick + leadInTicks;
    let curState = stepSubsteps({ x: emX, y: emY, vx: 0, vy: 0 }, leadInTicks * SUB_STEPS + 2);
    let curTick = hitTick0;

    // Precompute compact bar length
    const compactLen = Math.min(34, Math.max(28, chain.barLen * 0.78));
    const halfLen = compactLen * 0.5;

    for (let i = 0; i < chain.notes.length; i++) {
      const note = chain.notes[i];
      const spec = MATERIALS[note.material];
      const minDist = MARBLE_RADIUS + spec.thickness * 0.5;

      let nextX: number;
      let nextY: number;
      let dtTicks: number;

      if (i < chain.notes.length - 1) {
        const nextNote = chain.notes[i + 1];
        const nextTargetTick = Math.round(nextNote.beat / beatPerTick) + leadInTicks;
        dtTicks = Math.max(8, nextTargetTick - curTick);
        nextX = xs[i + 1];

        const dtSec = dtTicks * FIXED_DT;
        const arcDropBudget = 0.5 * GRAVITY * dtSec * dtSec;
        const dx = nextX - xs[i];
        // Require marble crossing bar i's plane at t_cross only AFTER passing bar i's right tip (+8px buffer)
        const minCrossFrac = Math.min(0.9, (halfLen + minDist + 8) / Math.max(1, dx));
        // If parabola is symmetric or drops by deltaY, t_cross = dtSec * (1 - deltaY / arcDropBudget)
        const maxSafeDy = arcDropBudget * (1 - minCrossFrac);

        const midiCurr = note.midi ?? 67;
        const midiNext = nextNote.midi ?? 67;
        const contour = Math.max(-7, Math.min(7, (midiCurr - midiNext) * 0.9));
        const desiredDy = Math.min(
          maxSafeDy,
          Math.max(-10, contour + Math.min(3.5, chain.dropPerHit * 0.35))
        );
        nextY = Math.max(chain.startY - 30, Math.min(635, curState.y + desiredDy));
      } else {
        // Exit smoothly up-and-right while matching incoming vx (keeps normal nearly vertical so marble never skims parallel!)
        dtTicks = 40;
        const exitVx = Math.max(145, curState.vx);
        nextX = curState.x + exitVx * (dtTicks * FIXED_DT);
        nextY = curState.y + 4;
      }

      const substeps = dtTicks * SUB_STEPS;
      const solved = solveExactBounce(curState, nextX, nextY, substeps);

      const cx = curState.x - solved.nx * (minDist - solved.penetration);
      const cy = curState.y - solved.ny * (minDist - solved.penetration);

      const resolvedInst: MelodicInstrumentId | undefined = note.drum
        ? undefined
        : timbreOverride ?? note.instrument ?? chain.defaultInstrument;

      bars.push({
        id: `song_${song.id}_${chain.id}_${i}`,
        ax: cx - solved.tx * halfLen,
        ay: cy - solved.ty * halfLen,
        bx: cx + solved.tx * halfLen,
        by: cy + solved.ty * halfLen,
        material: note.material,
        locked: false,
        fixedMidi: note.midi,
        instrumentOverride: resolvedInst,
        drumOverride: note.drum,
        customRestitution: solved.restitution,
        noteLabel: note.label,
        trackChannel: chain.trackChannel,
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
    scaleId: song.scaleId,
    bars,
    bumpers: [],
    splitters: [],
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
