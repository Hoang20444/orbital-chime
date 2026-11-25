import type { DrumId, MelodicInstrumentId } from "../../audio/instruments/types.ts";
import { midiToName } from "../../audio/scales.ts";
import type { MarbleSongDef, SongHitNote, SongPhraseChain } from "../../data/marbleSongs.ts";
import type { MaterialType } from "../../engine/types.ts";
import { gmDrumMidiToDrumId, type ParsedMidiFile } from "./MidiParser.ts";

export interface SongNoteInput {
  beat: number;
  midi: number;
}

export interface DrumNoteInput {
  beat: number;
  drum: DrumId;
}

export interface CustomSongDraft {
  id: string;
  title: string;
  bpm: number;
  loopBeats: number;
  leadVoice: MelodicInstrumentId;
  bassVoice: MelodicInstrumentId;
  melodyNotes: SongNoteInput[];
  bassNotes: SongNoteInput[];
  drumNotes: DrumNoteInput[];
  createdAt: number;
}

const DRUM_PRIORITY: Record<DrumId, number> = {
  kick: 6,
  snare: 5,
  clap: 4,
  hihat_open: 3,
  hihat_closed: 2,
  shaker: 1,
};

function materialForMelodicMidi(midi: number, isBass: boolean): MaterialType {
  if (isBass || midi < 55) return "bass";
  if (midi >= 74) return "ceramic";
  if (midi >= 68 && (midi % 12 === 1 || midi % 12 === 3 || midi % 12 === 6 || midi % 12 === 8 || midi % 12 === 10)) {
    return "brass";
  }
  return "marimba";
}

function materialForDrum(drum: DrumId): MaterialType {
  if (drum === "kick") return "bass";
  if (drum === "snare") return "brass";
  if (drum === "hihat_closed" || drum === "hihat_open") return "ceramic";
  return "marimba";
}

function drumLabel(drum: DrumId): string {
  switch (drum) {
    case "kick":
      return "KICK";
    case "snare":
      return "SNARE";
    case "clap":
      return "CLAP";
    case "hihat_closed":
      return "HAT";
    case "hihat_open":
      return "OHAT";
    case "shaker":
      return "SHK";
  }
}

function quantizeAndReduceMelodic(
  notes: SongNoteInput[],
  loopBeats: number,
  step: number,
  pickMode: "highest" | "lowest"
): SongNoteInput[] {
  const slots = new Map<number, number>();
  for (const n of notes) {
    const q = Math.round(n.beat / step) * step;
    if (q < 0 || q >= loopBeats - 1e-6) continue;
    const key = Math.round(q * 100);
    const prev = slots.get(key);
    if (prev === undefined) {
      slots.set(key, n.midi);
    } else if (pickMode === "highest" ? n.midi > prev : n.midi < prev) {
      slots.set(key, n.midi);
    }
  }
  return Array.from(slots.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, midi]) => ({ beat: k / 100, midi }));
}

function quantizeAndReduceDrums(
  notes: DrumNoteInput[],
  loopBeats: number,
  step: number
): DrumNoteInput[] {
  const slots = new Map<number, DrumId>();
  for (const n of notes) {
    const q = Math.round(n.beat / step) * step;
    if (q < 0 || q >= loopBeats - 1e-6) continue;
    const key = Math.round(q * 100);
    const prev = slots.get(key);
    if (prev === undefined || DRUM_PRIORITY[n.drum] > DRUM_PRIORITY[prev]) {
      slots.set(key, n.drum);
    }
  }
  return Array.from(slots.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, drum]) => ({ beat: k / 100, drum }));
}

/**
 * Partition chronological notes into safe physical chains so:
 * 1) Every chain has <= maxNotesPerChain (fitting cleanly on screen with >= 46px bar separation).
 * 2) Consecutive notes in the SAME chain ALWAYS have dtSec >= minHopSec (~0.26s, so impactSpeed > 45 > 32).
 *    Faster 1/16th subdivisions automatically interleave onto alternating lanes!
 */
function partitionSafeChains(
  notes: SongHitNote[],
  bpm: number,
  maxNotesPerChain = 16
): SongHitNote[][] {
  if (notes.length === 0) return [];
  const minHopBeats = Math.max(0.45, (0.27 * bpm) / 60);
  // Prevent multi-second rests from forcing huge parabolic launches (> MAX_SPEED)
  const maxHopBeats = Math.max(1.5, (1.35 * bpm) / 60);
  const chains: SongHitNote[][] = [];

  for (const note of notes) {
    let placed = false;
    for (const ch of chains) {
      if (ch.length >= maxNotesPerChain) continue;
      const last = ch[ch.length - 1];
      const dt = note.beat - last.beat;
      if (dt >= minHopBeats - 1e-4 && dt <= maxHopBeats + 1e-4) {
        ch.push(note);
        placed = true;
        break;
      }
    }
    if (!placed) {
      chains.push([note]);
    }
  }
  return chains;
}

export function convertDraftToMarbleSong(draft: CustomSongDraft): MarbleSongDef {
  const bpm = Math.max(55, Math.min(165, Math.round(draft.bpm || 104)));
  const loopBeats = Math.max(4, Math.min(64, Math.round(draft.loopBeats || 16)));

  const melClean = quantizeAndReduceMelodic(draft.melodyNotes, loopBeats, 0.25, "highest");
  const bassClean = quantizeAndReduceMelodic(draft.bassNotes, loopBeats, 0.25, "lowest");
  const drumClean = quantizeAndReduceDrums(draft.drumNotes, loopBeats, 0.25);

  const melHitNotes: SongHitNote[] = melClean.map((n) => ({
    beat: n.beat,
    midi: n.midi,
    material: materialForMelodicMidi(n.midi, false),
    instrument: draft.leadVoice,
    label: midiToName(n.midi),
  }));

  const bassHitNotes: SongHitNote[] = bassClean.map((n) => ({
    beat: n.beat,
    midi: n.midi,
    material: "bass",
    instrument: draft.bassVoice,
    label: midiToName(n.midi),
  }));

  const drumHitNotes: SongHitNote[] = drumClean.map((n) => ({
    beat: n.beat,
    drum: n.drum,
    material: materialForDrum(n.drum),
    label: drumLabel(n.drum),
  }));

  // Partition into safe chains; keep total rows compact (max 4 visual tiers if all 3 tracks are full)
  const melGroups = partitionSafeChains(melHitNotes, bpm, 16);
  const drumGroups = partitionSafeChains(drumHitNotes, bpm, 16);
  const bassGroups = partitionSafeChains(bassHitNotes, bpm, 16);

  interface GroupEntry {
    kind: "mel" | "drum" | "bass";
    notes: SongHitNote[];
    defaultInstrument: MelodicInstrumentId;
  }

  const orderedGroups: GroupEntry[] = [];
  for (const g of melGroups.slice(0, 2)) {
    orderedGroups.push({
      kind: "mel",
      notes: g,
      defaultInstrument: draft.leadVoice,
    });
  }
  for (const g of drumGroups.slice(0, 2)) {
    orderedGroups.push({
      kind: "drum",
      notes: g,
      defaultInstrument: "bass",
    });
  }
  for (const g of bassGroups.slice(0, 2)) {
    orderedGroups.push({
      kind: "bass",
      notes: g,
      defaultInstrument: draft.bassVoice,
    });
  }

  // Fallback if completely empty draft
  if (orderedGroups.length === 0) {
    orderedGroups.push({
      kind: "mel",
      defaultInstrument: draft.leadVoice,
      notes: [
        { beat: 0, midi: 60, material: "marimba", instrument: draft.leadVoice, label: "C4" },
        { beat: 1, midi: 64, material: "marimba", instrument: draft.leadVoice, label: "E4" },
        { beat: 2, midi: 67, material: "ceramic", instrument: draft.leadVoice, label: "G4" },
        { beat: 3, midi: 72, material: "ceramic", instrument: draft.leadVoice, label: "C5" },
      ],
    });
  }

  // Distribute startY cleanly across [140..605] (>= 110px tier spacing -> zero emitter overlap!)
  const finalGroups = orderedGroups.slice(0, 5);
  const count = finalGroups.length;
  const startYForIndex = (idx: number): number => {
    if (count === 1) return 260;
    if (count === 2) return idx === 0 ? 185 : 410;
    if (count === 3) return [150, 355, 555][idx] ?? 355;
    if (count === 4) return [142, 286, 435, 582][idx] ?? 400;
    return [136, 252, 368, 484, 600][idx] ?? 400;
  };

  const chains: SongPhraseChain[] = finalGroups.map((g, idx) => ({
    id: `${g.kind}_${idx}`,
    trackChannel: `lane_${g.kind}_${idx}`,
    startX: 90,
    startY: startYForIndex(idx),
    maxX: 910,
    stepX: g.notes.length <= 8 ? 82 : 55,
    dropPerHit: 6,
    barLen: g.kind === "bass" ? 50 : 44,
    defaultInstrument: g.defaultInstrument,
    notes: g.notes,
  }));

  return {
    id: draft.id,
    titleEn: draft.title || "Custom Song",
    titleVi: draft.title || "Bài nhạc tự tạo",
    composer: "Player Studio",
    subtitleEn: `${bpm} BPM · ${loopBeats} beats`,
    subtitleVi: `${bpm} BPM · ${loopBeats} phách`,
    bpm,
    scaleId: "a_minor9",
    loopBeats,
    chains,
  };
}

export interface MidiImportOptions {
  title?: string;
  leadTrackIndex?: number | null;
  bassTrackIndex?: number | null;
  drumTrackIndex?: number | null;
  startBeat?: number;
  loopBeats?: number;
  quantizeStep?: 0.5 | 0.25;
  leadVoice?: MelodicInstrumentId;
  bassVoice?: MelodicInstrumentId;
}

export function autoPickMidiTrackRoles(parsed: ParsedMidiFile): {
  leadTrackIndex: number | null;
  bassTrackIndex: number | null;
  drumTrackIndex: number | null;
} {
  const drumTrack = parsed.tracks.find((t) => t.isPercussion) ?? null;
  const melodicTracks = parsed.tracks.filter((t) => !t.isPercussion);

  let leadTrackIndex: number | null = null;
  let bassTrackIndex: number | null = null;

  if (melodicTracks.length === 1) {
    leadTrackIndex = melodicTracks[0].index;
  } else if (melodicTracks.length >= 2) {
    const byAvgDesc = [...melodicTracks].sort((a, b) => b.avgMidi - a.avgMidi);
    leadTrackIndex = byAvgDesc[0].index;
    const lowCandidate = byAvgDesc[byAvgDesc.length - 1];
    if (lowCandidate.index !== leadTrackIndex && lowCandidate.avgMidi < 60) {
      bassTrackIndex = lowCandidate.index;
    }
  }

  return {
    leadTrackIndex,
    bassTrackIndex,
    drumTrackIndex: drumTrack ? drumTrack.index : null,
  };
}

export function midiToCustomSongDraft(
  parsed: ParsedMidiFile,
  opts: MidiImportOptions = {}
): CustomSongDraft {
  const autoRoles = autoPickMidiTrackRoles(parsed);
  const leadIdx =
    opts.leadTrackIndex !== undefined ? opts.leadTrackIndex : autoRoles.leadTrackIndex;
  const bassIdx =
    opts.bassTrackIndex !== undefined ? opts.bassTrackIndex : autoRoles.bassTrackIndex;
  const drumIdx =
    opts.drumTrackIndex !== undefined ? opts.drumTrackIndex : autoRoles.drumTrackIndex;

  const startBeat = Math.max(0, opts.startBeat ?? 0);
  const loopBeats = Math.max(4, Math.min(32, opts.loopBeats ?? 16));
  const step = opts.quantizeStep ?? 0.5;

  const collectMelodic = (trackIdx: number | null, mode: "highest" | "lowest"): SongNoteInput[] => {
    if (trackIdx === null) return [];
    const track = parsed.tracks.find((t) => t.index === trackIdx);
    if (!track) return [];
    const sliced: SongNoteInput[] = [];
    for (const n of track.notes) {
      const rel = n.startBeat - startBeat;
      if (rel >= -0.05 && rel < loopBeats - 0.05) {
        sliced.push({
          beat: Math.max(0, rel),
          midi: n.midi,
        });
      }
    }
    return quantizeAndReduceMelodic(sliced, loopBeats, step, mode);
  };

  let melodyNotes = collectMelodic(leadIdx, "highest");
  let bassNotes = collectMelodic(bassIdx, "lowest");

  // If single-track piano MIDI has bass notes (< 54) + melody notes (>= 54) on the SAME track, split cleanly!
  if (leadIdx !== null && bassIdx === null) {
    const leadTrack = parsed.tracks.find((t) => t.index === leadIdx);
    if (leadTrack) {
      const highOnly: SongNoteInput[] = [];
      const lowOnly: SongNoteInput[] = [];
      for (const n of leadTrack.notes) {
        const rel = n.startBeat - startBeat;
        if (rel >= -0.05 && rel < loopBeats - 0.05) {
          if (n.midi < 55) lowOnly.push({ beat: Math.max(0, rel), midi: n.midi });
          else highOnly.push({ beat: Math.max(0, rel), midi: n.midi });
        }
      }
      if (highOnly.length > 0 && lowOnly.length >= 3) {
        melodyNotes = quantizeAndReduceMelodic(highOnly, loopBeats, step, "highest");
        bassNotes = quantizeAndReduceMelodic(lowOnly, loopBeats, step, "lowest");
      }
    }
  }

  const drumNotesRaw: DrumNoteInput[] = [];
  if (drumIdx !== null) {
    const dTrack = parsed.tracks.find((t) => t.index === drumIdx);
    if (dTrack) {
      for (const n of dTrack.notes) {
        const rel = n.startBeat - startBeat;
        if (rel >= -0.05 && rel < loopBeats - 0.05) {
          drumNotesRaw.push({
            beat: Math.max(0, rel),
            drum: gmDrumMidiToDrumId(n.midi),
          });
        }
      }
    }
  }
  const drumNotes = quantizeAndReduceDrums(drumNotesRaw, loopBeats, step);

  return {
    id: `custom_${Date.now()}`,
    title: opts.title?.trim() || "Imported MIDI Song",
    bpm: parsed.bpm,
    loopBeats,
    leadVoice: opts.leadVoice ?? "piano",
    bassVoice: opts.bassVoice ?? "bass",
    melodyNotes,
    bassNotes,
    drumNotes,
    createdAt: Date.now(),
  };
}
