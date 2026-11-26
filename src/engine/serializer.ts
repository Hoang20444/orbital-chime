import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  ScaleId,
  SplitterPiece,
  TubePiece,
  WorldState,
} from "./types.ts";

export interface EditableSnapshot {
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
  tubes: TubePiece[];
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
    })),
    splitters: world.splitters.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      radius: s.radius,
      locked: s.locked,
    })),
    tubes: (world.tubes ?? []).map((t) => ({
      id: t.id,
      points: t.points.map((p) => ({ ...p })),
      radius: t.radius,
      trackChannel: t.trackChannel,
      travelDuration: t.travelDuration,
      exitVx: t.exitVx,
      exitVy: t.exitVy,
      locked: t.locked,
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
  world.tubes = (snap.tubes ?? []).map((t) => ({
    ...t,
    points: t.points.map((p) => ({ ...p })),
  }));
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

type SerializedTubeTuple = [
  Array<[number, number]>,
  number?,
  string?,
  number?,
  number?,
  number?,
];

interface SharePayload {
  bpm: number;
  g?: number;
  scaleId: ScaleId;
  bars: SerializedBarTuple[];
  bumpers: Array<[number, number] | [number, number, number, string?]>;
  splitters: Array<[number, number] | [number, number, 0 | 1, string?, number?]>;
  tubes?: SerializedTubeTuple[];
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
    bumpers: world.bumpers.map((b) =>
      b.trackChannel || b.radius !== 22
        ? [round2(b.x), round2(b.y), b.radius, b.trackChannel]
        : [round2(b.x), round2(b.y)]
    ),
    splitters: world.splitters.map((s) =>
      s.harmonicPass || s.trackChannel || s.radius !== 20
        ? [round2(s.x), round2(s.y), s.harmonicPass ? 1 : 0, s.trackChannel, s.radius]
        : [round2(s.x), round2(s.y)]
    ),
    ...(world.tubes && world.tubes.length > 0
      ? {
          tubes: world.tubes.map((t) => [
            t.points.map((p) => [round2(p.x), round2(p.y)] as [number, number]),
            t.radius ?? 14,
            t.trackChannel,
            t.travelDuration,
            t.exitVx !== undefined ? round2(t.exitVx) : undefined,
            t.exitVy !== undefined ? round2(t.exitVy) : undefined,
          ]),
        }
      : {}),
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
  tubes: TubePiece[];
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
      bumpers: (parsed.bumpers ?? []).map((b, i) => ({
        id: `sb_bmp_${i}`,
        x: b[0],
        y: b[1],
        radius: typeof b[2] === "number" ? b[2] : 22,
        trackChannel: typeof b[3] === "string" ? b[3] : undefined,
      })),
      splitters: (parsed.splitters ?? []).map((s, i) => ({
        id: `sb_spl_${i}`,
        x: s[0],
        y: s[1],
        radius: typeof s[4] === "number" ? s[4] : 20,
        harmonicPass: s[2] === 1 ? true : undefined,
        trackChannel: typeof s[3] === "string" ? s[3] : undefined,
      })),
      tubes: (parsed.tubes ?? []).map((t, i) => ({
        id: `sb_tube_${i}`,
        points: (t[0] ?? []).map((p) => ({ x: p[0], y: p[1] })),
        radius: typeof t[1] === "number" ? t[1] : 14,
        trackChannel: typeof t[2] === "string" ? t[2] : undefined,
        travelDuration: typeof t[3] === "number" ? t[3] : undefined,
        exitVx: typeof t[4] === "number" ? t[4] : undefined,
        exitVy: typeof t[5] === "number" ? t[5] : undefined,
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
