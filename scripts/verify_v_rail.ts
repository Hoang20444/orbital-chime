import assert from "node:assert/strict";
import { SANDBOX_PRESETS } from "../src/data/presets.ts";
import { GRAVITY, MARBLE_RADIUS, stepFixed } from "../src/engine/physics.ts";
import { buildRailGeometry, projectPointOntoRail } from "../src/engine/railGeometry.ts";
import type { TransferRailPiece, WorldState } from "../src/engine/types.ts";
import { createWorldFromPreset } from "../src/engine/worldFactory.ts";

function makeBaseRail(overrides: Partial<TransferRailPiece> = {}): TransferRailPiece {
  return {
    id: "v_test",
    variant: "v",
    x: 400,
    y: 300,
    rotation: 0,
    armLength: 140,
    openingAngle: 88,
    curvature: 0.56,
    slopeBias: 0.08,
    channelWidth: 26,
    boost: 0.15,
    ...overrides,
  };
}

function makeTestWorld(rail: TransferRailPiece): WorldState {
  return {
    bars: [],
    bumpers: [],
    splitters: [],
    rails: [rail],
    emitters: [],
    rings: [],
    marbles: [],
    ripples: [],
    popups: [],
    bpm: 100,
    gravity: GRAVITY,
    scaleId: "a_minor9",
    beatClock: 0,
    nextMarbleId: 1,
    allChargedTimer: 0,
    levelSolved: false,
  };
}

console.log("=== Verifying TWIN 3D RAIL SYSTEM (Straight + V-Shaped) in 120Hz stepFixed ===");

// 0. Test Straight Twin Rail across rotations, gaps, and speeds
for (const rotDeg of [15, 25, 35]) {
  for (const gap of [22, 26, 30]) {
    const rail = makeBaseRail({
      id: "straight_test",
      variant: "straight",
      rotation: (rotDeg * Math.PI) / 180,
      armLength: 110,
      channelWidth: gap,
      boost: 0.14,
    });
    const geom = buildRailGeometry(rail);
    const world = makeTestWorld(rail);
    world.marbles.push({
      id: 1,
      x: geom.entryPoint.x - geom.entryTangent.x * 16,
      y: geom.entryPoint.y - geom.entryTangent.y * 16,
      prevX: geom.entryPoint.x,
      prevY: geom.entryPoint.y,
      vx: geom.entryTangent.x * 130,
      vy: geom.entryTangent.y * 130,
      radius: MARBLE_RADIUS,
      age: 0,
      trail: [],
      cooldowns: {},
      splitHistory: {},
      squash: 0,
      squashAngle: 0,
    });

    let entered = false;
    let exited = false;
    let exitDot = 0;
    let maxPen = 0;

    for (let tick = 0; tick < 280; tick++) {
      const evs = stepFixed(world, true);
      for (const ev of evs) {
        if (ev.type === "rail_enter" && ev.railId === "straight_test") entered = true;
        if (ev.type === "rail_exit" && ev.railId === "straight_test") {
          exited = true;
          const sp = Math.hypot(ev.vx, ev.vy) || 1;
          exitDot = (ev.vx * geom.exitTangent.x + ev.vy * geom.exitTangent.y) / sp;
        }
      }
      const m = world.marbles[0];
      if (m && entered && !exited) {
        const proj = projectPointOntoRail(geom, m.x, m.y);
        if (proj.t > 0.08 && proj.t < 0.92) {
          maxPen = Math.max(maxPen, proj.dist - (geom.halfChannel + 2));
        }
      }
    }

    assert.equal(entered, true, `Straight Twin Rail missed entry (rot=${rotDeg}, gap=${gap})`);
    assert.equal(exited, true, `Straight Twin Rail got stuck (rot=${rotDeg}, gap=${gap})`);
    assert.ok(maxPen < 2.0, `Marble escaped/penetrated straight rod by ${maxPen.toFixed(2)}px`);
    assert.ok(exitDot > 0.85, `Straight Twin Rail exit diverged (dot=${exitDot.toFixed(2)})`);
  }
}
console.log("[PASS] Straight Twin Rail verified across rotations (15°, 25°, 35°) & gaps (22, 26, 30px)");

// 1. Test varied entry speeds and slight angle offsets for V-Shaped Twin Rail
for (const entryVy of [120, 220, 340]) {
  for (const offsetVx of [-25, 0, 25]) {
    const rail = makeBaseRail({ boost: 0.2 });
    const geom = buildRailGeometry(rail);
    const world = makeTestWorld(rail);
    world.marbles.push({
      id: 1,
      x: geom.entryPoint.x,
      y: geom.entryPoint.y - 18,
      prevX: geom.entryPoint.x,
      prevY: geom.entryPoint.y - 18,
      vx: geom.entryTangent.x * 90 + offsetVx,
      vy: entryVy,
      radius: MARBLE_RADIUS,
      age: 0,
      trail: [],
      cooldowns: {},
      splitHistory: {},
      squash: 0,
      squashAngle: 0,
    });

    let entered = false;
    let exited = false;
    let exitVx = 0;
    let exitVy = 0;
    let maxWallPenetration = 0;
    let minSpeedInRail = Infinity;

    for (let tick = 0; tick < 360; tick++) {
      const evs = stepFixed(world, true);
      for (const ev of evs) {
        if (ev.type === "rail_enter") entered = true;
        if (ev.type === "rail_exit") {
          exited = true;
          exitVx = ev.vx;
          exitVy = ev.vy;
        }
      }
      const m = world.marbles[0];
      if (m && entered && !exited) {
        const sp = Math.hypot(m.vx, m.vy);
        if (sp < minSpeedInRail) minSpeedInRail = sp;
        const proj = projectPointOntoRail(geom, m.x, m.y);
        // If deep inside rail, radial distance must stay within halfChannel + margin
        if (proj.t > 0.08 && proj.t < 0.92) {
          const pen = proj.dist - (geom.halfChannel + 2);
          if (pen > maxWallPenetration) maxWallPenetration = pen;
        }
      }
    }

    assert.equal(entered, true, `Marble did not enter V-Rail (vy=${entryVy}, ovx=${offsetVx})`);
    assert.equal(exited, true, `Marble got stuck inside V-Rail (vy=${entryVy}, ovx=${offsetVx})`);
    assert.ok(
      maxWallPenetration < 2.0,
      `Marble penetrated rail wall by ${maxWallPenetration.toFixed(2)}px`
    );
    const exitSpeed = Math.hypot(exitVx, exitVy);
    assert.ok(exitSpeed > 90, `Exit speed too low (${exitSpeed.toFixed(1)})`);
    const dotOut =
      (exitVx * geom.exitTangent.x + exitVy * geom.exitTangent.y) / (exitSpeed || 1);
    assert.ok(
      dotOut > 0.65,
      `Exit direction diverged from outgoing arm (dot=${dotOut.toFixed(2)})`
    );
  }
}
console.log("[PASS] Varied entry speeds & angles rolled smoothly without sticking or wall penetration");

// 2. Test multiple rotations (including elevated exit at -25 deg with launch assist / kinetic speed)
for (const rotDeg of [-25, 0, 15, 30]) {
  const rail = makeBaseRail({
    rotation: (rotDeg * Math.PI) / 180,
    boost: rotDeg < 0 ? 0.65 : 0.25,
  });
  const geom = buildRailGeometry(rail);
  const world = makeTestWorld(rail);
  const entrySpeed = rotDeg < 0 ? 220 : 120;
  world.marbles.push({
    id: 1,
    x: geom.entryPoint.x,
    y: geom.entryPoint.y - 16,
    prevX: geom.entryPoint.x,
    prevY: geom.entryPoint.y - 16,
    vx: geom.entryTangent.x * entrySpeed,
    vy: Math.max(80, geom.entryTangent.y * entrySpeed),
    radius: MARBLE_RADIUS,
    age: 0,
    trail: [],
    cooldowns: {},
    splitHistory: {},
    squash: 0,
    squashAngle: 0,
  });

  let exited = false;
  let exitDirDot = 0;
  for (let tick = 0; tick < 360; tick++) {
    const evs = stepFixed(world, true);
    for (const ev of evs) {
      if (ev.type === "rail_exit") {
        exited = true;
        const sp = Math.hypot(ev.vx, ev.vy) || 1;
        exitDirDot = (ev.vx * geom.exitTangent.x + ev.vy * geom.exitTangent.y) / sp;
      }
    }
  }
  assert.equal(exited, true, `Failed exit at rotation ${rotDeg} deg`);
  assert.ok(exitDirDot > 0.6, `Wrong exit angle at rot=${rotDeg} deg (dot=${exitDirDot.toFixed(2)})`);
}
console.log("[PASS] Multiple rotations (-25°, 0°, 15°, 30°) verified cleanly");

// 3. Multiple marbles concurrently using the same V-Rail
{
  const rail = makeBaseRail({ boost: 0.2 });
  const geom = buildRailGeometry(rail);
  const world = makeTestWorld(rail);
  let enters = 0;
  let exits = 0;
  for (let tick = 0; tick < 480; tick++) {
    if (tick === 0 || tick === 45 || tick === 90) {
      world.marbles.push({
        id: world.nextMarbleId++,
        x: geom.entryPoint.x,
        y: geom.entryPoint.y - 16,
        prevX: geom.entryPoint.x,
        prevY: geom.entryPoint.y - 16,
        vx: 70,
        vy: 140,
        radius: MARBLE_RADIUS,
        age: 0,
        trail: [],
        cooldowns: {},
        splitHistory: {},
        squash: 0,
        squashAngle: 0,
      });
    }
    const evs = stepFixed(world, true);
    for (const ev of evs) {
      if (ev.type === "rail_enter") enters++;
      if (ev.type === "rail_exit") exits++;
    }
  }
  assert.equal(enters, 3, `Expected 3 marbles to enter, got ${enters}`);
  assert.equal(exits, 3, `Expected 3 marbles to exit, got ${exits}`);
}
console.log("[PASS] 3 concurrent marbles traversed V-Rail cleanly");

// 4. End-to-end showcase preset: Emitter -> Straight Twin Rail -> V-Shaped Twin Rail -> Musical Instruments
{
  const preset = SANDBOX_PRESETS.find((p) => p.id === "v-rail-transfer");
  assert.ok(preset, "v-rail-transfer preset missing!");
  const world = createWorldFromPreset(preset);
  const enteredIds = new Set<string>();
  const exitedIds = new Set<string>();
  let railEnters = 0;
  let railExits = 0;
  let barHits = 0;
  const hitBarIds = new Set<string>();

  for (let tick = 0; tick < 650; tick++) {
    const evs = stepFixed(world, true);
    for (const ev of evs) {
      if (ev.type === "rail_enter") {
        railEnters++;
        enteredIds.add(ev.railId);
      }
      if (ev.type === "rail_exit") {
        railExits++;
        exitedIds.add(ev.railId);
      }
      if (ev.type === "bar_hit") {
        barHits++;
        hitBarIds.add(ev.barId);
      }
    }
  }

  console.log(
    `[Preset v-rail-transfer] entered=[${[...enteredIds].join(",")}], exited=[${[...exitedIds].join(",")}], barHits=${barHits}, barsHit=[${[...hitBarIds].join(",")}]`
  );
  assert.ok(enteredIds.has("rail_straight"), "Showcase marble never entered Straight Twin Rail!");
  assert.ok(exitedIds.has("rail_straight"), "Showcase marble never exited Straight Twin Rail!");
  assert.ok(enteredIds.has("rail_v"), "Showcase marble never entered V-Shaped Twin Rail!");
  assert.ok(exitedIds.has("rail_v"), "Showcase marble never exited V-Shaped Twin Rail!");
  assert.ok(railEnters >= 2 && railExits >= 2, "Expected both rails traversed");
  assert.ok(hitBarIds.size >= 2, `Expected at least 2 downstream musical bars hit, got ${hitBarIds.size}`);
}
console.log("ALL TWIN 3D RAIL SYSTEM VERIFICATION TESTS PASSED!");
