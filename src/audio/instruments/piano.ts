import type { SampleKey, SampleManager } from "../SampleManager.ts";
import type { VoiceManager } from "../VoiceManager.ts";
import type { NoteTriggerOptions } from "./types.ts";

const PIANO_ROOTS: Array<{ key: SampleKey; freq: number }> = [
  { key: "piano_c3", freq: 130.81 },
  { key: "piano_c4", freq: 261.63 },
  { key: "piano_c5", freq: 523.25 },
];

export function triggerAcousticPiano(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  sampleManager: SampleManager,
  opts: NoteTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.15, Math.min(1, opts.velocity));
  const pan = Math.max(-0.85, Math.min(0.85, opts.pan ?? 0));
  const decay = opts.duration ?? 1.45;
  const endTime = t + decay + 0.04;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400 + Math.pow(vel, 1.3) * 7400, t);
  filter.Q.setValueAtTime(0.6, t);

  const envGain = ctx.createGain();
  envGain.connect(filter).connect(panner).connect(destination);

  const nodes: AudioNode[] = [envGain, filter, panner];
  const sources: AudioScheduledSourceNode[] = [];

  // Choose nearest piano sample root
  let bestRoot = PIANO_ROOTS[1];
  let bestRatioDist = Infinity;
  for (const r of PIANO_ROOTS) {
    const dist = Math.abs(Math.log2(opts.freq / r.freq));
    if (dist < bestRatioDist) {
      bestRatioDist = dist;
      bestRoot = r;
    }
  }

  const buf = sampleManager.getBuffer(bestRoot.key);
  if (buf) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.setValueAtTime(opts.freq / bestRoot.freq, t);

    envGain.gain.setValueAtTime(0.0001, t);
    envGain.gain.linearRampToValueAtTime(0.52 * vel, t + 0.005);
    envGain.gain.setValueAtTime(0.52 * vel, Math.max(t + 0.01, t + decay * 0.45));
    envGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    src.connect(envGain);
    src.start(t);
    src.stop(endTime);
    nodes.push(src);
    sources.push(src);
  } else {
    // Seamless warm harmonic fallback while sample finishes decoding
    const partials = [
      { mult: 1, amp: 0.30 * vel, d: decay },
      { mult: 2, amp: 0.14 * vel, d: decay * 0.65 },
      { mult: 3, amp: 0.06 * vel * vel, d: decay * 0.42 },
    ];
    envGain.gain.setValueAtTime(1, t);
    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(opts.freq * p.mult, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, p.amp), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
      osc.connect(g).connect(envGain);
      osc.start(t);
      osc.stop(t + p.d + 0.03);
      nodes.push(osc, g);
      sources.push(osc);
    });
  }

  voiceManager.allocateVoice(ctx, t, endTime, envGain, nodes, sources);
}

export function triggerMusicBox(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  opts: NoteTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.15, Math.min(1, opts.velocity));
  const pan = Math.max(-0.85, Math.min(0.85, opts.pan ?? 0));
  const decay = opts.duration ?? 1.25;
  const endTime = t + decay + 0.03;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const masterVoiceGain = ctx.createGain();
  masterVoiceGain.gain.setValueAtTime(1, t);
  masterVoiceGain.connect(panner).connect(destination);

  const nodes: AudioNode[] = [masterVoiceGain, panner];
  const sources: AudioScheduledSourceNode[] = [];

  // Delicate music-box steel tine: pure fundamental + octaves + subtle metallic pluck
  const partials = [
    { mult: 1, amp: 0.24 * vel, d: decay },
    { mult: 2.0, amp: 0.08 * vel, d: decay * 0.55 },
    { mult: 3.98, amp: 0.035 * Math.pow(vel, 1.4), d: 0.14 },
  ];

  partials.forEach((p) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(opts.freq * p.mult, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, p.amp), t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.d);
    osc.connect(g).connect(masterVoiceGain);
    osc.start(t);
    osc.stop(t + p.d + 0.02);
    nodes.push(osc, g);
    sources.push(osc);
  });

  voiceManager.allocateVoice(ctx, t, endTime, masterVoiceGain, nodes, sources);
}
