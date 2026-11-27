import { lengthToNote } from "../audio/scales.ts";
import { FONTS, MATERIALS, STAGE_H, STAGE_W, TOKENS } from "../theme/tokens.ts";
import {
  drawIridescentPrism,
  drawOrganicBumper,
  drawOrganicInstrumentBar,
  drawPremiumEmitter,
  drawPremiumMarble,
} from "./materialsRenderer.ts";
import { barLength, type GhostBranch } from "./physics.ts";
import { buildRailGeometry, sampleRailPose } from "./railGeometry.ts";
import type {
  BarPiece,
  LevelSolutionHint,
  TransferRailPiece,
  Vec2,
  WorldState,
} from "./types.ts";

export interface CameraState {
  zoom: number;
  focusX: number;
  focusY: number;
}

export interface ViewportTransform {
  cssWidth: number;
  cssHeight: number;
  baseScale: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
}

export function computeViewport(
  cssWidth: number,
  cssHeight: number,
  topMargin: number,
  bottomMargin: number,
  camera?: CameraState
): ViewportTransform {
  const padX = cssWidth < 720 ? 8 : 12;
  const availW = Math.max(200, cssWidth - padX * 2);
  const availH = Math.max(200, cssHeight - topMargin - bottomMargin);
  const baseScale = Math.min(availW / STAGE_W, availH / STAGE_H);
  const zoom = camera ? Math.max(0.45, Math.min(3.5, camera.zoom)) : 1;
  const scale = baseScale * zoom;
  const focusX = camera?.focusX ?? STAGE_W * 0.5;
  const focusY = camera?.focusY ?? STAGE_H * 0.5;

  const offsetX = cssWidth * 0.5 - focusX * scale;
  const offsetY = topMargin + availH * 0.5 - focusY * scale;

  const worldMinX = (padX - offsetX) / scale;
  const worldMaxX = (cssWidth - padX - offsetX) / scale;
  const worldMinY = (topMargin - offsetY) / scale;
  const worldMaxY = (cssHeight - bottomMargin - offsetY) / scale;

  return {
    cssWidth,
    cssHeight,
    baseScale,
    scale,
    offsetX,
    offsetY,
    worldMinX,
    worldMaxX,
    worldMinY,
    worldMaxY,
  };
}

export function screenToWorld(
  vp: ViewportTransform,
  localX: number,
  localY: number
): Vec2 {
  return {
    x: (localX - vp.offsetX) / vp.scale,
    y: (localY - vp.offsetY) / vp.scale,
  };
}

export interface RenderOptions {
  mode: "puzzle" | "sandbox";
  selectedId: string | null;
  hoveredId: string | null;
  showGhost: boolean;
  ghostBranches: GhostBranch[];
  hintOverlay: LevelSolutionHint | null;
  draftBar: Pick<BarPiece, "ax" | "ay" | "bx" | "by" | "material"> | null;
  interpAlpha: number;
  followedMarbleId?: number | null;
}

const WALL_SPILL_RGB: Record<BarPiece["material"], string> = {
  marimba: "255, 162, 64",
  brass: "255, 218, 88",
  ceramic: "52, 245, 206",
  bass: "76, 168, 255",
};

function drawObservatoryBackdrop2D(
  ctx: CanvasRenderingContext2D,
  worldMinX: number,
  worldMaxX: number,
  worldMinY: number,
  worldMaxY: number,
  scale: number
): void {
  const boardW = worldMaxX - worldMinX;
  const boardH = worldMaxY - worldMinY;

  // Deep midnight-slate atmospheric gradient
  const bg = ctx.createLinearGradient(0, worldMinY, 0, worldMaxY);
  bg.addColorStop(0, "#0D1524");
  bg.addColorStop(0.5, "#111B2E");
  bg.addColorStop(1, "#0B121F");
  ctx.fillStyle = bg;
  ctx.fillRect(worldMinX, worldMinY, boardW, boardH);

  // Subtle architectural panel grid (80px & 320px)
  ctx.strokeStyle = "rgba(84, 122, 172, 0.08)";
  ctx.lineWidth = 1 / scale;
  const g80StartX = Math.floor(worldMinX / 80) * 80;
  const g80StartY = Math.floor(worldMinY / 80) * 80;
  ctx.beginPath();
  for (let gx = g80StartX; gx <= worldMaxX; gx += 80) {
    ctx.moveTo(gx, worldMinY);
    ctx.lineTo(gx, worldMaxY);
  }
  for (let gy = g80StartY; gy <= worldMaxY; gy += 80) {
    ctx.moveTo(worldMinX, gy);
    ctx.lineTo(worldMaxX, gy);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgba(116, 162, 218, 0.14)";
  const g320StartX = Math.floor(worldMinX / 320) * 320;
  const g320StartY = Math.floor(worldMinY / 320) * 320;
  ctx.beginPath();
  for (let gx = g320StartX; gx <= worldMaxX; gx += 320) {
    ctx.moveTo(gx, worldMinY);
    ctx.lineTo(gx, worldMaxY);
  }
  for (let gy = g320StartY; gy <= worldMaxY; gy += 320) {
    ctx.moveTo(worldMinX, gy);
    ctx.lineTo(worldMaxX, gy);
  }
  ctx.stroke();

  // Precision "+" reticles at 160px offsets
  ctx.strokeStyle = "rgba(148, 192, 240, 0.22)";
  ctx.beginPath();
  for (let gx = g320StartX + 160; gx <= worldMaxX; gx += 320) {
    for (let gy = g320StartY + 160; gy <= worldMaxY; gy += 320) {
      ctx.moveTo(gx - 4.5, gy);
      ctx.lineTo(gx + 4.5, gy);
      ctx.moveTo(gx, gy - 4.5);
      ctx.lineTo(gx, gy + 4.5);
    }
  }
  ctx.stroke();

  // Orbital Astrolabe concentric medallions tiled gracefully down the stage
  const medallions = [
    { x: 500, y: 350, s: 1.0 },
    { x: 120, y: 740, s: 0.68 },
    { x: 890, y: 820, s: 0.72 },
    { x: 490, y: 1260, s: 0.92 },
    { x: 80, y: 1720, s: 0.66 },
    { x: 920, y: 1790, s: 0.7 },
    { x: 500, y: 2220, s: 0.9 },
    { x: 500, y: 3260, s: 0.88 },
  ];

  for (let i = 0; i < medallions.length; i++) {
    const m = medallions[i];
    const r3 = 340 * m.s;
    if (m.y + r3 < worldMinY || m.y - r3 > worldMaxY) continue;
    const r1 = 155 * m.s;
    const r2 = 245 * m.s;

    ctx.strokeStyle = "rgba(196, 154, 84, 0.18)";
    ctx.lineWidth = 1.2 / scale;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(82, 156, 214, 0.16)";
    ctx.beginPath();
    ctx.arc(m.x, m.y, r2, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([7 / scale, 7 / scale]);
    ctx.strokeStyle = "rgba(196, 154, 84, 0.14)";
    ctx.beginPath();
    ctx.arc(m.x, m.y, r3, i * 0.6, i * 0.6 + Math.PI * 0.62);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.x, m.y, r3, i * 0.6 + Math.PI, i * 0.6 + Math.PI * 1.62);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(128, 174, 222, 0.18)";
    ctx.beginPath();
    for (let t = 0; t < 24; t++) {
      const a = (t / 24) * Math.PI * 2;
      const inn = t % 6 === 0 ? r2 - 11 : r2 - 5;
      const out = t % 6 === 0 ? r2 + 11 : r2 + 5;
      ctx.moveTo(m.x + Math.cos(a) * inn, m.y + Math.sin(a) * inn);
      ctx.lineTo(m.x + Math.cos(a) * out, m.y + Math.sin(a) * out);
    }
    ctx.stroke();
  }
}

function drawBackwallLightSpills2D(
  ctx: CanvasRenderingContext2D,
  world: WorldState
): void {
  ctx.save();
  ctx.globalCompositeOperation = "screen";

  const paintSpill = (x: number, y: number, radius: number, rgb: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(${rgb}, ${(alpha * 0.54).toFixed(3)})`);
    g.addColorStop(0.36, `rgba(${rgb}, ${(alpha * 0.26).toFixed(3)})`);
    g.addColorStop(0.74, `rgba(${rgb}, ${(alpha * 0.07).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };

  for (const bar of world.bars) {
    if (bar.silent) continue;
    const raw = Math.max(bar.glow ?? 0, Math.min(1, Math.abs(bar.flexOffset ?? 0) * 0.18));
    if (raw <= 0.03) continue;
    const bulb = Math.pow(raw, 0.66);
    const mx = (bar.ax + bar.bx) * 0.5;
    const my = (bar.ay + bar.by) * 0.5;
    const len = Math.hypot(bar.bx - bar.ax, bar.by - bar.ay);
    paintSpill(mx, my, Math.max(145, len * 2.25), WALL_SPILL_RGB[bar.material], bulb);
  }

  for (const bmp of world.bumpers) {
    const pulse = bmp.pulse ?? 0;
    if (pulse <= 0.03) continue;
    const bulb = Math.pow(pulse, 0.64);
    paintSpill(bmp.x, bmp.y, bmp.radius * 9.0, "255, 122, 62", bulb);
  }

  for (const spl of world.splitters) {
    const pulse = spl.pulse ?? 0;
    if (pulse <= 0.03) continue;
    const bulb = Math.pow(pulse, 0.64);
    paintSpill(spl.x, spl.y, spl.radius * 9.0, "86, 232, 255", bulb);
  }

  for (const ring of world.rings) {
    if (ring.charge <= 0.04) continue;
    paintSpill(ring.x, ring.y, ring.radius * 5.2, "58, 232, 194", ring.charge * 0.9);
  }

  for (const rail of world.rails ?? []) {
    const glow = rail.activeGlow ?? 0;
    if (glow <= 0.04) continue;
    const geom = buildRailGeometry(rail);
    const pose = sampleRailPose(geom, rail.pulseT ?? 0.5);
    paintSpill(pose.point.x, pose.point.y, 155, "56, 226, 255", Math.pow(glow, 0.68) * 0.92);
  }

  ctx.restore();
}

function drawTransferRail2D(
  ctx: CanvasRenderingContext2D,
  rail: TransferRailPiece,
  isSelected: boolean,
  isHovered: boolean
): void {
  const geom = buildRailGeometry(rail);
  const pts = geom.centerPoints;
  const glow = rail.activeGlow ?? 0;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 2D Front View: front & back rails visually overlap into ONE single curved metallic rail
  // 1. Subtle soft drop shadow below
  ctx.save();
  ctx.translate(2, 4);
  ctx.strokeStyle = "rgba(22, 28, 34, 0.16)";
  ctx.lineWidth = geom.rodRadius * 2 + 1.4;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();

  // 2. Subtle underside support bridge bracket ticks (strictly beneath rolling path)
  ctx.strokeStyle = "#6F7B88";
  ctx.lineWidth = 3.2;
  for (const br of geom.bridges) {
    ctx.beginPath();
    ctx.moveTo(br.point.x - br.upNormal.x * 1.5, br.point.y - br.upNormal.y * 1.5);
    ctx.lineTo(br.point.x - br.upNormal.x * 5.2, br.point.y - br.upNormal.y * 5.2);
    ctx.stroke();
  }

  // 3. Unified dark graphite / black chrome rail silhouette
  ctx.strokeStyle = isSelected || isHovered ? "#263340" : "#182028";
  ctx.lineWidth = geom.rodRadius * 2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // 4. Brushed metallic specular sheen along the upper half
  ctx.strokeStyle = "rgba(205, 220, 236, 0.42)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // 5. Thin cyan luminous strip on the upper contact crest
  ctx.strokeStyle =
    glow > 0.04
      ? `rgba(76, 236, 255, ${(0.75 + glow * 0.25).toFixed(3)})`
      : isSelected
        ? "rgba(56, 226, 255, 0.92)"
        : "rgba(56, 226, 255, 0.56)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(
    pts[0].x + geom.upNormals[0].x * 2.1,
    pts[0].y + geom.upNormals[0].y * 2.1
  );
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(
      pts[i].x + geom.upNormals[i].x * 2.1,
      pts[i].y + geom.upNormals[i].y * 2.1
    );
  }
  ctx.stroke();

  // 6. Subtle collision highlight on upper surface impact
  const flash = rail.hitFlash ?? 0;
  if (flash > 0.04 && rail.hitX !== undefined && rail.hitY !== undefined) {
    const hg = ctx.createRadialGradient(rail.hitX, rail.hitY, 1, rail.hitX, rail.hitY, 14);
    hg.addColorStop(0, `rgba(145, 248, 255, ${(flash * 0.82).toFixed(3)})`);
    hg.addColorStop(1, "rgba(56, 226, 255, 0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(rail.hitX, rail.hitY, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Subtle cyan traveling glint on upper contact surface while marble rolls on top
  if (glow > 0.04) {
    const pose = sampleRailPose(geom, rail.pulseT ?? 0.5);
    const gx = pose.point.x + pose.upNormal.x * geom.rodRadius;
    const gy = pose.point.y + pose.upNormal.y * geom.rodRadius;
    const rg = ctx.createRadialGradient(gx, gy, 1, gx, gy, 14);
    rg.addColorStop(0, `rgba(110, 240, 255, ${(glow * 0.6).toFixed(3)})`);
    rg.addColorStop(1, "rgba(56, 226, 255, 0)");
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(gx, gy, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isSelected) {
    [
      { pt: geom.entryPoint, col: "#38E2FF", tag: "IN" },
      { pt: geom.exitPoint, col: "#F7A64B", tag: "OUT" },
    ].forEach(({ pt, col, tag }) => {
      ctx.fillStyle = "#1E252D";
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `700 9px ${FONTS.mono}`;
      ctx.fillStyle = col;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tag, pt.x, pt.y - 13);
    });
  }
  ctx.restore();
}

function drawPhysicalBar(
  ctx: CanvasRenderingContext2D,
  bar: Pick<BarPiece, "ax" | "ay" | "bx" | "by" | "material" | "locked" | "silent"> & {
    flexOffset?: number;
    flexVel?: number;
    hitNx?: number;
    hitNy?: number;
    glow?: number;
  },
  isSelected: boolean,
  isHovered: boolean
): void {
  const spec = MATERIALS[bar.material];
  drawOrganicInstrumentBar(ctx, bar, spec.thickness * 0.5, isSelected, isHovered);
}

export function renderWorld(
  ctx: CanvasRenderingContext2D,
  vp: ViewportTransform,
  world: WorldState,
  opts: RenderOptions
): void {
  const {
    cssWidth,
    cssHeight,
    scale,
    offsetX,
    offsetY,
    worldMinX,
    worldMaxX,
    worldMinY,
    worldMaxY,
  } = vp;

  // 1. Clean surrounding matte tray edge & full-bleed studio paper board
  ctx.fillStyle = TOKENS.surround;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);

  const boardW = worldMaxX - worldMinX;
  const boardH = worldMaxY - worldMinY;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(worldMinX, worldMinY, boardW, boardH, 12 / scale);
  ctx.clip();

  // 2. Orbital Observatory architectural slate board + astrolabe etchings + bulb backwall light spills!
  drawObservatoryBackdrop2D(ctx, worldMinX, worldMaxX, worldMinY, worldMaxY, scale);
  drawBackwallLightSpills2D(ctx, world);

  // Subtle 100-unit edge ruler ticks along top and bottom borders
  ctx.strokeStyle = TOKENS.borderStrong;
  ctx.lineWidth = 1 / scale;
  const tickStart = Math.floor(worldMinX / 100) * 100;
  for (let tx = tickStart; tx <= worldMaxX; tx += 100) {
    ctx.beginPath();
    ctx.moveTo(tx, worldMinY);
    ctx.lineTo(tx, worldMinY + 5 / scale);
    ctx.moveTo(tx, worldMaxY - 5 / scale);
    ctx.lineTo(tx, worldMaxY);
    ctx.stroke();
  }

  // Subtle corner crop marks around the Puzzle 1000x700 composition stage
  if (opts.mode === "puzzle") {
    const m = 14;
    ctx.strokeStyle = "rgba(148, 174, 206, 0.24)";
    ctx.lineWidth = 1.25 / scale;
    ctx.beginPath();
    // Top-left & Top-right
    ctx.moveTo(0, m);
    ctx.lineTo(0, 0);
    ctx.lineTo(m, 0);
    ctx.moveTo(STAGE_W - m, 0);
    ctx.lineTo(STAGE_W, 0);
    ctx.lineTo(STAGE_W, m);
    // Bottom-left & Bottom-right
    ctx.moveTo(0, STAGE_H - m);
    ctx.lineTo(0, STAGE_H);
    ctx.lineTo(m, STAGE_H);
    ctx.moveTo(STAGE_W - m, STAGE_H);
    ctx.lineTo(STAGE_W, STAGE_H);
    ctx.lineTo(STAGE_W, STAGE_H - m);
    ctx.stroke();
  }

  ctx.restore();

  // Crisp outer studio board border
  ctx.strokeStyle = TOKENS.border;
  ctx.lineWidth = 1.2 / scale;
  ctx.beginPath();
  ctx.roundRect(worldMinX, worldMinY, boardW, boardH, 12 / scale);
  ctx.stroke();

  // 3. Optional dashed Hint overlay in Puzzle mode
  if (opts.hintOverlay) {
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(140, 184, 228, 0.44)";
    for (const hb of opts.hintOverlay.bars ?? []) {
      const spec = MATERIALS[hb.material];
      ctx.lineWidth = spec.thickness;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(hb.ax, hb.ay);
      ctx.lineTo(hb.bx, hb.by);
      ctx.stroke();

      ctx.fillStyle = TOKENS.paper;
      ctx.lineWidth = 2;
      [
        { x: hb.ax, y: hb.ay },
        { x: hb.bx, y: hb.by },
      ].forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
    for (const hbmp of opts.hintOverlay.bumpers ?? []) {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(hbmp.x, hbmp.y, hbmp.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const hspl of opts.hintOverlay.splitters ?? []) {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(hspl.x, hspl.y - hspl.radius);
      ctx.lineTo(hspl.x + hspl.radius, hspl.y);
      ctx.lineTo(hspl.x, hspl.y + hspl.radius);
      ctx.lineTo(hspl.x - hspl.radius, hspl.y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // 4. Live Ghost Trajectory Preview (dotted matte curve)
  if (opts.showGhost) {
    for (const branch of opts.ghostBranches) {
      const pts = branch.points;
      for (let i = 1; i < pts.length; i++) {
        const fade = Math.max(0.05, 1 - i / pts.length);
        ctx.fillStyle = `rgba(128, 184, 232, ${(fade * 0.42).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 5. Resonance Rings (Targets)
  for (const ring of world.rings) {
    const active = ring.charge > 0.05;
    const pulseScale = 1 + (ring.pulse ?? 0) * 0.12;
    const r = ring.radius * pulseScale;

    if (ring.charge > 0.01) {
      ctx.fillStyle = `rgba(77, 138, 120, ${(ring.charge * 0.16).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = active ? TOKENS.ringActive : TOKENS.ringIdle;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, r, 0, Math.PI * 2);
    ctx.stroke();

    if (ring.charge > 0.01) {
      ctx.strokeStyle = TOKENS.ringActive;
      ctx.lineWidth = 4.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(
        ring.x,
        ring.y,
        r - 5,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * ring.charge
      );
      ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(206, 91, 70, 0.35)";
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 6. Emitters (Premium Ivory & Brass Launcher)
  for (const em of world.emitters) {
    drawPremiumEmitter(
      ctx,
      em,
      world.beatClock,
      opts.selectedId === em.id,
      opts.hoveredId === em.id
    );
  }

  // 7. Splitters (Iridescent Crystal Prism Resonator)
  for (const spl of world.splitters) {
    drawIridescentPrism(
      ctx,
      spl,
      opts.selectedId === spl.id,
      opts.hoveredId === spl.id
    );
  }

  // 8. Bumpers (Elastic Coral Resonance Pad)
  for (const bmp of world.bumpers) {
    drawOrganicBumper(
      ctx,
      bmp,
      opts.selectedId === bmp.id,
      opts.hoveredId === bmp.id
    );
  }

  // 8.5. Transfer Rails (Dark Graphite + Cyan Luminous V-Rail)
  for (const rail of world.rails ?? []) {
    drawTransferRail2D(
      ctx,
      rail,
      opts.selectedId === rail.id,
      opts.hoveredId === rail.id
    );
  }

  // 9. Physical Acoustic Bars
  for (const bar of world.bars) {
    const isSel = opts.selectedId === bar.id;
    const isHov = opts.hoveredId === bar.id;

    let focusAlpha = 1;
    if (world.marbles.length > 0 && !isSel && !isHov) {
      const mx = (bar.ax + bar.bx) * 0.5;
      const my = (bar.ay + bar.by) * 0.5;
      let minDist = Infinity;
      for (const m of world.marbles) {
        const d = Math.hypot(m.x - mx, m.y - my);
        if (d < minDist) minDist = d;
      }
      if (minDist > 240) {
        focusAlpha = Math.max(0.76, 1 - ((minDist - 240) / 360) * 0.24);
      }
    }

    ctx.save();
    if (focusAlpha < 1) {
      ctx.globalAlpha = focusAlpha;
    }
    drawPhysicalBar(ctx, bar, isSel, isHov);

    // Interactive end handles + pitch tag when hovered or selected
    if (!bar.locked && (isSel || isHov)) {
      [
        { x: bar.ax, y: bar.ay },
        { x: bar.bx, y: bar.by },
      ].forEach((pt) => {
        ctx.fillStyle = TOKENS.paper;
        ctx.strokeStyle = TOKENS.ink;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = TOKENS.ink;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      const labelText =
        bar.noteLabel ?? lengthToNote(barLength(bar), world.scaleId, bar.material).noteName;
      const mx = (bar.ax + bar.bx) * 0.5;
      const my = Math.min(bar.ay, bar.by) - 20;
      ctx.font = `600 12.5px ${FONTS.mono}`;
      const labelW = ctx.measureText(labelText).width + 14;
      ctx.fillStyle = TOKENS.ink;
      ctx.beginPath();
      ctx.roundRect(mx - labelW * 0.5, my - 11, labelW, 21, 6);
      ctx.fill();
      ctx.fillStyle = TOKENS.paper;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, mx, my);
    } else if (bar.noteLabel) {
      const mx = (bar.ax + bar.bx) * 0.5;
      const my = Math.min(bar.ay, bar.by) - 13;
      const bulb = bar.glow ?? 0;
      ctx.font = `600 10px ${FONTS.mono}`;
      ctx.fillStyle =
        bulb > 0.06 ? MATERIALS[bar.material].highlightColor : "rgba(176, 194, 216, 0.56)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bar.noteLabel, mx, my);
    }
    ctx.restore();
  }

  // 10. Draft bar while user is actively drawing on canvas
  if (opts.draftBar) {
    const db = opts.draftBar;
    drawPhysicalBar(ctx, db, true, false);

    const len = barLength(db);
    const note = lengthToNote(len, world.scaleId, db.material);
    const mx = (db.ax + db.bx) * 0.5;
    const my = Math.min(db.ay, db.by) - 22;
    ctx.font = `600 12.5px ${FONTS.mono}`;
    const labelW = ctx.measureText(note.noteName).width + 16;
    ctx.fillStyle = TOKENS.paper;
    ctx.strokeStyle = TOKENS.borderStrong;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(mx - labelW * 0.5, my - 11, labelW, 21, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = TOKENS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(note.noteName, mx, my);
  }

  // 11. Marbles — Pure Unchanging Brushed-Silver Sphere (zero collision halo/ripples)
  for (const m of world.marbles) {
    const ix = m.prevX + (m.x - m.prevX) * opts.interpAlpha;
    const iy = m.prevY + (m.y - m.prevY) * opts.interpAlpha;
    drawPremiumMarble(
      ctx,
      m,
      ix,
      iy,
      opts.followedMarbleId === m.id,
      vp.scale,
      "pearl"
    );
  }

  // 13. Floating Note Popups (crisp note pill rising cleanly)
  for (const pop of world.popups) {
    const t = Math.min(1, pop.age / pop.duration);
    const alpha = t < 0.18 ? t / 0.18 : Math.max(0, 1 - (t - 0.18) / 0.82);
    const y = pop.y - t * 28;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `700 13px ${FONTS.mono}`;
    ctx.fillStyle = pop.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pop.text, pop.x, y);
    ctx.restore();
  }

  ctx.restore();
}
