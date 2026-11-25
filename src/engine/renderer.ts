import { lengthToNote } from "../audio/scales.ts";
import { FONTS, MATERIALS, STAGE_H, STAGE_W, TOKENS } from "../theme/tokens.ts";
import { barLength, type GhostBranch } from "./physics.ts";
import type {
  BarPiece,
  LevelSolutionHint,
  Vec2,
  WorldState,
} from "./types.ts";

export interface ViewportTransform {
  cssWidth: number;
  cssHeight: number;
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
  bottomMargin: number
): ViewportTransform {
  const padX = cssWidth < 720 ? 8 : 12;
  const availW = Math.max(200, cssWidth - padX * 2);
  const availH = Math.max(200, cssHeight - topMargin - bottomMargin);
  const scale = Math.min(availW / STAGE_W, availH / STAGE_H);
  const offsetX = (cssWidth - STAGE_W * scale) * 0.5;
  const offsetY = topMargin + (availH - STAGE_H * scale) * 0.5;

  const worldMinX = (padX - offsetX) / scale;
  const worldMaxX = (cssWidth - padX - offsetX) / scale;
  const worldMinY = (topMargin - offsetY) / scale;
  const worldMaxY = (cssHeight - bottomMargin - offsetY) / scale;

  return {
    cssWidth,
    cssHeight,
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
}

function traceStraightRoundedBar(
  ctx: CanvasRenderingContext2D,
  halfLen: number,
  halfThick: number,
  cornerRadius: number
): void {
  const r = Math.min(cornerRadius, halfThick, halfLen);
  ctx.beginPath();
  ctx.roundRect(-halfLen, -halfThick, halfLen * 2, halfThick * 2, r);
}

function traceFlexedRibbon(
  ctx: CanvasRenderingContext2D,
  halfLen: number,
  halfThick: number,
  bendY: number
): void {
  ctx.beginPath();
  ctx.moveTo(-halfLen, -halfThick);
  ctx.quadraticCurveTo(0, -halfThick + bendY, halfLen, -halfThick);
  ctx.arc(halfLen, 0, halfThick, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(0, halfThick + bendY, -halfLen, halfThick);
  ctx.arc(-halfLen, 0, halfThick, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
}

function drawPhysicalBar(
  ctx: CanvasRenderingContext2D,
  bar: Pick<BarPiece, "ax" | "ay" | "bx" | "by" | "material" | "locked"> & {
    flexOffset?: number;
    hitNx?: number;
    hitNy?: number;
  },
  isSelected: boolean,
  isHovered: boolean
): void {
  const spec = MATERIALS[bar.material];
  const dx = bar.bx - bar.ax;
  const dy = bar.by - bar.ay;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const halfLen = len * 0.5;
  const halfThick = spec.thickness * 0.5;
  const midX = (bar.ax + bar.bx) * 0.5;
  const midY = (bar.ay + bar.by) * 0.5;
  const angle = Math.atan2(dy, dx);

  // Project world flex vector onto bar's local Y axis
  const flex = bar.flexOffset ?? 0;
  const hnx = bar.hitNx ?? 0;
  const hny = bar.hitNy ?? -1;
  const localPerpX = -Math.sin(angle);
  const localPerpY = Math.cos(angle);
  const bendY = flex * (hnx * localPerpX + hny * localPerpY);
  const isFlexing = Math.abs(bendY) > 0.12;

  const cornerRadius =
    bar.material === "brass"
      ? halfThick
      : bar.material === "ceramic"
        ? Math.min(halfThick, 5.5)
        : bar.material === "marimba"
          ? 3.5
          : 2.5;

  // Compute world-space offset (2.5, 4.5) in bar-local frame for consistent top-left studio lighting
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const shX = 2.4 * cosA + 4.4 * sinA;
  const shY = -2.4 * sinA + 4.4 * cosA;
  const bevX = 2.2 * sinA;
  const bevY = 2.2 * cosA;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angle);

  // 1. Crisp soft-ink contact shadow on studio paper
  ctx.save();
  ctx.translate(shX, shY);
  ctx.fillStyle = TOKENS.shadowContact;
  if (isFlexing) {
    traceFlexedRibbon(ctx, halfLen, halfThick + 0.5, bendY * 0.8);
  } else {
    traceStraightRoundedBar(ctx, halfLen, halfThick + 0.5, cornerRadius);
  }
  ctx.fill();
  ctx.restore();

  // 2. Extruded 3D bottom bevel slab (physical bar thickness)
  ctx.save();
  ctx.translate(bevX, bevY);
  ctx.fillStyle = spec.bevelColor;
  if (isFlexing) {
    traceFlexedRibbon(ctx, halfLen, halfThick, bendY);
  } else {
    traceStraightRoundedBar(ctx, halfLen, halfThick, cornerRadius);
  }
  ctx.fill();
  ctx.strokeStyle = spec.borderColor;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.restore();

  // 3. Main solid matte material face
  ctx.fillStyle = spec.color;
  if (isFlexing) {
    traceFlexedRibbon(ctx, halfLen, halfThick, bendY);
  } else {
    traceStraightRoundedBar(ctx, halfLen, halfThick, cornerRadius);
  }
  ctx.fill();

  // 4. Material-specific tactile surface craft (no gradients!)
  ctx.save();
  ctx.clip();

  // Upper edge specular/chamfer strip
  ctx.strokeStyle = spec.highlightColor;
  ctx.lineWidth = bar.material === "brass" ? 1.8 : 1.3;
  ctx.beginPath();
  const hiY = -halfThick + (bar.material === "brass" ? 2.2 : 1.4);
  ctx.moveTo(-halfLen + 4, hiY);
  ctx.quadraticCurveTo(0, hiY + bendY, halfLen - 4, hiY);
  ctx.stroke();

  if (bar.material === "marimba") {
    // Subtle broken maple wood grain lines
    ctx.strokeStyle = spec.grainColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-halfLen * 0.72, -1.2 + bendY * 0.2);
    ctx.lineTo(-halfLen * 0.12, -1.2 + bendY * 0.5);
    ctx.moveTo(halfLen * 0.08, 1.8 + bendY * 0.5);
    ctx.lineTo(halfLen * 0.68, 1.8 + bendY * 0.2);
    ctx.stroke();
  } else if (bar.material === "brass") {
    // Machined brushed brass end-cap collars
    ctx.strokeStyle = spec.borderColor;
    ctx.lineWidth = 1.1;
    const capX = Math.max(10, halfLen - 12);
    ctx.beginPath();
    ctx.moveTo(-capX, -halfThick);
    ctx.lineTo(-capX, halfThick);
    ctx.moveTo(capX, -halfThick);
    ctx.lineTo(capX, halfThick);
    ctx.stroke();
  } else if (bar.material === "ceramic") {
    // Smooth inset celadon porcelain glaze rim
    ctx.strokeStyle = spec.highlightColor;
    ctx.lineWidth = 1;
    traceStraightRoundedBar(ctx, halfLen - 2.2, halfThick - 2.2, Math.max(2, cornerRadius - 1.5));
    ctx.stroke();
  } else if (bar.material === "bass") {
    // Heavy machined seam tick + felt damper pads under nodal pins
    ctx.strokeStyle = spec.grainColor;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-5, -halfThick);
    ctx.lineTo(5, halfThick);
    ctx.stroke();
  }
  ctx.restore();

  // 5. Crisp outer hairline border (darkens on selection)
  ctx.strokeStyle = isSelected ? TOKENS.ink : spec.borderColor;
  ctx.lineWidth = isSelected ? 2.2 : 1.25;
  if (isFlexing) {
    traceFlexedRibbon(ctx, halfLen, halfThick, bendY);
  } else {
    traceStraightRoundedBar(ctx, halfLen, halfThick, cornerRadius);
  }
  ctx.stroke();

  // 6. Acoustic nodal mounting pins (22% and 78% of bar length)
  const pinOffset = Math.max(12, halfLen * 0.56);
  [-pinOffset, pinOffset].forEach((px) => {
    const py = bendY * 0.45;
    if (bar.material === "bass" || bar.locked) {
      ctx.fillStyle = TOKENS.inkSoft;
      ctx.beginPath();
      ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = bar.locked ? TOKENS.paper : spec.bevelColor;
    ctx.beginPath();
    ctx.arc(px, py, bar.locked ? 1.8 : 2.1, 0, Math.PI * 2);
    ctx.fill();
  });

  // 7. Hover / Selected subtle outer selection halo
  if (isHovered && !isSelected && !bar.locked) {
    ctx.strokeStyle = "rgba(28, 35, 33, 0.35)";
    ctx.lineWidth = 1.2;
    traceStraightRoundedBar(ctx, halfLen + 3, halfThick + 3, cornerRadius + 2);
    ctx.stroke();
  }

  ctx.restore();
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

  // 6. Emitters (Braun-style precision dial)
  for (const em of world.emitters) {
    const isSel = opts.selectedId === em.id;
    const isHov = opts.hoveredId === em.id;
    const r = 17 + (em.pulse ?? 0) * 2.5;

    if (Math.hypot(em.vx, em.vy) > 10) {
      const ang = Math.atan2(em.vy, em.vx);
      ctx.strokeStyle = TOKENS.slate;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(em.x + Math.cos(ang) * 19, em.y + Math.sin(ang) * 19);
      ctx.lineTo(em.x + Math.cos(ang) * 31, em.y + Math.sin(ang) * 31);
      ctx.stroke();
    }

    // Subtle contact shadow
    ctx.fillStyle = TOKENS.shadowContact;
    ctx.beginPath();
    ctx.arc(em.x + 1.5, em.y + 3, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = TOKENS.tray;
    ctx.strokeStyle = isSel || isHov ? TOKENS.accent : TOKENS.ink;
    ctx.lineWidth = isSel ? 2.8 : 2;
    ctx.beginPath();
    ctx.arc(em.x, em.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Beat progress sweep
    const interval = Math.max(0.25, em.beatInterval);
    const timeUntil = Math.max(0, em.nextEmitBeat - world.beatClock);
    const progress = 1 - Math.min(1, timeUntil / interval);
    ctx.strokeStyle = TOKENS.accent;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(
      em.x,
      em.y,
      r - 5,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress
    );
    ctx.stroke();

    ctx.fillStyle = TOKENS.ink;
    ctx.beginPath();
    ctx.arc(em.x, em.y, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Splitters (Machined Prism Housing)
  for (const spl of world.splitters) {
    const isSel = opts.selectedId === spl.id;
    const isHov = opts.hoveredId === spl.id;
    const r = spl.radius * (1 + (spl.pulse ?? 0) * 0.14);

    ctx.fillStyle = TOKENS.shadowContact;
    ctx.beginPath();
    ctx.moveTo(spl.x + 2, spl.y - r + 4);
    ctx.lineTo(spl.x + r + 2, spl.y + 4);
    ctx.lineTo(spl.x + 2, spl.y + r + 4);
    ctx.lineTo(spl.x - r + 2, spl.y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = TOKENS.splitterFill;
    ctx.strokeStyle = isSel || isHov ? TOKENS.accent : TOKENS.splitterStroke;
    ctx.lineWidth = isSel ? 2.8 : 2;
    ctx.beginPath();
    ctx.moveTo(spl.x, spl.y - r);
    ctx.lineTo(spl.x + r, spl.y);
    ctx.lineTo(spl.x, spl.y + r);
    ctx.lineTo(spl.x - r, spl.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner prism facet lines
    ctx.strokeStyle = TOKENS.borderStrong;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(spl.x, spl.y - r + 4);
    ctx.lineTo(spl.x, spl.y + r - 4);
    ctx.moveTo(spl.x - r + 6, spl.y);
    ctx.lineTo(spl.x + r - 6, spl.y);
    ctx.stroke();
  }

  // 8. Bumpers (Machined Collar + Vermilion Rubber Cushion)
  for (const bmp of world.bumpers) {
    const isSel = opts.selectedId === bmp.id;
    const isHov = opts.hoveredId === bmp.id;
    const r = bmp.radius * (1 + (bmp.pulse ?? 0) * 0.16);

    ctx.fillStyle = TOKENS.shadowContact;
    ctx.beginPath();
    ctx.arc(bmp.x + 2, bmp.y + 4, r, 0, Math.PI * 2);
    ctx.fill();

    // Outer metallic collar
    ctx.fillStyle = TOKENS.tray;
    ctx.strokeStyle = isSel || isHov ? TOKENS.ink : TOKENS.borderStrong;
    ctx.lineWidth = isSel ? 2.4 : 1.5;
    ctx.beginPath();
    ctx.arc(bmp.x, bmp.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vermilion rubber pad
    ctx.fillStyle = TOKENS.accent;
    ctx.beginPath();
    ctx.arc(bmp.x, bmp.y, r - 4.5, 0, Math.PI * 2);
    ctx.fill();

    // Inner ivory rim & brass center rivet
    ctx.strokeStyle = TOKENS.paper;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(bmp.x, bmp.y, r - 7.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = TOKENS.paper;
    ctx.beginPath();
    ctx.arc(bmp.x, bmp.y, 3, 0, Math.PI * 2);
    ctx.fill();
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

  // 12. Marbles (Dynamic motion-reactive shadow, <=12% squash/stretch, matte sheen)
  for (const m of world.marbles) {
    const ix = m.prevX + (m.x - m.prevX) * opts.interpAlpha;
    const iy = m.prevY + (m.y - m.prevY) * opts.interpAlpha;

    // Subtle matte motion trail
    if (m.trail.length > 1) {
      for (let i = 0; i < m.trail.length; i++) {
        const pt = m.trail[i];
        const ratio = (i + 1) / (m.trail.length + 1);
        ctx.fillStyle = `rgba(28, 35, 33, ${(ratio * 0.14).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, m.radius * (0.32 + ratio * 0.42), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Dynamic contact/elevation shadow shifting subtly with marble velocity & tightening at impact
    const impactTighten = 1 - m.squash * 0.55;
    const shDx = (2 + Math.max(-2, Math.min(2, m.vx * 0.004))) * impactTighten;
    const shDy = (3.8 + Math.max(-1.5, Math.min(2.5, m.vy * 0.004))) * impactTighten;
    ctx.fillStyle = `rgba(28, 35, 33, ${(0.12 + m.squash * 0.08).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(
      ix + shDx,
      iy + shDy,
      m.radius * (0.92 + m.squash * 0.12),
      m.radius * (0.85 - m.squash * 0.08),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Marble body
    ctx.save();
    ctx.translate(ix, iy);
    if (m.squash > 0.02) {
      ctx.rotate(m.squashAngle);
      const sx = 1 - m.squash * 0.12;
      const sy = 1 + m.squash * 0.12;
      ctx.scale(sx, sy);
    }
    ctx.fillStyle = TOKENS.ink;
    ctx.beginPath();
    ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
    ctx.fill();

    // Subtle inner rim highlight arc
    ctx.strokeStyle = "#485450";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, m.radius - 1.5, Math.PI * 1.05, Math.PI * 1.72);
    ctx.stroke();

    // Crisp specular dot
    ctx.fillStyle = TOKENS.paper;
    ctx.beginPath();
    ctx.arc(-m.radius * 0.32, -m.radius * 0.32, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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
