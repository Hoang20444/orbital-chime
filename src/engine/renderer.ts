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
import type {
  BarPiece,
  LevelSolutionHint,
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

function drawPhysicalBar(
  ctx: CanvasRenderingContext2D,
  bar: Pick<BarPiece, "ax" | "ay" | "bx" | "by" | "material" | "locked"> & {
    flexOffset?: number;
    flexVel?: number;
    hitNx?: number;
    hitNy?: number;
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
  ctx.fillStyle = TOKENS.paper;
  ctx.beginPath();
  ctx.roundRect(worldMinX, worldMinY, boardW, boardH, 12 / scale);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(worldMinX, worldMinY, boardW, boardH, 12 / scale);
  ctx.clip();

  // 2. Full-bleed architectural dot grid across entire expanded canvas
  ctx.fillStyle = TOKENS.border;
  const step = 25;
  const startGx = Math.floor(worldMinX / step) * step;
  const startGy = Math.floor(worldMinY / step) * step;
  for (let gx = startGx; gx <= worldMaxX; gx += step) {
    for (let gy = startGy; gy <= worldMaxY; gy += step) {
      ctx.fillRect(gx - 0.9, gy - 0.9, 1.8, 1.8);
    }
  }

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
    ctx.strokeStyle = "rgba(28, 35, 33, 0.14)";
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
    ctx.strokeStyle = "rgba(28, 35, 33, 0.34)";
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
        ctx.fillStyle = `rgba(28, 35, 33, ${(fade * 0.34).toFixed(3)})`;
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

  // 9. Physical Acoustic Bars
  for (const bar of world.bars) {
    const isSel = opts.selectedId === bar.id;
    const isHov = opts.hoveredId === bar.id;

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
      ctx.font = `600 10px ${FONTS.mono}`;
      ctx.fillStyle = "rgba(28, 35, 33, 0.58)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(bar.noteLabel, mx, my);
    }
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
    ctx.fillStyle = TOKENS.ink;
    ctx.beginPath();
    ctx.roundRect(mx - labelW * 0.5, my - 11, labelW, 21, 6);
    ctx.fill();
    ctx.fillStyle = TOKENS.paper;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(note.noteName, mx, my);
  }

  // 11. Acoustic Ripples (1-2 crisp hairline rings from impact point)
  for (const rp of world.ripples) {
    const t = Math.min(1, rp.age / rp.duration);
    const ease = 1 - Math.pow(1 - t, 3);
    const alpha = Math.max(0, (1 - t) * 0.65);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = rp.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(rp.x, rp.y, 8 + rp.maxRadius * ease, 0, Math.PI * 2);
    ctx.stroke();

    if (rp.doubleRing && t > 0.14) {
      const t2 = Math.min(1, (t - 0.14) / 0.86);
      const ease2 = 1 - Math.pow(1 - t2, 3);
      ctx.globalAlpha = Math.max(0, (1 - t2) * 0.42);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, 8 + rp.maxRadius * 0.72 * ease2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 12. Marbles (Glossy Obsidian Glass Sphere)
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
      "obsidian"
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
