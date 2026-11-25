export interface ManagedVoice {
  id: number;
  startTime: number;
  endTime: number;
  envGain: GainNode;
  nodes: AudioNode[];
  sources: Array<AudioScheduledSourceNode>;
  finished: boolean;
}

export class VoiceManager {
  private maxVoices = 28;
  private nextId = 1;
  private voices: ManagedVoice[] = [];
  private totalStolen = 0;

  public setMaxVoices(cap: number): void {
    this.maxVoices = Math.max(6, Math.min(64, cap));
  }

  public getMaxVoices(): number {
    return this.maxVoices;
  }

  public getActiveCount(): number {
    return this.voices.length;
  }

  public getTotalStolen(): number {
    return this.totalStolen;
  }

  public allocateVoice(
    ctx: AudioContext,
    startTime: number,
    endTime: number,
    envGain: GainNode,
    nodes: AudioNode[],
    sources: Array<AudioScheduledSourceNode>
  ): ManagedVoice {
    this.pruneExpired(ctx.currentTime);

    while (this.voices.length >= this.maxVoices) {
      this.stealOldest(ctx);
    }

    const voice: ManagedVoice = {
      id: this.nextId++,
      startTime,
      endTime,
      envGain,
      nodes,
      sources,
      finished: false,
    };

    this.voices.push(voice);

    const primary = sources[0];
    if (primary) {
      primary.onended = () => {
        this.releaseVoice(voice);
      };
    }

    return voice;
  }

  public pruneExpired(now: number): void {
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const v = this.voices[i];
      if (v.finished || now > v.endTime + 0.06) {
        this.releaseVoice(v);
      }
    }
  }

  private stealOldest(ctx: AudioContext): void {
    const oldest = this.voices[0];
    if (!oldest) return;
    this.totalStolen++;

    const now = ctx.currentTime;
    try {
      oldest.envGain.gain.cancelScheduledValues(now);
      oldest.envGain.gain.setValueAtTime(
        Math.max(0.0001, oldest.envGain.gain.value || 0.05),
        now
      );
      oldest.envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
      for (const src of oldest.sources) {
        try {
          src.stop(now + 0.015);
        } catch {
          // ignore already stopped
        }
      }
    } catch {
      // ignore param errors on mock/disposed nodes
    }
    this.releaseVoice(oldest);
  }

  public releaseVoice(voice: ManagedVoice): void {
    if (voice.finished) return;
    voice.finished = true;

    const idx = this.voices.indexOf(voice);
    if (idx >= 0) {
      this.voices.splice(idx, 1);
    }

    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // ignore already disconnected
      }
    }
  }
}
