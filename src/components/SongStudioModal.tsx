import React, { useEffect, useMemo, useRef, useState } from "react";
import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import { midiToFreq, midiToName } from "../audio/scales.ts";
import { synthEngine } from "../audio/synthEngine.ts";
import { MARBLE_SONGS, type MarbleSongDef } from "../data/marbleSongs.ts";
import type { WorldState } from "../engine/types.ts";
import type { Locale } from "../i18n.ts";
import { sculptMarbleSong } from "../music/MarbleSongSculptor.ts";
import {
  analyzeAudioClipToDraft,
  extractWaveformPeaks,
  mixToMono,
  type AudioAnalysisResult,
  type ExtractionDensity,
} from "../music/audio/AudioAnalyzer.ts";
import {
  createBlankDraft,
  draftToMarbleSongDef,
  marbleSongToDraft,
  type CustomSongDraft,
} from "../music/customSongsStore.ts";
import { parseMidiBuffer, type ParsedMidiFile } from "../music/midi/MidiParser.ts";
import {
  autoPickMidiTrackRoles,
  midiToCustomSongDraft,
} from "../music/midi/MidiToMarbleSong.ts";

interface SongStudioModalProps {
  locale: Locale;
  initialDraft?: CustomSongDraft | null;
  initialTab?: "compose" | "import";
  onClose: () => void;
  onSaveDraft: (draft: CustomSongDraft) => void;
  onBuildSongWorld: (
    world: WorldState,
    song: MarbleSongDef,
    draft: CustomSongDraft
  ) => void;
}

const LEAD_VOICES: { id: MelodicInstrumentId; labelEn: string; labelVi: string }[] = [
  { id: "piano", labelEn: "Piano", labelVi: "Piano" },
  { id: "marimba", labelEn: "Maple", labelVi: "Gỗ Maple" },
  { id: "ceramic", labelEn: "Ceramic", labelVi: "Men Gốm" },
  { id: "brass", labelEn: "Brass", labelVi: "Đồng Thau" },
  { id: "musicBox", labelEn: "Music Box", labelVi: "Hộp Nhạc" },
  { id: "synthLead", labelEn: "Synth Lead", labelVi: "Synth Lead" },
];

const BASS_VOICES: { id: MelodicInstrumentId; labelEn: string; labelVi: string }[] = [
  { id: "bass", labelEn: "Acoustic Bass", labelVi: "Bass Trầm" },
  { id: "piano", labelEn: "Piano Bass", labelVi: "Piano Trầm" },
  { id: "subBass", labelEn: "Sub Bass", labelVi: "Sub Bass" },
];

const DRUM_ROWS: { id: DrumId; label: string }[] = [
  { id: "hihat_open", label: "OHAT" },
  { id: "hihat_closed", label: "HAT" },
  { id: "shaker", label: "SHK" },
  { id: "clap", label: "CLAP" },
  { id: "snare", label: "SNARE" },
  { id: "kick", label: "KICK" },
];

const KEYBOARD_MAP: Record<string, number> = {
  a: 60, // C4
  w: 61, // Db4
  s: 62, // D4
  e: 63, // Eb4
  d: 64, // E4
  f: 65, // F4
  t: 66, // F#4
  g: 67, // G4
  y: 68, // Ab4
  h: 69, // A4
  u: 70, // Bb4
  j: 71, // B4
  k: 72, // C5
  o: 73, // Db5
  l: 74, // D5
  p: 75, // Eb5
};

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

interface DecodedAudioState {
  buffer: AudioBuffer;
  mono: Float32Array;
  peaks: number[];
  durationSec: number;
  title: string;
}

function formatTimeSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

export const SongStudioModal: React.FC<SongStudioModalProps> = ({
  locale,
  initialDraft,
  initialTab = "compose",
  onClose,
  onSaveDraft,
  onBuildSongWorld,
}) => {
  const [tab, setTab] = useState<"compose" | "import">(initialTab);
  const [draft, setDraft] = useState<CustomSongDraft>(
    () => initialDraft ?? createBlankDraft()
  );
  const [lane, setLane] = useState<"melody" | "bass" | "drums">("melody");
  const [cursorStep, setCursorStep] = useState(0);
  const [keybdActive, setKeybdActive] = useState(true);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [playStep, setPlayStep] = useState<number | null>(null);

  // MP3 / Audio Import state
  const [decodedAudio, setDecodedAudio] = useState<DecodedAudioState | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioStartSec, setAudioStartSec] = useState(0);
  const [audioLoopBeats, setAudioLoopBeats] = useState(16);
  const [audioBpmOverride, setAudioBpmOverride] = useState<number | null>(null);
  const [audioDensity, setAudioDensity] = useState<ExtractionDensity>("balanced");
  const [audioSnapKey, setAudioSnapKey] = useState(true);
  const [incMelody, setIncMelody] = useState(true);
  const [incBass, setIncBass] = useState(true);
  const [incDrums, setIncDrums] = useState(true);
  const [clipPlaying, setClipPlaying] = useState(false);
  const clipSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Quiet fallback MIDI state if user drops a .mid file
  const [parsedMidi, setParsedMidi] = useState<ParsedMidiFile | null>(null);
  const [midiFileName, setMidiFileName] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [leadTrackIdx, setLeadTrackIdx] = useState<number | null>(null);
  const [bassTrackIdx, setBassTrackIdx] = useState<number | null>(null);
  const [drumTrackIdx, setDrumTrackIdx] = useState<number | null>(null);
  const [midiStartBeat, setMidiStartBeat] = useState(0);
  const [midiLoopBeats, setMidiLoopBeats] = useState(16);
  const [midiQuantize, setMidiQuantize] = useState<0.5 | 0.25>(0.5);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopClipPlayback = () => {
    if (clipSourceRef.current) {
      try {
        clipSourceRef.current.stop();
      } catch {
        // Ignore already stopped
      }
      clipSourceRef.current.disconnect();
      clipSourceRef.current = null;
    }
    setClipPlaying(false);
  };

  useEffect(() => {
    return () => {
      stopClipPlayback();
    };
  }, []);

  const audioAnalysis: AudioAnalysisResult | null = useMemo(() => {
    if (!decodedAudio) return null;
    return analyzeAudioClipToDraft(decodedAudio.mono, decodedAudio.buffer.sampleRate, {
      title: decodedAudio.title,
      startSec: audioStartSec,
      loopBeats: audioLoopBeats,
      bpmOverride: audioBpmOverride ?? undefined,
      leadVoice: draft.leadVoice,
      bassVoice: draft.bassVoice,
      density: audioDensity,
      snapToKey: audioSnapKey,
      includeMelody: incMelody,
      includeBass: incBass,
      includeDrums: incDrums,
    });
  }, [
    decodedAudio,
    audioStartSec,
    audioLoopBeats,
    audioBpmOverride,
    audioDensity,
    audioSnapKey,
    incMelody,
    incBass,
    incDrums,
    draft.leadVoice,
    draft.bassVoice,
  ]);

  const stepGrid = 0.5;
  const totalCols = Math.max(8, Math.round(draft.loopBeats / stepGrid));

  // Stop preview on unmount
  useEffect(() => {
    if (!previewPlaying) {
      setPlayStep(null);
      return;
    }
    synthEngine.unlock();
    let stepIdx = 0;
    const intervalMs = Math.max(80, Math.round(((60 / draft.bpm) * stepGrid) * 1000));

    const playCol = (col: number) => {
      const beat = col * stepGrid;
      for (const n of draft.melodyNotes) {
        if (Math.abs(n.beat - beat) < 0.08) {
          synthEngine.manager.playNote(draft.leadVoice, {
            freq: midiToFreq(n.midi),
            velocity: 0.72,
            duration: 0.36,
          });
        }
      }
      for (const n of draft.bassNotes) {
        if (Math.abs(n.beat - beat) < 0.08) {
          synthEngine.manager.playNote(draft.bassVoice, {
            freq: midiToFreq(n.midi),
            velocity: 0.76,
            duration: 0.45,
          });
        }
      }
      for (const d of draft.drumNotes) {
        if (Math.abs(d.beat - beat) < 0.08) {
          synthEngine.manager.playDrum(d.drum, { velocity: 0.78 });
        }
      }
    };

    setPlayStep(0);
    playCol(0);
    const id = window.setInterval(() => {
      stepIdx = (stepIdx + 1) % totalCols;
      setPlayStep(stepIdx);
      playCol(stepIdx);
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [
    previewPlaying,
    draft.bpm,
    draft.leadVoice,
    draft.bassVoice,
    draft.melodyNotes,
    draft.bassNotes,
    draft.drumNotes,
    totalCols,
  ]);

  // Computer keyboard piano entry when Compose tab is active & Keybd enabled
  useEffect(() => {
    if (tab !== "compose" || !keybdActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const midi = KEYBOARD_MAP[e.key.toLowerCase()];
      if (midi === undefined) return;
      e.preventDefault();
      synthEngine.unlock();
      const targetMidi = lane === "bass" ? midi - 24 : midi;
      synthEngine.manager.playNote(lane === "bass" ? draft.bassVoice : draft.leadVoice, {
        freq: midiToFreq(targetMidi),
        velocity: 0.76,
        duration: 0.35,
      });

      const beat = (cursorStep % totalCols) * stepGrid;
      setDraft((prev) => {
        if (lane === "bass") {
          const rest = prev.bassNotes.filter((n) => Math.abs(n.beat - beat) > 0.05);
          return {
            ...prev,
            bassNotes: [...rest, { beat, midi: targetMidi }].sort((a, b) => a.beat - b.beat),
          };
        }
        const rest = prev.melodyNotes.filter((n) => Math.abs(n.beat - beat) > 0.05);
        return {
          ...prev,
          melodyNotes: [...rest, { beat, midi: targetMidi }].sort((a, b) => a.beat - b.beat),
        };
      });
      setCursorStep((c) => (c + 1) % totalCols);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, keybdActive, lane, cursorStep, totalCols, draft.leadVoice, draft.bassVoice]);

  const toggleMelodicCell = (midi: number, col: number, targetLane: "melody" | "bass") => {
    const beat = col * stepGrid;
    synthEngine.unlock();
    setCursorStep(col);
    setDraft((prev) => {
      const list = targetLane === "melody" ? prev.melodyNotes : prev.bassNotes;
      const hitIdx = list.findIndex(
        (n) => Math.abs(n.beat - beat) < 0.05 && n.midi === midi
      );
      let nextList: typeof list;
      if (hitIdx >= 0) {
        nextList = list.filter((_, i) => i !== hitIdx);
      } else {
        synthEngine.manager.playNote(
          targetLane === "melody" ? prev.leadVoice : prev.bassVoice,
          { freq: midiToFreq(midi), velocity: 0.75, duration: 0.35 }
        );
        // Monophonic slot for crisp single-marble chain per beat
        nextList = [
          ...list.filter((n) => Math.abs(n.beat - beat) > 0.05),
          { beat, midi },
        ].sort((a, b) => a.beat - b.beat);
      }
      return targetLane === "melody"
        ? { ...prev, melodyNotes: nextList }
        : { ...prev, bassNotes: nextList };
    });
  };

  const toggleDrumCell = (drum: DrumId, col: number) => {
    const beat = col * stepGrid;
    synthEngine.unlock();
    setCursorStep(col);
    setDraft((prev) => {
      const hitIdx = prev.drumNotes.findIndex(
        (d) => Math.abs(d.beat - beat) < 0.05 && d.drum === drum
      );
      let nextList: typeof prev.drumNotes;
      if (hitIdx >= 0) {
        nextList = prev.drumNotes.filter((_, i) => i !== hitIdx);
      } else {
        synthEngine.manager.playDrum(drum, { velocity: 0.8 });
        nextList = [
          ...prev.drumNotes.filter((d) => Math.abs(d.beat - beat) > 0.05),
          { beat, drum },
        ].sort((a, b) => a.beat - b.beat);
      }
      return { ...prev, drumNotes: nextList };
    });
  };

  const handleLoadStarter = (starterId: string) => {
    setPreviewPlaying(false);
    if (starterId === "blank") {
      setDraft({
        ...createBlankDraft(),
        melodyNotes: [],
        bassNotes: [],
        drumNotes: [],
        title: locale === "vi" ? "Bài nhạc mới" : "New Song",
      });
      return;
    }
    const found = MARBLE_SONGS.find((s) => s.id === starterId);
    if (found) {
      setDraft(marbleSongToDraft(found));
    }
  };

  const handleImportFile = async (file: File) => {
    setImportError(null);
    stopClipPlayback();
    const isMidi = /\.(mid|midi)$/i.test(file.name);

    if (isMidi) {
      setDecodedAudio(null);
      try {
        const buf = await file.arrayBuffer();
        const parsed = parseMidiBuffer(buf);
        if (parsed.tracks.length === 0) {
          setImportError(
            locale === "vi"
              ? "Không tìm thấy nốt nhạc hợp lệ trong file MIDI này."
              : "No playable MIDI note tracks found in this file."
          );
          return;
        }
        const roles = autoPickMidiTrackRoles(parsed);
        setParsedMidi(parsed);
        setMidiFileName(file.name.replace(/\.(mid|midi)$/i, ""));
        setLeadTrackIdx(roles.leadTrackIndex);
        setBassTrackIdx(roles.bassTrackIndex);
        setDrumTrackIdx(roles.drumTrackIndex);
        setMidiStartBeat(0);
        setMidiLoopBeats(Math.min(24, Math.max(8, parsed.totalBeats >= 16 ? 16 : 8)));
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Failed to parse MIDI file");
      }
      return;
    }

    // Standard Audio (.mp3 / .wav / .ogg / .m4a) via Web Audio API decodeAudioData
    setParsedMidi(null);
    setAudioLoading(true);
    try {
      const ctx =
        synthEngine.manager.contextManager.unlock() ??
        new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const rawBuf = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(rawBuf.slice(0));
      const channels: Float32Array[] = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channels.push(audioBuffer.getChannelData(c));
      }
      const mono = mixToMono(channels);
      const peaks = extractWaveformPeaks(mono, 120);
      const title = file.name.replace(/\.[^.]+$/, "");
      // Start near 25% into the track if > 24s (often where main melody kicks in) or 0s on short clips
      const initStart =
        audioBuffer.duration > 24 ? Math.round(audioBuffer.duration * 0.2) : 0;
      setDecodedAudio({
        buffer: audioBuffer,
        mono,
        peaks,
        durationSec: audioBuffer.duration,
        title,
      });
      setAudioStartSec(initStart);
      setAudioBpmOverride(null);
      setAudioLoopBeats(16);
    } catch (err) {
      setImportError(
        locale === "vi"
          ? "Không thể giải mã file âm thanh này. Hãy thử MP3 hoặc WAV chuẩn."
          : `Could not decode audio file: ${err instanceof Error ? err.message : "Unsupported format"}`
      );
    } finally {
      setAudioLoading(false);
    }
  };

  const toggleClipPlayback = () => {
    if (!decodedAudio) return;
    if (clipPlaying) {
      stopClipPlayback();
      return;
    }
    synthEngine.unlock();
    const ctx = synthEngine.manager.contextManager.unlock();
    if (!ctx) return;
    stopClipPlayback();
    const bpm = audioAnalysis?.detectedBpm ?? 108;
    const playDur = Math.min(
      Math.max(2, (audioLoopBeats * 60) / bpm),
      Math.max(0.5, decodedAudio.durationSec - audioStartSec)
    );
    const src = ctx.createBufferSource();
    src.buffer = decodedAudio.buffer;
    src.connect(ctx.destination);
    src.onended = () => {
      if (clipSourceRef.current === src) {
        clipSourceRef.current = null;
        setClipPlaying(false);
      }
    };
    clipSourceRef.current = src;
    setClipPlaying(true);
    src.start(0, audioStartSec, playDur);
  };

  const buildImportedDraft = (): CustomSongDraft | null => {
    if (audioAnalysis) return audioAnalysis.draft;
    if (!parsedMidi) return null;
    return midiToCustomSongDraft(parsedMidi, {
      title: midiFileName || "Imported MIDI",
      leadTrackIndex: leadTrackIdx,
      bassTrackIndex: bassTrackIdx,
      drumTrackIndex: drumTrackIdx,
      startBeat: midiStartBeat,
      loopBeats: midiLoopBeats,
      quantizeStep: midiQuantize,
      leadVoice: draft.leadVoice,
      bassVoice: draft.bassVoice,
    });
  };

  const handleBuildNow = (targetDraft: CustomSongDraft) => {
    setPreviewPlaying(false);
    synthEngine.unlock();
    onSaveDraft(targetDraft);
    const songDef = draftToMarbleSongDef(targetDraft);
    const world = sculptMarbleSong(songDef, targetDraft.leadVoice);
    onBuildSongWorld(world, songDef, targetDraft);
    onClose();
  };

  const pitchRows =
    lane === "melody"
      ? Array.from({ length: 25 }, (_, i) => 84 - i) // C6 down to C4
      : Array.from({ length: 20 }, (_, i) => 55 - i); // G3 down to C2

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backgroundColor: "rgba(28, 35, 33, 0.36)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 100%)",
          maxHeight: "min(86dvh, 720px)",
          backgroundColor: "#F7F8F5",
          border: "1px solid var(--border-strong)",
          borderRadius: 18,
          boxShadow: "0 20px 48px rgba(28, 35, 33, 0.2)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            backgroundColor: "#ECEEE8",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>
              {locale === "vi" ? "Studio Soạn Nhạc & Nhập MP3" : "Song Studio & MP3 Importer"}
            </span>
            <div
              style={{
                display: "flex",
                backgroundColor: "#E0E3DB",
                borderRadius: 10,
                padding: 3,
                gap: 2,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  stopClipPlayback();
                  setTab("compose");
                }}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  backgroundColor: tab === "compose" ? "#FFFFFF" : "transparent",
                  color: tab === "compose" ? "var(--ink)" : "var(--slate)",
                }}
              >
                {locale === "vi" ? "Piano Roll (Soạn nhạc)" : "Compose (Piano Roll)"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewPlaying(false);
                  setTab("import");
                }}
                style={{
                  border: "none",
                  borderRadius: 8,
                  padding: "4px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  backgroundColor: tab === "import" ? "#FFFFFF" : "transparent",
                  color: tab === "import" ? "var(--ink)" : "var(--slate)",
                }}
              >
                {locale === "vi" ? "Nhập nhạc MP3 / WAV" : "Import MP3 / Audio"}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setPreviewPlaying(false);
              stopClipPlayback();
              onClose();
            }}
            className="hw-btn"
            style={{ padding: "4px 10px", fontSize: 13 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {tab === "compose" ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              padding: 14,
              gap: 10,
            }}
          >
            {/* Top Controls Row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder={locale === "vi" ? "Tên bài nhạc..." : "Song title..."}
                style={{
                  flex: "1 1 160px",
                  minWidth: 140,
                  padding: "5px 10px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: 9,
                  border: "1px solid var(--border-strong)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--ink)",
                }}
              />

              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--slate)" }}>
                <span>BPM</span>
                <input
                  type="number"
                  min={60}
                  max={160}
                  value={draft.bpm}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      bpm: Math.max(60, Math.min(160, Number(e.target.value) || 104)),
                    })
                  }
                  style={{
                    width: 56,
                    padding: "4px 6px",
                    borderRadius: 8,
                    border: "1px solid var(--border-strong)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                />
              </label>

              <select
                value={draft.loopBeats}
                onChange={(e) =>
                  setDraft({ ...draft, loopBeats: Number(e.target.value) })
                }
                className="hw-select"
                style={{ fontSize: 12, padding: "4px 8px" }}
              >
                <option value={8}>8 {locale === "vi" ? "phách" : "beats"}</option>
                <option value={16}>16 {locale === "vi" ? "phách" : "beats"}</option>
                <option value={24}>24 {locale === "vi" ? "phách" : "beats"}</option>
              </select>

              <select
                value={draft.leadVoice}
                onChange={(e) =>
                  setDraft({ ...draft, leadVoice: e.target.value as MelodicInstrumentId })
                }
                className="hw-select"
                style={{ fontSize: 12, padding: "4px 8px" }}
              >
                {LEAD_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {locale === "vi" ? v.labelVi : v.labelEn}
                  </option>
                ))}
              </select>

              <select
                value={draft.bassVoice}
                onChange={(e) =>
                  setDraft({ ...draft, bassVoice: e.target.value as MelodicInstrumentId })
                }
                className="hw-select"
                style={{ fontSize: 12, padding: "4px 8px" }}
              >
                {BASS_VOICES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {locale === "vi" ? v.labelVi : v.labelEn}
                  </option>
                ))}
              </select>

              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) handleLoadStarter(e.target.value);
                }}
                className="hw-select"
                style={{ fontSize: 12, padding: "4px 8px" }}
              >
                <option value="">
                  {locale === "vi" ? "Mẫu khởi đầu..." : "Load template..."}
                </option>
                <option value="blank">{locale === "vi" ? "Trống (Xóa hết)" : "Blank Grid"}</option>
                {MARBLE_SONGS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {locale === "vi" ? s.titleVi : s.titleEn}
                  </option>
                ))}
              </select>
            </div>

            {/* Lane Tabs + Keyboard Piano Switch */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: 6 }}>
                {(
                  [
                    {
                      id: "melody",
                      label: `${locale === "vi" ? "Giai điệu" : "Melody"} (${draft.melodyNotes.length})`,
                    },
                    {
                      id: "bass",
                      label: `Bass (${draft.bassNotes.length})`,
                    },
                    {
                      id: "drums",
                      label: `${locale === "vi" ? "Trống" : "Drums"} (${draft.drumNotes.length})`,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLane(item.id)}
                    className={`hw-btn ${lane === item.id ? "is-selected" : ""}`}
                    style={{
                      padding: "4px 11px",
                      fontSize: 12,
                      fontWeight: 600,
                      backgroundColor: lane === item.id ? "var(--ink)" : "#FFFFFF",
                      color: lane === item.id ? "#FFFFFF" : "var(--ink)",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {lane !== "drums" && (
                  <button
                    type="button"
                    onClick={() => setKeybdActive((v) => !v)}
                    className="hw-btn"
                    style={{
                      padding: "4px 10px",
                      fontSize: 11.5,
                      fontWeight: 600,
                      backgroundColor: keybdActive ? "#ECEEE8" : "#FFFFFF",
                      borderColor: keybdActive ? "#4D8A78" : "var(--border)",
                      color: "var(--ink)",
                    }}
                    title="A W S E D F T G Y H U J K"
                  >
                    {keybdActive
                      ? locale === "vi"
                        ? "🎹 Gõ phím A–K đang bật"
                        : "🎹 Keybd Piano ON (A–K)"
                      : locale === "vi"
                        ? "🎹 Bật gõ phím A–K"
                        : "🎹 Keybd Piano OFF"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewPlaying((v) => !v)}
                  className="hw-btn"
                  style={{
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: previewPlaying ? "#CE5B46" : "#FFFFFF",
                    color: previewPlaying ? "#FFFFFF" : "var(--ink)",
                    borderColor: previewPlaying ? "#CE5B46" : "var(--border-strong)",
                  }}
                >
                  {previewPlaying
                    ? locale === "vi"
                      ? "■ Dừng nghe thử"
                      : "■ Stop Preview"
                    : locale === "vi"
                      ? "▶ Nghe thử"
                      : "▶ Preview"}
                </button>
              </div>
            </div>

            {/* Piano Roll / Drum Grid */}
            <div
              style={{
                flex: 1,
                minHeight: 240,
                maxHeight: 390,
                overflow: "auto",
                border: "1px solid var(--border-strong)",
                borderRadius: 12,
                backgroundColor: "#FFFFFF",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `64px repeat(${totalCols}, minmax(26px, 1fr))`,
                  minWidth: 64 + totalCols * 26,
                }}
              >
                {/* Beat header row */}
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 4,
                    backgroundColor: "#ECEEE8",
                    borderBottom: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    padding: "4px 6px",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--slate)",
                  }}
                >
                  {lane === "drums" ? "DRUM" : "NOTE"}
                </div>
                {Array.from({ length: totalCols }, (_, col) => {
                  const isDownbeat = col % 2 === 0;
                  const isCursor = col === cursorStep;
                  const isPlay = col === playStep;
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => setCursorStep(col)}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 3,
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        borderRight: "1px solid rgba(28,35,33,0.08)",
                        backgroundColor: isPlay
                          ? "#CE5B46"
                          : isCursor
                            ? "#D8A25E"
                            : isDownbeat
                              ? "#ECEEE8"
                              : "#F7F8F5",
                        color: isPlay || isCursor ? "#FFFFFF" : "var(--slate)",
                        fontSize: 10,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        padding: "4px 0",
                        cursor: "pointer",
                      }}
                    >
                      {isDownbeat ? col / 2 + 1 : "·"}
                    </button>
                  );
                })}

                {/* Grid rows */}
                {lane === "drums"
                  ? DRUM_ROWS.map((dr) => (
                      <React.Fragment key={dr.id}>
                        <div
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 2,
                            backgroundColor: "#F7F8F5",
                            borderBottom: "1px solid rgba(28,35,33,0.08)",
                            borderRight: "1px solid var(--border)",
                            padding: "7px 8px",
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            color: "var(--ink)",
                          }}
                        >
                          {dr.label}
                        </div>
                        {Array.from({ length: totalCols }, (_, col) => {
                          const beat = col * stepGrid;
                          const active = draft.drumNotes.some(
                            (d) => Math.abs(d.beat - beat) < 0.05 && d.drum === dr.id
                          );
                          const isBarStart = col % 8 === 0;
                          return (
                            <button
                              key={col}
                              type="button"
                              onClick={() => toggleDrumCell(dr.id, col)}
                              style={{
                                border: "none",
                                borderBottom: "1px solid rgba(28,35,33,0.08)",
                                borderRight: `1px solid ${
                                  isBarStart
                                    ? "rgba(28,35,33,0.22)"
                                    : "rgba(28,35,33,0.06)"
                                }`,
                                backgroundColor: active
                                  ? "#CE5B46"
                                  : col === playStep
                                    ? "rgba(206, 91, 70, 0.12)"
                                    : col % 2 === 0
                                      ? "#FAFAF8"
                                      : "#FFFFFF",
                                cursor: "pointer",
                                height: 30,
                              }}
                              aria-label={`${dr.label} step ${col}`}
                            />
                          );
                        })}
                      </React.Fragment>
                    ))
                  : pitchRows.map((midi) => {
                      const isBlack = BLACK_PITCH_CLASSES.has(midi % 12);
                      const label = midiToName(midi);
                      const activeList =
                        lane === "melody" ? draft.melodyNotes : draft.bassNotes;
                      return (
                        <React.Fragment key={midi}>
                          <div
                            style={{
                              position: "sticky",
                              left: 0,
                              zIndex: 2,
                              backgroundColor: isBlack ? "#1C2321" : "#F7F8F5",
                              color: isBlack ? "#F7F8F5" : "#1C2321",
                              borderBottom: "1px solid rgba(28,35,33,0.1)",
                              borderRight: "1px solid var(--border)",
                              padding: "2px 8px",
                              fontSize: 10.5,
                              fontFamily: "var(--font-mono)",
                              fontWeight: midi % 12 === 0 ? 700 : 500,
                              display: "flex",
                              alignItems: "center",
                              height: 22,
                            }}
                          >
                            {label}
                          </div>
                          {Array.from({ length: totalCols }, (_, col) => {
                            const beat = col * stepGrid;
                            const active = activeList.some(
                              (n) => Math.abs(n.beat - beat) < 0.05 && n.midi === midi
                            );
                            const isBarStart = col % 8 === 0;
                            return (
                              <button
                                key={col}
                                type="button"
                                onClick={() => toggleMelodicCell(midi, col, lane)}
                                style={{
                                  border: "none",
                                  borderBottom: "1px solid rgba(28,35,33,0.08)",
                                  borderRight: `1px solid ${
                                    isBarStart
                                      ? "rgba(28,35,33,0.2)"
                                      : "rgba(28,35,33,0.06)"
                                  }`,
                                  backgroundColor: active
                                    ? lane === "melody"
                                      ? "#4D8A78"
                                      : "#48687E"
                                    : col === playStep
                                      ? "rgba(206, 91, 70, 0.1)"
                                      : isBlack
                                        ? "#F1F2EE"
                                        : col % 2 === 0
                                          ? "#FAFAF8"
                                          : "#FFFFFF",
                                  cursor: "pointer",
                                  height: 22,
                                }}
                                aria-label={`${label} step ${col}`}
                              />
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              flex: 1,
              overflowY: "auto",
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.mid,.midi"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleImportFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed var(--border-strong)",
                borderRadius: 14,
                padding: decodedAudio || parsedMidi ? "12px 16px" : "24px 16px",
                backgroundColor: "#FFFFFF",
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
                {audioLoading
                  ? locale === "vi"
                    ? "Đang giải mã sóng âm..."
                    : "Decoding audio waveform..."
                  : decodedAudio
                    ? `✓ ${decodedAudio.title} (${formatTimeSec(decodedAudio.durationSec)})`
                    : parsedMidi
                      ? `✓ ${midiFileName}.mid (${parsedMidi.bpm} BPM · ${parsedMidi.totalBeats} ${
                          locale === "vi" ? "phách" : "beats"
                        })`
                      : locale === "vi"
                        ? "Kéo thả file MP3 / WAV vào đây hoặc bấm để chọn bài hát"
                        : "Drop any MP3 / WAV song here or click to browse"}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--slate)", marginTop: 4 }}>
                {locale === "vi"
                  ? "Tự động phân tích BPM, tông nhạc, giai điệu, bass & trống để dựng thành thanh bi lăn vật lý (cũng hỗ trợ .mid)"
                  : "Detects BPM, musical key, melody, bass & drums right in your browser (also accepts .mid)"}
              </div>
            </div>

            {importError && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  backgroundColor: "#FDF0ED",
                  border: "1px solid #CE5B46",
                  color: "#A33B29",
                  fontSize: 12,
                }}
              >
                {importError}
              </div>
            )}

            {decodedAudio && audioAnalysis && (
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                {/* Waveform Scrubber */}
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-strong)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: 11,
                      color: "var(--slate)",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <span>
                      {locale === "vi"
                        ? "Bấm lên sóng âm để chọn đoạn điệp khúc trích xuất:"
                        : "Click waveform to choose extract window:"}{" "}
                      <strong style={{ color: "var(--ink)" }}>
                        {formatTimeSec(audioStartSec)} →{" "}
                        {formatTimeSec(
                          Math.min(
                            decodedAudio.durationSec,
                            audioStartSec + (audioLoopBeats * 60) / audioAnalysis.detectedBpm
                          )
                        )}
                      </strong>
                    </span>
                    <button
                      type="button"
                      className="hw-btn"
                      onClick={toggleClipPlayback}
                      style={{
                        padding: "3px 10px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        backgroundColor: clipPlaying ? "#CE5B46" : "#ECEEE8",
                        color: clipPlaying ? "#FFFFFF" : "var(--ink)",
                        borderColor: clipPlaying ? "#CE5B46" : "var(--border)",
                      }}
                    >
                      {clipPlaying
                        ? locale === "vi"
                          ? "■ Dừng đoạn gốc"
                          : "■ Stop Original"
                        : locale === "vi"
                          ? "▶ Nghe đoạn gốc"
                          : "▶ Play Original Clip"}
                    </button>
                  </div>

                  <div
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      const winDur = (audioLoopBeats * 60) / audioAnalysis.detectedBpm;
                      const maxStart = Math.max(0, decodedAudio.durationSec - Math.min(4, winDur * 0.5));
                      const nextStart = Math.max(
                        0,
                        Math.min(maxStart, frac * decodedAudio.durationSec - winDur * 0.2)
                      );
                      stopClipPlayback();
                      setAudioStartSec(Number(nextStart.toFixed(2)));
                    }}
                    style={{
                      height: 64,
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      cursor: "pointer",
                      padding: "4px 2px",
                    }}
                  >
                    {decodedAudio.peaks.map((pk, idx) => {
                      const barTime = (idx / decodedAudio.peaks.length) * decodedAudio.durationSec;
                      const winEnd =
                        audioStartSec + (audioLoopBeats * 60) / audioAnalysis.detectedBpm;
                      const inWindow = barTime >= audioStartSec && barTime <= winEnd;
                      return (
                        <div
                          key={idx}
                          style={{
                            flex: 1,
                            height: `${Math.max(10, Math.round(pk * 100))}%`,
                            borderRadius: 2,
                            backgroundColor: inWindow
                              ? "#CE5B46"
                              : "rgba(28, 35, 33, 0.22)",
                          }}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Extraction Controls */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(175px, 1fr))",
                    gap: 10,
                    padding: 12,
                    borderRadius: 12,
                    backgroundColor: "#ECEEE8",
                    border: "1px solid var(--border)",
                  }}
                >
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      {locale === "vi" ? "Tên bài hát" : "Song Title"}
                    </span>
                    <input
                      type="text"
                      value={decodedAudio.title}
                      onChange={(e) =>
                        setDecodedAudio({ ...decodedAudio, title: e.target.value })
                      }
                      style={{
                        padding: "5px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--border-strong)",
                        fontSize: 12.5,
                      }}
                    />
                  </label>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      BPM ({locale === "vi" ? "tự dò" : "auto"}: {audioAnalysis.detectedBpm})
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type="number"
                        min={60}
                        max={160}
                        value={audioBpmOverride ?? audioAnalysis.detectedBpm}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setAudioBpmOverride(v >= 60 && v <= 160 ? v : null);
                        }}
                        style={{
                          width: 62,
                          padding: "4px 6px",
                          borderRadius: 8,
                          border: "1px solid var(--border-strong)",
                          fontFamily: "var(--font-mono)",
                        }}
                      />
                      <button
                        type="button"
                        className="hw-btn"
                        style={{ padding: "3px 7px", fontSize: 11 }}
                        onClick={() => {
                          const cur = audioBpmOverride ?? audioAnalysis.detectedBpm;
                          setAudioBpmOverride(Math.max(60, Math.round(cur / 2)));
                        }}
                      >
                        ÷2
                      </button>
                      <button
                        type="button"
                        className="hw-btn"
                        style={{ padding: "3px 7px", fontSize: 11 }}
                        onClick={() => {
                          const cur = audioBpmOverride ?? audioAnalysis.detectedBpm;
                          setAudioBpmOverride(Math.min(160, Math.round(cur * 2)));
                        }}
                      >
                        ×2
                      </button>
                    </div>
                  </div>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      {locale === "vi" ? "Độ dài vòng lặp" : "Loop Length"}
                    </span>
                    <select
                      className="hw-select"
                      value={audioLoopBeats}
                      onChange={(e) => setAudioLoopBeats(Number(e.target.value))}
                    >
                      <option value={8}>8 beats</option>
                      <option value={16}>16 beats</option>
                      <option value={24}>24 beats</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      {locale === "vi" ? "Mật độ bắt nốt" : "Note Density"}
                    </span>
                    <select
                      className="hw-select"
                      value={audioDensity}
                      onChange={(e) => setAudioDensity(e.target.value as ExtractionDensity)}
                    >
                      <option value="clean">{locale === "vi" ? "Gọn (Rõ nốt)" : "Clean"}</option>
                      <option value="balanced">{locale === "vi" ? "Cân bằng" : "Balanced"}</option>
                      <option value="rich">{locale === "vi" ? "Dày (Chi tiết)" : "Rich"}</option>
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      {locale === "vi" ? "Âm sắc giai điệu" : "Lead Voice"}
                    </span>
                    <select
                      className="hw-select"
                      value={draft.leadVoice}
                      onChange={(e) =>
                        setDraft({ ...draft, leadVoice: e.target.value as MelodicInstrumentId })
                      }
                    >
                      {LEAD_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {locale === "vi" ? v.labelVi : v.labelEn}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                    <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                      {locale === "vi" ? "Tông nhạc phát hiện" : "Detected Key"}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, height: 28 }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontWeight: 700,
                          fontSize: 12,
                          color: "var(--ink)",
                        }}
                      >
                        {audioAnalysis.keyInfo.label}
                      </span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
                        <input
                          type="checkbox"
                          checked={audioSnapKey}
                          onChange={(e) => setAudioSnapKey(e.target.checked)}
                        />
                        <span>{locale === "vi" ? "Nắn đúng tông" : "Snap Key"}</span>
                      </label>
                    </div>
                  </label>
                </div>

                {/* Extracted Lanes Summary */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={incMelody}
                        onChange={(e) => setIncMelody(e.target.checked)}
                      />
                      <span>
                        <strong>{audioAnalysis.draft.melodyNotes.length}</strong>{" "}
                        {locale === "vi" ? "Nốt giai điệu" : "Melody"}
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={incBass}
                        onChange={(e) => setIncBass(e.target.checked)}
                      />
                      <span>
                        <strong>{audioAnalysis.draft.bassNotes.length}</strong> Bass
                      </span>
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={incDrums}
                        onChange={(e) => setIncDrums(e.target.checked)}
                      />
                      <span>
                        <strong>{audioAnalysis.draft.drumNotes.length}</strong>{" "}
                        {locale === "vi" ? "Nhịp trống" : "Drums"}
                      </span>
                    </label>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--slate)" }}>
                    {locale === "vi"
                      ? "Gợi ý: mở Piano Roll nếu muốn chỉnh lại vài nốt cho sắc nét hơn."
                      : "Tip: Use Edit in Piano Roll to fine-tune extracted notes anytime."}
                  </span>
                </div>
              </div>
            )}

            {parsedMidi && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  backgroundColor: "#ECEEE8",
                  border: "1px solid var(--border)",
                }}
              >
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Tên bài hát" : "Song Title"}
                  </span>
                  <input
                    type="text"
                    value={midiFileName}
                    onChange={(e) => setMidiFileName(e.target.value)}
                    style={{
                      padding: "5px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--border-strong)",
                      fontSize: 12.5,
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Track giai điệu chính" : "Lead Melody Track"}
                  </span>
                  <select
                    className="hw-select"
                    value={leadTrackIdx ?? ""}
                    onChange={(e) =>
                      setLeadTrackIdx(e.target.value === "" ? null : Number(e.target.value))
                    }
                  >
                    <option value="">{locale === "vi" ? "(Không chọn)" : "(None)"}</option>
                    {parsedMidi.tracks.map((tr) => (
                      <option key={tr.index} value={tr.index}>
                        {tr.name} ({tr.notes.length} notes)
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Track Bass" : "Bass Track"}
                  </span>
                  <select
                    className="hw-select"
                    value={bassTrackIdx ?? ""}
                    onChange={(e) =>
                      setBassTrackIdx(e.target.value === "" ? null : Number(e.target.value))
                    }
                  >
                    <option value="">{locale === "vi" ? "(Tự tách nếu có)" : "(Auto / None)"}</option>
                    {parsedMidi.tracks.map((tr) => (
                      <option key={tr.index} value={tr.index}>
                        {tr.name} ({tr.notes.length} notes)
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Track Trống (Ch 10)" : "Drum Track (Ch 10)"}
                  </span>
                  <select
                    className="hw-select"
                    value={drumTrackIdx ?? ""}
                    onChange={(e) =>
                      setDrumTrackIdx(e.target.value === "" ? null : Number(e.target.value))
                    }
                  >
                    <option value="">{locale === "vi" ? "(Không)" : "(None)"}</option>
                    {parsedMidi.tracks.map((tr) => (
                      <option key={tr.index} value={tr.index}>
                        {tr.name} ({tr.notes.length} hits)
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Bắt đầu từ phách" : "Start Beat"}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, parsedMidi.totalBeats - 4)}
                    step={4}
                    value={midiStartBeat}
                    onChange={(e) => setMidiStartBeat(Math.max(0, Number(e.target.value) || 0))}
                    style={{
                      padding: "5px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--border-strong)",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Độ dài vòng lặp" : "Loop Length"}
                  </span>
                  <select
                    className="hw-select"
                    value={midiLoopBeats}
                    onChange={(e) => setMidiLoopBeats(Number(e.target.value))}
                  >
                    <option value={8}>8 beats</option>
                    <option value={16}>16 beats</option>
                    <option value={24}>24 beats</option>
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Lưới lượng tử" : "Quantize Grid"}
                  </span>
                  <select
                    className="hw-select"
                    value={midiQuantize}
                    onChange={(e) => setMidiQuantize(Number(e.target.value) as 0.5 | 0.25)}
                  >
                    <option value={0.5}>1/8 beat (Smooth)</option>
                    <option value={0.25}>1/16 beat (Dense)</option>
                  </select>
                </label>

                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--slate)" }}>
                    {locale === "vi" ? "Âm sắc giai điệu" : "Lead Voice"}
                  </span>
                  <select
                    className="hw-select"
                    value={draft.leadVoice}
                    onChange={(e) =>
                      setDraft({ ...draft, leadVoice: e.target.value as MelodicInstrumentId })
                    }
                  >
                    {LEAD_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {locale === "vi" ? v.labelVi : v.labelEn}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div
          style={{
            padding: "11px 18px",
            borderTop: "1px solid var(--border)",
            backgroundColor: "#ECEEE8",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 11.5, color: "var(--slate)" }}>
            {locale === "vi"
              ? "Mọi nốt nhạc sẽ tự dựng thành thanh gỗ/đồng/gốm để bi rơi trúng theo vật lý thật."
              : "Every note compiles into real angled acoustic bars synced to 120Hz ball physics."}
          </span>

          <div style={{ display: "flex", gap: 8 }}>
            {tab === "import" ? (
              <>
                <button
                  type="button"
                  disabled={!decodedAudio && !parsedMidi}
                  className="hw-btn"
                  style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 600 }}
                  onClick={() => {
                    const converted = buildImportedDraft();
                    if (converted) {
                      stopClipPlayback();
                      setDraft(converted);
                      setTab("compose");
                    }
                  }}
                >
                  {locale === "vi" ? "Mở trong Piano Roll" : "Edit in Piano Roll"}
                </button>
                <button
                  type="button"
                  disabled={!decodedAudio && !parsedMidi}
                  className="hw-btn"
                  style={{
                    padding: "6px 14px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    backgroundColor: decodedAudio || parsedMidi ? "#1C2321" : "#D6D8D0",
                    color: "#FFFFFF",
                    borderColor: "transparent",
                  }}
                  onClick={() => {
                    const converted = buildImportedDraft();
                    if (converted) {
                      stopClipPlayback();
                      handleBuildNow(converted);
                    }
                  }}
                >
                  {locale === "vi" ? "Dựng Máy Bi & Lưu" : "Build Marble Machine & Save"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="hw-btn"
                  style={{ padding: "6px 12px", fontSize: 12.5, fontWeight: 600 }}
                  onClick={() => {
                    onSaveDraft(draft);
                    synthEngine.unlock();
                    synthEngine.playUiTick();
                  }}
                >
                  {locale === "vi" ? "Lưu vào Bài của tôi" : "Save to My Songs"}
                </button>
                <button
                  type="button"
                  className="hw-btn"
                  style={{
                    padding: "6px 16px",
                    fontSize: 12.5,
                    fontWeight: 700,
                    backgroundColor: "#1C2321",
                    color: "#FFFFFF",
                    borderColor: "transparent",
                  }}
                  onClick={() => handleBuildNow(draft)}
                >
                  {locale === "vi" ? "Dựng Máy Bi trên Sân" : "Build Marble Machine"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
