export class StereoDelayBus {
  public readonly input: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly feedback: GainNode;
  private readonly dampingFilter: BiquadFilterNode;
  private readonly wetGain: GainNode;
  private enabled = true;
  private bpm = 104;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.delayL = ctx.createDelay(2.0);
    this.delayR = ctx.createDelay(2.0);

    this.dampingFilter = ctx.createBiquadFilter();
    this.dampingFilter.type = "lowpass";
    this.dampingFilter.frequency.value = 2800;
    this.dampingFilter.Q.value = 0.7;

    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.32;

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 0.9;

    // Gentle stereo ping-pong style delay (dotted eighth L, quarter R)
    this.input.connect(this.delayL);
    this.delayL.connect(this.dampingFilter);
    this.dampingFilter.connect(this.delayR);
    this.delayR.connect(this.feedback);
    this.feedback.connect(this.delayL);

    this.delayL.connect(this.wetGain);
    this.delayR.connect(this.wetGain);
    this.wetGain.connect(destination);

    this.applyDelayTimes(ctx.currentTime);
  }

  private applyDelayTimes(now: number): void {
    const beatSec = 60 / Math.max(40, Math.min(200, this.bpm));
    const tL = Math.min(1.5, beatSec * 0.75); // dotted eighth
    const tR = Math.min(1.5, beatSec * 0.5); // eighth
    this.delayL.delayTime.setTargetAtTime(tL, now, 0.03);
    this.delayR.delayTime.setTargetAtTime(tR, now, 0.03);
  }

  public setBpm(bpm: number, now: number): void {
    this.bpm = bpm;
    this.applyDelayTimes(now);
  }

  public setEnabled(enabled: boolean, now: number): void {
    this.enabled = enabled;
    this.wetGain.gain.setTargetAtTime(enabled ? 0.9 : 0.0001, now, 0.025);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }
}
