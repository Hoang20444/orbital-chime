export class MasterProcessor {
  public readonly input: GainNode;
  private readonly subHighPass: BiquadFilterNode;
  private readonly lowShelf: BiquadFilterNode;
  private readonly midDip: BiquadFilterNode;
  private readonly highShelf: BiquadFilterNode;
  private readonly glueCompressor: DynamicsCompressorNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly masterGain: GainNode;
  private muted = false;
  private volume = 0.88;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    // 1. Clean sub-rumble below 30Hz for laptop & headphone headroom
    this.subHighPass = ctx.createBiquadFilter();
    this.subHighPass.type = "highpass";
    this.subHighPass.frequency.value = 30;
    this.subHighPass.Q.value = 0.7;

    // 2. Subtle 3-band mastering EQ (warmth + clear midrange + gentle air)
    this.lowShelf = ctx.createBiquadFilter();
    this.lowShelf.type = "lowshelf";
    this.lowShelf.frequency.value = 115;
    this.lowShelf.gain.value = 1.2;

    this.midDip = ctx.createBiquadFilter();
    this.midDip.type = "peaking";
    this.midDip.frequency.value = 380;
    this.midDip.Q.value = 1.1;
    this.midDip.gain.value = -1.2;

    this.highShelf = ctx.createBiquadFilter();
    this.highShelf.type = "highshelf";
    this.highShelf.frequency.value = 6500;
    this.highShelf.gain.value = 1.0;

    // 3. Musical Glue Compressor
    this.glueCompressor = ctx.createDynamicsCompressor();
    this.glueCompressor.threshold.setValueAtTime(-13, ctx.currentTime);
    this.glueCompressor.knee.setValueAtTime(14, ctx.currentTime);
    this.glueCompressor.ratio.setValueAtTime(4, ctx.currentTime);
    this.glueCompressor.attack.setValueAtTime(0.008, ctx.currentTime);
    this.glueCompressor.release.setValueAtTime(0.18, ctx.currentTime);

    // 4. Transparent Brickwall Limiter preventing digital clipping at 0 dBFS
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-1.5, ctx.currentTime);
    this.limiter.knee.setValueAtTime(0, ctx.currentTime);
    this.limiter.ratio.setValueAtTime(20, ctx.currentTime);
    this.limiter.attack.setValueAtTime(0.001, ctx.currentTime);
    this.limiter.release.setValueAtTime(0.06, ctx.currentTime);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0.0001 : this.volume;

    this.input
      .connect(this.subHighPass)
      .connect(this.lowShelf)
      .connect(this.midDip)
      .connect(this.highShelf)
      .connect(this.glueCompressor)
      .connect(this.limiter)
      .connect(this.masterGain)
      .connect(destination);
  }

  public setMuted(muted: boolean, now: number): void {
    this.muted = muted;
    this.masterGain.gain.setTargetAtTime(
      muted ? 0.0001 : this.volume,
      now,
      0.018
    );
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setVolume(vol: number, now: number): void {
    this.volume = Math.max(0.0001, Math.min(1, vol));
    if (!this.muted) {
      this.masterGain.gain.setTargetAtTime(this.volume, now, 0.02);
    }
  }
}
