import React, { useEffect, useState } from "react";
import type { DrumId } from "../audio/instruments/types.ts";
import type { Locale } from "../i18n.ts";
import {
  getStepsPerBar,
  type LoopBars,
  type TimeSignature,
} from "../music/clock/MusicClock.ts";
import { RHYTHM_STYLES } from "../music/rhythm/PatternLibrary.ts";
import { rhythmEngine } from "../music/rhythm/rhythmSingleton.ts";
import type { RhythmStyleId } from "../music/rhythm/types.ts";

interface RhythmSequencerDrawerProps {
  locale: Locale;
  onClose: () => void;
}

const DRUM_LABELS: Record<DrumId, string> = {
  kick: "Kick",
  snare: "Snare",
  hihat_closed: "Hat C",
  hihat_open: "Hat O",
  clap: "Clap",
  shaker: "Shaker",
};

const STYLES: RhythmStyleId[] = ["lofi", "pop", "hiphop", "edm", "funk"];
const SIGNATURES: TimeSignature[] = ["4/4", "3/4", "6/8"];
const LOOP_BARS: LoopBars[] = [1, 2, 4, 8, 16];

export const RhythmSequencerDrawer: React.FC<RhythmSequencerDrawerProps> = ({
  locale,
  onClose,
}) => {
  const [snap, setSnap] = useState(() => rhythmEngine.getSnapshot());
  const [tSnap, setTSnap] = useState(() => rhythmEngine.transport.getSnapshot());
  const [playheadStep, setPlayheadStep] = useState<number | null>(null);

  useEffect(() => {
    const unsubR = rhythmEngine.subscribe(() => {
      setSnap(rhythmEngine.getSnapshot());
      setTSnap(rhythmEngine.transport.getSnapshot());
    });
    return unsubR;
  }, []);

  // Poll visual playhead strictly while this drawer is mounted & playing
  useEffect(() => {
    if (tSnap.status === "stopped") {
      setPlayheadStep(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      setPlayheadStep(rhythmEngine.scheduler.getVisualStep());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tSnap.status]);

  const stepsInBar = getStepsPerBar(tSnap.timeSignature, tSnap.subdivision);
  const currentBarStep =
    playheadStep !== null ? playheadStep % stepsInBar : -1;
  const displayBar =
    playheadStep !== null
      ? Math.floor(playheadStep / stepsInBar) + 1
      : tSnap.position.bar;
  const displayBeat =
    playheadStep !== null
      ? Math.floor((playheadStep % stepsInBar) / 4) + 1
      : tSnap.position.beat;

  return (
    <div
      style={{
        position: "fixed",
        top: 60,
        right: 12,
        width: 590,
        maxWidth: "calc(100vw - 24px)",
        backgroundColor: "var(--paper)",
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 14px 30px rgba(28,35,33,0.14)",
        zIndex: 32,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Header & Transport */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className={`hw-btn ${
              tSnap.status === "playing" ? "is-playing" : "is-accent"
            }`}
            style={{ padding: "5px 12px", fontSize: 12.5 }}
            onClick={() => {
              if (tSnap.status === "playing") {
                rhythmEngine.pause();
              } else if (tSnap.status === "paused") {
                rhythmEngine.resume();
              } else {
                rhythmEngine.start();
              }
            }}
          >
            {tSnap.status === "playing"
              ? locale === "vi"
                ? "❚❚ Dừng Beat"
                : "❚❚ Pause"
              : tSnap.status === "paused"
                ? locale === "vi"
                  ? "▶ Tiếp"
                  : "▶ Resume"
                : locale === "vi"
                  ? "▶ Chạy Beat"
                  : "▶ Beat"}
          </button>

          <button
            type="button"
            className="hw-btn"
            style={{ padding: "5px 9px", fontSize: 12 }}
            onClick={() => rhythmEngine.stop()}
          >
            ■
          </button>

          <span
            className="mono"
            style={{
              fontSize: 12,
              fontWeight: 700,
              backgroundColor: "var(--tray)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "4px 8px",
            }}
          >
            {displayBar}.{displayBeat} / {tSnap.loopBars}b
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            aria-label="Rhythm Style"
            value={snap.styleId}
            onChange={(e) =>
              rhythmEngine.loadStyle(e.target.value as RhythmStyleId, true)
            }
            style={{
              border: "1px solid var(--border)",
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
            }}
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {locale === "vi" ? RHYTHM_STYLES[s].nameVi : RHYTHM_STYLES[s].nameEn}
              </option>
            ))}
          </select>

          <select
            aria-label="Time Signature"
            value={tSnap.timeSignature}
            onChange={(e) =>
              rhythmEngine.setTimeSignature(e.target.value as TimeSignature)
            }
            className="mono"
            style={{
              border: "1px solid var(--border)",
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              padding: "4px 7px",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            {SIGNATURES.map((sig) => (
              <option key={sig} value={sig}>
                {sig}
              </option>
            ))}
          </select>

          <select
            aria-label="Loop Bars"
            value={tSnap.loopBars}
            onChange={(e) =>
              rhythmEngine.setLoopBars(Number(e.target.value) as LoopBars)
            }
            className="mono"
            style={{
              border: "1px solid var(--border)",
              backgroundColor: "#FFFFFF",
              borderRadius: 8,
              padding: "4px 7px",
              fontSize: 11.5,
              fontWeight: 600,
            }}
          >
            {LOOP_BARS.map((b) => (
              <option key={b} value={b}>
                {b} Bar{b > 1 ? "s" : ""}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 16,
              fontWeight: 700,
              color: "var(--slate)",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* Groove Sliders */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
          backgroundColor: "var(--tray)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "6px 10px",
          fontSize: 11.5,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ fontWeight: 600, color: "var(--slate)" }}>Swing</span>
          <input
            type="range"
            min={0}
            max={75}
            value={Math.round(tSnap.swing * 100)}
            onChange={(e) => rhythmEngine.setSwing(Number(e.target.value) / 100)}
            style={{ flex: 1, accentColor: "#1C2321" }}
          />
          <span className="mono" style={{ width: 32, textAlign: "right", fontWeight: 600 }}>
            {Math.round(tSnap.swing * 100)}%
          </span>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <span style={{ fontWeight: 600, color: "var(--slate)" }}>
            Humanize
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(snap.humanize * 100)}
            onChange={(e) =>
              rhythmEngine.setHumanize(Number(e.target.value) / 100)
            }
            style={{ flex: 1, accentColor: "#4D8A78" }}
          />
          <span className="mono" style={{ width: 32, textAlign: "right", fontWeight: 600 }}>
            {Math.round(snap.humanize * 100)}%
          </span>
        </label>
      </div>

      {/* 16/12-Step Drum Sequencer Grid */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {snap.tracks.map((tr) => (
          <div
            key={tr.id}
            style={{
              display: "grid",
              gridTemplateColumns: `68px 46px repeat(${stepsInBar}, minmax(0, 1fr))`,
              alignItems: "center",
              gap: 3,
            }}
          >
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: tr.muted ? "var(--slate)" : "var(--ink)",
                opacity: tr.muted ? 0.5 : 1,
              }}
            >
              {DRUM_LABELS[tr.id]}
            </span>

            <div style={{ display: "flex", gap: 2 }}>
              <button
                type="button"
                className="hw-btn mono"
                onClick={() => rhythmEngine.setTrackMute(tr.id, !tr.muted)}
                style={{
                  padding: "2px 5px",
                  fontSize: 10,
                  fontWeight: 700,
                  backgroundColor: tr.muted ? "var(--accent-tint)" : "#F7F8F5",
                  color: tr.muted ? "var(--accent)" : "var(--slate)",
                  borderColor: tr.muted ? "var(--accent)" : "var(--border)",
                }}
              >
                M
              </button>
              <button
                type="button"
                className="hw-btn mono"
                onClick={() => rhythmEngine.setTrackSolo(tr.id, !tr.solo)}
                style={{
                  padding: "2px 5px",
                  fontSize: 10,
                  fontWeight: 700,
                  backgroundColor: tr.solo ? "#4D8A78" : "#F7F8F5",
                  color: tr.solo ? "#F7F8F5" : "var(--slate)",
                  borderColor: tr.solo ? "#2D5448" : "var(--border)",
                }}
              >
                S
              </button>
            </div>

            {tr.steps.slice(0, stepsInBar).map((cell, idx) => {
              const isHead = idx === currentBarStep;
              const isBeatStart = idx % 4 === 0;
              const fillColor = !cell.active
                ? isBeatStart
                  ? "#ECEEE8"
                  : "#F2F4EF"
                : cell.accent
                  ? "#CE5B46"
                  : cell.ghost
                    ? "#9CB3AA"
                    : "#48687E";

              return (
                <button
                  key={idx}
                  type="button"
                  aria-label={`${DRUM_LABELS[tr.id]} step ${idx + 1}`}
                  onClick={() => rhythmEngine.toggleStep(tr.id, idx)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    rhythmEngine.cycleStepVelocity(tr.id, idx);
                  }}
                  style={{
                    height: 22,
                    borderRadius: 5,
                    border: isHead
                      ? "1.5px solid #1C2321"
                      : cell.active
                        ? "1px solid rgba(28,35,33,0.28)"
                        : "1px solid var(--border)",
                    backgroundColor: fillColor,
                    opacity: tr.muted ? 0.45 : 1,
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "var(--slate)" }}>
        {locale === "vi"
          ? "Bấm trái để bật/tắt ô · Bấm phải để đổi lực đánh (Ghost / Vừa / Mạnh)"
          : "Click to toggle step · Right-click to cycle Ghost / Normal / Accent"}
      </div>
    </div>
  );
};
