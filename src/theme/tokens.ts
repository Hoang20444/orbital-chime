import type { MaterialSpec, MaterialType } from "../engine/types.ts";

export const STAGE_W = 1000;
export const STAGE_H = 700;

export const TOKENS = {
  surround: "#080C13",
  paper: "#131B28",
  tray: "rgba(18, 26, 39, 0.88)",
  trayWell: "#0D131D",
  trayHover: "#1D293D",
  border: "#253349",
  borderStrong: "#344763",
  ink: "#E8EFF7",
  inkSoft: "#C4D2E3",
  slate: "#889BB3",
  accent: "#F06D4F",
  accentDark: "#BA482E",
  accentTint: "rgba(240, 109, 79, 0.16)",
  shadowContact: "rgba(2, 5, 10, 0.45)",
  shadowFloat: "rgba(2, 5, 10, 0.36)",
  guideStroke: "rgba(136, 168, 206, 0.28)",
  ringIdle: "#C98A3C",
  ringActive: "#3AE8C2",
  splitterFill: "#3B5778",
  splitterStroke: "#8ED8FF",
} as const;

export const FONTS = {
  sans: '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
} as const;

export const MATERIALS: Record<MaterialType, MaterialSpec> = {
  marimba: {
    id: "marimba",
    color: "#F6AD55",
    darkEdge: "#5C3514",
    bevelColor: "#8A5220",
    borderColor: "#B87538",
    highlightColor: "#FFD89B",
    grainColor: "#C6843E",
    restitution: 0.84,
    thickness: 12,
  },
  brass: {
    id: "brass",
    color: "#F5CA52",
    darkEdge: "#5E4610",
    bevelColor: "#8C6B1C",
    borderColor: "#C8A33E",
    highlightColor: "#FFF0A6",
    grainColor: "#B8922E",
    restitution: 0.92,
    thickness: 10,
  },
  ceramic: {
    id: "ceramic",
    color: "#4AE0C2",
    darkEdge: "#18473E",
    bevelColor: "#286E60",
    borderColor: "#42B59D",
    highlightColor: "#ADFFEE",
    grainColor: "#359684",
    restitution: 0.86,
    thickness: 11,
  },
  bass: {
    id: "bass",
    color: "#5EA8F6",
    darkEdge: "#142A42",
    bevelColor: "#22466B",
    borderColor: "#467CB0",
    highlightColor: "#AED8FF",
    grainColor: "#315E8C",
    restitution: 0.76,
    thickness: 15,
  },
};
