import React from "react";
import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import { midiToFreq, midiToName } from "../audio/scales.ts";
import { synthEngine } from "../audio/synthEngine.ts";
import { barLength } from "../engine/physics.ts";
import type { BarPiece, ScaleId } from "../engine/types.ts";
import type { Locale } from "../i18n.ts";

interface BarInspectorPillProps {
  locale: Locale;
  bar: BarPiece;
  scaleId: ScaleId;
  onUpdateBar: (patch: Partial<BarPiece>) => void;
}

const VOICES: { id: "default" | MelodicInstrumentId; labelEn: string; labelVi: string }[] = [
  { id: "default", labelEn: "Material", labelVi: "Mặc định thanh" },
  { id: "piano", labelEn: "Piano", labelVi: "Piano" },
  { id: "marimba", labelEn: "Maple", labelVi: "Gỗ Maple" },
  { id: "ceramic", labelEn: "Ceramic", labelVi: "Men Gốm" },
  { id: "brass", labelEn: "Brass", labelVi: "Đồng Thau" },
  { id: "bass", labelEn: "Bass", labelVi: "Bass" },
  { id: "musicBox", labelEn: "Music Box", labelVi: "Hộp Nhạc" },
  { id: "synthLead", labelEn: "Synth Lead", labelVi: "Synth Lead" },
  { id: "subBass", labelEn: "Sub Bass", labelVi: "Sub Bass" },
];

const DRUM_OPTIONS: { id: DrumId; label: string }[] = [
  { id: "kick", label: "KICK" },
  { id: "snare", label: "SNARE" },
  { id: "clap", label: "CLAP" },
  { id: "hihat_closed", label: "HAT" },
  { id: "hihat_open", label: "OHAT" },
  { id: "shaker", label: "SHK" },
];

const MIDI_MIN = 36; // C2
const MIDI_MAX = 84; // C6

export const BarInspectorPill: React.FC<BarInspectorPillProps> = ({
  locale,
  bar,
  scaleId,
  onUpdateBar,
}) => {
  const pitchValue = bar.drumOverride
    ? `drum:${bar.drumOverride}`
    : bar.fixedMidi !== undefined
      ? `midi:${bar.fixedMidi}`
      : "auto";

  const voiceValue = bar.instrumentOverride ?? "default";

  const audition = (patch: Partial<BarPiece>) => {
    const merged: BarPiece = { ...bar, ...patch };
    synthEngine.unlock();
    if (merged.drumOverride) {
      synthEngine.manager.playDrum(merged.drumOverride, { velocity: 0.8 });
    } else if (merged.fixedMidi !== undefined) {
      synthEngine.manager.playNote(merged.instrumentOverride ?? merged.material, {
        freq: midiToFreq(merged.fixedMidi),
        velocity: 0.78,
        duration: 0.42,
      });
    } else {
      synthEngine.playBarHit(
        merged.material,
        barLength(merged),
        scaleId,
        (merged.ax + merged.bx) * 0.5,
        360,
        undefined,
        { instrumentOverride: merged.instrumentOverride }
      );
    }
  };

  const handlePitchSelect = (val: string) => {
    if (val === "auto") {
      const patch: Partial<BarPiece> = {
        fixedMidi: undefined,
        drumOverride: undefined,
        noteLabel: undefined,
      };
      onUpdateBar(patch);
      audition(patch);
    } else if (val.startsWith("drum:")) {
      const drum = val.slice(5) as DrumId;
      const label = DRUM_OPTIONS.find((d) => d.id === drum)?.label ?? drum.toUpperCase();
      const patch: Partial<BarPiece> = {
        fixedMidi: undefined,
        drumOverride: drum,
        noteLabel: label,
      };
      onUpdateBar(patch);
      audition(patch);
    } else if (val.startsWith("midi:")) {
      const midi = Number(val.slice(5));
      const patch: Partial<BarPiece> = {
        fixedMidi: midi,
        drumOverride: undefined,
        noteLabel: midiToName(midi),
      };
      onUpdateBar(patch);
      audition(patch);
    }
  };

  const stepSemitone = (delta: number) => {
    const base = bar.fixedMidi ?? 60;
    const next = Math.max(MIDI_MIN, Math.min(MIDI_MAX, base + delta));
    const patch: Partial<BarPiece> = {
      fixedMidi: next,
      drumOverride: undefined,
      noteLabel: midiToName(next),
    };
    onUpdateBar(patch);
    audition(patch);
  };

  const handleVoiceSelect = (val: string) => {
    const patch: Partial<BarPiece> = {
      instrumentOverride: val === "default" ? undefined : (val as MelodicInstrumentId),
    };
    onUpdateBar(patch);
    audition(patch);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 90,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 19,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        backgroundColor: "#F7F8F5",
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        boxShadow: "0 8px 24px rgba(28, 35, 33, 0.1)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--slate)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {locale === "vi" ? "Nốt" : "Note"}
      </span>

      <button
        type="button"
        className="hw-btn"
        style={{ padding: "3px 8px", fontSize: 12, fontWeight: 700 }}
        onClick={() => stepSemitone(-1)}
        title={locale === "vi" ? "Giảm 1 nửa cung" : "Down 1 semitone"}
      >
        −
      </button>

      <select
        value={pitchValue}
        onChange={(e) => handlePitchSelect(e.target.value)}
        className="hw-select"
        style={{ fontSize: 12, padding: "4px 8px", fontFamily: "var(--font-mono)" }}
      >
        <option value="auto">
          {locale === "vi" ? "Tự động (theo độ dài)" : "Auto (Length)"}
        </option>
        <optgroup label={locale === "vi" ? "Cao độ (C2–C6)" : "Chromatic (C2–C6)"}>
          {Array.from({ length: MIDI_MAX - MIDI_MIN + 1 }, (_, i) => MIDI_MAX - i).map(
            (midi) => (
              <option key={midi} value={`midi:${midi}`}>
                {midiToName(midi)}
              </option>
            )
          )}
        </optgroup>
        <optgroup label={locale === "vi" ? "Bộ gõ" : "Drums"}>
          {DRUM_OPTIONS.map((d) => (
            <option key={d.id} value={`drum:${d.id}`}>
              {d.label}
            </option>
          ))}
        </optgroup>
      </select>

      <button
        type="button"
        className="hw-btn"
        style={{ padding: "3px 8px", fontSize: 12, fontWeight: 700 }}
        onClick={() => stepSemitone(1)}
        title={locale === "vi" ? "Tăng 1 nửa cung" : "Up 1 semitone"}
      >
        +
      </button>

      <div style={{ width: 1, height: 18, backgroundColor: "var(--border)" }} />

      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--slate)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {locale === "vi" ? "Âm sắc" : "Voice"}
      </span>

      <select
        value={voiceValue}
        onChange={(e) => handleVoiceSelect(e.target.value)}
        className="hw-select"
        style={{ fontSize: 12, padding: "4px 8px" }}
        disabled={Boolean(bar.drumOverride)}
      >
        {VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {locale === "vi" ? v.labelVi : v.labelEn}
          </option>
        ))}
      </select>
    </div>
  );
};
