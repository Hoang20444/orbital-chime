import type { MelodicInstrumentId } from "../../audio/instruments/types.ts";
import { midiToFreq } from "../../audio/scales.ts";
import type {
  CustomSongDraft,
  DrumNoteInput,
  SongNoteInput,
} from "../midi/MidiToMarbleSong.ts";

export interface DetectedKeyInfo {
  rootPc: number;
  mode: "major" | "minor";
  label: string;
  scalePcs: Set<number>;
}

export type ExtractionDensity = "clean" | "balanced" | "rich";

export interface AudioAnalysisOptions {
  title?: string;
  startSec: number;
  loopBeats: number;
  bpmOverride?: number;
  leadVoice?: MelodicInstrumentId;
  bassVoice?: MelodicInstrumentId;
  density?: ExtractionDensity;
  snapToKey?: boolean;
  includeMelody?: boolean;
  includeBass?: boolean;
  includeDrums?: boolean;
}

export interface AudioAnalysisResult {
  draft: CustomSongDraft;
  detectedBpm: number;
  alignedOffsetSec: number;
  keyInfo: DetectedKeyInfo;
  analyzedDurationSec: number;
}

const NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];

// Krumhansl-Schmuckler tonal hierarchy weights
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = channels[0].length;
  const out = new Float32Array(len);
  const inv = 1 / channels.length;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += channels[c][i] ?? 0;
    }
    out[i] = sum * inv;
  }
  return out;
}

export function extractWaveformPeaks(mono: Float32Array, numBars = 120): number[] {
  if (mono.length === 0 || numBars <= 0) return Array(Math.max(1, numBars)).fill(0);
  const peaks: number[] = new Array(numBars).fill(0);
  const blockSize = Math.max(1, Math.floor(mono.length / numBars));
  const stride = Math.max(1, Math.floor(blockSize / 64));
  let globalMax = 1e-6;

  for (let b = 0; b < numBars; b++) {
    const start = b * blockSize;
    const end = b === numBars - 1 ? mono.length : Math.min(mono.length, start + blockSize);
    let maxAbs = 0;
    for (let i = start; i < end; i += stride) {
      const a = Math.abs(mono[i]);
      if (a > maxAbs) maxAbs = a;
    }
    peaks[b] = maxAbs;
    if (maxAbs > globalMax) globalMax = maxAbs;
  }

  for (let b = 0; b < numBars; b++) {
    peaks[b] = Math.min(1, peaks[b] / globalMax);
  }
  return peaks;
}

function downsample2xIfHigh(
  samples: Float32Array,
  sampleRate: number
): { data: Float32Array; sr: number } {
  if (sampleRate < 38000) return { data: samples, sr: sampleRate };
  const len = Math.floor(samples.length / 2);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = 0.5 * (samples[i * 2] + samples[i * 2 + 1]);
  }
  return { data: out, sr: sampleRate * 0.5 };
}

function biquadFilter(
  samples: Float32Array,
  sr: number,
  type: "lowpass" | "highpass" | "bandpass",
  cutoffHz: number,
  q = 0.707
): Float32Array {
  const w0 = (2 * Math.PI * Math.min(cutoffHz, sr * 0.45)) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);

  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  if (type === "lowpass") {
    b0 = (1 - cosw0) * 0.5;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) * 0.5;
  } else if (type === "highpass") {
    b0 = (1 + cosw0) * 0.5;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) * 0.5;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  const out = new Float32Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

const hannWindowCache = new Map<number, Float32Array>();

function getHannWindow(len: number): Float32Array {
  let win = hannWindowCache.get(len);
  if (win) return win;
  win = new Float32Array(len);
  const invNm1 = 1 / Math.max(1, len - 1);
  for (let i = 0; i < len; i++) {
    win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i * invNm1));
  }
  hannWindowCache.set(len, win);
  return win;
}

function goertzelMag(
  samples: Float32Array,
  start: number,
  len: number,
  sr: number,
  targetFreq: number
): number {
  if (len < 16 || targetFreq >= sr * 0.48) return 0;
  const omega = (2 * Math.PI * targetFreq) / sr;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  const end = Math.min(samples.length, start + len);
  const actualLen = end - start;
  if (actualLen < 16) return 0;

  const win = getHannWindow(actualLen);
  for (let idx = 0; idx < actualLen; idx++) {
    q0 = coeff * q1 - q2 + samples[start + idx] * win[idx];
    q2 = q1;
    q1 = q0;
  }
  const power = Math.max(0, q1 * q1 + q2 * q2 - q1 * q2 * coeff);
  return Math.sqrt(power) / actualLen;
}

function rmsSlice(samples: Float32Array, start: number, len: number): number {
  const end = Math.min(samples.length, start + len);
  const count = end - start;
  if (count <= 0) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / count);
}

export function detectTempoAndOffset(
  clip: Float32Array,
  sampleRate: number
): { bpm: number; offsetSec: number } {
  const { data, sr } = downsample2xIfHigh(clip, sampleRate);
  if (data.length < sr * 1.2) {
    return { bpm: 108, offsetSec: 0 };
  }

  // Combine low-punch (<180Hz) and high-mid onset flux (>1200Hz)
  const lowBand = biquadFilter(data, sr, "lowpass", 180, 0.8);
  const midHighBand = biquadFilter(data, sr, "highpass", 1200, 0.707);

  const hop = 256; // ~86 Hz frame rate at 22050Hz
  const frameRate = sr / hop;
  const numFrames = Math.floor(data.length / hop);
  const env = new Float32Array(numFrames);

  let prevLow = 0;
  let prevHi = 0;
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    const eLow = rmsSlice(lowBand, start, hop);
    const eHi = rmsSlice(midHighBand, start, hop);
    const flux = Math.max(0, eLow - prevLow) * 1.4 + Math.max(0, eHi - prevHi);
    env[f] = flux;
    prevLow = eLow * 0.85 + prevLow * 0.15;
    prevHi = eHi * 0.85 + prevHi * 0.15;
  }

  // Evaluate autocorrelation for BPM 68..154
  let bestBpm = 108;
  let bestScore = -1;

  for (let bpm = 68; bpm <= 154; bpm++) {
    const beatFrames = (60 / bpm) * frameRate;
    const lag1 = Math.round(beatFrames);
    const lag2 = Math.round(beatFrames * 2);
    const lagHalf = Math.round(beatFrames * 0.5);

    let s1 = 0;
    let s2 = 0;
    let sHalf = 0;
    let count = 0;

    for (let i = 0; i + lag2 < numFrames; i++) {
      const a = env[i];
      if (a <= 1e-6) continue;
      s1 += a * (env[i + lag1] ?? 0);
      s2 += a * (env[i + lag2] ?? 0);
      sHalf += a * (env[i + lagHalf] ?? 0);
      count++;
    }
    if (count === 0) continue;

    // Gentle human tempo preference centered around 108 BPM to resolve 2x/0.5x ambiguity
    const tempoPrior = Math.exp(-Math.pow((bpm - 108) / 38, 2));
    const score = (s1 * 1.3 + s2 * 0.9 + sHalf * 0.35) * (0.78 + 0.22 * tempoPrior);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  // Align beat grid phase offset (0 .. beatDuration)
  const beatFrames = (60 / bestBpm) * frameRate;
  const searchFrames = Math.max(1, Math.round(beatFrames));
  let bestPhase = 0;
  let bestPhaseSum = -1;

  for (let ph = 0; ph < searchFrames; ph++) {
    let sum = 0;
    for (let k = 0; ph + k * beatFrames < numFrames; k++) {
      const center = Math.round(ph + k * beatFrames);
      for (let d = -2; d <= 2; d++) {
        const idx = center + d;
        if (idx >= 0 && idx < numFrames) {
          sum += env[idx] * (d === 0 ? 1 : 0.5);
        }
      }
    }
    if (sum > bestPhaseSum) {
      bestPhaseSum = sum;
      bestPhase = ph;
    }
  }

  return {
    bpm: bestBpm,
    offsetSec: Math.min(0.45, bestPhase / frameRate),
  };
}

export function detectMusicalKey(
  clip: Float32Array,
  sampleRate: number
): DetectedKeyInfo {
  const { data, sr } = downsample2xIfHigh(clip, sampleRate);
  const chroma = new Float64Array(12);
  const winLen = Math.min(data.length, 2048);
  const stride = Math.max(winLen, Math.floor((data.length - winLen) / 7));

  if (winLen < 64) {
    return {
      rootPc: 0,
      mode: "major",
      label: "C Major",
      scalePcs: new Set(MAJOR_INTERVALS),
    };
  }

  // Sum energy across octaves C3..B5 (MIDI 48..83) on sampled frames
  for (let pos = 0; pos + winLen <= data.length; pos += stride) {
    for (let midi = 48; midi <= 83; midi++) {
      const mag = goertzelMag(data, pos, winLen, sr, midiToFreq(midi));
      chroma[midi % 12] += mag * mag;
    }
  }

  let bestRoot = 0;
  let bestMode: "major" | "minor" = "major";
  let bestCorr = -Infinity;

  for (let root = 0; root < 12; root++) {
    let majScore = 0;
    let minScore = 0;
    for (let pc = 0; pc < 12; pc++) {
      const val = chroma[(root + pc) % 12];
      majScore += val * KS_MAJOR[pc];
      minScore += val * KS_MINOR[pc];
    }
    if (majScore > bestCorr) {
      bestCorr = majScore;
      bestRoot = root;
      bestMode = "major";
    }
    if (minScore > bestCorr) {
      bestCorr = minScore;
      bestRoot = root;
      bestMode = "minor";
    }
  }

  const intervals = bestMode === "major" ? MAJOR_INTERVALS : MINOR_INTERVALS;
  const scalePcs = new Set(intervals.map((iv) => (bestRoot + iv) % 12));
  return {
    rootPc: bestRoot,
    mode: bestMode,
    label: `${NOTE_NAMES[bestRoot]} ${bestMode === "major" ? "Major" : "Minor"}`,
    scalePcs,
  };
}

function snapMidiToKey(midi: number, scalePcs: Set<number>): number {
  const pc = ((midi % 12) + 12) % 12;
  if (scalePcs.has(pc)) return midi;
  // Prefer nearest semitone inside key scale
  const upPc = (midi + 1) % 12;
  const downPc = (midi + 11) % 12;
  if (scalePcs.has(upPc)) return midi + 1;
  if (scalePcs.has(downPc)) return midi - 1;
  return midi;
}

export function analyzeAudioClipToDraft(
  mono: Float32Array,
  sampleRate: number,
  opts: AudioAnalysisOptions
): AudioAnalysisResult {
  const startSample = Math.max(0, Math.floor(opts.startSec * sampleRate));
  const preliminaryBpm = opts.bpmOverride ?? 108;
  const approxClipSec = Math.max(4, Math.min(28, (opts.loopBeats * 60) / Math.max(55, preliminaryBpm) + 1.5));
  const maxSliceLen = Math.min(mono.length - startSample, Math.floor(approxClipSec * sampleRate));
  const rawClip = mono.subarray(startSample, startSample + Math.max(0, maxSliceLen));

  const { data: clip, sr } = downsample2xIfHigh(rawClip, sampleRate);
  const tempoInfo = detectTempoAndOffset(clip, sr);
  const bpm = Math.max(60, Math.min(160, Math.round(opts.bpmOverride ?? tempoInfo.bpm)));
  const beatOffsetSec = opts.bpmOverride ? 0 : tempoInfo.offsetSec;

  const loopBeats = Math.max(8, Math.min(24, opts.loopBeats || 16));
  const keyInfo = detectMusicalKey(clip, sr);

  const density: ExtractionDensity = opts.density ?? "balanced";
  const snapToKey = opts.snapToKey ?? true;
  const includeMelody = opts.includeMelody ?? true;
  const includeBass = opts.includeBass ?? true;
  const includeDrums = opts.includeDrums ?? true;

  // Compute filtered signals once for fast per-slot inspection
  const melodySig = includeMelody ? biquadFilter(clip, sr, "highpass", 225, 0.707) : clip;
  const bassSig = includeBass ? biquadFilter(clip, sr, "lowpass", 195, 0.85) : clip;
  const lowDrumSig = includeDrums ? biquadFilter(clip, sr, "lowpass", 145, 0.85) : clip;
  const midDrumSig = includeDrums ? biquadFilter(clip, sr, "bandpass", 950, 1.0) : clip;
  const highDrumSig = includeDrums ? biquadFilter(clip, sr, "highpass", 4800, 0.75) : clip;

  const stepBeats = 0.5;
  const totalSlots = Math.round(loopBeats / stepBeats);
  const beatSec = 60 / bpm;
  const slotSec = beatSec * stepBeats;
  const slotSamples = Math.max(256, Math.floor(slotSec * sr));

  // Pre-scan slot energies for adaptive gating
  const melRms: number[] = [];
  const bassRms: number[] = [];
  const lowDrumAtk: number[] = [];
  const midDrumAtk: number[] = [];
  const highDrumAtk: number[] = [];

  for (let s = 0; s < totalSlots; s++) {
    const pos = Math.floor((beatOffsetSec + s * slotSec) * sr);
    if (pos + 256 >= clip.length) {
      melRms.push(0);
      bassRms.push(0);
      lowDrumAtk.push(0);
      midDrumAtk.push(0);
      highDrumAtk.push(0);
      continue;
    }
    const atkLen = Math.min(slotSamples, Math.floor(0.065 * sr));
    melRms.push(rmsSlice(melodySig, pos, Math.min(slotSamples, Math.floor(0.18 * sr))));
    bassRms.push(rmsSlice(bassSig, pos, slotSamples));
    lowDrumAtk.push(rmsSlice(lowDrumSig, pos, atkLen));
    midDrumAtk.push(rmsSlice(midDrumSig, pos, atkLen));
    highDrumAtk.push(rmsSlice(highDrumSig, pos, atkLen));
  }

  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const melMean = mean(melRms);
  const bassMean = mean(bassRms);
  const lowDrumMean = mean(lowDrumAtk);
  const midDrumMean = mean(midDrumAtk);
  const highDrumMean = mean(highDrumAtk);

  const melFactor = density === "clean" ? 0.68 : density === "rich" ? 0.25 : 0.44;
  const bassFactor = density === "clean" ? 0.72 : density === "rich" ? 0.3 : 0.48;
  const drumFactor = density === "clean" ? 1.28 : density === "rich" ? 0.85 : 1.05;

  const melodyNotes: SongNoteInput[] = [];
  const bassNotes: SongNoteInput[] = [];
  const drumNotes: DrumNoteInput[] = [];

  let prevMelMidi = 72;
  let prevMelScore = 0;

  for (let s = 0; s < totalSlots; s++) {
    const beat = s * stepBeats;
    const pos = Math.floor((beatOffsetSec + s * slotSec) * sr);
    if (pos + 512 >= clip.length) break;

    // 1. Melody extraction (MIDI 60..84)
    if (includeMelody && melRms[s] > Math.max(0.008, melMean * melFactor)) {
      const winLen = Math.min(clip.length - pos, Math.min(slotSamples, 2048));
      let bestMidi = 69;
      let bestScore = -1;

      for (let midi = 60; midi <= 84; midi++) {
        const f0 = midiToFreq(midi);
        const h1 = goertzelMag(melodySig, pos, winLen, sr, f0);
        const h2 = goertzelMag(melodySig, pos, winLen, sr, f0 * 2);
        const h3 = goertzelMag(melodySig, pos, winLen, sr, f0 * 3);
        let score = h1 + 0.45 * h2 + 0.2 * h3;
        if (Math.abs(midi - prevMelMidi) <= 7) {
          score *= 1.08;
        }
        if (score > bestScore) {
          bestScore = score;
          bestMidi = midi;
        }
      }

      // Trigger new note on onset rise or significant energy, skip faint held tail unless rich mode
      const prevE = s > 0 ? melRms[s - 1] : 0;
      const isOnset = melRms[s] >= prevE * 0.92 || bestMidi !== prevMelMidi || density === "rich";
      if (isOnset && bestScore > prevMelScore * 0.12) {
        const finalMidi = snapToKey ? snapMidiToKey(bestMidi, keyInfo.scalePcs) : bestMidi;
        melodyNotes.push({ beat, midi: finalMidi });
        prevMelMidi = finalMidi;
        prevMelScore = bestScore;
      }
    }

    // 2. Bass extraction (MIDI 36..55), mainly on quarter beats unless rich
    if (
      includeBass &&
      (s % 2 === 0 || density !== "clean") &&
      bassRms[s] > Math.max(0.01, bassMean * bassFactor)
    ) {
      const winLen = Math.min(clip.length - pos, Math.min(slotSamples, 4096));
      let bestMidi = 45;
      let bestScore = -1;

      for (let midi = 36; midi <= 55; midi++) {
        const f0 = midiToFreq(midi);
        const h1 = goertzelMag(bassSig, pos, winLen, sr, f0);
        const h2 = goertzelMag(bassSig, pos, winLen, sr, f0 * 2);
        const score = h1 + 0.35 * h2;
        if (score > bestScore) {
          bestScore = score;
          bestMidi = midi;
        }
      }
      const prevBass = s > 0 ? bassRms[s - 1] : 0;
      if (bassRms[s] >= prevBass * 0.95 || s % 2 === 0) {
        const finalMidi = snapToKey ? snapMidiToKey(bestMidi, keyInfo.scalePcs) : bestMidi;
        bassNotes.push({ beat, midi: finalMidi });
      }
    }

    // 3. 3-band Drum Onset Extraction
    if (includeDrums) {
      const prevLow = s > 0 ? lowDrumAtk[s - 1] : 0;
      const prevMid = s > 0 ? midDrumAtk[s - 1] : 0;
      const prevHi = s > 0 ? highDrumAtk[s - 1] : 0;

      const kickHit =
        lowDrumAtk[s] > Math.max(0.015, lowDrumMean * drumFactor) &&
        lowDrumAtk[s] > prevLow * 1.12;
      const snareHit =
        midDrumAtk[s] > Math.max(0.012, midDrumMean * drumFactor * 1.05) &&
        midDrumAtk[s] > prevMid * 1.15;
      const hatHit =
        highDrumAtk[s] > Math.max(0.008, highDrumMean * drumFactor) &&
        highDrumAtk[s] > prevHi * 1.12;

      if (kickHit) {
        drumNotes.push({ beat, drum: "kick" });
      } else if (snareHit) {
        drumNotes.push({ beat, drum: s % 4 === 2 ? "snare" : "clap" });
      } else if (hatHit) {
        drumNotes.push({ beat, drum: "hihat_closed" });
      }
    }
  }

  return {
    draft: {
      id: `audio_${Date.now()}`,
      title: opts.title?.trim() || "Imported MP3 Song",
      bpm,
      loopBeats,
      leadVoice: opts.leadVoice ?? "piano",
      bassVoice: opts.bassVoice ?? "bass",
      melodyNotes,
      bassNotes,
      drumNotes,
      createdAt: Date.now(),
    },
    detectedBpm: bpm,
    alignedOffsetSec: beatOffsetSec,
    keyInfo,
    analyzedDurationSec: rawClip.length / Math.max(1, sampleRate),
  };
}
