import assert from "node:assert/strict";
import { MARBLE_SONGS } from "../src/data/marbleSongs.ts";
import { SANDBOX_PRESETS } from "../src/data/presets.ts";
import { FIXED_DT, stepFixed } from "../src/engine/physics.ts";
import { createWorldFromPreset } from "../src/engine/worldFactory.ts";
import {
  decodeSandboxShareHash,
  encodeSandboxShareHash,
} from "../src/engine/serializer.ts";
import type { WorldState } from "../src/engine/types.ts";
import { sculptMarbleSong } from "../src/music/MarbleSongSculptor.ts";
import {
  createBlankDraft,
  draftToMarbleSongDef,
  marbleSongToDraft,
} from "../src/music/customSongsStore.ts";
import { parseMidiBuffer } from "../src/music/midi/MidiParser.ts";
import { midiToCustomSongDraft } from "../src/music/midi/MidiToMarbleSong.ts";

function writeVLQ(out: number[], value: number): void {
  let v = value >>> 0;
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) {
    bytes.push((v & 0x7f) | 0x80);
  }
  for (let i = bytes.length - 1; i >= 0; i--) out.push(bytes[i]);
}

function makeChunk(tag: string, payload: number[]): number[] {
  const len = payload.length;
  return [
    tag.charCodeAt(0),
    tag.charCodeAt(1),
    tag.charCodeAt(2),
    tag.charCodeAt(3),
    (len >>> 24) & 0xff,
    (len >>> 16) & 0xff,
    (len >>> 8) & 0xff,
    len & 0xff,
    ...payload,
  ];
}

function buildTrackChunk(name: string, events: { tick: number; bytes: number[] }[]): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick);
  const body: number[] = [
    // Meta track name at tick 0
    0x00,
    0xff,
    0x03,
    name.length,
    ...Array.from(name, (c) => c.charCodeAt(0)),
  ];
  let prevTick = 0;
  for (const ev of sorted) {
    const dt = Math.max(0, ev.tick - prevTick);
    prevTick = ev.tick;
    writeVLQ(body, dt);
    body.push(...ev.bytes);
  }
  // End of track
  body.push(0x00, 0xff, 0x2f, 0x00);
  return makeChunk("MTrk", body);
}

function buildTestFormat1Midi(bpm: number, ppq = 480): Uint8Array {
  const usPerQuarter = Math.round(60_000_000 / bpm);
  const tempoTrack = makeChunk("MTrk", [
    0x00,
    0xff,
    0x51,
    0x03,
    (usPerQuarter >>> 16) & 0xff,
    (usPerQuarter >>> 8) & 0xff,
    usPerQuarter & 0xff,
    0x00,
    0xff,
    0x2f,
    0x00,
  ]);

  // Lead track: 8 beats + chord at beat 0 (C5+E5 -> highest E5), plus 1/16 burst at beat 4..5
  const leadEvents: { tick: number; bytes: number[] }[] = [];
  const addNote = (
    list: { tick: number; bytes: number[] }[],
    ch: number,
    midi: number,
    startBeat: number,
    durBeats = 0.4
  ) => {
    const s = Math.round(startBeat * ppq);
    const e = Math.round((startBeat + durBeats) * ppq);
    list.push({ tick: s, bytes: [0x90 | ch, midi, 100] });
    list.push({ tick: e, bytes: [0x80 | ch, midi, 0] });
  };

  addNote(leadEvents, 0, 72, 0.0); // chord lower note C5
  addNote(leadEvents, 0, 76, 0.0); // chord higher note E5
  addNote(leadEvents, 0, 75, 0.5);
  addNote(leadEvents, 0, 76, 1.0);
  addNote(leadEvents, 0, 71, 1.5);
  addNote(leadEvents, 0, 74, 2.0);
  addNote(leadEvents, 0, 72, 2.5);
  addNote(leadEvents, 0, 69, 3.0);
  // 1/16th rapid burst:
  addNote(leadEvents, 0, 64, 4.0, 0.2);
  addNote(leadEvents, 0, 67, 4.25, 0.2);
  addNote(leadEvents, 0, 71, 4.5, 0.2);
  addNote(leadEvents, 0, 76, 4.75, 0.2);
  addNote(leadEvents, 0, 72, 5.5);

  const bassEvents: { tick: number; bytes: number[] }[] = [];
  addNote(bassEvents, 1, 45, 0.0, 1.5);
  addNote(bassEvents, 1, 52, 2.0, 1.5);
  addNote(bassEvents, 1, 40, 4.0, 1.5);
  addNote(bassEvents, 1, 45, 6.0, 1.5);

  const drumEvents: { tick: number; bytes: number[] }[] = [];
  addNote(drumEvents, 9, 36, 0.0, 0.2); // kick
  addNote(drumEvents, 9, 42, 1.0, 0.2); // closed hat
  addNote(drumEvents, 9, 38, 2.0, 0.2); // snare
  addNote(drumEvents, 9, 39, 3.0, 0.2); // clap
  addNote(drumEvents, 9, 36, 4.0, 0.2); // kick
  addNote(drumEvents, 9, 38, 6.0, 0.2); // snare

  const tracks = [
    tempoTrack,
    buildTrackChunk("Piano Lead", leadEvents),
    buildTrackChunk("Electric Bass", bassEvents),
    buildTrackChunk("Drums", drumEvents),
  ];

  const header = makeChunk("MThd", [
    0x00, 0x01, // format 1
    (tracks.length >>> 8) & 0xff,
    tracks.length & 0xff,
    (ppq >>> 8) & 0xff,
    ppq & 0xff,
  ]);

  return new Uint8Array([...header, ...tracks.flat()]);
}

function assertSculptedWorldHits100(label: string, world: WorldState, loopBeats: number): void {
  const loopSec = (loopBeats * 60) / world.bpm;
  const totalTicks = Math.floor(loopSec / FIXED_DT) + 102;
  const hitsByBar = new Map<string, number[]>();
  const stray: string[] = [];
  let railEnters = 0;
  let bumperHits = 0;

  for (let t = 0; t < totalTicks; t++) {
    const events = stepFixed(world, true);
    for (const ev of events) {
      if (ev.type === "rail_enter") railEnters++;
      if (ev.type === "bumper_hit") bumperHits++;
      if (ev.type === "bar_hit") {
        const list = hitsByBar.get(ev.barId) ?? [];
        list.push(t);
        hitsByBar.set(ev.barId, list);
        if (list.length > 1) {
          stray.push(`${ev.barId} hit ${list.length}x at t=${t}`);
        }
      }
    }
  }

  const missed = world.bars.filter((b) => !hitsByBar.has(b.id)).map((b) => `${b.id}(${b.noteLabel})`);
  console.log(
    `[Studio Verify] ${label}: bars=${world.bars.length}, rails=${world.rails.length}, bumpers=${world.bumpers.length}, railEnters=${railEnters}, bumperHits=${bumperHits}, missed=${missed.length}, stray=${stray.length}`
  );
  assert.ok(world.rails.length >= 1, `${label} expected >= 1 Dual-Support Rail`);
  assert.ok(world.bumpers.length >= 1, `${label} expected >= 1 Elastic Bumper`);
  assert.ok(railEnters >= 1, `${label} expected >= 1 live rail_enter event`);
  assert.ok(bumperHits >= 1, `${label} expected >= 1 live bumper_hit event`);
  assert.equal(missed.length, 0, `${label} missed bars: ${missed.join(", ")}`);
  assert.equal(stray.length, 0, `${label} stray hits: ${stray.join(", ")}`);
}

console.log("=== Verifying Song Studio, MIDI Parser & Share Serializer ===");

// 1. Parse Format 1 binary MIDI
const midiBytes = buildTestFormat1Midi(116, 480);
const parsed = parseMidiBuffer(midiBytes);
assert.equal(parsed.format, 1);
assert.equal(parsed.bpm, 116);
assert.equal(parsed.tracks.length, 3);
assert.equal(parsed.tracks[2].isPercussion, true);
console.log(
  `[PASS] MIDI Parser extracted BPM=${parsed.bpm}, tracks=${parsed.tracks.map((t) => t.name).join(", ")}`
);

// 2. Convert 1/16 quantized MIDI -> Marble Song -> Real 120Hz Physics
const midiDraft16 = midiToCustomSongDraft(parsed, {
  title: "Test Latin 16th",
  loopBeats: 8,
  quantizeStep: 0.25,
  leadVoice: "piano",
  bassVoice: "bass",
});
assert.equal(midiDraft16.melodyNotes[0].midi, 76, "Chord at beat 0 reduced to top note E5(76)");
assert.equal(midiDraft16.bassNotes.length, 4);
assert.equal(midiDraft16.drumNotes.length, 6);
const midiSong16 = draftToMarbleSongDef(midiDraft16);
const midiWorld16 = sculptMarbleSong(midiSong16, midiDraft16.leadVoice);
assertSculptedWorldHits100("Imported 1/16 MIDI Sculpture", midiWorld16, midiSong16.loopBeats);

// 3. Built-in Für Elise -> Remix Draft -> Marble Sculpture
const remixDraft = marbleSongToDraft(MARBLE_SONGS[0]);
const remixSong = draftToMarbleSongDef(remixDraft);
const remixWorld = sculptMarbleSong(remixSong, "musicBox");
assertSculptedWorldHits100("Für Elise Remix Draft", remixWorld, remixSong.loopBeats);

// 4. Blank Starter Draft -> Marble Sculpture
const starterDraft = createBlankDraft();
const starterSong = draftToMarbleSongDef(starterDraft);
const starterWorld = sculptMarbleSong(starterSong, "ceramic");
assertSculptedWorldHits100("Piano Roll Starter Draft", starterWorld, starterSong.loopBeats);

// 5. Share Hash (#s=...) Exact Roundtrip Preservation & Physics
const eliseWorld = sculptMarbleSong(MARBLE_SONGS[0]);
const shareHash = encodeSandboxShareHash(eliseWorld);
const decoded = decodeSandboxShareHash(shareHash);
assert.ok(decoded && decoded.bars && decoded.emitters);
assert.equal(decoded.bars.length, eliseWorld.bars.length);
assert.equal(decoded.bumpers?.length, eliseWorld.bumpers.length);
assert.equal(decoded.rails?.length, eliseWorld.rails.length);
assert.equal(decoded.bars[0].fixedMidi, eliseWorld.bars[0].fixedMidi);
assert.equal(decoded.bars[0].instrumentOverride, eliseWorld.bars[0].instrumentOverride);
assert.equal(decoded.bars[0].trackChannel, eliseWorld.bars[0].trackChannel);
assert.equal(decoded.emitters[0].trackChannel, eliseWorld.emitters[0].trackChannel);

const reconstructed = createWorldFromPreset(SANDBOX_PRESETS[0]);
reconstructed.bpm = decoded.bpm!;
reconstructed.gravity = decoded.gravity;
reconstructed.scaleId = decoded.scaleId!;
reconstructed.bars = decoded.bars;
reconstructed.bumpers = decoded.bumpers ?? [];
reconstructed.splitters = decoded.splitters ?? [];
reconstructed.rails = decoded.rails ?? [];
reconstructed.emitters = decoded.emitters;
assertSculptedWorldHits100(
  "Decoded Share Hash Für Elise",
  reconstructed,
  MARBLE_SONGS[0].loopBeats
);

console.log("ALL SONG STUDIO & MIDI VERIFICATION TESTS PASSED!");
