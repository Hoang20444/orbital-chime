import type { MaterialType, ScaleId } from "../engine/types.ts";
import { InstrumentManager, type AudioStats } from "./InstrumentManager.ts";
import type { DrumId, MelodicInstrumentId } from "./instruments/types.ts";
import { lengthToNote, midiToFreq, midiToName } from "./scales.ts";

class SynthEngineFacade {
  public readonly manager = new InstrumentManager();

  public unlock(): void {
    this.manager.unlock();
  }

  public getCurrentTime(): number {
    return this.manager.getCurrentTime();
  }

  public setMuted(muted: boolean): void {
    this.manager.setMuted(muted);
  }

  public isMuted(): boolean {
    return this.manager.isMuted();
  }

  public setBpm(bpm: number): void {
    this.manager.setBpm(bpm);
  }

  public setReverbEnabled(enabled: boolean): void {
    this.manager.setReverbEnabled(enabled);
  }

  public setDelayEnabled(enabled: boolean): void {
    this.manager.setDelayEnabled(enabled);
  }

  public setLowCpuMode(enabled: boolean): void {
    this.manager.setLowCpuMode(enabled);
  }

  public getStats(): AudioStats {
    return this.manager.getStats();
  }

  public playBarHit(
    material: MaterialType,
    length: number,
    scaleId: ScaleId,
    worldX: number,
    speed: number,
    when?: number,
    override?: {
      fixedMidi?: number;
      instrumentOverride?: MelodicInstrumentId;
      drumOverride?: DrumId;
      noteLabel?: string;
    }
  ): string {
    const velocity = Math.max(0.24, Math.min(1, speed / 480));
    const pan = this.manager.worldXToPan(worldX);

    if (override?.drumOverride) {
      this.manager.playDrum(override.drumOverride, {
        velocity: Math.max(0.45, velocity),
        when,
        pan,
      });
      return override.noteLabel ?? override.drumOverride.toUpperCase();
    }

    if (override?.fixedMidi !== undefined) {
      const freq = midiToFreq(override.fixedMidi);
      const label = override.noteLabel ?? midiToName(override.fixedMidi);
      const inst = override.instrumentOverride ?? material;
      this.manager.playNote(inst, {
        freq,
        velocity: Math.max(0.38, velocity),
        duration: 0.42,
        when,
        pan,
      });
      return label;
    }

    const note = lengthToNote(length, scaleId, material);
    this.manager.playNote(material, {
      freq: note.freq,
      velocity,
      when,
      pan,
    });
    return note.noteName;
  }

  public playBumperHit(worldX: number, speed: number, when?: number): void {
    this.manager.playBumper(worldX, speed, when);
  }

  public playSplitterChime(worldX: number, when?: number): void {
    this.manager.playSplitter(worldX, when);
  }

  public playRingCharge(
    worldX: number,
    ringIndex: number,
    scaleId: ScaleId,
    when?: number
  ): void {
    this.manager.playRingCharge(worldX, ringIndex, scaleId, when);
  }

  public playWinArpeggio(scaleId: ScaleId): void {
    this.manager.playWinArpeggio(scaleId);
  }

  public playNotePreviewTick(
    length: number,
    scaleId: ScaleId,
    material: MaterialType,
    worldX: number
  ): void {
    const note = lengthToNote(length, scaleId, material);
    this.manager.playNote(material, {
      freq: note.freq,
      velocity: 0.34,
      duration: 0.18,
      pan: this.manager.worldXToPan(worldX),
    });
  }

  public playUiTick(): void {
    this.manager.playUiTick();
  }

  public auditionInstrument(
    instrument: MelodicInstrumentId,
    velocity: number
  ): void {
    this.unlock();
    const baseFreq =
      instrument === "bass" || instrument === "subBass" ? 110 : 392;
    this.manager.playNote(instrument, { freq: baseFreq, velocity });
  }

  public auditionDrum(drum: DrumId, velocity: number): void {
    this.unlock();
    this.manager.playDrum(drum, { velocity });
  }
}

export const synthEngine = new SynthEngineFacade();
