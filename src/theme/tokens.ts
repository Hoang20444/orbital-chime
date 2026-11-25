import type { MaterialSpec, MaterialType } from "../engine/types.ts";

export const STAGE_W = 1000;
export const STAGE_H = 700;

export const TOKENS = {
  surround: "#EFF1EC",
  paper: "#F7F8F5",
  tray: "#ECEEE8",
  trayWell: "#E3E6DE",
  trayHover: "#E1E4DC",
  border: "#D7DCD1",
  borderStrong: "#BFC7B9",
  ink: "#1C2321",
  inkSoft: "#36413D",
  slate: "#636E6A",
  accent: "#CE5B46",
  accentDark: "#A14231",
  accentTint: "#F5DFDA",
  shadowContact: "rgba(28, 35, 33, 0.11)",
  shadowFloat: "rgba(28, 35, 33, 0.08)",
  guideStroke: "rgba(28, 35, 33, 0.24)",
  ringIdle: "#CE5B46",
  ringActive: "#4D8A78",
  splitterFill: "#E9EDE6",
  splitterStroke: "#1C2321",
} as const;

export const FONTS = {
  sans: '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
} as const;

export const MATERIALS: Record<MaterialType, MaterialSpec> = {
  marimba: {
    id: "marimba",
    color: "#D8A25E",
    darkEdge: "#7A501E",
    bevelColor: "#A36E2E",
    borderColor: "#7A501E",
    highlightColor: "#ECCFA6",
    grainColor: "#C28B46",
    restitution: 0.84,
    thickness: 12,
  },
  brass: {
    id: "brass",
    color: "#C29B45",
    darkEdge: "#6B4F14",
    bevelColor: "#8C691E",
    borderColor: "#6B4F14",
    highlightColor: "#E3CA82",
    grainColor: "#AE8734",
    restitution: 0.92,
    thickness: 10,
  },
  ceramic: {
    id: "ceramic",
    color: "#639E8C",
    darkEdge: "#2D5448",
    bevelColor: "#3F7061",
    borderColor: "#2D5448",
    highlightColor: "#CAE2D9",
    grainColor: "#538C7B",
    restitution: 0.86,
    thickness: 11,
  },
  bass: {
    id: "bass",
    color: "#48687E",
    darkEdge: "#1D2F3C",
    bevelColor: "#2B4354",
    borderColor: "#1D2F3C",
    highlightColor: "#7898AE",
    grainColor: "#395569",
    restitution: 0.76,
    thickness: 15,
  },
};
