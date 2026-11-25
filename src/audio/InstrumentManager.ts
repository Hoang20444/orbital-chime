import type { ScaleId } from "../engine/types.ts";
import { STAGE_W } from "../theme/tokens.ts";
import { AudioContextManager } from "./AudioContextManager.ts";
import { StereoDelayBus } from "./effects/delay.ts";
import { MasterProcessor } from "./effects/dynamics.ts";
import { StudioReverbBus } from "./effects/reverb.ts";
import { triggerAcousticBar } from "./instruments/acousticBars.ts";
import { triggerDrumHit } from "./instruments/drums.ts";
import { triggerAcousticPiano, triggerMusicBox } from "./instruments/piano.ts";
import { triggerSubBass, triggerSynthLead } from "./instruments/synthVoices.ts";
import type {
  DrumId,
  DrumTriggerOptions,
  MelodicInstrumentId,
  NoteTriggerOptions,
} from "./instruments/types.ts";
import { SampleManager } from "./SampleManager.ts";
import { midiToFreq, SCALES } from "./scales.ts";
import { TrackMixer, type TrackId } from "./TrackMixer.ts";
import { VoiceManager } from "./VoiceManager.ts";

export interface AudioStats {
  activeVoices: number;
  maxVoices: number;
  stolenVoices: number;
  loadedSamples: number;
  totalSamples: number;
  reverbEnabled: boolean;
  delayEnabled: boolean;
  lowCpuMode: boolean;
}

export class InstrumentManager {
  public readonly contextManager = new AudioContextManager();
  public readonly voiceManager = new VoiceManager();
  public readonly sampleManager = new SampleManager();

  private initializedForCtx: AudioContext | null = null;
  private dryBus: GainNode | null = null;
  private reverbBus: StudioReverbBus | null = null;
  private delayBus: StereoDelayBus | null = null;
  private masterProcessor: MasterProcessor | null = null;
  private mixer: TrackMixer | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private muted = false;
  private bpm = 104;
  private reverbEnabled = true;
  private delayEnabled = true;
  private lowCpuMode = false;
  private samplesPreloaded = false;

  public unlock(): AudioContext | null {
    const ctx = this.contextManager.unlock();
    if (!ctx) return null;
    this.ensureGraph(ctx);

    if (!this.samplesPreloaded && typeof fetch !== "undefined") {
      this.samplesPreloaded = true;
      void this.sampleManager.preloadGroup(ctx, "percussion");
      void this.sampleManager.preloadGroup(ctx, "piano");
    }
    return ctx;
  }

  public initWithContext(ctx: AudioContext): void {
    this.contextManager.setCustomContext(ctx);
    this.ensureGraph(ctx);
  }

  private ensureGraph(ctx: AudioContext): void {
    if (this.initializedForCtx === ctx) return;
    this.initializedForCtx = ctx;

    const master = new MasterProcessor(ctx, ctx.destination);
    master.setMuted(this.muted, ctx.currentTime);

    const dry = ctx.createGain();
    dry.gain.value = 0.85;
    dry.connect(master.input);

    const reverb = new StudioReverbBus(ctx, master.input);
    reverb.setEnabled(this.reverbEnabled, ctx.currentTime);

    const delay = new StereoDelayBus(ctx, master.input);
    delay.setBpm(this.bpm, ctx.currentTime);
    delay.setEnabled(this.delayEnabled, ctx.currentTime);

    const mixer = new TrackMixer(ctx, dry, reverb.input, delay.input);

    const sampleRate = ctx.sampleRate || 44100;
    const noiseLen = Math.max(1, Math.floor(sampleRate * 0.12));
    const nb = ctx.createBuffer(1, noiseLen, sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      nd[i] = Math.random() * 2 - 1;
    }

    this.masterProcessor = master;
    this.dryBus = dry;
    this.reverbBus = reverb;
    this.delayBus = delay;
    this.mixer = mixer;
    this.noiseBuffer = nb;
  }

  public getCurrentTime(): number {
    return this.contextManager.getCurrentTime();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.contextManager.getContext();
    if (ctx && this.masterProcessor) {
      this.masterProcessor.setMuted(muted, ctx.currentTime);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setBpm(bpm: number): void {
    this.bpm = bpm;
    const ctx = this.contextManager.getContext();
    if (ctx && this.delayBus) {
      this.delayBus.setBpm(bpm, ctx.currentTime);
    }
  }

  public setReverbEnabled(enabled: boolean): void {
    this.reverbEnabled = enabled;
    const ctx = this.contextManager.getContext();
    if (ctx && this.reverbBus) {
      this.reverbBus.setEnabled(enabled, ctx.currentTime);
    }
  }

  public setDelayEnabled(enabled: boolean): void {
    this.delayEnabled = enabled;
    const ctx = this.contextManager.getContext();
    if (ctx && this.delayBus) {
      this.delayBus.setEnabled(enabled, ctx.currentTime);
    }
  }

  public setLowCpuMode(enabled: boolean): void {
    this.lowCpuMode = enabled;
    this.voiceManager.setMaxVoices(enabled ? 14 : 28);
    if (enabled) {
      this.setDelayEnabled(false);
    }
  }

  public getMixer(): TrackMixer | null {
    return this.mixer;
  }

  public getStats(): AudioStats {
    const ctx = this.contextManager.getContext();
    if (ctx) {
      this.voiceManager.pruneExpired(ctx.currentTime);
    }
    return {
      activeVoices: this.voiceManager.getActiveCount(),
      maxVoices: this.voiceManager.getMaxVoices(),
      stolenVoices: this.voiceManager.getTotalStolen(),
      loadedSamples: this.sampleManager.getLoadedCount(),
      totalSamples: this.sampleManager.getTotalCount(),
      reverbEnabled: this.reverbEnabled,
      delayEnabled: this.delayEnabled,
      lowCpuMode: this.lowCpuMode,
    };
  }

  public worldXToPan(worldX: number): number {
    return Math.max(-0.75, Math.min(0.75, ((worldX / STAGE_W) * 2 - 1) * 0.75));
  }

  public playNote(
    instrument: MelodicInstrumentId,
    opts: NoteTriggerOptions
  ): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.mixer || !this.noiseBuffer || this.muted) return;

    const trackId: TrackId = instrument;
    const dest = this.mixer.getTrackInput(trackId);

    if (
      instrument === "marimba" ||
      instrument === "brass" ||
      instrument === "ceramic" ||
      instrument === "bass"
    ) {
      triggerAcousticBar(
        ctx,
        dest,
        this.voiceManager,
        this.noiseBuffer,
        instrument,
        opts
      );
    } else if (instrument === "piano") {
      triggerAcousticPiano(
        ctx,
        dest,
        this.voiceManager,
        this.sampleManager,
        opts
      );
    } else if (instrument === "musicBox") {
      triggerMusicBox(ctx, dest, this.voiceManager, opts);
    } else if (instrument === "synthLead") {
      triggerSynthLead(ctx, dest, this.voiceManager, opts);
    } else if (instrument === "subBass") {
      triggerSubBass(ctx, dest, this.voiceManager, opts);
    }
  }

  public playDrum(drum: DrumId, opts: DrumTriggerOptions): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.mixer || !this.noiseBuffer || this.muted) return;

    const dest = this.mixer.getTrackInput("drums");
    triggerDrumHit(
      ctx,
      dest,
      this.voiceManager,
      this.sampleManager,
      this.noiseBuffer,
      drum,
      opts
    );
  }

  public playBumper(worldX: number, speed: number, when?: number): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.mixer || this.muted) return;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);
    const vel = Math.max(0.28, Math.min(1, speed / 550));

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.worldXToPan(worldX), t);

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(265, t + 0.055);
    osc.frequency.exponentialRampToValueAtTime(172, t + 0.16);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    const endTime = t + 0.2;
    osc.connect(g).connect(panner).connect(this.mixer.getTrackInput("ui"));
    osc.start(t);
    osc.stop(endTime);

    this.voiceManager.allocateVoice(
      ctx,
      t,
      endTime,
      g,
      [osc, g, panner],
      [osc]
    );
  }

  public playSplitter(worldX: number, when?: number): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.mixer || this.muted) return;
    const t = Math.max(ctx.currentTime, when ?? ctx.currentTime);

    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(this.worldXToPan(worldX), t);

    const masterG = ctx.createGain();
    masterG.gain.setValueAtTime(1, t);
    masterG.connect(panner).connect(this.mixer.getTrackInput("ceramic"));

    const nodes: AudioNode[] = [masterG, panner];
    const sources: AudioScheduledSourceNode[] = [];

    [1046.5, 1567.98].forEach((freq, idx) => {
      const s = t + idx * 0.02;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, s);
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.075, s + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      osc.connect(g).connect(masterG);
      osc.start(s);
      osc.stop(s + 0.38);
      nodes.push(osc, g);
      sources.push(osc);
    });

    this.voiceManager.allocateVoice(ctx, t, t + 0.42, masterG, nodes, sources);
  }

  public playRingCharge(
    worldX: number,
    ringIndex: number,
    scaleId: ScaleId,
    when?: number
  ): void {
    const scale = SCALES[scaleId] ?? SCALES.c_pentatonic;
    const midi = scale[(ringIndex * 2 + 4) % scale.length];
    this.playNote("musicBox", {
      freq: midiToFreq(midi),
      velocity: 0.65,
      when,
      duration: 0.85,
      pan: this.worldXToPan(worldX),
    });
  }

  public playWinArpeggio(scaleId: ScaleId): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || this.muted) return;
    const scale = SCALES[scaleId] ?? SCALES.c_pentatonic;
    const indices = [0, 2, 4, 6, 9];
    const t0 = ctx.currentTime;
    indices.forEach((deg, idx) => {
      this.playNote("piano", {
        freq: midiToFreq(scale[deg % scale.length]),
        velocity: 0.55 + idx * 0.05,
        when: t0 + idx * 0.085,
        duration: 1.35,
        pan: (idx - 2) * 0.18,
      });
    });
  }

  public playUiTick(): void {
    const ctx = this.contextManager.getContext();
    if (!ctx || !this.dryBus || this.muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(640, t);
    osc.frequency.exponentialRampToValueAtTime(380, t + 0.018);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
    osc.connect(g).connect(this.dryBus);
    osc.start(t);
    osc.stop(t + 0.025);

    this.voiceManager.allocateVoice(ctx, t, t + 0.025, g, [osc, g], [osc]);
  }
}
