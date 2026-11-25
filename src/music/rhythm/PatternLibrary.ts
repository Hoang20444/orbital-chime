import type { DrumId } from "../../audio/instruments/types.ts";
import type { RhythmPatternPreset, RhythmStyleId, StepCell } from "./types.ts";

/**
 * Pattern notation:
 * '.' = rest
 * 'X' = accent (0.95)
 * 'x' = normal (0.76)
 * 'g' = ghost note (0.34)
 * 'p' = probabilistic fill (0.58, 65% chance)
 */
function parsePattern(pattern: string): StepCell[] {
  return Array.from(pattern).map((ch) => {
    if (ch === "X") return { active: true, velocity: 0.94, accent: true };
    if (ch === "x") return { active: true, velocity: 0.74 };
    if (ch === "g") return { active: true, velocity: 0.34, ghost: true };
    if (ch === "p") {
      return { active: true, velocity: 0.56, probability: 0.65 };
    }
    return { active: false, velocity: 0.75 };
  });
}

function makeTracks(
  map: Record<DrumId, string>
): Record<DrumId, StepCell[]> {
  return {
    kick: parsePattern(map.kick),
    snare: parsePattern(map.snare),
    hihat_closed: parsePattern(map.hihat_closed),
    hihat_open: parsePattern(map.hihat_open),
    clap: parsePattern(map.clap),
    shaker: parsePattern(map.shaker),
  };
}

export const RHYTHM_STYLES: Record<RhythmStyleId, RhythmPatternPreset> = {
  pop: {
    id: "pop",
    nameEn: "Pop",
    nameVi: "Pop Hiện Đại",
    bpm: 108,
    swing: 0.04,
    timeSignature: "4/4",
    tracks: makeTracks({
      kick: "X..g..x.X.....p.",
      snare: "....X.......X..g",
      hihat_closed: "x.x.x.x.x.x.x.x.",
      hihat_open: "..............x.",
      clap: "....x.......x...",
      shaker: "..g...g...g...p.",
    }),
  },
  hiphop: {
    id: "hiphop",
    nameEn: "Hip-Hop",
    nameVi: "Hip-Hop Pocket",
    bpm: 88,
    swing: 0.24,
    timeSignature: "4/4",
    tracks: makeTracks({
      kick: "X..g...x..x...p.",
      snare: "....X..g....X...",
      hihat_closed: "x.x.x.xx.xx.x.px",
      hihat_open: "..............x.",
      clap: "............x...",
      shaker: ".g...g...g...g..",
    }),
  },
  lofi: {
    id: "lofi",
    nameEn: "Lo-Fi",
    nameVi: "Lo-Fi Thư Giãn",
    bpm: 78,
    swing: 0.32,
    timeSignature: "4/4",
    tracks: makeTracks({
      kick: "X.....x...x..p..",
      snare: "....x.......x.g.",
      hihat_closed: "x.g.x.g.x.g.x.p.",
      hihat_open: ".......p........",
      clap: "................",
      shaker: "..x...x...x...x.",
    }),
  },
  edm: {
    id: "edm",
    nameEn: "EDM",
    nameVi: "EDM Nhịp Đều",
    bpm: 124,
    swing: 0.0,
    timeSignature: "4/4",
    tracks: makeTracks({
      kick: "X...X...X...X...",
      snare: "....x.......x.p.",
      hihat_closed: "..x...x...x...x.",
      hihat_open: "..g.......p...x.",
      clap: "....X.......X...",
      shaker: "x.x.x.x.x.x.x.x.",
    }),
  },
  funk: {
    id: "funk",
    nameEn: "Funk",
    nameVi: "Funk Đảo Phách",
    bpm: 104,
    swing: 0.16,
    timeSignature: "4/4",
    tracks: makeTracks({
      kick: "X..x..g...x..x..",
      snare: "....X..g.g..X..g",
      hihat_closed: "X.x.x.x.X.x.x.p.",
      hihat_open: "......x.......x.",
      clap: "....x...........",
      shaker: ".x.g.x.g.x.g.x.g",
    }),
  },
};
