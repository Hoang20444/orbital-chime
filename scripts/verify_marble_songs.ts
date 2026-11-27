import assert from "node:assert/strict";
import { MARBLE_SONGS } from "../src/data/marbleSongs.ts";
import { FIXED_DT, stepFixed } from "../src/engine/physics.ts";
import {
  computeSongOneLoopTicks,
  sculptMarbleSong,
} from "../src/music/MarbleSongSculptor.ts";

console.log("=== Verifying Real-Physics Marble Songs inside 120Hz stepFixed ===");

for (const song of MARBLE_SONGS) {
  const world = sculptMarbleSong(song);
  const totalScoreNotes = song.chains.reduce((acc, c) => acc + c.notes.length, 0);

  // Measure exactly 1 full song cycle (up to loopBeats + drop tail, stopping strictly before Loop 2's bar 0 hit)
  const totalTicks = computeSongOneLoopTicks(song.loopBeats, song.bpm);

  const hitsByBar = new Map<string, { tick: number; speed: number; marbleId?: number }[]>();
  const strayBars: string[] = [];
  let railEnters = 0;
  let bumperHits = 0;

  for (let tick = 0; tick < totalTicks; tick++) {
    const events = stepFixed(world, true);
    for (const ev of events) {
      if (ev.type === "rail_enter") railEnters++;
      if (ev.type === "bumper_hit") bumperHits++;
      if (ev.type === "bar_hit") {
        const list = hitsByBar.get(ev.barId) ?? [];
        list.push({ tick, speed: ev.speed });
        hitsByBar.set(ev.barId, list);
        if (list.length > 1) {
          strayBars.push(`${ev.barId} hit ${list.length}x at tick ${tick}`);
        }
      }
    }
  }

  let missed = 0;
  let maxErrMs = 0;
  let leadInSecRef: number | null = null;

  for (const chain of song.chains) {
    for (let i = 0; i < chain.notes.length; i++) {
      const note = chain.notes[i];
      const barId = `song_${song.id}_${chain.id}_${i}`;
      const hits = hitsByBar.get(barId);
      if (!hits || hits.length === 0) {
        missed++;
        console.error(
          `  [MISS] ${song.id} chain=${chain.id} idx=${i} (${note.label}) beat=${note.beat}`
        );
        continue;
      }
      const actualSec = hits[0].tick * FIXED_DT;
      const expectedScoreSec = (note.beat * 60) / song.bpm;
      if (leadInSecRef === null && chain === song.chains[0] && i === 0) {
        leadInSecRef = actualSec - expectedScoreSec;
      }
      if (leadInSecRef !== null) {
        const errMs = Math.abs(actualSec - (expectedScoreSec + leadInSecRef)) * 1000;
        maxErrMs = Math.max(maxErrMs, errMs);
      }
    }
  }

  // Verify adjacent non-turn bars in each chain are clearly separated & staggered (never flat uniform rows)
  let minAdjacentStepDist = Infinity;
  let minAdjacentDy = Infinity;
  for (const chain of song.chains) {
    const chainBars = world.bars.filter((b) => b.trackChannel === chain.trackChannel);
    for (let i = 0; i + 1 < chainBars.length; i++) {
      const a = chainBars[i];
      const b = chainBars[i + 1];
      const acx = (a.ax + a.bx) * 0.5;
      const acy = (a.ay + a.by) * 0.5;
      const bcx = (b.ax + b.bx) * 0.5;
      const bcy = (b.ay + b.by) * 0.5;
      minAdjacentStepDist = Math.min(minAdjacentStepDist, Math.hypot(bcx - acx, bcy - acy));
      minAdjacentDy = Math.min(minAdjacentDy, Math.abs(bcy - acy));
    }
  }

  console.log(
    `[Song] ${song.titleEn} (${song.bpm} BPM, ${totalScoreNotes} bars, ${world.rails.length} rails, ${world.bumpers.length} bumpers): missed=${missed}, multiHitStray=${strayBars.length}, railEnters=${railEnters}, bumperHits=${bumperHits}, minDy=${minAdjacentDy.toFixed(1)}px, minDist=${minAdjacentStepDist.toFixed(1)}px, maxTimingErr=${maxErrMs.toFixed(1)}ms`
  );
  if (strayBars.length > 0) {
    console.log("  Stray details:", strayBars.slice(0, 6).join("; "));
  }
  assert.ok(
    world.rails.length >= song.chains.length + 3,
    `${song.id} expected frequent Dual-Support Rails (>= ${song.chains.length + 3}), got ${world.rails.length}`
  );
  assert.ok(world.bumpers.length >= 2, `${song.id} expected >= 2 Elastic Bumpers`);
  assert.ok(
    railEnters >= song.chains.length + 3,
    `${song.id} expected >= ${song.chains.length + 3} rail_enter events, got ${railEnters}`
  );
  assert.ok(bumperHits >= 2, `${song.id} expected >= 2 bumper_hit events, got ${bumperHits}`);
  assert.ok(
    minAdjacentDy >= 28,
    `${song.id} adjacent bars too flat vertically: minDy=${minAdjacentDy.toFixed(1)}px`
  );
  assert.equal(missed, 0, `${song.id} missed ${missed} bars!`);
  assert.equal(strayBars.length, 0, `${song.id} had stray collisions: ${strayBars.join(", ")}`);
  assert.ok(maxErrMs <= 22, `${song.id} maxTimingErr=${maxErrMs.toFixed(1)}ms exceeded 22ms!`);
}

console.log("ALL 4 MARBLE SONGS PASSED 100% PHYSICS VERIFICATION.");
