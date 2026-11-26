import type { TransferRailPiece, Vec2 } from "./types.ts";

export interface RailGeometry {
  railId: string;
  centerPoints: Vec2[];
  tangents: Vec2[];
  normals: Vec2[];
  outerWall: Vec2[];
  innerWall: Vec2[];
  wallThickness: number;
  halfChannel: number;
  entryPoint: Vec2;
  exitPoint: Vec2;
  entryTangent: Vec2;
  exitTangent: Vec2;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function rotateAndTranslate(
  lx: number,
  ly: number,
  cosR: number,
  sinR: number,
  tx: number,
  ty: number
): Vec2 {
  return {
    x: tx + lx * cosR - ly * sinR,
    y: ty + lx * sinR + ly * cosR,
  };
}

/**
 * Generates smooth centerline and continuous side guiding walls for transfer rails.
 * Supports V-Rail now with clean variant dispatch for future U, S, and Launch variants.
 */
export function buildRailGeometry(rail: TransferRailPiece): RailGeometry {
  const armLen = Math.max(55, Math.min(230, rail.armLength || 120));
  const halfOpenRad =
    (Math.max(40, Math.min(150, rail.openingAngle || 88)) * 0.5 * Math.PI) / 180;
  const curv = Math.max(0.2, Math.min(0.88, rail.curvature || 0.52));
  const bias = Math.max(-0.45, Math.min(0.45, rail.slopeBias || 0));
  const wallThickness = 7.6; // diameter of each 3D cylindrical rod (rodRadius = 3.8)
  const halfChannel = Math.max(11.5, (rail.channelWidth || 25) * 0.5);

  const localPts: Vec2[] = [];

  switch (rail.variant) {
    case "straight": {
      const steps = 13;
      const startX = -armLen;
      const startY = -bias * armLen * 0.3;
      const endX = armLen;
      const endY = bias * armLen * 0.3;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        localPts.push({
          x: startX + (endX - startX) * u,
          y: startY + (endY - startY) * u,
        });
      }
      break;
    }
    case "v":
    default: {
      // Entry arm goes from upper-left (-dx, -dy) down toward origin (0, 0),
      // outgoing arm goes from (0, 0) out toward upper-right (+dx, -dy).
      const dirInX = -Math.sin(halfOpenRad + bias * 0.45);
      const dirInY = -Math.cos(halfOpenRad + bias * 0.45);
      const dirOutX = Math.sin(halfOpenRad - bias * 0.45);
      const dirOutY = -Math.cos(halfOpenRad - bias * 0.45);

      const inLen = armLen * (1 - bias * 0.25);
      const outLen = armLen * (1 + bias * 0.25);
      const fillet = Math.min(inLen, outLen) * curv;

      const p0 = { x: dirInX * inLen, y: dirInY * inLen };
      const t1 = { x: dirInX * fillet, y: dirInY * fillet };
      const t2 = { x: dirOutX * fillet, y: dirOutY * fillet };
      const p2 = { x: dirOutX * outLen, y: dirOutY * outLen };

      // 4 straight samples along incoming arm (p0 -> t1)
      const armSteps = 4;
      for (let i = 0; i < armSteps; i++) {
        const u = i / armSteps;
        localPts.push({
          x: p0.x + (t1.x - p0.x) * u,
          y: p0.y + (t1.y - p0.y) * u,
        });
      }

      // 12 smooth quadratic Bezier samples around rounded bottom (t1 -> (0,0) -> t2)
      const curveSteps = 12;
      for (let i = 0; i <= curveSteps; i++) {
        const u = i / curveSteps;
        const omt = 1 - u;
        localPts.push({
          x: omt * omt * t1.x + u * u * t2.x,
          y: omt * omt * t1.y + u * u * t2.y,
        });
      }

      // 4 straight samples along outgoing arm (t2 -> p2)
      for (let i = 1; i <= armSteps; i++) {
        const u = i / armSteps;
        localPts.push({
          x: t2.x + (p2.x - t2.x) * u,
          y: t2.y + (p2.y - t2.y) * u,
        });
      }
      break;
    }
  }

  if (rail.flipped) {
    localPts.reverse();
  }

  const cosR = Math.cos(rail.rotation);
  const sinR = Math.sin(rail.rotation);
  const centerPoints = localPts.map((p) =>
    rotateAndTranslate(p.x, p.y, cosR, sinR, rail.x, rail.y)
  );

  const count = centerPoints.length;
  const tangents: Vec2[] = [];
  const normals: Vec2[] = [];

  for (let i = 0; i < count; i++) {
    const prev = centerPoints[Math.max(0, i - 1)];
    const next = centerPoints[Math.min(count - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    tangents.push({ x: tx, y: ty });
    // Right-hand normal relative to travel direction (points toward outer bottom of V)
    normals.push({ x: -ty, y: tx });
  }

  const wallOffsetBase = halfChannel + wallThickness * 0.5;
  const outerWall: Vec2[] = [];
  const innerWall: Vec2[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < count; i++) {
    const c = centerPoints[i];
    const n = normals[i];
    // Subtle outward entrance/exit funnel flare at the endpoints only
    const flare = i === 0 || i === count - 1 ? 3.5 : 0;

    const off = wallOffsetBase + flare;
    const ow = { x: c.x + n.x * off, y: c.y + n.y * off };
    const iw = { x: c.x - n.x * off, y: c.y - n.y * off };
    outerWall.push(ow);
    innerWall.push(iw);

    if (ow.x < minX) minX = ow.x;
    if (ow.y < minY) minY = ow.y;
    if (ow.x > maxX) maxX = ow.x;
    if (ow.y > maxY) maxY = ow.y;
    if (iw.x < minX) minX = iw.x;
    if (iw.y < minY) minY = iw.y;
    if (iw.x > maxX) maxX = iw.x;
    if (iw.y > maxY) maxY = iw.y;
  }

  return {
    railId: rail.id,
    centerPoints,
    tangents,
    normals,
    outerWall,
    innerWall,
    wallThickness,
    halfChannel,
    entryPoint: centerPoints[0],
    exitPoint: centerPoints[count - 1],
    entryTangent: tangents[0],
    exitTangent: tangents[count - 1],
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Projects a marble center onto the rail centerline polyline, returning normalized progress t in [0, 1].
 */
export function projectPointOntoRail(
  geom: RailGeometry,
  px: number,
  py: number
): {
  t: number;
  dist: number;
  signedDist: number;
  closest: Vec2;
  tangent: Vec2;
} {
  const pts = geom.centerPoints;
  const n = pts.length;
  let bestD2 = Infinity;
  let bestT = 0;
  let bestPt = pts[0];
  let bestTan = geom.tangents[0];
  let bestNorm = geom.normals[0];

  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const u =
      len2 > 1e-6
        ? Math.max(0, Math.min(1, ((px - a.x) * abx + (py - a.y) * aby) / len2))
        : 0;
    const cx = a.x + abx * u;
    const cy = a.y + aby * u;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestT = (i + u) / (n - 1);
      bestPt = { x: cx, y: cy };
      const tan = len2 > 1e-6 ? { x: abx / Math.sqrt(len2), y: aby / Math.sqrt(len2) } : geom.tangents[i];
      bestTan = tan;
      bestNorm = { x: -tan.y, y: tan.x };
    }
  }

  const dist = Math.sqrt(bestD2);
  const signedDist = (px - bestPt.x) * bestNorm.x + (py - bestPt.y) * bestNorm.y;
  return {
    t: bestT,
    dist,
    signedDist,
    closest: bestPt,
    tangent: bestTan,
  };
}

/**
 * Evaluates a world position at normalized parameter t in [0, 1] along centerPoints.
 */
export function sampleRailCenter(geom: RailGeometry, t: number): Vec2 {
  const pts = geom.centerPoints;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (pts.length - 1);
  const idx = Math.min(pts.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = pts[idx];
  const b = pts[idx + 1];
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };
}
