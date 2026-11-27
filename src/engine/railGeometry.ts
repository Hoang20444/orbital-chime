import type { TransferRailPiece, Vec2 } from "./types.ts";

export const DUAL_RAIL_ROD_RADIUS = 3.2;

export interface BridgeStation {
  point: Vec2;
  tangent: Vec2;
  upNormal: Vec2;
  u: number;
}

export interface RailGeometry {
  railId: string;
  centerPoints: Vec2[];
  tangents: Vec2[];
  upNormals: Vec2[];
  rodRadius: number;
  railSpacing: number;
  bridgeSpacing: number;
  supportHeight: number;
  totalLength: number;
  bridges: BridgeStation[];
  standoffs: BridgeStation[];
  entryPoint: Vec2;
  exitPoint: Vec2;
  entryTangent: Vec2;
  exitTangent: Vec2;
  entryUpNormal: Vec2;
  exitUpNormal: Vec2;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Exact normal height of a sphere center resting symmetrically on top of two
 * parallel cylindrical rods separated in depth by `railSpacing`.
 */
export function computeDualRailSupportHeight(
  marbleRadius: number,
  rodRadius: number,
  railSpacing: number
): number {
  const sumR = marbleRadius + rodRadius;
  const halfS = Math.min(sumR - 0.8, Math.max(2, railSpacing * 0.5));
  return Math.sqrt(sumR * sumR - halfS * halfS);
}

function rotatePoint(lx: number, ly: number, cosR: number, sinR: number): Vec2 {
  return {
    x: lx * cosR - ly * sinR,
    y: lx * sinR + ly * cosR,
  };
}

function sampleStationAtArcLength(
  centerPoints: Vec2[],
  upNormals: Vec2[],
  cumLen: number[],
  targetArc: number
): BridgeStation {
  const n = centerPoints.length;
  const totalLen = Math.max(1e-4, cumLen[n - 1]);
  const clamped = Math.max(0, Math.min(totalLen, targetArc));
  let idx = 0;
  while (idx < n - 2 && cumLen[idx + 1] < clamped) {
    idx++;
  }
  const segLen = Math.max(1e-5, cumLen[idx + 1] - cumLen[idx]);
  const frac = Math.max(0, Math.min(1, (clamped - cumLen[idx]) / segLen));

  const a = centerPoints[idx];
  const b = centerPoints[idx + 1];
  const point = {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
  };

  const tdx = b.x - a.x;
  const tdy = b.y - a.y;
  const tlen = Math.hypot(tdx, tdy) || 1;
  const tangent = { x: tdx / tlen, y: tdy / tlen };

  const na = upNormals[idx];
  const nb = upNormals[idx + 1];
  const nx = na.x + (nb.x - na.x) * frac;
  const ny = na.y + (nb.y - na.y) * frac;
  const nlen = Math.hypot(nx, ny) || 1;
  const upNormal = { x: nx / nlen, y: ny / nlen };

  return {
    point,
    tangent,
    upNormal,
    u: clamped / totalLen,
  };
}

/**
 * Builds the shared 2D centerline curve, upper support normals, connecting bridge
 * stations, and standoffs for the Curved Dual-Support Rail.
 */
export function buildRailGeometry(rail: TransferRailPiece): RailGeometry {
  const armLen = Math.max(34, Math.min(230, rail.armLength || 120));
  const halfOpenRad =
    (Math.max(40, Math.min(150, rail.openingAngle || 88)) * 0.5 * Math.PI) / 180;
  const curv = Math.max(0.2, Math.min(0.88, rail.curvature || 0.52));
  const bias = Math.max(-0.45, Math.min(0.45, rail.slopeBias || 0));
  const rodRadius = DUAL_RAIL_ROD_RADIUS;
  const railSpacing = Math.max(9, Math.min(14.5, rail.railSpacing || 12.8));
  const bridgeSpacing = Math.max(24, Math.min(96, rail.bridgeSpacing || 52));
  const supportHeight = computeDualRailSupportHeight(8, rodRadius, railSpacing);

  const localPts: Vec2[] = [];

  switch (rail.variant) {
    case "straight": {
      const steps = 20;
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
    case "u": {
      const steps = 48;
      const halfSpan = armLen * 0.82;
      const depth = armLen * (0.48 + curv * 0.45);
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const theta = Math.PI * (1 - u); // PI -> 0 (left top -> bottom -> right top)
        localPts.push({
          x: Math.cos(theta) * halfSpan,
          y: -Math.sin(theta) * depth * 0.55 + (u - 0.5) * bias * armLen * 0.35 + depth * 0.25,
        });
      }
      break;
    }
    case "s":
    case "custom": {
      const steps = 40;
      const amp = armLen * 0.34 * curv;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps;
        const x = -armLen + 2 * armLen * u;
        const y = -Math.cos(Math.PI * u) * amp + bias * armLen * 0.25 * (u - 0.5);
        localPts.push({ x, y });
      }
      break;
    }
    case "v":
    default: {
      // Smooth continuous V-valley: straight incoming arm -> G1 Bezier valley -> straight outgoing arm
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

      const armSteps = 8;
      for (let i = 0; i < armSteps; i++) {
        const u = i / armSteps;
        localPts.push({
          x: p0.x + (t1.x - p0.x) * u,
          y: p0.y + (t1.y - p0.y) * u,
        });
      }

      const curveSteps = 32;
      for (let i = 0; i <= curveSteps; i++) {
        const u = i / curveSteps;
        const omt = 1 - u;
        localPts.push({
          x: omt * omt * t1.x + u * u * t2.x,
          y: omt * omt * t1.y + u * u * t2.y,
        });
      }

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

  // Compute local upward normal BEFORE flipped reversal so upper hardware face stays consistent
  const count = localPts.length;
  const localUpNormals: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const prev = localPts[Math.max(0, i - 1)];
    const next = localPts[Math.min(count - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Left-hand normal in screen coordinates (for dx > 0, dy = 0 => (0, -1) pointing UP)
    localUpNormals.push({ x: dy / len, y: -dx / len });
  }

  const cosR = Math.cos(rail.rotation);
  const sinR = Math.sin(rail.rotation);
  const centerPoints = localPts.map((p) => {
    const rp = rotatePoint(p.x, p.y, cosR, sinR);
    return { x: rail.x + rp.x, y: rail.y + rp.y };
  });
  const upNormals = localUpNormals.map((n) => rotatePoint(n.x, n.y, cosR, sinR));

  if (rail.flipped) {
    centerPoints.reverse();
    upNormals.reverse();
  }

  const tangents: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const prev = centerPoints[Math.max(0, i - 1)];
    const next = centerPoints[Math.min(count - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    tangents.push({ x: dx / len, y: dy / len });
  }

  const cumLen: number[] = [0];
  for (let i = 1; i < count; i++) {
    cumLen.push(
      cumLen[i - 1] +
        Math.hypot(
          centerPoints[i].x - centerPoints[i - 1].x,
          centerPoints[i].y - centerPoints[i - 1].y
        )
    );
  }
  const totalLength = cumLen[count - 1];

  // Connecting support bridges at regular arc-length intervals along usable span
  const inset = Math.min(14, totalLength * 0.16);
  const usable = Math.max(10, totalLength - 2 * inset);
  const nIntervals = Math.max(1, Math.round(usable / bridgeSpacing));
  const bridges: BridgeStation[] = [];
  for (let i = 0; i <= nIntervals; i++) {
    const arc = inset + (usable * i) / nIntervals;
    bridges.push(sampleStationAtArcLength(centerPoints, upNormals, cumLen, arc));
  }

  // Two rear mounting standoffs matching brushed door-handle proportions
  const standoffs: BridgeStation[] = [
    sampleStationAtArcLength(centerPoints, upNormals, cumLen, totalLength * 0.22),
    sampleStationAtArcLength(centerPoints, upNormals, cumLen, totalLength * 0.78),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const boundPad = supportHeight + 14;
  for (const p of centerPoints) {
    if (p.x - boundPad < minX) minX = p.x - boundPad;
    if (p.y - boundPad < minY) minY = p.y - boundPad;
    if (p.x + boundPad > maxX) maxX = p.x + boundPad;
    if (p.y + boundPad > maxY) maxY = p.y + boundPad;
  }

  return {
    railId: rail.id,
    centerPoints,
    tangents,
    upNormals,
    rodRadius,
    railSpacing,
    bridgeSpacing,
    supportHeight,
    totalLength,
    bridges,
    standoffs,
    entryPoint: centerPoints[0],
    exitPoint: centerPoints[count - 1],
    entryTangent: tangents[0],
    exitTangent: tangents[count - 1],
    entryUpNormal: upNormals[0],
    exitUpNormal: upNormals[count - 1],
    bounds: { minX, minY, maxX, maxY },
  };
}

/**
 * Projects a marble center onto the shared 2D centerline polyline, smoothly
 * interpolating the upper-surface normal across curved transitions.
 */
export function projectPointOntoRail(
  geom: RailGeometry,
  px: number,
  py: number
): {
  t: number;
  dist: number;
  signedUpDist: number;
  closest: Vec2;
  tangent: Vec2;
  upNormal: Vec2;
} {
  const pts = geom.centerPoints;
  const n = pts.length;
  let bestD2 = Infinity;
  let bestT = 0;
  let bestPt = pts[0];
  let bestTan = geom.tangents[0];
  let bestUp = geom.upNormals[0];

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
      bestTan =
        len2 > 1e-6
          ? { x: abx / Math.sqrt(len2), y: aby / Math.sqrt(len2) }
          : geom.tangents[i];
      const na = geom.upNormals[i];
      const nb = geom.upNormals[i + 1];
      const nx = na.x + (nb.x - na.x) * u;
      const ny = na.y + (nb.y - na.y) * u;
      const nlen = Math.hypot(nx, ny) || 1;
      bestUp = { x: nx / nlen, y: ny / nlen };
    }
  }

  const dist = Math.sqrt(bestD2);
  const signedUpDist = (px - bestPt.x) * bestUp.x + (py - bestPt.y) * bestUp.y;
  return {
    t: bestT,
    dist,
    signedUpDist,
    closest: bestPt,
    tangent: bestTan,
    upNormal: bestUp,
  };
}

/**
 * Evaluates world position, tangent, and upward normal at normalized parameter t in [0, 1].
 */
export function sampleRailPose(
  geom: RailGeometry,
  t: number
): { point: Vec2; tangent: Vec2; upNormal: Vec2 } {
  const pts = geom.centerPoints;
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (pts.length - 1);
  const idx = Math.min(pts.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = pts[idx];
  const b = pts[idx + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const na = geom.upNormals[idx];
  const nb = geom.upNormals[idx + 1];
  const nx = na.x + (nb.x - na.x) * frac;
  const ny = na.y + (nb.y - na.y) * frac;
  const nlen = Math.hypot(nx, ny) || 1;

  return {
    point: {
      x: a.x + dx * frac,
      y: a.y + dy * frac,
    },
    tangent: { x: dx / len, y: dy / len },
    upNormal: { x: nx / nlen, y: ny / nlen },
  };
}

export function sampleRailCenter(geom: RailGeometry, t: number): Vec2 {
  return sampleRailPose(geom, t).point;
}
