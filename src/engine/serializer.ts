import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  ScaleId,
  SplitterPiece,
  WorldState,
} from "./types.ts";

export interface EditableSnapshot {
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
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
  world.emitters = snap.emitters.map((e) => ({ ...e }));
}

interface BarShareMeta {
  m?: number;
  i?: MelodicInstrumentId;
  d?: DrumId;
  r?: number;
  l?: string;
  c?: string;
}

type SerializedBarTuple =
  | [number, number, number, number, string]
  | [number, number, number, number, string, BarShareMeta];

type SerializedEmitterTuple =
  | [number, number, number, number, number, number]
  | [number, number, number, number, number, number, string];

interface SharePayload {
  bpm: number;
  scaleId: ScaleId;
  bars: SerializedBarTuple[];
  bumpers: Array<[number, number]>;
  splitters: Array<[number, number]>;
  emitters: SerializedEmitterTuple[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function encodeSandboxShareHash(world: WorldState): string {
  const payload: SharePayload = {
    bpm: world.bpm,
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
    bumpers: world.bumpers.map((b) => [round2(b.x), round2(b.y)]),
    splitters: world.splitters.map((s) => [round2(s.x), round2(s.y)]),
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
  scaleId: ScaleId;
  bars: BarPiece[];
  bumpers: BumperPiece[];
  splitters: SplitterPiece[];
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
        };
      }),
      bumpers: (parsed.bumpers ?? []).map((b, i) => ({
        id: `sb_bmp_${i}`,
        x: b[0],
        y: b[1],
        radius: 22,
      })),
      splitters: (parsed.splitters ?? []).map((s, i) => ({
        id: `sb_spl_${i}`,
        x: s[0],
        y: s[1],
        radius: 20,
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
