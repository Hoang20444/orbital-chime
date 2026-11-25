export type SampleGroup = "piano" | "percussion";

export type SampleKey =
  | "piano_c3"
  | "piano_c4"
  | "piano_c5"
  | "kick"
  | "snare"
  | "hihat_closed"
  | "hihat_open"
  | "clap"
  | "shaker";

const SAMPLE_URLS: Record<SampleKey, string> = {
  piano_c3: "./samples/piano/C3.wav",
  piano_c4: "./samples/piano/C4.wav",
  piano_c5: "./samples/piano/C5.wav",
  kick: "./samples/percussion/kick.wav",
  snare: "./samples/percussion/snare.wav",
  hihat_closed: "./samples/percussion/hihat-closed.wav",
  hihat_open: "./samples/percussion/hihat-open.wav",
  clap: "./samples/percussion/clap.wav",
  shaker: "./samples/percussion/shaker.wav",
};

const GROUP_KEYS: Record<SampleGroup, SampleKey[]> = {
  piano: ["piano_c3", "piano_c4", "piano_c5"],
  percussion: ["kick", "snare", "hihat_closed", "hihat_open", "clap", "shaker"],
};

export class SampleManager {
  private cache = new Map<SampleKey, AudioBuffer>();
  private inFlight = new Map<SampleKey, Promise<AudioBuffer | null>>();

  public getBuffer(key: SampleKey): AudioBuffer | null {
    return this.cache.get(key) ?? null;
  }

  public getLoadedCount(): number {
    return this.cache.size;
  }

  public getTotalCount(): number {
    return Object.keys(SAMPLE_URLS).length;
  }

  public async loadSample(
    ctx: AudioContext,
    key: SampleKey
  ): Promise<AudioBuffer | null> {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    if (typeof fetch === "undefined") {
      return null;
    }

    const promise = (async () => {
      try {
        const res = await fetch(SAMPLE_URLS[key]);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        this.cache.set(key, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  public preloadGroup(ctx: AudioContext, group: SampleGroup): Promise<void> {
    const keys = GROUP_KEYS[group];
    return Promise.all(keys.map((k) => this.loadSample(ctx, k))).then(() => undefined);
  }
}
