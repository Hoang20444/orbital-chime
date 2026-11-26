import assert from "node:assert/strict";
import { SANDBOX_PRESETS } from "../src/data/presets.ts";
import { GRAVITY, MARBLE_RADIUS, stepFixed } from "../src/engine/physics.ts";
import { buildRailGeometry, projectPointOntoRail } from "../src/engine/railGeometry.ts";
import type { TransferRailPiece, WorldState } from "../src/engine/types.ts";
import { createWorldFromPreset } from "../src/engine/worldFactory.ts";

function makeBaseRail(overrides: Partial<TransferRailPiece> = {}): TransferRailPiece {
  return {
    id: "dual_test",
    variant: "v",
    x: 400,
    y: 300,
    rotation: 0,
    armLength: 135,
    openingAngle: 88,
    curvature: 0.56,
    slopeBias: 0.08,
    railSpacing: 12.8,
    bridgeSpacing: 52,
    boost: 0.16,
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

console.log("=== Verifying CURVED DUAL-SUPPORT RAIL SYSTEM in 120Hz stepFixed ===");

// 1. Straight Dual-Support Rail across rotations, rail spacings, and entry speeds
for (const rotDeg of [12, 22, 34]) {
  for (const railSpacing of [9.5, 12.8, 14.5]) {
    for (const entrySpeed of [80, 180, 300]) {
      const rail = makeBaseRail({
        id: "straight_dual",
        variant: "straight",
        rotation: (rotDeg * Math.PI) / 180,
        armLength: 115,
        railSpacing,
        boost: 0.12,
      });
      const geom = buildRailGeometry(rail);
      const world = makeTestWorld(rail);
      // Spawn slightly above upper support saddle along entry span
      const spawnOffset = 0.08;
      const sx =
        geom.entryPoint.x +
        geom.entryTangent.x * 16 +
        geom.entryUpNormal.x * (geom.supportHeight + 2 + spawnOffset);
      const sy =
        geom.entryPoint.y +
        geom.entryTangent.y * 16 +
        geom.entryUpNormal.y * (geom.supportHeight + 2 + spawnOffset);
      world.marbles.push({
        id: 1,
        x: sx,
        y: sy,
        prevX: sx,
        prevY: sy,
        vx: geom.entryTangent.x * entrySpeed,
        vy: geom.entryTangent.y * entrySpeed,
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
      let minSignedUp = Infinity;

      for (let tick = 0; tick < 300; tick++) {
        const evs = stepFixed(world, true);
        for (const ev of evs) {
          if (ev.type === "rail_enter" && ev.railId === "straight_dual") entered = true;
          if (ev.type === "rail_exit" && ev.railId === "straight_dual") {
            exited = true;
            exitVx = ev.vx;
            exitVy = ev.vy;
          }
        }
        const m = world.marbles[0];
        if (m && entered && !exited) {
          const proj = projectPointOntoRail(geom, m.x, m.y);
          if (proj.t > 0.03 && proj.t < 0.97) {
            minSignedUp = Math.min(minSignedUp, proj.signedUpDist);
            assert.ok(
              proj.signedUpDist >= geom.supportHeight - 0.8 &&
                proj.signedUpDist > MARBLE_RADIUS,
              `Marble fell between or below Straight rails! signedUpDist=${proj.signedUpDist.toFixed(2)}, supportH=${geom.supportHeight.toFixed(2)}`
            );
          }
        }
      }

      assert.equal(
        entered,
        true,
        `Straight Dual-Support Rail missed entry (rot=${rotDeg}, spacing=${railSpacing}, speed=${entrySpeed})`
      );
      assert.equal(
        exited,
        true,
        `Straight Dual-Support Rail got stuck (rot=${rotDeg}, spacing=${railSpacing}, speed=${entrySpeed})`
      );
      const exitSpeed = Math.hypot(exitVx, exitVy) || 1;
      const dot = (exitVx * geom.exitTangent.x + exitVy * geom.exitTangent.y) / exitSpeed;
      assert.ok(dot > 0.85, `Straight rail exit diverged (dot=${dot.toFixed(2)})`);
    }
  }
}
console.log("[PASS] Straight Dual-Support Rail verified strictly ON TOP across rotations (12°, 22°, 34°), spacings (9.5..14.5), and speeds (80..300)");

// 2. Curved V-Shaped Dual-Support Rail across opening angles, rotations, and speeds
for (const openingAngle of [68, 90, 116]) {
  for (const rotDeg of [-20, 0, 16, 28]) {
    for (const speed of [110, 220, 340]) {
      const rail = makeBaseRail({
        id: "v_dual",
        variant: "v",
        openingAngle,
        rotation: (rotDeg * Math.PI) / 180,
        boost: rotDeg < 0 ? 0.55 : 0.2,
      });
      const geom = buildRailGeometry(rail);
      const world = makeTestWorld(rail);
      const sx =
        geom.entryPoint.x +
        geom.entryTangent.x * 16 +
        geom.entryUpNormal.x * (geom.supportHeight + 2);
      const sy =
        geom.entryPoint.y +
        geom.entryTangent.y * 16 +
        geom.entryUpNormal.y * (geom.supportHeight + 2);
      world.marbles.push({
        id: 1,
        x: sx,
        y: sy,
        prevX: sx,
        prevY: sy,
        vx: geom.entryTangent.x * speed,
        vy: Math.max(40, geom.entryTangent.y * speed),
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
      let maxHover = 0;

      for (let tick = 0; tick < 360; tick++) {
        const evs = stepFixed(world, true);
        for (const ev of evs) {
          if (ev.type === "rail_enter" && ev.railId === "v_dual") entered = true;
          if (ev.type === "rail_exit" && ev.railId === "v_dual") {
            exited = true;
            exitVx = ev.vx;
            exitVy = ev.vy;
          }
        }
        const m = world.marbles[0];
        if (m && entered && !exited) {
          const proj = projectPointOntoRail(geom, m.x, m.y);
          if (proj.t > 0.05 && proj.t < 0.95) {
            assert.ok(
              proj.signedUpDist >= geom.supportHeight - 0.8 &&
                proj.signedUpDist > MARBLE_RADIUS,
              `Marble penetrated or fell between V-Rail! signedUpDist=${proj.signedUpDist.toFixed(2)}, supportH=${geom.supportHeight.toFixed(2)}`
            );
            maxHover = Math.max(maxHover, proj.signedUpDist - geom.supportHeight);
          }
        }
      }

      assert.equal(
        entered,
        true,
        `V-Dual Rail missed entry (angle=${openingAngle}, rot=${rotDeg}, speed=${speed})`
      );
      assert.equal(
        exited,
        true,
        `V-Dual Rail got stuck (angle=${openingAngle}, rot=${rotDeg}, speed=${speed})`
      );
      assert.ok(
        maxHover < 12,
        `Unstable bounce detected on V-Dual Rail (hover=${maxHover.toFixed(2)}px)`
      );
      const exitSpeed = Math.hypot(exitVx, exitVy) || 1;
      const dot = (exitVx * geom.exitTangent.x + exitVy * geom.exitTangent.y) / exitSpeed;
      assert.ok(dot > 0.72, `V-Dual Rail exit diverged (dot=${dot.toFixed(2)})`);
    }
  }
}
console.log("[PASS] Curved V-Shaped Dual-Support Rail verified ON TOP across angles (68°, 90°, 116°), rotations (-20°..28°), and speeds (110..340)");

// 3. Multiple concurrent marbles + Bridge Spacing Synchronization check
{
  const dense = buildRailGeometry(makeBaseRail({ bridgeSpacing: 32 }));
  const sparse = buildRailGeometry(makeBaseRail({ bridgeSpacing: 84 }));
  assert.ok(
    dense.bridges.length > sparse.bridges.length && sparse.bridges.length >= 2,
    `Expected bridge count to scale with bridgeSpacing (dense=${dense.bridges.length}, sparse=${sparse.bridges.length})`
  );
  assert.equal(dense.railSpacing, sparse.railSpacing, "Rail depth spacing must stay synchronized");

  const rail = makeBaseRail({ boost: 0.22 });
  const geom = buildRailGeometry(rail);
  const world = makeTestWorld(rail);
  let enters = 0;
  let exits = 0;
  for (let tick = 0; tick < 480; tick++) {
    if (tick === 0 || tick === 45 || tick === 90) {
      const sx = geom.entryPoint.x + geom.entryTangent.x * 16 + geom.entryUpNormal.x * (geom.supportHeight + 2);
      const sy = geom.entryPoint.y + geom.entryTangent.y * 16 + geom.entryUpNormal.y * (geom.supportHeight + 2);
      world.marbles.push({
        id: world.nextMarbleId++,
        x: sx,
        y: sy,
        prevX: sx,
        prevY: sy,
        vx: geom.entryTangent.x * 140,
        vy: geom.entryTangent.y * 140,
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
  assert.equal(enters, 3, `Expected 3 concurrent marbles to enter, got ${enters}`);
  assert.equal(exits, 3, `Expected 3 concurrent marbles to exit, got ${exits}`);
}
console.log("[PASS] 3 concurrent marbles & bridgeSpacing/railSpacing geometry synchronization verified");

// 4. End-to-end showcase preset: Emitter -> Straight Dual Rail -> V-Shaped Dual Rail -> Musical Instruments
{
  const preset = SANDBOX_PRESETS.find((p) => p.id === "v-rail-transfer");
  assert.ok(preset, "v-rail-transfer preset missing!");
  const world = createWorldFromPreset(preset);
  const geoms = world.rails.map((r) => buildRailGeometry(r));
  const enteredIds = new Set<string>();
  const exitedIds = new Set<string>();
  const hitBarIds = new Set<string>();
  let minSignedUp = Infinity;

  for (let tick = 0; tick < 650; tick++) {
    const evs = stepFixed(world, true);
    for (const ev of evs) {
      if (ev.type === "rail_enter") enteredIds.add(ev.railId);
      if (ev.type === "rail_exit") exitedIds.add(ev.railId);
      if (ev.type === "bar_hit") hitBarIds.add(ev.barId);
    }
    for (const m of world.marbles) {
      if (m.activeRailId) {
        const g = geoms.find((x) => x.railId === m.activeRailId)!;
        const proj = projectPointOntoRail(g, m.x, m.y);
        minSignedUp = Math.min(minSignedUp, proj.signedUpDist);
        assert.ok(
          proj.signedUpDist > MARBLE_RADIUS,
          `Preset marble fell between rails on ${m.activeRailId}: signedUpDist=${proj.signedUpDist.toFixed(2)}`
        );
      }
    }
  }

  console.log(
    `[Preset v-rail-transfer] entered=[${[...enteredIds].join(",")}], exited=[${[...exitedIds].join(",")}], minSignedUp=${minSignedUp.toFixed(2)}px, barsHit=[${[...hitBarIds].join(",")}]`
  );
  assert.ok(enteredIds.has("rail_straight") && exitedIds.has("rail_straight"), "Preset did not traverse Straight Dual Rail!");
  assert.ok(enteredIds.has("rail_v") && exitedIds.has("rail_v"), "Preset did not traverse V-Shaped Dual Rail!");
  assert.ok(hitBarIds.size >= 2, `Expected at least 2 downstream musical bars hit, got ${hitBarIds.size}`);
}
console.log("ALL CURVED DUAL-SUPPORT RAIL VERIFICATION TESTS PASSED!");
