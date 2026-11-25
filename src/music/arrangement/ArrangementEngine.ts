import type { MelodicInstrumentId } from "../../audio/instruments/types.ts";
import { RHYTHM_STYLES } from "../rhythm/PatternLibrary.ts";
import type { RhythmStyleId } from "../rhythm/types.ts";
import type {
  GeneratedSong,
  MusicalEvent,
  SectionType,
  SongSection,
} from "../events/MusicalEvent.ts";
import { generateBasslineBar } from "../harmony/BasslineEngine.ts";
import {
  buildVoicedProgression,
  PROGRESSIONS,
  type ProgressionId,
} from "../harmony/ChordEngine.ts";
import { generateFourBarPhrase } from "../melody/PhraseGenerator.ts";

export interface SongGenerationOptions {
  id?: string;
  titleEn?: string;
  titleVi?: string;
  bpm?: number;
  styleId: RhythmStyleId;
  progressionId: ProgressionId;
  seed: number;
}

const SECTIONS: SongSection[] = [
  { name: "intro", startBar: 1, endBar: 4 },
  { name: "verse", startBar: 5, endBar: 8 },
  { name: "chorus", startBar: 9, endBar: 12 },
  { name: "outro", startBar: 13, endBar: 16 },
];

function getSectionAtBar(bar: number): SectionType {
  const sec = SECTIONS.find((s) => bar >= s.startBar && bar <= s.endBar);
  return sec?.name ?? "verse";
}

export function arrangeSong(opts: SongGenerationOptions): GeneratedSong {
  const style = RHYTHM_STYLES[opts.styleId] ?? RHYTHM_STYLES.lofi;
  const progPreset = PROGRESSIONS[opts.progressionId] ?? PROGRESSIONS.lofi_am;
  const base4Chords = buildVoicedProgression(progPreset.id);
  const chordsByBar = Array.from({ length: 16 }, (_, i) => base4Chords[i % 4]);
  const bpm = opts.bpm ?? style.bpm;

  const events: MusicalEvent[] = [];

  for (let bar = 1; bar <= 16; bar++) {
    const section = getSectionAtBar(bar);
    const chord = chordsByBar[bar - 1];
    const nextChord = chordsByBar[bar % 16];
    const barStepBase = (bar - 1) * 16;

    // 1. Drums arranged per section intensity
    for (let s = 0; s < 16; s++) {
      const globalStep = barStepBase + s;
      const pushDrum = (
        drumId: keyof typeof style.tracks,
        velScale: number
      ) => {
        const cell = style.tracks[drumId][s];
        if (!cell?.active) return;
        events.push({
          id: `drm_${bar}_${s}_${drumId}`,
          bar,
          stepInBar: s,
          globalStep,
          durationSteps: 1,
          velocity: Math.max(0.12, Math.min(1, cell.velocity * velScale)),
          role: "drums",
          drumId,
        });
      };

      if (section === "intro") {
        // Gentle shaker & light hats only in intro
        pushDrum("shaker", 0.55);
        if (bar >= 3) pushDrum("hihat_closed", 0.45);
        if (bar === 4 && s >= 12) pushDrum("snare", 0.42);
      } else if (section === "verse") {
        pushDrum("kick", 0.88);
        pushDrum("snare", 0.82);
        pushDrum("hihat_closed", 0.72);
        pushDrum("shaker", 0.65);
      } else if (section === "chorus") {
        pushDrum("kick", 1.0);
        pushDrum("snare", 0.96);
        pushDrum("hihat_closed", 0.85);
        pushDrum("hihat_open", 0.85);
        pushDrum("clap", 0.85);
        pushDrum("shaker", 0.78);
      } else {
        // Outro winds down cleanly
        if (bar <= 14) pushDrum("kick", 0.68);
        pushDrum("shaker", 0.52);
        pushDrum("hihat_closed", 0.50);
      }
    }

    // 2. Chords arranged per section (Piano / Marimba / Ceramic)
    const chordInstrument: MelodicInstrumentId =
      section === "intro" || section === "outro"
        ? "piano"
        : section === "chorus"
          ? "piano"
          : "ceramic";

    const chordSteps =
      section === "chorus"
        ? [0, 6, 10]
        : section === "verse"
          ? [0, 8]
          : [0];

    chordSteps.forEach((step, cIdx) => {
      const dur = section === "intro" || section === "outro" ? 14 : 6;
      const vel =
        section === "chorus"
          ? cIdx === 0
            ? 0.68
            : 0.52
          : section === "verse"
            ? 0.56
            : 0.50;

      chord.voicedNotes.forEach((midi, vIdx) => {
        events.push({
          id: `chd_${bar}_${step}_${vIdx}`,
          bar,
          stepInBar: step,
          globalStep: barStepBase + step,
          durationSteps: dur,
          midi,
          velocity: vel,
          role: "chords",
          instrument: chordInstrument,
          chordSymbol: chord.symbol,
        });
      });
    });

    // 3. Chord-aware Bassline
    events.push(
      ...generateBasslineBar(bar, chord, nextChord, opts.styleId, section)
    );
  }

  // 4. Four-section Call-and-Response Melody phrases
  // Intro (bars 1-4): delicate Music Box / Marimba motif starting bar 2
  const introPhrase = generateFourBarPhrase({
    startBar: 1,
    chords: chordsByBar.slice(0, 4),
    scaleId: progPreset.scaleId,
    seed: opts.seed,
    instrument: "musicBox",
    energy: 0.72,
  }).filter((ev) => ev.bar >= 2);
  events.push(...introPhrase);

  // Verse (bars 5-8): warm Maple Marimba motif
  events.push(
    ...generateFourBarPhrase({
      startBar: 5,
      chords: chordsByBar.slice(4, 8),
      scaleId: progPreset.scaleId,
      seed: opts.seed + 1,
      instrument: "marimba",
      energy: 0.88,
    })
  );

  // Chorus (bars 9-12): lifted Synth Lead / Brass harmony hook
  const chorusInstrument: MelodicInstrumentId =
    opts.styleId === "edm" || opts.styleId === "pop" ? "synthLead" : "piano";
  const chorusMelody = generateFourBarPhrase({
    startBar: 9,
    chords: chordsByBar.slice(8, 12),
    scaleId: progPreset.scaleId,
    seed: opts.seed + 2,
    instrument: chorusInstrument,
    energy: 1.0,
  });
  events.push(...chorusMelody);

  // Subtle brass counter-accent on bar downbeats of chorus
  for (let bar = 9; bar <= 12; bar++) {
    events.push({
      id: `mel_chime_${bar}`,
      bar,
      stepInBar: 0,
      globalStep: (bar - 1) * 16,
      durationSteps: 10,
      midi: chordsByBar[bar - 1].voicedNotes[2] + 12,
      velocity: 0.62,
      role: "melody",
      instrument: "brass",
    });
  }

  // Outro (bars 13-16): soothing Music Box resolution
  events.push(
    ...generateFourBarPhrase({
      startBar: 13,
      chords: chordsByBar.slice(12, 16),
      scaleId: progPreset.scaleId,
      seed: opts.seed,
      instrument: "musicBox",
      energy: 0.74,
    }).filter((ev) => ev.bar <= 15 || ev.stepInBar <= 8)
  );

  events.sort((a, b) => a.globalStep - b.globalStep);

  return {
    id: opts.id ?? `song_${opts.styleId}_${opts.progressionId}_${opts.seed}`,
    titleEn: opts.titleEn ?? `${style.nameEn} Sketch`,
    titleVi: opts.titleVi ?? `Bản Phối ${style.nameVi}`,
    bpm,
    swing: style.swing,
    styleId: opts.styleId,
    progressionId: progPreset.id,
    scaleId: progPreset.scaleId,
    totalBars: 16,
    sections: SECTIONS,
    chordsByBar,
    events,
  };
}

export const SHOWCASE_SONGS: GeneratedSong[] = [
  arrangeSong({
    id: "lofi-sunset",
    titleEn: "Lo-Fi Sunset",
    titleVi: "Hoàng Hôn Lo-Fi",
    bpm: 84,
    styleId: "lofi",
    progressionId: "lofi_am",
    seed: 104,
  }),
  arrangeSong({
    id: "pop-horizon",
    titleEn: "Pop Horizon",
    titleVi: "Chân Trời Pop",
    bpm: 108,
    styleId: "pop",
    progressionId: "pop_lift",
    seed: 207,
  }),
];
