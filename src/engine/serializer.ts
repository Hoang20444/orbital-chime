import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  RailVariant,
  ScaleId,
  SplitterPiece,
  TransferRailPiece,
  WorldState,
} from "./types.ts";

export interface EditableSnapshot {
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
  rails: TransferRailPiece[];
  emitters: Emitter[];
}

export function cloneEditableSnapshot(world: WorldState): EditableSnapshot {
  return {
    bars: world.bars.map((b) => ({
      id: b.id,
      ax: b.ax,
      ay: b.ay,
      bx: b.bx,
      by: b.by,
      material: b.material,
      locked: b.locked,
      fixedMidi: b.fixedMidi,
      instrumentOverride: b.instrumentOverride,
      drumOverride: b.drumOverride,
      customRestitution: b.customRestitution,
      noteLabel: b.noteLabel,
      trackChannel: b.trackChannel,
      silent: b.silent,
    })),
    bumpers: world.bumpers.map((b) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radius: b.radius,
      locked: b.locked,
      customRestitution: b.customRestitution,
      trackChannel: b.trackChannel,
      silent: b.silent,
    })),
    splitters: world.splitters.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      radius: s.radius,
      locked: s.locked,
    })),
    rails: (world.rails ?? []).map((r) => ({
      id: r.id,
      variant: r.variant,
      x: r.x,
      y: r.y,
      rotation: r.rotation,
      armLength: r.armLength,
      openingAngle: r.openingAngle,
      curvature: r.curvature,
      slopeBias: r.slopeBias,
      railSpacing: r.railSpacing,
      bridgeSpacing: r.bridgeSpacing,
      boost: r.boost,
      flipped: r.flipped,
      locked: r.locked,
      trackChannel: r.trackChannel,
    })),
    emitters: world.emitters.map((e) => ({
      id: e.id,
      x: e.x,
      y: e.y,
      vx: e.vx,
      vy: e.vy,
      beatInterval: e.beatInterval,
      phaseOffset: e.phaseOffset,
      locked: e.locked,
      trackChannel: e.trackChannel,
      nextEmitBeat: e.nextEmitBeat,
    })),
  };
}

export function applyEditableSnapshot(
  world: WorldState,
  snap: EditableSnapshot
): void {
  world.bars = snap.bars.map((b) => ({ ...b }));
  world.bumpers = snap.bumpers.map((b) => ({ ...b }));
  world.splitters = snap.splitters.map((s) => ({ ...s }));
  world.rails = (snap.rails ?? []).map((r) => ({ ...r }));
  world.emitters = snap.emitters.map((e) => ({ ...e }));
}

interface BarShareMeta {
  m?: number;
  i?: MelodicInstrumentId;
  d?: DrumId;
  r?: number;
  l?: string;
  c?: string;
  s?: 1;
}

type SerializedBarTuple =
  | [number, number, number, number, string]
  | [number, number, number, number, string, BarShareMeta];

type SerializedEmitterTuple =
  | [number, number, number, number, number, number]
  | [number, number, number, number, number, number, string];

interface BumperShareMeta {
  r?: number;
  c?: string;
  s?: 1;
}

type SerializedBumperTuple =
  | [number, number]
  | [number, number, number]
  | [number, number, number, BumperShareMeta];

type SerializedRailTuple = [
  string, // variant
  number, // x
  number, // y
  number, // rotation
  number, // armLength
  number, // openingAngle
  number, // curvature
  number, // slopeBias
  number, // railSpacing
  number, // boost
  number?, // flipped (1 | 0)
  number?, // bridgeSpacing
  string? // trackChannel
];

interface SharePayload {
  bpm: number;
  g?: number;
  scaleId: ScaleId;
  bars: SerializedBarTuple[];
  bumpers: SerializedBumperTuple[];
  splitters: Array<[number, number]>;
  rails?: SerializedRailTuple[];
  emitters: SerializedEmitterTuple[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function encodeSandboxShareHash(world: WorldState): string {
  const payload: SharePayload = {
    bpm: world.bpm,
    ...(world.gravity !== undefined ? { g: world.gravity } : {}),
    scaleId: world.scaleId,
    bars: world.bars.map((b) => {
      const meta: BarShareMeta = {};
      let hasMeta = false;
      if (b.fixedMidi !== undefined) {
        meta.m = b.fixedMidi;
        hasMeta = true;
      }
      if (b.instrumentOverride !== undefined) {
        meta.i = b.instrumentOverride;
        hasMeta = true;
      }
      if (b.drumOverride !== undefined) {
        meta.d = b.drumOverride;
        hasMeta = true;
      }
      if (b.customRestitution !== undefined) {
        meta.r = Math.round(b.customRestitution * 10000) / 10000;
        hasMeta = true;
      }
      if (b.noteLabel !== undefined) {
        meta.l = b.noteLabel;
        hasMeta = true;
      }
      if (b.trackChannel !== undefined) {
        meta.c = b.trackChannel;
        hasMeta = true;
      }
      if (b.silent) {
        meta.s = 1;
        hasMeta = true;
      }
      if (hasMeta) {
        return [
          round2(b.ax),
          round2(b.ay),
          round2(b.bx),
          round2(b.by),
          b.material,
          meta,
        ];
      }
      return [
        round2(b.ax),
        round2(b.ay),
        round2(b.bx),
        round2(b.by),
        b.material,
      ];
    }),
    bumpers: world.bumpers.map((b) => {
      const meta: BumperShareMeta = {};
      let hasMeta = false;
      if (b.customRestitution !== undefined) {
        meta.r = Math.round(b.customRestitution * 10000) / 10000;
        hasMeta = true;
      }
      if (b.trackChannel !== undefined) {
        meta.c = b.trackChannel;
        hasMeta = true;
      }
      if (b.silent) {
        meta.s = 1;
        hasMeta = true;
      }
      if (hasMeta) {
        return [round2(b.x), round2(b.y), round2(b.radius), meta];
      }
      if (b.radius !== 22) {
        return [round2(b.x), round2(b.y), round2(b.radius)];
      }
      return [round2(b.x), round2(b.y)];
    }),
    splitters: world.splitters.map((s) => [round2(s.x), round2(s.y)]),
    rails: (world.rails ?? []).map((r) => [
      r.variant,
      round2(r.x),
      round2(r.y),
      Math.round(r.rotation * 1000) / 1000,
      round2(r.armLength),
      round2(r.openingAngle),
      round2(r.curvature),
      round2(r.slopeBias),
      round2(r.railSpacing),
      round2(r.boost),
      r.flipped ? 1 : 0,
      round2(r.bridgeSpacing),
      r.trackChannel,
    ]),
    emitters: world.emitters.map((e) => {
      if (e.trackChannel) {
        return [
          round2(e.x),
          round2(e.y),
          round2(e.vx),
          round2(e.vy),
          e.beatInterval,
          e.phaseOffset,
          e.trackChannel,
        ];
      }
      return [
        round2(e.x),
        round2(e.y),
        round2(e.vx),
        round2(e.vy),
        e.beatInterval,
        e.phaseOffset,
      ];
    }),
  };

  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const base64 = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `#s=${base64}`;
}

export function decodeSandboxShareHash(hash: string): Partial<{
  bpm: number;
  gravity: number;
  scaleId: ScaleId;
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
  rails: TransferRailPiece[];
  emitters: Emitter[];
}> | null {
  if (!hash.startsWith("#s=")) return null;
  try {
    let b64 = hash.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as SharePayload;

    return {
      bpm: typeof parsed.bpm === "number" ? parsed.bpm : 108,
      gravity: typeof parsed.g === "number" ? parsed.g : undefined,
      scaleId: parsed.scaleId ?? "c_pentatonic",
      bars: (parsed.bars ?? []).map((b, i) => {
        const meta = b[5];
        return {
          id: `sb_bar_${i}`,
          ax: b[0],
          ay: b[1],
          bx: b[2],
          by: b[3],
          material: (b[4] as BarPiece["material"]) ?? "marimba",
          fixedMidi: meta?.m,
          instrumentOverride: meta?.i,
          drumOverride: meta?.d,
          customRestitution: meta?.r,
          noteLabel: meta?.l,
          trackChannel: meta?.c,
          silent: meta?.s === 1 ? true : undefined,
        };
      }),
      bumpers: (parsed.bumpers ?? []).map((b, i) => {
        const meta = b[3];
        return {
          id: `sb_bmp_${i}`,
          x: b[0],
          y: b[1],
          radius: b[2] ?? 22,
          customRestitution: meta?.r,
          trackChannel: meta?.c,
          silent: meta?.s === 1 ? true : undefined,
        };
      }),
      splitters: (parsed.splitters ?? []).map((s, i) => ({
        id: `sb_spl_${i}`,
        x: s[0],
        y: s[1],
        radius: 20,
      })),
      rails: (parsed.rails ?? []).map((r, i) => ({
        id: `sb_rail_${i}`,
        variant: (r[0] as RailVariant) ?? "v",
        x: r[1],
        y: r[2],
        rotation: r[3] ?? 0,
        armLength: r[4] ?? 120,
        openingAngle: r[5] ?? 88,
        curvature: r[6] ?? 0.52,
        slopeBias: r[7] ?? 0,
        railSpacing: Math.max(9, Math.min(14.5, r[8] ?? 12.8)),
        boost: r[9] ?? 0.25,
        flipped: r[10] === 1,
        bridgeSpacing: Math.max(28, Math.min(96, r[11] ?? 52)),
        trackChannel: r[12],
      })),
      emitters: (parsed.emitters ?? []).map((e, i) => ({
        id: `sb_em_${i}`,
        x: e[0],
        y: e[1],
        vx: e[2],
        vy: e[3],
        beatInterval: e[4] ?? 2,
        phaseOffset: e.length >= 6 ? e[5] : 0,
        trackChannel: e.length >= 7 ? e[6] : undefined,
        nextEmitBeat: e.length >= 6 ? e[5] : 0,
      })),
    };
  } catch {
    return null;
  }
}
