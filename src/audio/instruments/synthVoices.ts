import type { VoiceManager } from "../VoiceManager.ts";
import type { NoteTriggerOptions } from "./types.ts";

export function triggerSynthLead(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  opts: NoteTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.15, Math.min(1, opts.velocity));
  const pan = Math.max(-0.85, Math.min(0.85, opts.pan ?? 0));
  const dur = opts.duration ?? 0.55;
  const release = 0.28;
  const endTime = t + dur + release + 0.03;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  const baseCutoff = 900 + vel * 1200;
  const peakCutoff = 2200 + vel * 3400;
  filter.frequency.setValueAtTime(baseCutoff, t);
  filter.frequency.linearRampToValueAtTime(peakCutoff, t + 0.025);
  filter.frequency.exponentialRampToValueAtTime(baseCutoff, t + dur);
  filter.Q.setValueAtTime(1.8, t);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.24 * vel, t + 0.012);
  env.gain.setValueAtTime(0.19 * vel, Math.max(t + 0.02, t + dur * 0.65));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = "triangle";
  osc2.type = "sawtooth";
  osc1.frequency.setValueAtTime(opts.freq, t);
  osc2.frequency.setValueAtTime(opts.freq, t);
  osc1.detune.setValueAtTime(-5, t);
  osc2.detune.setValueAtTime(5, t);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.45, t);

  osc1.connect(filter);
  osc2.connect(g2).connect(filter);
  filter.connect(env).connect(panner).connect(destination);

  osc1.start(t);
  osc1.stop(endTime);
  osc2.start(t);
  osc2.stop(endTime);

  voiceManager.allocateVoice(
    ctx,
    t,
    endTime,
    env,
    [osc1, osc2, g2, filter, env, panner],
    [osc1, osc2]
  );
}

export function triggerSubBass(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  opts: NoteTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.18, Math.min(1, opts.velocity));
  const dur = opts.duration ?? 0.48;
  const release = 0.14;
  const endTime = t + dur + release + 0.03;

  // Keep bass centered for tight low-end translation
  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(0, t);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(260 + vel * 140, t);
  filter.Q.setValueAtTime(0.8, t);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(0.42 * vel, t + 0.008);
  env.gain.setValueAtTime(0.36 * vel, Math.max(t + 0.015, t + dur * 0.72));
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);

  const sub = ctx.createOscillator();
  const warm2x = ctx.createOscillator();
  const gWarm = ctx.createGain();

  sub.type = "sine";
  sub.frequency.setValueAtTime(opts.freq, t);

  // -13 dB 2nd harmonic ensures bass remains audible on small laptop speakers
  warm2x.type = "sine";
  warm2x.frequency.setValueAtTime(opts.freq * 2, t);
  gWarm.gain.setValueAtTime(0.22, t);

  sub.connect(filter);
  warm2x.connect(gWarm).connect(filter);
  filter.connect(env).connect(panner).connect(destination);

  sub.start(t);
  sub.stop(endTime);
  warm2x.start(t);
  warm2x.stop(endTime);

  voiceManager.allocateVoice(
    ctx,
    t,
    endTime,
    env,
    [sub, warm2x, gWarm, filter, env, panner],
    [sub, warm2x]
  );
}
