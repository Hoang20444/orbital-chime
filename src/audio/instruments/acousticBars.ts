import type { MaterialType } from "../../engine/types.ts";
import type { VoiceManager } from "../VoiceManager.ts";
import type { NoteTriggerOptions } from "./types.ts";

export function triggerAcousticBar(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  noiseBuffer: AudioBuffer,
  material: MaterialType,
  opts: NoteTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.18, Math.min(1, opts.velocity));
  const pan = Math.max(-0.85, Math.min(0.85, opts.pan ?? 0));
  const microDetune = (Math.random() - 0.5) * 6; // ±3 cents
  const durScale = 0.95 + Math.random() * 0.1;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const masterVoiceGain = ctx.createGain();
  masterVoiceGain.gain.setValueAtTime(1, t);
  masterVoiceGain.connect(panner).connect(destination);

  const nodes: AudioNode[] = [masterVoiceGain, panner];
  const sources: AudioScheduledSourceNode[] = [];
  let endTime = t + 0.7;

  if (material === "marimba") {
    const decay = (opts.duration ?? 0.68) * durScale;
    endTime = t + decay + 0.03;

    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(opts.freq, t);
    osc1.detune.setValueAtTime(microDetune, t);
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.linearRampToValueAtTime(0.34 * vel, t + 0.004);
    g1.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc1.connect(g1).connect(masterVoiceGain);

    // Woody 4th harmonic transient
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(opts.freq * 4, t);
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.1 * vel * vel, t + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.044);
    osc2.connect(g2).connect(masterVoiceGain);

    // Filtered mallet thump
    const mallet = ctx.createBufferSource();
    mallet.buffer = noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1350 + vel * 600, t);
    bp.Q.setValueAtTime(2.3, t);
    const gm = ctx.createGain();
    gm.gain.setValueAtTime(0.0001, t);
    gm.gain.linearRampToValueAtTime(0.095 * vel, t + 0.002);
    gm.gain.exponentialRampToValueAtTime(0.0001, t + 0.016);
    mallet.connect(bp).connect(gm).connect(masterVoiceGain);

    osc1.start(t);
    osc1.stop(endTime);
    osc2.start(t);
    osc2.stop(t + 0.055);
    mallet.start(t);
    mallet.stop(t + 0.024);

    nodes.push(osc1, g1, osc2, g2, mallet, bp, gm);
    sources.push(osc1, osc2, mallet);
  } else if (material === "brass") {
    const baseDecay = (opts.duration ?? 1.95) * durScale;
    endTime = t + baseDecay + 0.03;

    const partials = [
      { ratio: 1, amp: 0.25 * vel, decay: baseDecay },
      { ratio: 2.756, amp: 0.12 * Math.pow(vel, 1.4), decay: baseDecay * 0.52 },
      { ratio: 5.404, amp: 0.05 * Math.pow(vel, 1.7), decay: baseDecay * 0.24 },
    ];

    partials.forEach((p, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(opts.freq * p.ratio, t);
      osc.detune.setValueAtTime(microDetune + idx * 1.2, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, p.amp), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      osc.connect(g).connect(masterVoiceGain);
      osc.start(t);
      osc.stop(t + p.decay + 0.025);
      nodes.push(osc, g);
      sources.push(osc);
    });
  } else if (material === "ceramic") {
    const baseDecay = (opts.duration ?? 1.5) * durScale;
    endTime = t + baseDecay + 0.03;

    const partials = [
      { freq: opts.freq, amp: 0.27 * vel, decay: baseDecay },
      { freq: opts.freq * 2.0, amp: 0.095 * vel, decay: baseDecay * 0.5 },
      { freq: opts.freq * 3.0 + 0.85, amp: 0.045 * Math.pow(vel, 1.3), decay: baseDecay * 0.32 },
    ];

    partials.forEach((p) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(p.freq, t);
      osc.detune.setValueAtTime(microDetune, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(Math.max(0.0002, p.amp), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.decay);
      osc.connect(g).connect(masterVoiceGain);
      osc.start(t);
      osc.stop(t + p.decay + 0.025);
      nodes.push(osc, g);
      sources.push(osc);
    });
  } else {
    // Felt Bass: warm triangle + subtle 2nd harmonic warmth for laptop speaker translation
    const decay = (opts.duration ?? 0.88) * durScale;
    endTime = t + decay + 0.03;

    const osc = ctx.createOscillator();
    const oscHarm = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const gHarm = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(opts.freq * 1.15, t);
    osc.frequency.exponentialRampToValueAtTime(opts.freq, t + 0.026);
    osc.detune.setValueAtTime(microDetune, t);

    oscHarm.type = "sine";
    oscHarm.frequency.setValueAtTime(opts.freq * 2, t);
    gHarm.gain.setValueAtTime(0.14 * vel, t);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(440 + vel * 460, t);
    filter.Q.setValueAtTime(1.1, t);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.40 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    osc.connect(filter);
    oscHarm.connect(gHarm).connect(filter);
    filter.connect(g).connect(masterVoiceGain);

    osc.start(t);
    osc.stop(endTime);
    oscHarm.start(t);
    oscHarm.stop(endTime);

    nodes.push(osc, oscHarm, gHarm, filter, g);
    sources.push(osc, oscHarm);
  }

  voiceManager.allocateVoice(ctx, t, endTime, masterVoiceGain, nodes, sources);
}
