import assert from "node:assert/strict";
import { midiToFreq } from "../src/audio/scales.ts";
import { FIXED_DT, stepFixed } from "../src/engine/physics.ts";
import {
  computeSongOneLoopTicks,
  sculptMarbleSong,
} from "../src/music/MarbleSongSculptor.ts";
import {
  analyzeAudioClipToDraft,
  extractWaveformPeaks,
  mixToMono,
} from "../src/music/audio/AudioAnalyzer.ts";
import { draftToMarbleSongDef } from "../src/music/customSongsStore.ts";

function synthPianoNote(
  buf: Float32Array,
  sr: number,
  startSec: number,
  durSec: number,
  midi: number,
  amp: number
): void {
  const f = midiToFreq(midi);
  const startIdx = Math.floor(startSec * sr);
  const len = Math.floor(durSec * sr);
  for (let i = 0; i < len && startIdx + i < buf.length; i++) {
    const t = i / sr;
    const atk = Math.min(1, t / 0.008);
    const dec = Math.exp(-t * 5.2);
    const s =
      Math.sin(2 * Math.PI * f * t) +
      0.45 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 8) +
      0.2 * Math.sin(2 * Math.PI * f * 3 * t) * Math.exp(-t * 12);
    buf[startIdx + i] += amp * atk * dec * s * 0.6;
  }
}

function synthKick(buf: Float32Array, sr: number, startSec: number, amp = 0.7): void {
  const startIdx = Math.floor(startSec * sr);
  const len = Math.floor(0.22 * sr);
  let phase = 0;
  for (let i = 0; i < len && startIdx + i < buf.length; i++) {
    const t = i / sr;
    const freq = 140 * Math.exp(-t * 28) + 48;
    phase += (2 * Math.PI * freq) / sr;
    buf[startIdx + i] += amp * Math.exp(-t * 15) * Math.sin(phase);
  }
}

function synthSnare(buf: Float32Array, sr: number, startSec: number, amp = 0.45): void {
  const startIdx = Math.floor(startSec * sr);
  const len = Math.floor(0.16 * sr);
  let seed = 1337;
  for (let i = 0; i < len && startIdx + i < buf.length; i++) {
    const t = i / sr;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const tone = Math.sin(2 * Math.PI * 190 * t);
    buf[startIdx + i] += amp * Math.exp(-t * 22) * (0.65 * noise + 0.35 * tone);
  }
}

function synthHat(buf: Float32Array, sr: number, startSec: number, amp = 0.22): void {
  const startIdx = Math.floor(startSec * sr);
  const len = Math.floor(0.05 * sr);
  let seed = 9001;
  let prev = 0;
  for (let i = 0; i < len && startIdx + i < buf.length; i++) {
    const t = i / sr;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff) * 2 - 1;
    const hp = noise - prev * 0.85;
    prev = noise;
    buf[startIdx + i] += amp * Math.exp(-t * 55) * hp;
  }
}

function assertSculptHitsAll(label: string, draft: ReturnType<typeof analyzeAudioClipToDraft>["draft"]): void {
  const song = draftToMarbleSongDef(draft);
  const world = sculptMarbleSong(song, draft.leadVoice);
  const totalTicks = computeSongOneLoopTicks(song.loopBeats, song.bpm);
  const hitsByBar = new Map<string, number>();
  const stray: string[] = [];
  let railEnters = 0;
  let bumperHits = 0;

  for (let t = 0; t < totalTicks; t++) {
    const events = stepFixed(world, true);
    for (const ev of events) {
      if (ev.type === "rail_enter") railEnters++;
      if (ev.type === "bumper_hit") bumperHits++;
      if (ev.type === "bar_hit") {
        const count = (hitsByBar.get(ev.barId) ?? 0) + 1;
        hitsByBar.set(ev.barId, count);
        if (count > 1) stray.push(`${ev.barId} (${count}x)`);
      }
    }
  }
  const missed = world.bars.filter((b) => !hitsByBar.has(b.id));
  console.log(
    `[Audio Sculpture] ${label}: bars=${world.bars.length}, rails=${world.rails.length}, bumpers=${world.bumpers.length}, railEnters=${railEnters}, bumperHits=${bumperHits}, missed=${missed.length}, stray=${stray.length}`
  );
  if (missed.length > 0) {
    for (const ch of song.chains) {
      console.log(
        "  chain=" +
        ch.id +
        " " +
        ch.notes
          .map((n, i) => {
            const id = `song_${song.id}_${ch.id}_${i}`;
            return `${i}:${n.label}@${n.beat}${hitsByBar.has(id) ? "" : "(MISS)"}`;
          })
          .join(" ")
      );
    }
  }
  assert.ok(
    world.rails.length >= song.chains.length + 2,
    `${label} expected frequent Dual-Support Rails (>= ${song.chains.length + 2}), got ${world.rails.length}`
  );
  assert.ok(world.bumpers.length >= 2, `${label} expected >= 2 Elastic Bumpers`);
  assert.ok(
    railEnters >= song.chains.length + 2,
    `${label} expected >= ${song.chains.length + 2} rail_enter events, got ${railEnters}`
  );
  assert.ok(bumperHits >= 2, `${label} expected >= 2 bumper_hit events`);
  assert.equal(missed.length, 0, `${label} missed bars: ${missed.map((b) => b.noteLabel).join(",")}`);
  assert.equal(stray.length, 0, `${label} stray hits: ${stray.join(",")}`);
}

console.log("=== Verifying MP3 / Audio DSP Analyzer & Marble Song Sculpting ===");

const sr = 44100;

// Clip 1: Für Elise motif (96 BPM, 10s stereo)
{
  const durSec = 10.5;
  const left = new Float32Array(Math.floor(durSec * sr));
  const right = new Float32Array(Math.floor(durSec * sr));
  const beatSec = 60 / 96;
  const motif: [number, number][] = [
    [0.0, 76], [0.5, 75], [1.0, 76], [1.5, 75], [2.0, 76],
    [2.5, 71], [3.0, 74], [3.5, 72], [4.0, 69],
    [5.5, 60], [6.0, 64], [6.5, 69], [7.0, 71],
    [8.5, 64], [9.0, 68], [9.5, 71], [10.0, 72],
  ];
  for (const [b, midi] of motif) {
    synthPianoNote(left, sr, b * beatSec, 0.45, midi, 0.65);
    synthPianoNote(right, sr, b * beatSec, 0.45, midi, 0.6);
  }
  const bass: [number, number][] = [
    [4.0, 45], [4.5, 52], [5.0, 57],
    [7.0, 40], [7.5, 52], [8.0, 56],
    [10.0, 45], [10.5, 52], [11.0, 57],
  ];
  for (const [b, midi] of bass) {
    synthPianoNote(left, sr, b * beatSec, 0.5, midi, 0.55);
    synthPianoNote(right, sr, b * beatSec, 0.5, midi, 0.55);
  }

  const mono = mixToMono([left, right]);
  const peaks = extractWaveformPeaks(mono, 120);
  assert.equal(peaks.length, 120);
  assert.ok(peaks.some((p) => p > 0.8), "Waveform peaks should normalize cleanly");

  const t0 = performance.now();
  const result = analyzeAudioClipToDraft(mono, sr, {
    title: "Elise MP3 Clip",
    startSec: 0,
    loopBeats: 16,
    density: "balanced",
    snapToKey: true,
  });
  const elapsedMs = performance.now() - t0;

  console.log(
    `[PASS] Elise Audio DSP (${elapsedMs.toFixed(1)}ms): BPM=${result.detectedBpm}, Key=${result.keyInfo.label}, mel=${result.draft.melodyNotes.length}, bass=${result.draft.bassNotes.length}`
  );
  assert.ok(elapsedMs < 350, `DSP took too long: ${elapsedMs.toFixed(1)}ms`);
  assert.ok(result.detectedBpm >= 65 && result.detectedBpm <= 160);
  assert.ok(result.draft.melodyNotes.length >= 6, "Should extract melody notes");
  assert.ok(result.draft.bassNotes.length >= 2, "Should extract bass notes");

  assertSculptHitsAll("Elise MP3 Sculpture", result.draft);
}

// Clip 2: Pop Groove (112 BPM, 9.5s with Kick/Snare/HiHat + Bass + Melody)
{
  const durSec = 9.5;
  const mono = new Float32Array(Math.floor(durSec * sr));
  const beatSec = 60 / 112;
  for (let b = 0; b < 16; b++) {
    const t = b * beatSec;
    if (b % 2 === 0) synthKick(mono, sr, t, 0.78);
    if (b % 2 === 1) synthSnare(mono, sr, t, 0.5);
    synthHat(mono, sr, t + 0.5 * beatSec, 0.25);
  }
  const mel: [number, number][] = [
    [0, 72], [1, 76], [2, 79], [3, 76],
    [4, 74], [5, 72], [6, 71], [7, 72],
    [8, 72], [9, 76], [10, 79], [11, 81],
    [12, 79], [13, 77], [14, 76], [15, 74],
  ];
  for (const [b, m] of mel) synthPianoNote(mono, sr, b * beatSec, 0.45, m, 0.48);
  for (let b = 0; b < 16; b += 2) {
    synthPianoNote(mono, sr, b * beatSec, 0.85, b % 4 === 0 ? 48 : 43, 0.5);
  }

  const t0 = performance.now();
  const result = analyzeAudioClipToDraft(mono, sr, {
    title: "Pop Groove MP3",
    startSec: 0,
    loopBeats: 16,
    density: "balanced",
    snapToKey: true,
  });
  const elapsedMs = performance.now() - t0;

  console.log(
    `[PASS] Groove Audio DSP (${elapsedMs.toFixed(1)}ms): BPM=${result.detectedBpm}, Key=${result.keyInfo.label}, mel=${result.draft.melodyNotes.length}, bass=${result.draft.bassNotes.length}, drums=${result.draft.drumNotes.length}`
  );
  assert.ok(elapsedMs < 350, `DSP took too long: ${elapsedMs.toFixed(1)}ms`);
  assert.ok(Math.abs(result.detectedBpm - 112) <= 4, `Expected BPM near 112, got ${result.detectedBpm}`);
  assert.ok(result.draft.melodyNotes.length >= 6);
  assert.ok(result.draft.bassNotes.length >= 4);
  assert.ok(result.draft.drumNotes.length >= 4);

  assertSculptHitsAll("Pop Groove MP3 Sculpture", result.draft);
}

console.log("ALL MP3 / AUDIO ANALYZER & SCULPTURE TESTS PASSED!");
