import React, { useEffect, useState } from "react";
import type { AudioStats } from "../audio/InstrumentManager.ts";
import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import { synthEngine } from "../audio/synthEngine.ts";
import type { Locale } from "../i18n.ts";

interface AudioBenchPopoverProps {
  locale: Locale;
  onClose: () => void;
}

const MELODIC_ITEMS: Array<{ id: MelodicInstrumentId; en: string; vi: string }> = [
  { id: "marimba", en: "Maple", vi: "Gỗ" },
  { id: "brass", en: "Brass", vi: "Đồng" },
  { id: "ceramic", en: "Ceramic", vi: "Gốm" },
  { id: "bass", en: "Felt Bass", vi: "Trầm" },
  { id: "piano", en: "Piano", vi: "Piano" },
  { id: "musicBox", en: "Music Box", vi: "Hộp nhạc" },
  { id: "synthLead", en: "Synth Lead", vi: "Lead" },
  { id: "subBass", en: "Sub Bass", vi: "Sub Bass" },
];

const DRUM_ITEMS: Array<{ id: DrumId; label: string }> = [
  { id: "kick", label: "Kick" },
  { id: "snare", label: "Snare" },
  { id: "hihat_closed", label: "Hat C" },
  { id: "hihat_open", label: "Hat O" },
  { id: "clap", label: "Clap" },
  { id: "shaker", label: "Shaker" },
];

export const AudioBenchPopover: React.FC<AudioBenchPopoverProps> = ({
  locale,
  onClose,
}) => {
  const [vel, setVel] = useState(0.72);
  const [stats, setStats] = useState<AudioStats>(() => synthEngine.getStats());

  useEffect(() => {
    const id = window.setInterval(() => {
      setStats(synthEngine.getStats());
    }, 200);
    return () => window.clearInterval(id);
  }, []);

  const refresh = () => setStats(synthEngine.getStats());

  const runStressChord = () => {
    synthEngine.unlock();
    const ctx = synthEngine.manager.contextManager.getContext();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Chord + Sub Bass + Drums + Chimes simultaneously to verify headroom & limiter
    [261.63, 329.63, 392.0, 493.88].forEach((freq, idx) => {
      synthEngine.manager.playNote("piano", {
        freq,
        velocity: vel,
        when: t + idx * 0.015,
        pan: (idx - 1.5) * 0.3,
      });
    });
    synthEngine.manager.playNote("subBass", { freq: 65.41, velocity: vel, when: t });
    synthEngine.manager.playDrum("kick", { velocity: vel, when: t });
    synthEngine.manager.playDrum("snare", { velocity: vel * 0.85, when: t + 0.18 });
    synthEngine.manager.playDrum("hihat_closed", { velocity: vel * 0.7, when: t + 0.09 });
    synthEngine.manager.playNote("brass", { freq: 587.33, velocity: vel, when: t + 0.12, pan: 0.45 });
    refresh();
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 8px)",
        right: 0,
        width: 318,
        maxWidth: "92vw",
        backgroundColor: "var(--paper)",
        border: "1px solid var(--border-strong)",
        borderRadius: 13,
        padding: 12,
        boxShadow: "0 12px 26px rgba(28,35,33,0.12)",
        zIndex: 35,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>
          {locale === "vi" ? "Phòng Thử Âm Thanh" : "Hybrid Audio Bench"}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            fontSize: 14,
            fontWeight: 700,
            color: "var(--slate)",
            padding: "0 4px",
          }}
        >
          ×
        </button>
      </div>

      {/* Bus & CPU toggles */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`hw-btn ${stats.reverbEnabled ? "is-selected" : ""}`}
          style={{ padding: "4px 8px", fontSize: 11.5 }}
          onClick={() => {
            synthEngine.unlock();
            synthEngine.setReverbEnabled(!stats.reverbEnabled);
            refresh();
          }}
        >
          Reverb
        </button>
        <button
          type="button"
          className={`hw-btn ${stats.delayEnabled ? "is-selected" : ""}`}
          style={{ padding: "4px 8px", fontSize: 11.5 }}
          onClick={() => {
            synthEngine.unlock();
            synthEngine.setDelayEnabled(!stats.delayEnabled);
            refresh();
          }}
        >
          Delay
        </button>
        <button
          type="button"
          className={`hw-btn ${stats.lowCpuMode ? "is-selected" : ""}`}
          style={{ padding: "4px 8px", fontSize: 11.5 }}
          onClick={() => {
            synthEngine.unlock();
            synthEngine.setLowCpuMode(!stats.lowCpuMode);
            refresh();
          }}
        >
          Low CPU
        </button>
      </div>

      {/* Velocity selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11.5, color: "var(--slate)", fontWeight: 600 }}>
          Velocity
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { label: "Low", val: 0.28 },
            { label: "Med", val: 0.68 },
            { label: "High", val: 1.0 },
          ].map((v) => (
            <button
              key={v.label}
              type="button"
              className={`hw-btn ${Math.abs(vel - v.val) < 0.05 ? "is-selected" : ""}`}
              style={{ padding: "3px 8px", fontSize: 11 }}
              onClick={() => setVel(v.val)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Melodic Instruments */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
        {MELODIC_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="hw-btn"
            style={{ padding: "5px 8px", fontSize: 11.5, textAlign: "left" }}
            onClick={() => {
              synthEngine.auditionInstrument(item.id, vel);
              refresh();
            }}
          >
            {locale === "vi" ? item.vi : item.en}
          </button>
        ))}
      </div>

      {/* Drums */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
        {DRUM_ITEMS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="hw-btn"
            style={{ padding: "4px 6px", fontSize: 11 }}
            onClick={() => {
              synthEngine.auditionDrum(d.id, vel);
              refresh();
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="hw-btn is-accent"
        style={{ padding: "6px 10px", fontSize: 12 }}
        onClick={runStressChord}
      >
        {locale === "vi" ? "Test Hợp Âm + Trống" : "Test Chord + Drums"}
      </button>

      <div
        className="mono"
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10.5,
          color: "var(--slate)",
          borderTop: "1px solid var(--border)",
          paddingTop: 6,
        }}
      >
        <span>
          Voices {stats.activeVoices}/{stats.maxVoices}
        </span>
        <span>
          Samples {stats.loadedSamples}/{stats.totalSamples}
        </span>
      </div>
    </div>
  );
};
