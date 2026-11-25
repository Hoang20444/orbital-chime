import React, { useState } from "react";
import type { MelodicInstrumentId } from "../audio/instruments/types.ts";
import { synthEngine } from "../audio/synthEngine.ts";
import { MARBLE_SONGS, type MarbleSongDef } from "../data/marbleSongs.ts";
import type { WorldState } from "../engine/types.ts";
import type { Locale } from "../i18n.ts";
import { sculptMarbleSong } from "../music/MarbleSongSculptor.ts";
import {
  draftToMarbleSongDef,
  type CustomSongDraft,
} from "../music/customSongsStore.ts";

interface SongShowcasePopoverProps {
  locale: Locale;
  activeSongId: string | null;
  customSongs: CustomSongDraft[];
  onLoadSongWorld: (world: WorldState, songId: string) => void;
  onOpenStudio: (draft?: CustomSongDraft | null) => void;
  onDeleteCustomSong: (id: string) => void;
  onClose: () => void;
}

const TIMBRE_OPTIONS: {
  id: MelodicInstrumentId;
  labelEn: string;
  labelVi: string;
}[] = [
  { id: "piano", labelEn: "Piano", labelVi: "Piano" },
  { id: "marimba", labelEn: "Maple", labelVi: "Gỗ Maple" },
  { id: "ceramic", labelEn: "Ceramic", labelVi: "Men Gốm" },
  { id: "brass", labelEn: "Brass", labelVi: "Đồng Thau" },
  { id: "musicBox", labelEn: "Music Box", labelVi: "Hộp Nhạc" },
];

export const SongShowcasePopover: React.FC<SongShowcasePopoverProps> = ({
  locale,
  activeSongId,
  customSongs,
  onLoadSongWorld,
  onOpenStudio,
  onDeleteCustomSong,
  onClose,
}) => {
  const [timbre, setTimbre] = useState<MelodicInstrumentId>("piano");

  const handleSelectSong = (song: MarbleSongDef, nextTimbre: MelodicInstrumentId) => {
    synthEngine.unlock();
    synthEngine.playUiTick();
    const world = sculptMarbleSong(song, nextTimbre);
    onLoadSongWorld(world, song.id);
    onClose();
  };

  const handleSelectCustom = (draft: CustomSongDraft, nextTimbre?: MelodicInstrumentId) => {
    synthEngine.unlock();
    synthEngine.playUiTick();
    const song = draftToMarbleSongDef(draft);
    const world = sculptMarbleSong(song, nextTimbre ?? draft.leadVoice);
    onLoadSongWorld(world, draft.id);
    onClose();
  };

  const handleSelectTimbre = (nextTimbre: MelodicInstrumentId) => {
    synthEngine.unlock();
    synthEngine.playUiTick();
    setTimbre(nextTimbre);
    if (activeSongId) {
      const builtIn = MARBLE_SONGS.find((s) => s.id === activeSongId);
      if (builtIn) {
        onLoadSongWorld(sculptMarbleSong(builtIn, nextTimbre), builtIn.id);
        return;
      }
      const custom = customSongs.find((c) => c.id === activeSongId);
      if (custom) {
        onLoadSongWorld(
          sculptMarbleSong(draftToMarbleSongDef(custom), nextTimbre),
          custom.id
        );
      }
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 10px)",
        right: 0,
        width: 360,
        maxHeight: "min(76dvh, 580px)",
        overflowY: "auto",
        backgroundColor: "#F7F8F5",
        border: "1px solid var(--border-strong)",
        borderRadius: 16,
        boxShadow: "0 12px 32px rgba(28, 35, 33, 0.14)",
        padding: 14,
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
            {locale === "vi" ? "Máy Nhạc Bi Lăn" : "Marble Song Machines"}
          </span>
          <span style={{ fontSize: 11, color: "var(--slate)" }}>
            {locale === "vi"
              ? "100% giai điệu phát từ va chạm vật lý thật"
              : "Every note triggers directly on real physics impact"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--slate)",
            cursor: "pointer",
            fontSize: 15,
            lineHeight: 1,
            padding: "2px 4px",
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Primary Studio / MP3 CTA */}
      <button
        type="button"
        onClick={() => {
          onClose();
          onOpenStudio(null);
        }}
        className="hw-btn"
        style={{
          width: "100%",
          padding: "8px 12px",
          fontSize: 12.5,
          fontWeight: 700,
          backgroundColor: "#1C2321",
          color: "#FFFFFF",
          borderColor: "transparent",
          textAlign: "center",
        }}
      >
        {locale === "vi"
          ? "+ Tự soạn bài / Nhập nhạc MP3"
          : "+ Create Song / Import MP3"}
      </button>

      {/* Melody Voice Selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--slate)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {locale === "vi" ? "Âm sắc giai điệu chính" : "Lead Voice"}
        </span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {TIMBRE_OPTIONS.map((opt) => {
            const active = timbre === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleSelectTimbre(opt.id)}
                className="hw-btn"
                style={{
                  padding: "4px 9px",
                  fontSize: 11.5,
                  fontWeight: 600,
                  backgroundColor: active ? "var(--ink)" : "#FFFFFF",
                  color: active ? "#FFFFFF" : "var(--ink)",
                  borderColor: active ? "var(--ink)" : "var(--border)",
                }}
              >
                {locale === "vi" ? opt.labelVi : opt.labelEn}
              </button>
            );
          })}
        </div>
      </div>

      {/* My Songs section */}
      {customSongs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--slate)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {locale === "vi" ? "Bài của tôi" : "My Songs"}
          </span>
          {customSongs.map((cs) => {
            const isSelected = activeSongId === cs.id;
            const total = cs.melodyNotes.length + cs.bassNotes.length + cs.drumNotes.length;
            return (
              <div
                key={cs.id}
                style={{
                  padding: "8px 10px",
                  borderRadius: 11,
                  border: `1.5px solid ${
                    isSelected ? "var(--ink)" : "var(--border)"
                  }`,
                  backgroundColor: isSelected ? "#FFFFFF" : "#ECEEE8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  onClick={() => handleSelectCustom(cs)}
                  style={{
                    flex: 1,
                    border: "none",
                    background: "transparent",
                    textAlign: "left",
                    padding: 0,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)" }}>
                    {cs.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontFamily: "var(--font-mono)",
                      color: isSelected ? "#CE5B46" : "var(--slate)",
                    }}
                  >
                    {cs.bpm} BPM · {total} {locale === "vi" ? "nốt" : "notes"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenStudio(cs);
                  }}
                  className="hw-btn"
                  style={{ padding: "3px 7px", fontSize: 11 }}
                >
                  {locale === "vi" ? "Sửa" : "Edit"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteCustomSong(cs.id)}
                  className="hw-btn"
                  style={{ padding: "3px 7px", fontSize: 11, color: "#CE5B46" }}
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Featured Songs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            color: "var(--slate)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          {locale === "vi" ? "Bộ sưu tập mẫu" : "Featured Classics"}
        </span>
        {MARBLE_SONGS.map((song) => {
          const isSelected = activeSongId === song.id;
          const totalNotes = song.chains.reduce((acc, c) => acc + c.notes.length, 0);
          return (
            <button
              key={song.id}
              type="button"
              onClick={() => handleSelectSong(song, timbre)}
              style={{
                textAlign: "left",
                padding: "9px 11px",
                borderRadius: 11,
                border: `1.5px solid ${
                  isSelected ? "var(--ink)" : "var(--border)"
                }`,
                backgroundColor: isSelected ? "#FFFFFF" : "#ECEEE8",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--ink)",
                  }}
                >
                  {locale === "vi" ? song.titleVi : song.titleEn}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    color: isSelected ? "#CE5B46" : "var(--slate)",
                  }}
                >
                  {song.bpm} BPM · {totalNotes} {locale === "vi" ? "thanh" : "bars"}
                </span>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: "var(--slate)",
                  lineHeight: 1.35,
                }}
              >
                {locale === "vi" ? song.subtitleVi : song.subtitleEn}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
