import type { MarbleSongDef } from "../data/marbleSongs.ts";
import {
  convertDraftToMarbleSong,
  type CustomSongDraft,
  type DrumNoteInput,
  type SongNoteInput,
} from "./midi/MidiToMarbleSong.ts";

export type { CustomSongDraft, DrumNoteInput, SongNoteInput };

const STORAGE_KEY = "orbital_chime_my_songs_v1";

export function loadCustomSongs(): CustomSongDraft[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomSongDraft[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomSong(draft: CustomSongDraft): CustomSongDraft[] {
  const existing = loadCustomSongs();
  const idx = existing.findIndex((s) => s.id === draft.id);
  const updated =
    idx >= 0
      ? existing.map((s) => (s.id === draft.id ? draft : s))
      : [draft, ...existing];
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore quota errors cleanly
    }
  }
  return updated;
}

export function deleteCustomSong(id: string): CustomSongDraft[] {
  const updated = loadCustomSongs().filter((s) => s.id !== id);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore cleanly
    }
  }
  return updated;
}

export function draftToMarbleSongDef(draft: CustomSongDraft): MarbleSongDef {
  return convertDraftToMarbleSong(draft);
}

export function marbleSongToDraft(song: MarbleSongDef): CustomSongDraft {
  const melodyNotes: SongNoteInput[] = [];
  const bassNotes: SongNoteInput[] = [];
  const drumNotes: DrumNoteInput[] = [];
  let leadVoice = song.chains[0]?.defaultInstrument ?? "piano";
  let bassVoice: CustomSongDraft["bassVoice"] = "bass";

  for (const chain of song.chains) {
    const isBass = chain.trackChannel.includes("bass");
    if (isBass && chain.defaultInstrument) {
      bassVoice = chain.defaultInstrument;
    } else if (!chain.trackChannel.includes("perc") && chain.defaultInstrument) {
      leadVoice = chain.defaultInstrument;
    }

    for (const n of chain.notes) {
      if (n.drum) {
        drumNotes.push({ beat: n.beat, drum: n.drum });
      } else if (n.midi !== undefined) {
        if (isBass) {
          bassNotes.push({ beat: n.beat, midi: n.midi });
        } else {
          melodyNotes.push({ beat: n.beat, midi: n.midi });
        }
      }
    }
  }

  return {
    id: `remix_${song.id}_${Date.now()}`,
    title: `${song.titleEn} Remix`,
    bpm: song.bpm,
    loopBeats: Math.min(24, song.loopBeats),
    leadVoice,
    bassVoice,
    melodyNotes,
    bassNotes,
    drumNotes,
    createdAt: Date.now(),
  };
}

export function createBlankDraft(): CustomSongDraft {
  return {
    id: `custom_${Date.now()}`,
    title: "My Marble Melody",
    bpm: 108,
    loopBeats: 16,
    leadVoice: "piano",
    bassVoice: "bass",
    melodyNotes: [
      { beat: 0, midi: 64 },
      { beat: 0.5, midi: 67 },
      { beat: 1, midi: 72 },
      { beat: 1.5, midi: 71 },
      { beat: 2, midi: 69 },
      { beat: 3, midi: 67 },
      { beat: 4, midi: 65 },
      { beat: 5, midi: 64 },
    ],
    bassNotes: [
      { beat: 0, midi: 48 },
      { beat: 2, midi: 43 },
      { beat: 4, midi: 41 },
      { beat: 6, midi: 43 },
    ],
    drumNotes: [
      { beat: 0, drum: "kick" },
      { beat: 1, drum: "clap" },
      { beat: 2, drum: "kick" },
      { beat: 3, drum: "snare" },
      { beat: 4, drum: "kick" },
      { beat: 5, drum: "clap" },
      { beat: 6, drum: "kick" },
      { beat: 7, drum: "hihat_closed" },
    ],
    createdAt: Date.now(),
  };
}
