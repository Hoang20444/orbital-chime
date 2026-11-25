export type TrackId =
  | "marimba"
  | "brass"
  | "ceramic"
  | "bass"
  | "piano"
  | "musicBox"
  | "synthLead"
  | "subBass"
  | "drums"
  | "ui";

export interface TrackConfig {
  volume: number;
  reverbSend: number;
  delaySend: number;
}

const DEFAULT_TRACKS: Record<TrackId, TrackConfig> = {
  marimba: { volume: 0.95, reverbSend: 0.24, delaySend: 0.14 },
  brass: { volume: 0.88, reverbSend: 0.32, delaySend: 0.18 },
  ceramic: { volume: 0.90, reverbSend: 0.30, delaySend: 0.16 },
  bass: { volume: 0.95, reverbSend: 0.08, delaySend: 0.04 },
  piano: { volume: 0.92, reverbSend: 0.26, delaySend: 0.12 },
  musicBox: { volume: 0.85, reverbSend: 0.34, delaySend: 0.22 },
  synthLead: { volume: 0.80, reverbSend: 0.22, delaySend: 0.24 },
  subBass: { volume: 0.94, reverbSend: 0.02, delaySend: 0.0001 },
  drums: { volume: 0.92, reverbSend: 0.10, delaySend: 0.03 },
  ui: { volume: 0.80, reverbSend: 0.08, delaySend: 0.0001 },
};

export interface TrackStrip {
  id: TrackId;
  input: GainNode;
  muteGain: GainNode;
  reverbGain: GainNode;
  delayGain: GainNode;
  muted: boolean;
  solo: boolean;
  volume: number;
}

export class TrackMixer {
  private strips = new Map<TrackId, TrackStrip>();
  private dryDestination: AudioNode;
  private reverbDestination: AudioNode;
  private delayDestination: AudioNode;
  private ctx: AudioContext;

  constructor(
    ctx: AudioContext,
    dryDestination: AudioNode,
    reverbDestination: AudioNode,
    delayDestination: AudioNode
  ) {
    this.ctx = ctx;
    this.dryDestination = dryDestination;
    this.reverbDestination = reverbDestination;
    this.delayDestination = delayDestination;

    (Object.keys(DEFAULT_TRACKS) as TrackId[]).forEach((id) => {
      const cfg = DEFAULT_TRACKS[id];
      const input = ctx.createGain();
      input.gain.value = cfg.volume;

      const muteGain = ctx.createGain();
      muteGain.gain.value = 1;

      const reverbGain = ctx.createGain();
      reverbGain.gain.value = cfg.reverbSend;

      const delayGain = ctx.createGain();
      delayGain.gain.value = cfg.delaySend;

      input.connect(muteGain);
      muteGain.connect(this.dryDestination);
      muteGain.connect(reverbGain);
      reverbGain.connect(this.reverbDestination);
      muteGain.connect(delayGain);
      delayGain.connect(this.delayDestination);

      this.strips.set(id, {
        id,
        input,
        muteGain,
        reverbGain,
        delayGain,
        muted: false,
        solo: false,
        volume: cfg.volume,
      });
    });
  }

  public getTrackInput(id: TrackId): AudioNode {
    return this.strips.get(id)?.input ?? this.dryDestination;
  }

  public setTrackVolume(id: TrackId, vol: number): void {
    const strip = this.strips.get(id);
    if (!strip) return;
    strip.volume = Math.max(0.0001, Math.min(1.2, vol));
    strip.input.gain.setTargetAtTime(strip.volume, this.ctx.currentTime, 0.02);
  }

  public setTrackMute(id: TrackId, muted: boolean): void {
    const strip = this.strips.get(id);
    if (!strip) return;
    strip.muted = muted;
    this.recomputeMutes();
  }

  public setTrackSolo(id: TrackId, solo: boolean): void {
    const strip = this.strips.get(id);
    if (!strip) return;
    strip.solo = solo;
    this.recomputeMutes();
  }

  private recomputeMutes(): void {
    const anySolo = Array.from(this.strips.values()).some((s) => s.solo);
    const now = this.ctx.currentTime;
    for (const strip of this.strips.values()) {
      const audible = anySolo ? strip.solo && !strip.muted : !strip.muted;
      strip.muteGain.gain.setTargetAtTime(audible ? 1 : 0.0001, now, 0.02);
    }
  }
}
