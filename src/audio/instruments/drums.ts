import type { SampleKey, SampleManager } from "../SampleManager.ts";
import type { VoiceManager } from "../VoiceManager.ts";
import type { DrumId, DrumTriggerOptions } from "./types.ts";

const DRUM_SAMPLE_MAP: Record<DrumId, SampleKey> = {
  kick: "kick",
  snare: "snare",
  hihat_closed: "hihat_closed",
  hihat_open: "hihat_open",
  clap: "clap",
  shaker: "shaker",
};

export function triggerDrumHit(
  ctx: AudioContext,
  destination: AudioNode,
  voiceManager: VoiceManager,
  sampleManager: SampleManager,
  noiseBuffer: AudioBuffer,
  drum: DrumId,
  opts: DrumTriggerOptions
): void {
  const t = Math.max(ctx.currentTime, opts.when ?? ctx.currentTime);
  const vel = Math.max(0.12, Math.min(1, opts.velocity));
  const pan =
    drum === "kick" || drum === "snare"
      ? 0
      : Math.max(-0.7, Math.min(0.7, opts.pan ?? 0));

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(pan, t);

  const sampleKey = DRUM_SAMPLE_MAP[drum];
  const buffer = sampleManager.getBuffer(sampleKey);

  if (buffer) {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Tiny organic rate jitter on hats/shaker/clap
    if (drum !== "kick") {
      src.playbackRate.setValueAtTime(0.985 + Math.random() * 0.03, t);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = drum === "kick" || drum === "snare" ? "lowpass" : "highpass";
    if (drum === "kick" || drum === "snare") {
      filter.frequency.setValueAtTime(3200 + vel * 12000, t);
    } else {
      filter.frequency.setValueAtTime(2200 - vel * 700, t);
    }

    const gain = ctx.createGain();
    const baseAmp =
      drum === "kick"
        ? 0.72
        : drum === "snare"
          ? 0.56
          : drum === "clap"
            ? 0.45
            : 0.34;
    gain.gain.setValueAtTime(baseAmp * vel, t);

    const endTime = t + (buffer.duration || 0.35) + 0.03;
    src.connect(filter).connect(gain).connect(panner).connect(destination);
    src.start(t);
    src.stop(endTime);

    voiceManager.allocateVoice(
      ctx,
      t,
      endTime,
      gain,
      [src, filter, gain, panner],
      [src]
    );
    return;
  }

  // Instant procedural synthesis fallback before samples finish decoding
  const envGain = ctx.createGain();
  envGain.connect(panner).connect(destination);
  const nodes: AudioNode[] = [envGain, panner];
  const sources: AudioScheduledSourceNode[] = [];
  let endTime = t + 0.25;

  if (drum === "kick") {
    endTime = t + 0.32;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(148, t);
    osc.frequency.exponentialRampToValueAtTime(46, t + 0.075);
    envGain.gain.setValueAtTime(0.0001, t);
    envGain.gain.linearRampToValueAtTime(0.65 * vel, t + 0.003);
    envGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    osc.connect(envGain);
    osc.start(t);
    osc.stop(endTime);
    nodes.push(osc);
    sources.push(osc);
  } else if (drum === "snare" || drum === "clap") {
    endTime = t + 0.22;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(drum === "clap" ? 1850 : 2400, t);
    bp.Q.setValueAtTime(1.2, t);
    envGain.gain.setValueAtTime(0.0001, t);
    envGain.gain.linearRampToValueAtTime(0.38 * vel, t + 0.003);
    envGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    src.connect(bp).connect(envGain);
    src.start(t);
    src.stop(endTime);
    nodes.push(src, bp);
    sources.push(src);
  } else {
    const hatDur = drum === "hihat_open" ? 0.32 : 0.07;
    endTime = t + hatDur + 0.02;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(drum === "shaker" ? 4200 : 6500, t);
    envGain.gain.setValueAtTime(0.0001, t);
    envGain.gain.linearRampToValueAtTime(0.24 * vel, t + 0.002);
    envGain.gain.exponentialRampToValueAtTime(0.0001, t + hatDur);
    src.connect(hp).connect(envGain);
    src.start(t);
    src.stop(endTime);
    nodes.push(src, hp);
    sources.push(src);
  }

  voiceManager.allocateVoice(ctx, t, endTime, envGain, nodes, sources);
}
