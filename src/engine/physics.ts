import { MATERIALS, STAGE_H, STAGE_W } from "../theme/tokens.ts";
import {
  buildRailGeometry,
  projectPointOntoRail,
  type RailGeometry,
} from "./railGeometry.ts";
import type {
  BarPiece,
  Marble,
  PhysicsEvent,
  TransferRailPiece,
  Vec2,
  WorldState,
} from "./types.ts";

export const FIXED_DT = 1 / 120;
export const GRAVITY = 460;
export const MAX_SPEED = 900;
export const MARBLE_RADIUS = 8;
export const MAX_MARBLES = 36;
const RING_CHARGE_DECAY_SEC = 4.2;
const RING_WIN_HOLD_SEC = 0.45;

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function barLength(bar: Pick<BarPiece, "ax" | "ay" | "bx" | "by">): number {
  return Math.hypot(bar.bx - bar.ax, bar.by - bar.ay);
}

export function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cx: number; cy: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-6) {
    return { cx: ax, cy: ay, t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return { cx: ax + abx * t, cy: ay + aby * t, t };
}

function clampSpeed(m: Marble): void {
  const sp = Math.hypot(m.vx, m.vy);
  if (sp > MAX_SPEED) {
    const scale = MAX_SPEED / sp;
    m.vx *= scale;
    m.vy *= scale;
  }
}

/**
 * Resolves continuous capsule-wall containment and momentum-preserving gliding inside a Transfer Rail.
 */
function resolveMarbleInRail(
  body: { x: number; y: number; vx: number; vy: number; radius: number },
  rail: TransferRailPiece,
  geom: RailGeometry,
  dt: number
): { inChannel: boolean; t: number; hitPoint?: Vec2 } {
  const pad = body.radius + geom.wallThickness + 16;
  if (
    body.x < geom.bounds.minX - pad ||
    body.x > geom.bounds.maxX + pad ||
    body.y < geom.bounds.minY - pad ||
    body.y > geom.bounds.maxY + pad
  ) {
    return { inChannel: false, t: 0 };
  }

  const minDist = body.radius + geom.wallThickness * 0.5;
  const minDistSq = minDist * minDist;
  let hitPoint: Vec2 | undefined;
  let maxImpact = 22;

  // Two passes stabilize corner & double-wall containment cleanly at all speeds
  for (let pass = 0; pass < 2; pass++) {
    for (const rod of [geom.outerWall, geom.innerWall]) {
      for (let i = 0; i < rod.length - 1; i++) {
        const a = rod[i];
        const b = rod[i + 1];
        const { cx, cy } = closestPointOnSegment(body.x, body.y, a.x, a.y, b.x, b.y);
        const dx = body.x - cx;
        const dy = body.y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDistSq) {
          const d = Math.sqrt(d2);
          let nx = 0;
          let ny = -1;
          if (d > 1e-5) {
            nx = dx / d;
            ny = dy / d;
          } else {
            const wdx = b.x - a.x;
            const wdy = b.y - a.y;
            const wl = Math.hypot(wdx, wdy) || 1;
            nx = -wdy / wl;
            ny = wdx / wl;
          }
          const overlap = minDist - d;
          body.x += nx * overlap;
          body.y += ny * overlap;

          const vn = body.vx * nx + body.vy * ny;
          if (vn < 0) {
            const impact = -vn;
            if (impact > maxImpact) {
              maxImpact = impact;
              hitPoint = { x: cx, y: cy };
            }
            // Low normal restitution prevents bouncing/chatter while gliding along the rods
            const wallRestitution = 0.12;
            body.vx -= (1 + wallRestitution) * vn * nx;
            body.vy -= (1 + wallRestitution) * vn * ny;
            // Subtle rolling friction preserving natural momentum
            body.vx *= 0.9992;
            body.vy *= 0.9992;
          }
        }
      }
    }
  }

  const proj = projectPointOntoRail(geom, body.x, body.y);
  const inChannel = proj.dist <= geom.halfChannel + 5 && proj.t > 0.025 && proj.t < 0.975;

  if (inChannel && rail.boost > 0) {
    const vDotT = body.vx * proj.tangent.x + body.vy * proj.tangent.y;
    const dir = Math.abs(vDotT) < 18 ? 1 : vDotT >= 0 ? 1 : -1;
    const speedAlong = vDotT * dir;
    if (speedAlong < 460) {
      const accel = rail.boost * 760 * dt;
      body.vx += proj.tangent.x * dir * accel;
      body.vy += proj.tangent.y * dir * accel;
    }
  }

  return { inChannel, t: proj.t, hitPoint };
}

export function stepFixed(world: WorldState, isPlaying: boolean): PhysicsEvent[] {
  const events: PhysicsEvent[] = [];

  // Visual spring oscillation & decay update smoothly every fixed tick
  for (const bar of world.bars) {
    const amp = bar.flexOffset ?? 0;
    const vel = bar.flexVel ?? 0;
    if (Math.abs(amp) > 0.005 || Math.abs(vel) > 0.005) {
      const k = 320;
      const damp = 14;
      const acc = -k * amp - damp * vel;
      const nextVel = vel + acc * FIXED_DT;
      const nextAmp = amp + nextVel * FIXED_DT;
      bar.flexVel = nextVel;
      bar.flexOffset = nextAmp;
    } else {
      bar.flexOffset = 0;
      bar.flexVel = 0;
    }
  }

  for (const b of world.bumpers) {
    if (b.pulse && b.pulse > 0) b.pulse = Math.max(0, b.pulse - FIXED_DT * 4.5);
  }
  for (const s of world.splitters) {
    if (s.pulse && s.pulse > 0) s.pulse = Math.max(0, s.pulse - FIXED_DT * 4.0);
  }
  for (const e of world.emitters) {
    if (e.pulse && e.pulse > 0) e.pulse = Math.max(0, e.pulse - FIXED_DT * 4.5);
  }
  for (const r of world.rings) {
    if (r.pulse && r.pulse > 0) r.pulse = Math.max(0, r.pulse - FIXED_DT * 3.0);
  }
  const rails = world.rails ?? [];
  for (const rail of rails) {
    if (rail.activeGlow && rail.activeGlow > 0) {
      rail.activeGlow = Math.max(0, rail.activeGlow - FIXED_DT * 2.4);
    }
    if (rail.exitPulse && rail.exitPulse > 0) {
      rail.exitPulse = Math.max(0, rail.exitPulse - FIXED_DT * 3.2);
    }
    if (rail.hitFlash && rail.hitFlash > 0) {
      rail.hitFlash = Math.max(0, rail.hitFlash - FIXED_DT * 4.5);
    }
  }
  const railGeoms = rails.map((r) => ({ rail: r, geom: buildRailGeometry(r) }));

  // Update visual ripples and note popups
  for (let i = world.ripples.length - 1; i >= 0; i--) {
    world.ripples[i].age += FIXED_DT;
    if (world.ripples[i].age >= world.ripples[i].duration) {
      world.ripples.splice(i, 1);
    }
  }
  for (let i = world.popups.length - 1; i >= 0; i--) {
    world.popups[i].age += FIXED_DT;
    if (world.popups[i].age >= world.popups[i].duration) {
      world.popups.splice(i, 1);
    }
  }

  if (!isPlaying) {
    return events;
  }

  // Advance beat clock & spawn marbles cleanly on beat boundaries
  const beatsPerSec = world.bpm / 60;
  world.beatClock += beatsPerSec * FIXED_DT;

  for (const em of world.emitters) {
    if (world.beatClock >= em.nextEmitBeat - 1e-6) {
      em.nextEmitBeat += Math.max(0.25, em.beatInterval);
      em.pulse = 1;
      if (world.marbles.length < MAX_MARBLES) {
        world.marbles.push({
          id: world.nextMarbleId++,
          x: em.x,
          y: em.y,
          prevX: em.x,
          prevY: em.y,
          vx: em.vx,
          vy: em.vy,
          radius: MARBLE_RADIUS,
          age: 0,
          trail: [],
          cooldowns: {},
          splitHistory: {},
          squash: 0,
          squashAngle: 0,
          trackChannel: em.trackChannel,
        });
      }
    }
  }

  // Run 2 micro-steps per 1/120s tick (240Hz continuous sub-stepping => zero tunneling)
  const SUB_STEPS = 2;
  const subDt = FIXED_DT / SUB_STEPS;
  const spawnedFromSplit: Marble[] = [];

  for (const m of world.marbles) {
    m.prevX = m.x;
    m.prevY = m.y;
    m.age += FIXED_DT;
    if (m.squash > 0) {
      m.squash = Math.max(0, m.squash - FIXED_DT * 6.5);
    }

    // Decay per-piece cooldowns
    for (const key of Object.keys(m.cooldowns)) {
      m.cooldowns[key] -= FIXED_DT;
      if (m.cooldowns[key] <= 0) {
        delete m.cooldowns[key];
      }
    }
  }

  const g = world.gravity ?? GRAVITY;
  for (let step = 0; step < SUB_STEPS; step++) {
    for (let mi = world.marbles.length - 1; mi >= 0; mi--) {
      const m = world.marbles[mi];
      m.vy += g * subDt;
      clampSpeed(m);
      m.x += m.vx * subDt;
      m.y += m.vy * subDt;

      // 1. Circle-vs-Capsule collisions against musical bars
      for (const bar of world.bars) {
        if (m.cueTargetId && m.cueTargetId !== bar.id) continue;
        if (m.trackChannel && bar.trackChannel && m.trackChannel !== bar.trackChannel) {
          continue;
        }
        const spec = MATERIALS[bar.material];
        const restitution = bar.customRestitution ?? spec.restitution;
        const minDist = m.radius + spec.thickness * 0.5;
        const { cx, cy } = closestPointOnSegment(m.x, m.y, bar.ax, bar.ay, bar.bx, bar.by);
        const dx = m.x - cx;
        const dy = m.y - cy;
        const d2 = dx * dx + dy * dy;

        if (d2 < minDist * minDist) {
          let nx = 0;
          let ny = -1;
          const d = Math.sqrt(d2);
          if (d > 1e-5) {
            nx = dx / d;
            ny = dy / d;
          } else {
            // Fallback normal perpendicular to bar
            const bdx = bar.bx - bar.ax;
            const bdy = bar.by - bar.ay;
            const bl = Math.hypot(bdx, bdy) || 1;
            nx = -bdy / bl;
            ny = bdx / bl;
          }

          // Push marble strictly out of capsule penetration
          const overlap = minDist - d;
          m.x += nx * overlap;
          m.y += ny * overlap;

          const vn = m.vx * nx + m.vy * ny;
          if (vn < 0) {
            const impactSpeed = -vn;
            m.vx -= (1 + restitution) * vn * nx;
            m.vy -= (1 + restitution) * vn * ny;
            // Subtle tangental damping for natural feel
            m.vx *= 0.996;
            m.vy *= 0.996;
            clampSpeed(m);

            if (!m.cooldowns[bar.id] && impactSpeed > 32) {
              m.cooldowns[bar.id] = 0.035;
              m.squash = Math.min(1, impactSpeed / 460);
              m.squashAngle = Math.atan2(ny, nx);

              bar.hitNx = -nx;
              bar.hitNy = -ny;
              bar.flexVel = Math.min(260, 75 + impactSpeed * 0.36);

              const wasSilentCue = Boolean(m.silentCue);
              if (m.cueTargetId === bar.id) {
                m.cueTargetId = undefined;
                m.silentCue = false;
              }

              events.push({
                type: "bar_hit",
                barId: bar.id,
                material: bar.material,
                length: barLength(bar),
                x: cx,
                y: cy,
                speed: impactSpeed,
                silentCue: wasSilentCue || bar.silent,
                fixedMidi: bar.fixedMidi,
                instrumentOverride: bar.instrumentOverride,
                drumOverride: bar.drumOverride,
                noteLabel: bar.noteLabel,
              });
            }
          }
        }
      }

      // 2. Circle-vs-Circle collisions against Bumpers
      for (const bumper of world.bumpers) {
        if (m.cueTargetId && m.cueTargetId !== bumper.id) continue;
        const minDist = m.radius + bumper.radius;
        const dx = m.x - bumper.x;
        const dy = m.y - bumper.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDist * minDist) {
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d;
          const ny = dy / d;
          m.x = bumper.x + nx * minDist;
          m.y = bumper.y + ny * minDist;

          const vn = m.vx * nx + m.vy * ny;
          if (vn < 0) {
            const impactSpeed = -vn;
            m.vx -= 2.12 * vn * nx;
            m.vy -= 2.12 * vn * ny;
            const sp = Math.hypot(m.vx, m.vy);
            if (sp < 420) {
              const boost = 420 / (sp || 1);
              m.vx *= boost;
              m.vy *= boost;
            }
            clampSpeed(m);

            if (!m.cooldowns[bumper.id]) {
              m.cooldowns[bumper.id] = 0.045;
              bumper.pulse = 1;
              m.squash = 0.9;
              m.squashAngle = Math.atan2(ny, nx);
              const wasSilentCue = Boolean(m.silentCue);
              if (m.cueTargetId === bumper.id) {
                m.cueTargetId = undefined;
                m.silentCue = false;
              }
              events.push({
                type: "bumper_hit",
                bumperId: bumper.id,
                x: bumper.x,
                y: bumper.y,
                speed: impactSpeed,
                silentCue: wasSilentCue,
              });
            }
          }
        }
      }

      // 2.5. Continuous Curved Transfer Rails (V-Rail guide containment)
      for (const { rail, geom } of railGeoms) {
        const res = resolveMarbleInRail(m, rail, geom, subDt);
        clampSpeed(m);
        if (res.hitPoint) {
          rail.hitFlash = 1;
          rail.hitX = res.hitPoint.x;
          rail.hitY = res.hitPoint.y;
        }
        if (res.inChannel) {
          if (m.activeRailId !== rail.id) {
            m.activeRailId = rail.id;
            m.activeRailT = res.t;
            events.push({
              type: "rail_enter",
              railId: rail.id,
              x: m.x,
              y: m.y,
              t: res.t,
            });
          } else {
            m.activeRailT = res.t;
          }
          rail.activeGlow = 1;
          rail.pulseT = res.t;
        } else if (m.activeRailId === rail.id) {
          m.activeRailId = undefined;
          m.activeRailT = undefined;
          rail.exitPulse = 1;
          rail.exitX = m.x;
          rail.exitY = m.y;
          events.push({
            type: "rail_exit",
            railId: rail.id,
            x: m.x,
            y: m.y,
            vx: m.vx,
            vy: m.vy,
          });
        }
      }

      // 3. Prism Splitter sensor (splits 1 marble into ±26° symmetric twin streams)
      for (const splitter of world.splitters) {
        if (m.splitHistory[splitter.id]) continue;
        const triggerR = splitter.radius + m.radius * 0.5;
        if (distSq(m.x, m.y, splitter.x, splitter.y) <= triggerR * triggerR) {
          splitter.pulse = 1;
          const baseSpeed = Math.max(240, Math.hypot(m.vx, m.vy) * 0.96);
          const angle = Math.atan2(m.vy, m.vx);
          const spread = (26 * Math.PI) / 180;

          // Update original marble to left branch and spawn right branch
          m.splitHistory[splitter.id] = true;
          const childHistory = { ...m.splitHistory };

          m.x = splitter.x;
          m.y = splitter.y;
          m.vx = Math.cos(angle - spread) * baseSpeed;
          m.vy = Math.sin(angle - spread) * baseSpeed;

          if (world.marbles.length + spawnedFromSplit.length < MAX_MARBLES) {
            spawnedFromSplit.push({
              id: world.nextMarbleId++,
              x: splitter.x,
              y: splitter.y,
              prevX: splitter.x,
              prevY: splitter.y,
              vx: Math.cos(angle + spread) * baseSpeed,
              vy: Math.sin(angle + spread) * baseSpeed,
              radius: m.radius,
              age: m.age,
              trail: [],
              cooldowns: { ...m.cooldowns },
              splitHistory: childHistory,
              squash: 0.4,
              squashAngle: angle + spread,
            });
          }

          events.push({
            type: "splitter_hit",
            splitterId: splitter.id,
            x: splitter.x,
            y: splitter.y,
          });
        }
      }

      // 4. Resonance Ring sensor
      world.rings.forEach((ring, ringIndex) => {
        const hitR = ring.radius + m.radius * 0.4;
        if (distSq(m.x, m.y, ring.x, ring.y) <= hitR * hitR) {
          const shouldEmit = ring.charge < 0.82;
          ring.charge = 1;
          if (shouldEmit) {
            ring.pulse = 1;
            events.push({
              type: "ring_hit",
              ringId: ring.id,
              x: ring.x,
              y: ring.y,
              ringIndex,
            });
          }
        }
      });
    }
  }

  if (spawnedFromSplit.length > 0) {
    world.marbles.push(...spawnedFromSplit);
  }

  // Record smooth trail points and prune off-stage marbles
  const maxBarY = world.bars.reduce(
    (mx, b) => Math.max(mx, b.ay, b.by),
    STAGE_H
  );
  const cullBottomY = Math.max(STAGE_H + 120, maxBarY + 240);

  for (let i = world.marbles.length - 1; i >= 0; i--) {
    const m = world.marbles[i];
    if (
      m.y > cullBottomY ||
      m.x < -550 ||
      m.x > STAGE_W + 550 ||
      m.y < -220
    ) {
      world.marbles.splice(i, 1);
      continue;
    }

    const last = m.trail[m.trail.length - 1];
    if (!last || distSq(m.x, m.y, last.x, last.y) > 20) {
      m.trail.push({ x: m.x, y: m.y });
      if (m.trail.length > 8) {
        m.trail.shift();
      }
    }
  }

  // Decay ring charge & check harmonic win state
  for (const ring of world.rings) {
    if (ring.charge > 0) {
      ring.charge = Math.max(0, ring.charge - FIXED_DT / RING_CHARGE_DECAY_SEC);
    }
  }

  if (world.rings.length > 0 && !world.levelSolved) {
    const allActive = world.rings.every((r) => r.charge > 0.05);
    if (allActive) {
      world.allChargedTimer += FIXED_DT;
      if (world.allChargedTimer >= RING_WIN_HOLD_SEC) {
        world.levelSolved = true;
        events.push({ type: "level_win" });
      }
    } else {
      world.allChargedTimer = Math.max(0, world.allChargedTimer - FIXED_DT * 2);
    }
  }

  return events;
}

export interface GhostBranch {
  points: Vec2[];
}

export function simulateGhostPath(
  world: WorldState,
  steps = 185
): GhostBranch[] {
  const branches: GhostBranch[] = [];

  for (const em of world.emitters) {
    type SimOrb = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      points: Vec2[];
      bounces: number;
      splitHistory: Record<string, boolean>;
    };

    const queue: SimOrb[] = [
      {
        x: em.x,
        y: em.y,
        vx: em.vx,
        vy: em.vy,
        points: [{ x: em.x, y: em.y }],
        bounces: 0,
        splitHistory: {},
      },
    ];

    const ghostRails = (world.rails ?? []).map((r) => ({
      rail: r,
      geom: buildRailGeometry(r),
    }));

    let iterations = 0;
    while (queue.length > 0 && iterations < 6) {
      iterations++;
      const orb = queue.shift()!;
      for (let t = 0; t < steps; t++) {
        orb.vy += (world.gravity ?? GRAVITY) * FIXED_DT;
        const sp = Math.hypot(orb.vx, orb.vy);
        if (sp > MAX_SPEED) {
          orb.vx *= MAX_SPEED / sp;
          orb.vy *= MAX_SPEED / sp;
        }
        orb.x += orb.vx * FIXED_DT;
        orb.y += orb.vy * FIXED_DT;

        for (const bar of world.bars) {
          const spec = MATERIALS[bar.material];
          const minDist = MARBLE_RADIUS + spec.thickness * 0.5;
          const { cx, cy } = closestPointOnSegment(
            orb.x,
            orb.y,
            bar.ax,
            bar.ay,
            bar.bx,
            bar.by
          );
          const dx = orb.x - cx;
          const dy = orb.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDist * minDist) {
            const d = Math.sqrt(d2) || 1;
            const nx = dx / d;
            const ny = dy / d;
            orb.x += nx * (minDist - d);
            orb.y += ny * (minDist - d);
            const vn = orb.vx * nx + orb.vy * ny;
            if (vn < 0) {
              orb.vx -= (1 + spec.restitution) * vn * nx;
              orb.vy -= (1 + spec.restitution) * vn * ny;
              orb.bounces++;
              orb.points.push({ x: orb.x, y: orb.y });
            }
          }
        }

        for (const bumper of world.bumpers) {
          const minDist = MARBLE_RADIUS + bumper.radius;
          const dx = orb.x - bumper.x;
          const dy = orb.y - bumper.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDist * minDist) {
            const d = Math.sqrt(d2) || 1;
            const nx = dx / d;
            const ny = dy / d;
            orb.x = bumper.x + nx * minDist;
            orb.y = bumper.y + ny * minDist;
            const vn = orb.vx * nx + orb.vy * ny;
            if (vn < 0) {
              orb.vx -= 2.12 * vn * nx;
              orb.vy -= 2.12 * vn * ny;
              const curr = Math.hypot(orb.vx, orb.vy);
              if (curr < 420) {
                const boost = 420 / (curr || 1);
                orb.vx *= boost;
                orb.vy *= boost;
              }
              orb.bounces++;
            }
          }
        }

        for (const { rail, geom } of ghostRails) {
          resolveMarbleInRail(
            {
              get x() {
                return orb.x;
              },
              set x(v) {
                orb.x = v;
              },
              get y() {
                return orb.y;
              },
              set y(v) {
                orb.y = v;
              },
              get vx() {
                return orb.vx;
              },
              set vx(v) {
                orb.vx = v;
              },
              get vy() {
                return orb.vy;
              },
              set vy(v) {
                orb.vy = v;
              },
              radius: MARBLE_RADIUS,
            },
            rail,
            geom,
            FIXED_DT
          );
        }

        for (const splitter of world.splitters) {
          if (orb.splitHistory[splitter.id]) continue;
          const triggerR = splitter.radius + MARBLE_RADIUS * 0.5;
          if (distSq(orb.x, orb.y, splitter.x, splitter.y) <= triggerR * triggerR) {
            orb.splitHistory[splitter.id] = true;
            const baseSpeed = Math.max(240, Math.hypot(orb.vx, orb.vy) * 0.96);
            const angle = Math.atan2(orb.vy, orb.vx);
            const spread = (26 * Math.PI) / 180;
            orb.x = splitter.x;
            orb.y = splitter.y;
            orb.vx = Math.cos(angle - spread) * baseSpeed;
            orb.vy = Math.sin(angle - spread) * baseSpeed;
            orb.points.push({ x: splitter.x, y: splitter.y });

            if (queue.length < 4) {
              queue.push({
                x: splitter.x,
                y: splitter.y,
                vx: Math.cos(angle + spread) * baseSpeed,
                vy: Math.sin(angle + spread) * baseSpeed,
                points: [{ x: splitter.x, y: splitter.y }],
                bounces: orb.bounces,
                splitHistory: { ...orb.splitHistory },
              });
            }
          }
        }

        if (t % 3 === 0) {
          orb.points.push({ x: orb.x, y: orb.y });
        }
        if (
          orb.y > STAGE_H + 20 ||
          orb.x < -30 ||
          orb.x > STAGE_W + 30 ||
          orb.bounces >= 5
        ) {
          break;
        }
      }
      branches.push({ points: orb.points });
    }
  }

  return branches;
}
