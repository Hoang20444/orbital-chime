export function createStudioReverbBuffer(
  ctx: AudioContext,
  duration = 1.85
): AudioBuffer {
  const sampleRate = ctx.sampleRate || 44100;
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const fadeSamples = Math.max(1, Math.floor(sampleRate * 0.015));

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const env = Math.pow(1 - t, 2.7);
      const onset = i < fadeSamples ? i / fadeSamples : 1;
      const white = Math.random() * 2 - 1;
      lp = lp * 0.64 + white * 0.36;
      data[i] = lp * env * onset * 0.65;
    }
  }

  return buffer;
}

export class StudioReverbBus {
  public readonly input: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly wetGain: GainNode;
  private enabled = true;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createStudioReverbBuffer(ctx, 1.85);

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 1;

    this.input.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(destination);
  }

  public setEnabled(enabled: boolean, now: number): void {
    this.enabled = enabled;
    this.wetGain.gain.setTargetAtTime(enabled ? 1 : 0.0001, now, 0.025);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}
