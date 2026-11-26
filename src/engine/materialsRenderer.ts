import { TOKENS } from "../theme/tokens.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  Marble,
  MaterialType,
  SplitterPiece,
} from "./types.ts";

export type MarbleVariant = "obsidian" | "amber" | "pearl" | "echo" | "prism";

interface BarMaterialPalette {
  topStop: string;
  midStop: string;
  botStop: string;
  bevelDark: string;
  bevelEdge: string;
  border: string;
  highlight: string;
  grain: string;
  pinOuter: string;
  pinInner: string;
  glow: string;
}

const BAR_PALETTES: Record<MaterialType, BarMaterialPalette> = {
  marimba: {
    topStop: "#F3CE9A",
    midStop: "#DDA057",
    botStop: "#BC7431",
    bevelDark: "#824C1D",
    bevelEdge: "#6A3B14",
    border: "#8A5222",
    highlight: "rgba(255, 244, 220, 0.72)",
    grain: "rgba(138, 76, 28, 0.22)",
    pinOuter: "#9B622C",
    pinInner: "#F5D9AF",
    glow: "rgba(255, 236, 198, 0.55)",
  },
  brass: {
    topStop: "#FAEAAC",
    midStop: "#D9B14A",
    botStop: "#AE8321",
    bevelDark: "#7D5B12",
    bevelEdge: "#5F440B",
    border: "#8C6818",
    highlight: "rgba(255, 253, 236, 0.82)",
    grain: "rgba(255, 249, 214, 0.42)",
    pinOuter: "#8A6616",
    pinInner: "#F9EAA8",
    glow: "rgba(255, 246, 194, 0.65)",
  },
  ceramic: {
    topStop: "#CBECE2",
    midStop: "#76BCA9",
    botStop: "#4C9280",
    bevelDark: "#31695B",
    bevelEdge: "#255247",
    border: "#3A7566",
    highlight: "rgba(255, 255, 255, 0.78)",
    grain: "rgba(255, 255, 255, 0.36)",
    pinOuter: "#3A7566",
    pinInner: "#E9F8F3",
    glow: "rgba(220, 255, 246, 0.62)",
  },
  bass: {
    topStop: "#688CA6",
    midStop: "#3D5F79",
    botStop: "#264056",
    bevelDark: "#162938",
    bevelEdge: "#0F1D29",
    border: "#1E364A",
    highlight: "rgba(218, 234, 247, 0.50)",
    grain: "rgba(15, 30, 44, 0.30)",
    pinOuter: "#1A2E3E",
    pinInner: "#B5CADB",
    glow: "rgba(176, 212, 240, 0.48)",
  },
};

/**
 * Traces the sculpted organic bone/waist pill silhouette matching the visual reference.
 * Preserves the physical upper strike surface near +/-halfThick through the main body while
 * flaring gracefully at the rounded organic ends.
 */
export function traceOrganicBarPath(
  ctx: CanvasRenderingContext2D,
  halfLen: number,
  halfThick: number,
  bendY: number,
  pad = 0
): void {
  const hl = Math.max(8, halfLen + pad);
  const ht = Math.max(3, halfThick + pad);
  const endR = Math.min(hl * 0.42, ht * 1.24);
  const pinX = Math.max(2, hl - endR);
  const waistY = ht * 0.88;
  const ctrlX = pinX * 0.46;

  ctx.beginPath();
  // Start at top-left shoulder
  ctx.moveTo(-pinX, -endR);
  // Top organic concave curve
  ctx.bezierCurveTo(
    -ctrlX,
    -waistY + bendY * 0.6,
    ctrlX,
    -waistY + bendY * 0.6,
    pinX,
    -endR
  );
  // Right rounded organic bulb
  ctx.arc(pinX, 0, endR, -Math.PI / 2, Math.PI / 2);
  // Bottom organic concave curve
  ctx.bezierCurveTo(
    ctrlX,
    waistY + bendY * 0.6,
    -ctrlX,
    waistY + bendY * 0.6,
    -pinX,
    endR
  );
  // Left rounded organic bulb
  ctx.arc(-pinX, 0, endR, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
}

export function drawOrganicInstrumentBar(
  ctx: CanvasRenderingContext2D,
  bar: Pick<
    BarPiece,
    | "ax"
    | "ay"
    | "bx"
    | "by"
    | "material"
    | "locked"
    | "silent"
    | "flexOffset"
    | "flexVel"
    | "hitNx"
    | "hitNy"
  >,
  halfThick: number,
  isSelected: boolean,
  isHovered: boolean
): void {
  const pal: BarMaterialPalette = bar.silent
    ? {
        topStop: "#E6E8E1",
        midStop: "#CFD3C9",
        botStop: "#B5BAB0",
        bevelDark: "#8F958A",
        bevelEdge: "#777D73",
        border: "#989E93",
        highlight: "rgba(255, 255, 255, 0.55)",
        grain: "rgba(110, 116, 108, 0.16)",
        pinOuter: "#8F958A",
        pinInner: "#ECEEE8",
        glow: "rgba(240, 244, 236, 0.45)",
      }
    : BAR_PALETTES[bar.material];
  const dx = bar.bx - bar.ax;
  const dy = bar.by - bar.ay;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;

  const halfLen = len * 0.5;
  const midX = (bar.ax + bar.bx) * 0.5;
  const midY = (bar.ay + bar.by) * 0.5;
  const angle = Math.atan2(dy, dx);

  const flex = bar.flexOffset ?? 0;
  const hnx = bar.hitNx ?? 0;
  const hny = bar.hitNy ?? -1;
  const localPerpX = -Math.sin(angle);
  const localPerpY = Math.cos(angle);
  const bendY = flex * (hnx * localPerpX + hny * localPerpY);
  const hitGlow = Math.min(
    1,
    Math.abs(flex) * 0.22 + Math.abs(bar.flexVel ?? 0) * 0.0055
  );

  // Consistent top-left directional shadow & depth projection in bar-local coords
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const elev = isSelected ? 1.2 : 0;
  const shX = (3.2 + elev) * cosA + (6.2 + elev) * sinA;
  const shY = -(3.2 + elev) * sinA + (6.2 + elev) * cosA;
  const bevX = 2.6 * sinA;
  const bevY = 2.6 * cosA;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angle);

  // Layer 1: Soft layered 2.5D directional cast shadow
  ctx.save();
  ctx.translate(shX, shY);
  ctx.fillStyle = "rgba(28, 35, 33, 0.075)";
  traceOrganicBarPath(ctx, halfLen, halfThick, bendY * 0.85, 1.8);
  ctx.fill();
  ctx.fillStyle = "rgba(28, 35, 33, 0.11)";
  traceOrganicBarPath(ctx, halfLen, halfThick, bendY * 0.85, 0.2);
  ctx.fill();
  ctx.restore();

  // Layer 2: Dark lower extruded 3D thickness contour
  ctx.save();
  ctx.translate(bevX, bevY);
  const bevelGrad = ctx.createLinearGradient(0, -halfThick, 0, halfThick);
  bevelGrad.addColorStop(0, pal.midStop);
  bevelGrad.addColorStop(1, pal.bevelDark);
  ctx.fillStyle = bevelGrad;
  traceOrganicBarPath(ctx, halfLen, halfThick, bendY, 0);
  ctx.fill();
  ctx.strokeStyle = pal.bevelEdge;
  ctx.lineWidth = 1.05;
  ctx.stroke();
  ctx.restore();

  // Layer 3 & 4: Main organic silhouette & rich material gradient
  const bodyGrad = ctx.createLinearGradient(-halfLen * 0.35, -halfThick * 1.2, halfLen * 0.35, halfThick * 1.3);
  bodyGrad.addColorStop(0, pal.topStop);
  bodyGrad.addColorStop(0.52, pal.midStop);
  bodyGrad.addColorStop(1, pal.botStop);

  ctx.fillStyle = bodyGrad;
  traceOrganicBarPath(ctx, halfLen, halfThick, bendY, 0);
  ctx.fill();

  // Layer 5: Clipped material surface details & glossy reflections
  ctx.save();
  ctx.clip();

  if (bar.material === "marimba") {
    // Organic wood grain curves + warm golden reflection sheen
    ctx.strokeStyle = pal.grain;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(-halfLen * 0.85, -halfThick * 0.35);
    ctx.bezierCurveTo(
      -halfLen * 0.25,
      -halfThick * 0.65 + bendY * 0.3,
      halfLen * 0.25,
      halfThick * 0.25 + bendY * 0.3,
      halfLen * 0.85,
      -halfThick * 0.15
    );
    ctx.moveTo(-halfLen * 0.72, halfThick * 0.32);
    ctx.bezierCurveTo(
      -halfLen * 0.15,
      halfThick * 0.08 + bendY * 0.3,
      halfLen * 0.32,
      halfThick * 0.55 + bendY * 0.3,
      halfLen * 0.78,
      halfThick * 0.22
    );
    ctx.stroke();

    // Diagonal light ribbon
    const sheen = ctx.createLinearGradient(-halfLen * 0.5, -halfThick, halfLen * 0.2, halfThick);
    sheen.addColorStop(0, "rgba(255, 245, 224, 0)");
    sheen.addColorStop(0.45, "rgba(255, 245, 224, 0.28)");
    sheen.addColorStop(1, "rgba(255, 245, 224, 0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(-halfLen - 4, -halfThick * 1.4, (halfLen + 4) * 2, halfThick * 2.8);
  } else if (bar.material === "brass") {
    // Champagne gold diagonal brushed metallic light streak
    const streak = ctx.createLinearGradient(-halfLen * 0.7, -halfThick, halfLen * 0.6, halfThick);
    streak.addColorStop(0, "rgba(255, 252, 232, 0)");
    streak.addColorStop(0.38, "rgba(255, 252, 232, 0.12)");
    streak.addColorStop(0.5, "rgba(255, 253, 242, 0.52)");
    streak.addColorStop(0.62, "rgba(255, 252, 232, 0.12)");
    streak.addColorStop(1, "rgba(255, 252, 232, 0)");
    ctx.fillStyle = streak;
    ctx.fillRect(-halfLen - 4, -halfThick * 1.5, (halfLen + 4) * 2, halfThick * 3);
  } else if (bar.material === "ceramic") {
    // Glazed translucent inner glow + crisp diagonal glass reflection
    const innerGlow = ctx.createRadialGradient(
      0,
      -halfThick * 0.2,
      2,
      0,
      0,
      halfLen * 0.9
    );
    innerGlow.addColorStop(0, "rgba(235, 255, 249, 0.38)");
    innerGlow.addColorStop(1, "rgba(76, 146, 128, 0)");
    ctx.fillStyle = innerGlow;
    ctx.fillRect(-halfLen - 4, -halfThick * 1.5, (halfLen + 4) * 2, halfThick * 3);

    // Glossy diagonal celadon glass highlight band
    ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
    ctx.beginPath();
    ctx.moveTo(-halfLen * 0.62, -halfThick * 1.3);
    ctx.lineTo(-halfLen * 0.08, -halfThick * 1.3);
    ctx.lineTo(halfLen * 0.36, halfThick * 1.3);
    ctx.lineTo(-halfLen * 0.18, halfThick * 1.3);
    ctx.closePath();
    ctx.fill();
  } else if (bar.material === "bass") {
    // Sculpted S-wave surface ridge + satin reflection
    ctx.strokeStyle = pal.grain;
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(-halfLen * 0.88, -halfThick * 0.22);
    ctx.bezierCurveTo(
      -halfLen * 0.2,
      -halfThick * 0.55,
      halfLen * 0.15,
      halfThick * 0.55,
      halfLen * 0.88,
      halfThick * 0.18
    );
    ctx.stroke();

    ctx.strokeStyle = "rgba(220, 236, 248, 0.22)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-halfLen * 0.88, -halfThick * 0.34);
    ctx.bezierCurveTo(
      -halfLen * 0.2,
      -halfThick * 0.67,
      halfLen * 0.15,
      halfThick * 0.43,
      halfLen * 0.88,
      halfThick * 0.06
    );
    ctx.stroke();
  }

  // Smooth upper contour specular highlight line
  ctx.strokeStyle = pal.highlight;
  ctx.lineWidth = bar.material === "ceramic" ? 1.6 : 1.3;
  const endR = Math.min(halfLen * 0.42, halfThick * 1.24);
  const pinX = Math.max(2, halfLen - endR);
  ctx.beginPath();
  ctx.moveTo(-pinX * 0.94, -endR + 1.6);
  ctx.bezierCurveTo(
    -pinX * 0.44,
    -halfThick * 0.86 + 1.6 + bendY * 0.55,
    pinX * 0.44,
    -halfThick * 0.86 + 1.6 + bendY * 0.55,
    pinX * 0.94,
    -endR + 1.6
  );
  ctx.stroke();

  // Collision illumination flash synchronized to physics impact
  if (hitGlow > 0.03) {
    ctx.globalAlpha = Math.min(0.68, hitGlow);
    ctx.fillStyle = pal.glow;
    traceOrganicBarPath(ctx, halfLen, halfThick, bendY, 0);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // Outer refined hairline contour
  ctx.strokeStyle = isSelected ? TOKENS.ink : pal.border;
  ctx.lineWidth = isSelected ? 2.1 : 1.15;
  traceOrganicBarPath(ctx, halfLen, halfThick, bendY, 0);
  ctx.stroke();

  // Layer 6: Sculpted recessed mounting sockets near organic ends
  const socketX = Math.max(8, halfLen - Math.max(8, endR * 1.15));
  [-socketX, socketX].forEach((px) => {
    const py = bendY * 0.22;
    const sockR = Math.min(3.5, Math.max(2.3, halfThick * 0.46));

    // Recessed socket ring
    ctx.fillStyle = pal.pinOuter;
    ctx.beginPath();
    ctx.arc(px, py, sockR, 0, Math.PI * 2);
    ctx.fill();

    // Inner metallic/ceramic pin
    ctx.fillStyle = bar.locked ? TOKENS.paper : pal.pinInner;
    ctx.beginPath();
    ctx.arc(px - 0.3, py - 0.3, sockR * 0.58, 0, Math.PI * 2);
    ctx.fill();

    // Pin top-left specular dot
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.beginPath();
    ctx.arc(px - sockR * 0.28, py - sockR * 0.28, sockR * 0.22, 0, Math.PI * 2);
    ctx.fill();
  });

  // Layer 7: Subtle hover / selection halo (conforms cleanly to organic silhouette)
  if ((isHovered || isSelected) && !bar.locked) {
    ctx.strokeStyle = isSelected ? "rgba(28, 35, 33, 0.48)" : "rgba(28, 35, 33, 0.26)";
    ctx.lineWidth = isSelected ? 1.5 : 1.1;
    traceOrganicBarPath(ctx, halfLen, halfThick, bendY, 3.2);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawOrganicBumper(
  ctx: CanvasRenderingContext2D,
  bmp: BumperPiece,
  isSelected: boolean,
  isHovered: boolean
): void {
  const pulse = bmp.pulse ?? 0;
  // Elastic squash/expand synchronized cleanly to bumper_hit
  const r = bmp.radius * (1 + pulse * 0.16);

  // Layer 1: Soft ambient contact shadow
  ctx.fillStyle = "rgba(28, 35, 33, 0.11)";
  ctx.beginPath();
  ctx.arc(bmp.x + 2.4, bmp.y + 4.8, r + 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Impact radial pulse aura
  if (pulse > 0.04) {
    ctx.strokeStyle = `rgba(232, 114, 68, ${(pulse * 0.55).toFixed(3)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(bmp.x, bmp.y, r + (1 - pulse) * 14, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Layer 2: Lower depth rim
  ctx.fillStyle = "#B84928";
  ctx.beginPath();
  ctx.arc(bmp.x + 0.6, bmp.y + 2.1, r, 0, Math.PI * 2);
  ctx.fill();

  // Layer 3 & 4: Elastic outer coral-cream collar + warm raised tangerine dome
  const collarGrad = ctx.createLinearGradient(bmp.x - r, bmp.y - r, bmp.x + r, bmp.y + r);
  collarGrad.addColorStop(0, "#FAF5EE");
  collarGrad.addColorStop(1, "#DED9CF");
  ctx.fillStyle = collarGrad;
  ctx.strokeStyle = isSelected || isHovered ? TOKENS.ink : "#9A8F82";
  ctx.lineWidth = isSelected ? 2.2 : 1.3;
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const innerR = Math.max(6, r - 3.8);
  const domeGrad = ctx.createRadialGradient(
    bmp.x - innerR * 0.32,
    bmp.y - innerR * 0.34,
    innerR * 0.12,
    bmp.x,
    bmp.y,
    innerR
  );
  domeGrad.addColorStop(0, "#FFB182");
  domeGrad.addColorStop(0.55, "#EC7446");
  domeGrad.addColorStop(1, "#BA4424");

  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, innerR, 0, Math.PI * 2);
  ctx.fill();

  // Layer 5: Elastic glossy top-left specular crescent
  ctx.strokeStyle = "rgba(255, 245, 236, 0.78)";
  ctx.lineWidth = 2.1;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, innerR - 2.6, Math.PI * 1.06, Math.PI * 1.66);
  ctx.stroke();

  // Layer 6: Raised pearl center dome + subtle rim
  ctx.fillStyle = "rgba(255, 250, 245, 0.92)";
  ctx.strokeStyle = "rgba(186, 68, 36, 0.45)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(bmp.x, bmp.y, Math.max(4, innerR * 0.34), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawIridescentPrism(
  ctx: CanvasRenderingContext2D,
  spl: SplitterPiece,
  isSelected: boolean,
  isHovered: boolean
): void {
  const pulse = spl.pulse ?? 0;
  const r = spl.radius * (1 + pulse * 0.14);
  // Horizontally elongated faceted crystal silhouette centered over exact splitter sensor
  const hw = r * 1.28;
  const hh = r * 0.68;
  const bev = hw * 0.28;

  const traceCrystal = (ox = 0, oy = 0, expand = 0) => {
    const w = hw + expand;
    const h = hh + expand * 0.75;
    const b = bev;
    ctx.beginPath();
    ctx.moveTo(spl.x + ox - w + b, spl.y + oy - h);
    ctx.lineTo(spl.x + ox + w - b, spl.y + oy - h);
    ctx.lineTo(spl.x + ox + w, spl.y + oy);
    ctx.lineTo(spl.x + ox + w - b, spl.y + oy + h);
    ctx.lineTo(spl.x + ox - w + b, spl.y + oy + h);
    ctx.lineTo(spl.x + ox - w, spl.y + oy);
    ctx.closePath();
  };

  // Layer 1: Soft translucent contact shadow
  ctx.fillStyle = "rgba(105, 118, 152, 0.14)";
  traceCrystal(2, 4.2, 0.5);
  ctx.fill();

  // Impact prismatic pulse ring
  if (pulse > 0.04) {
    ctx.strokeStyle = `rgba(150, 178, 245, ${(pulse * 0.55).toFixed(3)})`;
    ctx.lineWidth = 2;
    traceCrystal(0, 0, (1 - pulse) * 8);
    ctx.stroke();
  }

  // Layer 2 & 3: Iridescent translucent crystal body gradient
  const prismGrad = ctx.createLinearGradient(
    spl.x - hw,
    spl.y - hh,
    spl.x + hw,
    spl.y + hh
  );
  prismGrad.addColorStop(0, "rgba(182, 236, 249, 0.90)"); // soft cyan
  prismGrad.addColorStop(0.35, "rgba(232, 224, 255, 0.88)"); // pale lavender
  prismGrad.addColorStop(0.7, "rgba(250, 214, 240, 0.88)"); // subtle rose pink
  prismGrad.addColorStop(1, "rgba(196, 232, 252, 0.90)"); // ice sky

  ctx.fillStyle = prismGrad;
  traceCrystal();
  ctx.fill();

  // Layer 4 & 5: Internal crystal facet planes & refracted highlights
  ctx.save();
  traceCrystal();
  ctx.clip();

  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  ctx.beginPath();
  ctx.moveTo(spl.x - hw + bev, spl.y - hh);
  ctx.lineTo(spl.x + hw * 0.18, spl.y - hh);
  ctx.lineTo(spl.x - hw * 0.12, spl.y + hh);
  ctx.lineTo(spl.x - hw + bev, spl.y + hh);
  ctx.closePath();
  ctx.fill();

  // Internal crisp facet ridges
  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(spl.x - hw, spl.y);
  ctx.lineTo(spl.x - hw + bev + 3, spl.y - hh * 0.35);
  ctx.lineTo(spl.x + hw - bev - 3, spl.y + hh * 0.35);
  ctx.lineTo(spl.x + hw, spl.y);
  ctx.moveTo(spl.x - hw + bev, spl.y - hh);
  ctx.lineTo(spl.x, spl.y + hh);
  ctx.moveTo(spl.x + hw - bev, spl.y - hh);
  ctx.lineTo(spl.x, spl.y + hh);
  ctx.stroke();

  if (pulse > 0.04) {
    ctx.fillStyle = `rgba(255, 255, 255, ${(pulse * 0.45).toFixed(3)})`;
    traceCrystal();
    ctx.fill();
  }
  ctx.restore();

  // Outer crystal rim stroke
  ctx.strokeStyle =
    isSelected || isHovered ? TOKENS.ink : "rgba(120, 134, 172, 0.85)";
  ctx.lineWidth = isSelected ? 2.1 : 1.3;
  traceCrystal();
  ctx.stroke();
}

export function drawPremiumEmitter(
  ctx: CanvasRenderingContext2D,
  em: Emitter,
  beatClock: number,
  isSelected: boolean,
  isHovered: boolean
): void {
  const pulse = em.pulse ?? 0;
  const r = 16.5 + pulse * 2.5;

  // Direction indicator vector if launched with initial velocity
  if (Math.hypot(em.vx, em.vy) > 10) {
    const ang = Math.atan2(em.vy, em.vx);
    ctx.strokeStyle = TOKENS.slate;
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(em.x + Math.cos(ang) * 20, em.y + Math.sin(ang) * 20);
    ctx.lineTo(em.x + Math.cos(ang) * 33, em.y + Math.sin(ang) * 33);
    ctx.stroke();
  }

  // Subtle horizontal sculpted ivory-and-brass wing housing (matches reference Emitter silhouette)
  const wingHW = 25;
  const wingHH = 7.5;

  // Wing contact shadow
  ctx.fillStyle = "rgba(28, 35, 33, 0.11)";
  ctx.beginPath();
  ctx.roundRect(em.x - wingHW + 1.5, em.y - wingHH + 3.8, wingHW * 2, wingHH * 2, wingHH);
  ctx.fill();

  // Wing lower depth edge
  ctx.fillStyle = "#B8AF9F";
  ctx.beginPath();
  ctx.roundRect(em.x - wingHW, em.y - wingHH + 1.8, wingHW * 2, wingHH * 2, wingHH);
  ctx.fill();

  // Wing ivory body
  const wingGrad = ctx.createLinearGradient(em.x, em.y - wingHH, em.x, em.y + wingHH);
  wingGrad.addColorStop(0, "#FAF8F2");
  wingGrad.addColorStop(1, "#DED8CC");
  ctx.fillStyle = wingGrad;
  ctx.strokeStyle = isSelected || isHovered ? TOKENS.ink : "#9F9687";
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.roundRect(em.x - wingHW, em.y - wingHH, wingHW * 2, wingHH * 2, wingHH);
  ctx.fill();
  ctx.stroke();

  // Champagne-gold wing end caps
  [-1, 1].forEach((dir) => {
    const capX = dir < 0 ? em.x - wingHW : em.x + wingHW - 6.5;
    const capGrad = ctx.createLinearGradient(capX, em.y - wingHH, capX, em.y + wingHH);
    capGrad.addColorStop(0, "#F7E49E");
    capGrad.addColorStop(1, "#AF8524");
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.roundRect(capX, em.y - wingHH, 6.5, wingHH * 2, 3.5);
    ctx.fill();
  });

  // Central launcher collar shadow
  ctx.fillStyle = "rgba(28, 35, 33, 0.14)";
  ctx.beginPath();
  ctx.arc(em.x + 1, em.y + 3, r * 0.84, 0, Math.PI * 2);
  ctx.fill();

  // Brushed champagne-gold center bezel
  const bezelGrad = ctx.createLinearGradient(em.x - r, em.y - r, em.x + r, em.y + r);
  bezelGrad.addColorStop(0, "#FAEAAC");
  bezelGrad.addColorStop(0.5, "#D9B14A");
  bezelGrad.addColorStop(1, "#9B7218");
  ctx.fillStyle = bezelGrad;
  ctx.strokeStyle = isSelected || isHovered ? TOKENS.accent : "#785710";
  ctx.lineWidth = isSelected ? 2.1 : 1.3;
  ctx.beginPath();
  ctx.arc(em.x, em.y, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner ivory dial face
  ctx.fillStyle = "#F5F2EA";
  ctx.beginPath();
  ctx.arc(em.x, em.y, r * 0.62, 0, Math.PI * 2);
  ctx.fill();

  // Activation progress arc around central lens
  const interval = Math.max(0.25, em.beatInterval);
  const timeUntil = Math.max(0, em.nextEmitBeat - beatClock);
  const progress = 1 - Math.min(1, timeUntil / interval);
  ctx.strokeStyle = "#CE5B46";
  ctx.lineWidth = 2.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(
    em.x,
    em.y,
    r * 0.52,
    -Math.PI / 2,
    -Math.PI / 2 + Math.PI * 2 * progress
  );
  ctx.stroke();

  // Central luminous pearl aperture + emit pulse ring
  if (pulse > 0.04) {
    ctx.strokeStyle = `rgba(232, 168, 60, ${(pulse * 0.65).toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(em.x, em.y, r + (1 - pulse) * 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  const coreGrad = ctx.createRadialGradient(em.x - 1.5, em.y - 1.5, 0.5, em.x, em.y, 4.8);
  coreGrad.addColorStop(0, "#FFFFFF");
  coreGrad.addColorStop(0.65, "#E8DFCF");
  coreGrad.addColorStop(1, "#8D7F6B");
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(em.x, em.y, 4.6, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPremiumMarble(
  ctx: CanvasRenderingContext2D,
  m: Marble,
  ix: number,
  iy: number,
  isFollowed: boolean,
  scale: number,
  variant: MarbleVariant = "obsidian"
): void {
  // 1. Subtle tapered motion trail
  if (m.trail.length > 1) {
    for (let i = 0; i < m.trail.length; i++) {
      const pt = m.trail[i];
      const ratio = (i + 1) / (m.trail.length + 1);
      ctx.fillStyle = `rgba(20, 26, 28, ${(ratio * 0.14).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, m.radius * (0.28 + ratio * 0.38), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. Soft motion-reactive contact shadow
  const impactTighten = 1 - m.squash * 0.55;
  const shDx = (2.1 + Math.max(-2, Math.min(2, m.vx * 0.004))) * impactTighten;
  const shDy = (4.2 + Math.max(-1.5, Math.min(2.6, m.vy * 0.004))) * impactTighten;
  ctx.fillStyle = `rgba(20, 26, 28, ${(0.11 + m.squash * 0.07).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(
    ix + shDx,
    iy + shDy,
    m.radius * (0.95 + m.squash * 0.12),
    m.radius * (0.82 - m.squash * 0.08),
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // Optional follow-camera target reticle
  if (isFollowed) {
    ctx.strokeStyle = "rgba(206, 91, 70, 0.58)";
    ctx.lineWidth = 1.7 / Math.max(0.75, Math.min(1.6, scale));
    ctx.beginPath();
    ctx.arc(ix, iy, m.radius + 5.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3. Spherical glossy marble body
  ctx.save();
  ctx.translate(ix, iy);
  if (m.squash > 0.02) {
    ctx.rotate(m.squashAngle);
    const sx = 1 - m.squash * 0.11;
    const sy = 1 + m.squash * 0.11;
    ctx.scale(sx, sy);
    ctx.rotate(-m.squashAngle);
  }

  const r = m.radius;
  const sphereGrad = ctx.createRadialGradient(
    -r * 0.34,
    -r * 0.36,
    r * 0.08,
    0,
    0,
    r
  );

  if (variant === "obsidian") {
    sphereGrad.addColorStop(0, "#4B565E");
    sphereGrad.addColorStop(0.28, "#1E2429");
    sphereGrad.addColorStop(0.76, "#090B0D");
    sphereGrad.addColorStop(1, "#2A333A");
  } else if (variant === "amber") {
    sphereGrad.addColorStop(0, "#FFE9A8");
    sphereGrad.addColorStop(0.35, "#E09734");
    sphereGrad.addColorStop(0.85, "#8E4A10");
    sphereGrad.addColorStop(1, "#C97A26");
  } else if (variant === "echo") {
    sphereGrad.addColorStop(0, "#B8F0E2");
    sphereGrad.addColorStop(0.35, "#3E8B7D");
    sphereGrad.addColorStop(0.85, "#153D37");
    sphereGrad.addColorStop(1, "#35786C");
  } else {
    sphereGrad.addColorStop(0, "#FFFFFF");
    sphereGrad.addColorStop(0.4, "#D7DEE2");
    sphereGrad.addColorStop(0.88, "#8F9AA2");
    sphereGrad.addColorStop(1, "#B8C4CC");
  }

  ctx.fillStyle = sphereGrad;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  // Clipped multi-layer reflections (creates convincing obsidian black glass sphere)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();

  // Subtle ambient studio reflection arc along lower-right rim
  ctx.strokeStyle =
    variant === "obsidian"
      ? "rgba(196, 212, 224, 0.34)"
      : "rgba(255, 255, 255, 0.42)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, r - 1.3, 0.18 * Math.PI, 0.62 * Math.PI);
  ctx.stroke();

  // Subtle soft upper-left inner dome reflection
  const velShift = Math.max(-0.5, Math.min(0.5, m.vx * 0.0012));
  ctx.save();
  ctx.translate(-r * 0.34 + velShift, -r * 0.35);
  ctx.rotate(-0.62);
  const specGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.42);
  specGrad.addColorStop(0, "rgba(255, 255, 255, 0.96)");
  specGrad.addColorStop(0.65, "rgba(255, 255, 255, 0.65)");
  specGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = specGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.38, r * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Crisp secondary pinpoint reflection
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.beginPath();
  ctx.arc(r * 0.14 + velShift * 0.6, -r * 0.48, Math.max(0.9, r * 0.12), 0, Math.PI * 2);
  ctx.fill();

  // Faint lower-right warm studio bounce glint
  ctx.fillStyle = "rgba(235, 240, 244, 0.24)";
  ctx.beginPath();
  ctx.ellipse(r * 0.34, r * 0.38, r * 0.22, r * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Crisp outer glass edge hairline
  ctx.strokeStyle =
    variant === "obsidian"
      ? "rgba(8, 11, 14, 0.88)"
      : "rgba(28, 35, 33, 0.45)";
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();
}
