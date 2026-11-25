import assert from "node:assert/strict";
import { LEVELS } from "../src/data/levels.ts";
import { SANDBOX_PRESETS } from "../src/data/presets.ts";
import { FIXED_DT, MAX_SPEED, stepFixed } from "../src/engine/physics.ts";
import { createWorldFromLevel, createWorldFromPreset } from "../src/engine/worldFactory.ts";
import type { WorldState } from "../src/engine/types.ts";

// 1. Anti-tunneling test: fire a marble at MAX_SPEED straight at a thin brass bar
{
  const world: WorldState = {
    bars: [{ id: "wall", ax: 300, ay: 400, bx: 700, by: 400, material: "brass" }],
    bumpers: [],
    splitters: [],
    emitters: [],
    rings: [],
    marbles: [
      {
        id: 1,
        x: 500,
        y: 350,
        prevX: 500,
        prevY: 350,
        vx: 0,
        vy: MAX_SPEED,
        radius: 8,
        age: 0,
        trail: [],
        cooldowns: {},
        splitHistory: {},
        squash: 0,
        squashAngle: 0,
      },
    ],
    ripples: [],
    popups: [],
    bpm: 100,
    scaleId: "c_pentatonic",
    beatClock: 0,
    nextMarbleId: 2,
    allChargedTimer: 0,
    levelSolved: false,
  };

  let crossed = false;
  let bounced = false;
  for (let i = 0; i < 60; i++) {
    const events = stepFixed(world, true);
    if (events.some((e) => e.type === "bar_hit")) bounced = true;
    if (world.marbles[0] && world.marbles[0].y > 400) crossed = true;
  }
  assert.equal(bounced, true, "High-speed marble must collide with thin bar");
  assert.equal(crossed, false, "High-speed marble must NEVER tunnel through bar");
  console.log("[PASS] Anti-tunneling check at MAX_SPEED =", MAX_SPEED);
}

// 2 & 3. Verify all 12 Puzzle Album tracks: unsolved initially, solved with hintSolution
const SIM_TICKS = Math.round(16 / FIXED_DT);
let failures = 0;

for (const level of LEVELS) {
  const initialWorld = createWorldFromLevel(level, false);
  for (let t = 0; t < SIM_TICKS; t++) {
    stepFixed(initialWorld, true);
    if (initialWorld.levelSolved) break;
  }
  if (initialWorld.levelSolved) {
    console.error(`[FAIL] ${level.id} (${level.titleEn}) solved WITHOUT player action!`);
    failures++;
  }

  const hintWorld = createWorldFromLevel(level, true);
  let solvedAtTick = -1;
  let barHits = 0;
  for (let t = 0; t < SIM_TICKS; t++) {
    const events = stepFixed(hintWorld, true);
    for (const ev of events) {
      if (ev.type === "bar_hit") barHits++;
      if (ev.type === "level_win" && solvedAtTick < 0) solvedAtTick = t;
    }
    if (hintWorld.levelSolved) break;
  }

  if (!hintWorld.levelSolved) {
    const charges = hintWorld.rings.map((r) => `${r.id}:${r.charge.toFixed(2)}`).join(", ");
    console.error(
      `[FAIL] ${level.id} (${level.titleEn}) did NOT solve with hintSolution! Rings=[${charges}]`
    );
    failures++;
  } else {
    console.log(
      `[PASS] Track ${String(level.trackNumber).padStart(2, "0")} "${level.titleEn}" solved in ${(solvedAtTick * FIXED_DT).toFixed(2)}s (${barHits} bar hits)`
    );
  }
}

// 4. Verify all 3 Sandbox presets produce lively musical bar hits
for (const preset of SANDBOX_PRESETS) {
  const world = createWorldFromPreset(preset);
  let hits = 0;
  for (let t = 0; t < Math.round(10 / FIXED_DT); t++) {
    const events = stepFixed(world, true);
    hits += events.filter((e) => e.type === "bar_hit" || e.type === "bumper_hit").length;
  }
  assert.ok(hits >= 10, `Preset ${preset.id} should produce >= 10 hits in 10s (got ${hits})`);
  console.log(`[PASS] Preset "${preset.nameEn}" produced ${hits} musical hits in 10s`);
}

if (failures > 0) {
  process.exit(1);
}
console.log("ALL VERIFICATION CHECKS PASSED!");
