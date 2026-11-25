import React, { useEffect, useState } from "react";
import { LEVELS } from "../data/levels.ts";
import { SANDBOX_PRESETS } from "../data/presets.ts";
import type { ScaleId, WorldState } from "../engine/types.ts";
import type { Locale, Strings } from "../i18n.ts";
import type { CustomSongDraft } from "../music/customSongsStore.ts";
import { rhythmEngine } from "../music/rhythm/rhythmSingleton.ts";
import { AudioBenchPopover } from "./AudioBenchPopover.tsx";
import { RhythmSequencerDrawer } from "./RhythmSequencerDrawer.tsx";
import { SongShowcasePopover } from "./SongShowcasePopover.tsx";

interface TopBarProps {
  t: Strings;
  locale: Locale;
  onToggleLocale: () => void;
  mode: "puzzle" | "sandbox";
  onChangeMode: (mode: "puzzle" | "sandbox") => void;
  levelIndex: number;
  onSelectLevel: (idx: number) => void;
  completedIds: string[];
  presetId: string;
  onSelectPreset: (id: string) => void;
  scaleId: ScaleId;
  onChangeScale: (id: ScaleId) => void;
  bpm: number;
  onChangeBpm: (bpm: number) => void;
  muted: boolean;
  onToggleMute: () => void;
  activeSongId: string | null;
  isPlaying: boolean;
  customSongs: CustomSongDraft[];
  onLoadSongWorld: (world: WorldState, songId: string) => void;
  onOpenStudio: (draft?: CustomSongDraft | null) => void;
  onDeleteCustomSong: (id: string) => void;
}

const SCALE_OPTIONS: ScaleId[] = [
  "c_pentatonic",
  "f_lydian",
  "d_hirajoshi",
  "a_minor9",
  "g_dorian",
];

export const TopBar: React.FC<TopBarProps> = ({
  t,
  locale,
  onToggleLocale,
  mode,
  onChangeMode,
  levelIndex,
  onSelectLevel,
  completedIds,
  presetId,
  onSelectPreset,
  scaleId,
  onChangeScale,
  bpm,
  onChangeBpm,
  muted,
  onToggleMute,
  activeSongId,
  isPlaying,
  customSongs,
  onLoadSongWorld,
  onOpenStudio,
  onDeleteCustomSong,
}) => {
  const [albumOpen, setAlbumOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  const [rhythmOpen, setRhythmOpen] = useState(false);
  const [songOpen, setSongOpen] = useState(false);
  const [rhythmPlaying, setRhythmPlaying] = useState(
    () => rhythmEngine.transport.getStatus() === "playing"
  );
  const songPlaying = Boolean(activeSongId && isPlaying);
  const currentLevel = LEVELS[levelIndex] ?? LEVELS[0];

  useEffect(() => {
    const u1 = rhythmEngine.transport.subscribe((snap, reason) => {
      if (reason !== "tick") {
        setRhythmPlaying(snap.status === "playing");
      }
    });
    return () => {
      u1();
    };
  }, []);

  const switchPill = (active: boolean): React.CSSProperties => ({
    border: "none",
    backgroundColor: active ? "#FFFFFF" : "transparent",
    color: active ? "var(--ink)" : "var(--slate)",
    fontWeight: active ? 600 : 500,
    fontSize: 12.5,
    padding: "4px 11px",
    borderRadius: 8,
    boxShadow: active ? "0 1px 0 rgba(28,35,33,0.10)" : "none",
  });

  return (
    <header
      style={{
        position: "fixed",
        top: 10,
        left: 12,
        right: 12,
        zIndex: 20,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        pointerEvents: "none",
      }}
    >
      {/* Left: Brand & Mode hierarchy */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          pointerEvents: "auto",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            backgroundColor: "var(--tray)",
            border: "1px solid var(--border-strong)",
            borderRadius: 11,
            padding: "5px 11px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="#1C2321" strokeWidth="2.3" />
            <circle cx="12" cy="12" r="4" fill="#CE5B46" />
          </svg>
          <span style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-0.01em" }}>
            {t.appName}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            backgroundColor: "var(--tray-well)",
            border: "1px solid var(--border-strong)",
            borderRadius: 11,
            padding: 3,
            gap: 2,
          }}
        >
          <button
            type="button"
            style={switchPill(mode === "puzzle")}
            onClick={() => {
              setAlbumOpen(false);
              onChangeMode("puzzle");
            }}
          >
            {t.puzzleMode}
          </button>
          <button
            type="button"
            style={switchPill(mode === "sandbox")}
            onClick={() => {
              setAlbumOpen(false);
              onChangeMode("sandbox");
            }}
          >
            {t.sandboxMode}
          </button>
        </div>
      </div>

      {/* Center: Album Track Selector OR Sandbox Preset Selector */}
      <div
        style={{
          position: "relative",
          pointerEvents: "auto",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {mode === "puzzle" ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "var(--tray)",
                border: "1px solid var(--border-strong)",
                borderRadius: 11,
                padding: 3,
                gap: 3,
              }}
            >
              <button
                type="button"
                aria-label="Previous track"
                disabled={levelIndex === 0}
                onClick={() => onSelectLevel(Math.max(0, levelIndex - 1))}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "3px 8px",
                  borderRadius: 7,
                  opacity: levelIndex === 0 ? 0.32 : 1,
                  fontWeight: 700,
                }}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setAlbumOpen((v) => !v)}
                style={{
                  border: "1px solid var(--border)",
                  background: "#FFFFFF",
                  padding: "4px 11px",
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span className="mono" style={{ color: "var(--slate)", fontSize: 11.5 }}>
                  {String(currentLevel.trackNumber).padStart(2, "0")}/12
                </span>
                <span>
                  {locale === "vi" ? currentLevel.titleVi : currentLevel.titleEn}
                </span>
                {completedIds.includes(currentLevel.id) && (
                  <span style={{ color: "#4D8A78", fontWeight: 700 }}>✓</span>
                )}
                <span style={{ fontSize: 10, color: "var(--slate)" }}>▾</span>
              </button>
              <button
                type="button"
                aria-label="Next track"
                disabled={levelIndex === LEVELS.length - 1}
                onClick={() =>
                  onSelectLevel(Math.min(LEVELS.length - 1, levelIndex + 1))
                }
                style={{
                  border: "none",
                  background: "transparent",
                  padding: "3px 8px",
                  borderRadius: 7,
                  opacity: levelIndex === LEVELS.length - 1 ? 0.32 : 1,
                  fontWeight: 700,
                }}
              >
                ›
              </button>
            </div>

            {albumOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 336,
                  maxWidth: "90vw",
                  backgroundColor: "var(--paper)",
                  border: "1px solid var(--border-strong)",
                  borderRadius: 13,
                  padding: 10,
                  boxShadow: "0 12px 26px rgba(28,35,33,0.12)",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {LEVELS.map((lvl, idx) => {
                  const done = completedIds.includes(lvl.id);
                  const current = idx === levelIndex;
                  return (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => {
                        onSelectLevel(idx);
                        setAlbumOpen(false);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "7px 10px",
                        borderRadius: 9,
                        border: current
                          ? "1.5px solid var(--ink)"
                          : "1px solid var(--border)",
                        backgroundColor: current ? "#FFFFFF" : "var(--tray)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: 11,
                        }}
                      >
                        <span className="mono" style={{ color: "var(--slate)" }}>
                          Track {String(lvl.trackNumber).padStart(2, "0")}
                        </span>
                        {done && <span style={{ color: "#4D8A78", fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {locale === "vi" ? lvl.titleVi : lvl.titleEn}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              backgroundColor: "var(--tray)",
              border: "1px solid var(--border-strong)",
              borderRadius: 11,
              padding: "4px 8px 4px 11px",
            }}
          >
            <span style={{ fontSize: 12, color: "var(--slate)", fontWeight: 600 }}>
              {t.presetLabel}
            </span>
            <select
              aria-label="Sandbox preset"
              value={presetId}
              onChange={(e) => onSelectPreset(e.target.value)}
              style={{
                border: "1px solid var(--border)",
                backgroundColor: "#FFFFFF",
                borderRadius: 8,
                padding: "4px 9px",
                fontSize: 12.5,
                fontWeight: 600,
                fontFamily: "inherit",
                color: "var(--ink)",
              }}
            >
              {SANDBOX_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {locale === "vi" ? p.nameVi : p.nameEn}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right: Scale + BPM Hardware Readout Well, Language, Sound Toggle, Audio Bench */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          pointerEvents: "auto",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            backgroundColor: "var(--tray)",
            border: "1px solid var(--border-strong)",
            borderRadius: 11,
            padding: "3px 8px",
          }}
        >
          <select
            aria-label="Musical scale"
            value={scaleId}
            onChange={(e) => onChangeScale(e.target.value as ScaleId)}
            style={{
              border: "1px solid var(--border)",
              background: "#FFFFFF",
              borderRadius: 7,
              padding: "3px 8px",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "inherit",
              color: "var(--ink)",
            }}
          >
            {SCALE_OPTIONS.map((id) => (
              <option key={id} value={id}>
                {t.scales[id]}
              </option>
            ))}
          </select>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              backgroundColor: "var(--paper)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "2px 4px",
            }}
          >
            <button
              type="button"
              aria-label="Decrease BPM"
              onClick={() => onChangeBpm(Math.max(60, bpm - 4))}
              style={{
                border: "none",
                background: "transparent",
                padding: "1px 6px",
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              −
            </button>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600, minWidth: 52, textAlign: "center" }}>
              {bpm} BPM
            </span>
            <button
              type="button"
              aria-label="Increase BPM"
              onClick={() => onChangeBpm(Math.min(180, bpm + 4))}
              style={{
                border: "none",
                background: "transparent",
                padding: "1px 6px",
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleLocale}
          className="hw-btn mono"
          style={{
            padding: "5px 9px",
            fontSize: 11.5,
            fontWeight: 700,
          }}
        >
          {locale === "en" ? "EN" : "VI"}
        </button>

        <button
          type="button"
          onClick={onToggleMute}
          className="hw-btn"
          style={{
            backgroundColor: muted ? "var(--accent-tint)" : "#F7F8F5",
            borderColor: muted ? "var(--accent)" : "var(--border-strong)",
            color: muted ? "var(--accent)" : "var(--ink)",
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          {muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="22" y1="9" x2="16" y2="15" />
              <line x1="16" y1="9" x2="22" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          )}
          <span>{muted ? t.mute : t.unmute}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setBenchOpen(false);
            setRhythmOpen(false);
            setSongOpen((v) => !v);
          }}
          className={`hw-btn ${songOpen ? "is-selected" : ""}`}
          style={{
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: songPlaying ? "#CE5B46" : "var(--slate)",
              display: "inline-block",
            }}
          />
          <span>{locale === "vi" ? "Bài nhạc" : "Song"}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setBenchOpen(false);
            setRhythmOpen(false);
            setSongOpen(false);
            onOpenStudio(null);
          }}
          className="hw-btn"
          style={{
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title={locale === "vi" ? "Tự soạn bài nhạc & nhập MP3" : "Compose & Import MP3"}
        >
          <span>{locale === "vi" ? "+ Soạn" : "+ Studio"}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setBenchOpen(false);
            setSongOpen(false);
            setRhythmOpen((v) => !v);
          }}
          className={`hw-btn ${rhythmOpen ? "is-selected" : ""}`}
          style={{
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: rhythmPlaying ? "#4D8A78" : "var(--slate)",
              display: "inline-block",
            }}
          />
          <span>{locale === "vi" ? "Nhịp" : "Beat"}</span>
        </button>

        <button
          type="button"
          aria-label="Audio Bench"
          title={locale === "vi" ? "Phòng thử âm thanh" : "Audio Bench"}
          onClick={() => {
            setRhythmOpen(false);
            setSongOpen(false);
            setBenchOpen((v) => !v);
          }}
          className={`hw-btn ${benchOpen ? "is-selected" : ""}`}
          style={{
            padding: "5px 8px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <line x1="4" y1="21" x2="4" y2="14" />
            <line x1="4" y1="10" x2="4" y2="3" />
            <line x1="12" y1="21" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12" y2="3" />
            <line x1="20" y1="21" x2="20" y2="16" />
            <line x1="20" y1="12" x2="20" y2="3" />
            <line x1="1" y1="14" x2="7" y2="14" />
            <line x1="9" y1="8" x2="15" y2="8" />
            <line x1="17" y1="16" x2="23" y2="16" />
          </svg>
        </button>

        {benchOpen && (
          <AudioBenchPopover locale={locale} onClose={() => setBenchOpen(false)} />
        )}
        {rhythmOpen && (
          <RhythmSequencerDrawer
            locale={locale}
            onClose={() => setRhythmOpen(false)}
          />
        )}
        {songOpen && (
          <SongShowcasePopover
            locale={locale}
            activeSongId={activeSongId}
            customSongs={customSongs}
            onLoadSongWorld={onLoadSongWorld}
            onOpenStudio={onOpenStudio}
            onDeleteCustomSong={onDeleteCustomSong}
            onClose={() => setSongOpen(false)}
          />
        )}
      </div>
    </header>
  );
};
