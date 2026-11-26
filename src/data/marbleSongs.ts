import type { DrumId, MelodicInstrumentId } from "../audio/instruments/types.ts";
import { midiToName } from "../audio/scales.ts";
import type { MaterialType, ScaleId } from "../engine/types.ts";

export interface SongHitNote {
  /** Score beat time relative to beat 0 (before lead-in drop shift) */
  beat: number;
  /** Exact MIDI note number for melodic hits */
  midi?: number;
  /** Exact drum sound for percussion hits */
  drum?: DrumId;
  /** Optional instrument override (otherwise mapped by lane/timbre) */
  instrument?: MelodicInstrumentId;
  /** Visual bar material */
  material: MaterialType;
  /** Override visual label */
  label?: string;
}

export interface SongPhraseChain {
  id: string;
  /** Collision lane so parallel balls only strike their own score rails + user-drawn bars */
  trackChannel: string;
  /** Top Y anchor in world coordinates */
  startY: number;
  /** Starting X coordinate */
  startX: number;
  /** Right X corridor bound for zigzag sweeps */
  maxX: number;
  /** Left X corridor bound for zigzag sweeps */
  minX?: number;
  /** Horizontal travel baseline per hop */
  stepX: number;
  /** Gentle vertical cascade drop bias per beat */
  dropPerHit: number;
  /** Sculpted bar visual length */
  barLen: number;
  /** Default melodic instrument for this lane */
  defaultInstrument: MelodicInstrumentId;
  /** Notes in strict chronological order */
  notes: SongHitNote[];
}

export interface MarbleSongDef {
  id: string;
  titleEn: string;
  titleVi: string;
  composer: string;
  subtitleEn: string;
  subtitleVi: string;
  bpm: number;
  scaleId: ScaleId;
  loopBeats: number;
  chains: SongPhraseChain[];
}

function m(
  beat: number,
  midi: number,
  material: MaterialType = "ceramic",
  instrument?: MelodicInstrumentId
): SongHitNote {
  return {
    beat,
    midi,
    material,
    instrument,
    label: midiToName(midi),
  };
}

function d(
  beat: number,
  drum: DrumId,
  material: MaterialType = "bass",
  label?: string
): SongHitNote {
  return {
    beat,
    drum,
    material,
    label: label ?? drum.toUpperCase(),
  };
}

export const MARBLE_SONGS: MarbleSongDef[] = [
  {
    id: "fur_elise",
    titleEn: "Für Elise",
    titleVi: "Für Elise (Beethoven)",
    composer: "L. v. Beethoven",
    subtitleEn: "Continuous right-hand melody + parallel left-hand arpeggio cascade",
    subtitleVi: "Giai điệu piano liên hoàn song song bè trầm rơi từ trên xuống dưới",
    bpm: 96,
    scaleId: "a_minor9",
    loopBeats: 24,
    chains: [
      {
        id: "melody",
        trackChannel: "melody",
        minX: 55,
        startX: 110,
        maxX: 465,
        startY: 132,
        stepX: 82,
        dropPerHit: 28,
        barLen: 52,
        defaultInstrument: "piano",
        notes: [
          m(0.0, 76, "ceramic"), // E5
          m(0.5, 75, "brass"),   // D#5
          m(1.0, 76, "ceramic"), // E5
          m(1.5, 75, "brass"),   // D#5
          m(2.0, 76, "ceramic"), // E5
          m(2.5, 71, "marimba"), // B4
          m(3.0, 74, "ceramic"), // D5
          m(3.5, 72, "marimba"), // C5
          m(4.0, 69, "marimba"), // A4
          m(5.5, 60, "marimba"), // C4
          m(6.0, 64, "marimba"), // E4
          m(6.5, 69, "ceramic"), // A4
          m(7.0, 71, "ceramic"), // B4
          m(8.5, 64, "marimba"), // E4
          m(9.0, 68, "brass"),   // G#4
          m(9.5, 71, "ceramic"), // B4
          m(10.0, 72, "ceramic"), // C5
          m(11.5, 64, "marimba"), // E4
          m(12.0, 76, "ceramic"), // E5
          m(12.5, 75, "brass"),   // D#5
          m(13.0, 76, "ceramic"), // E5
          m(13.5, 75, "brass"),   // D#5
          m(14.0, 76, "ceramic"), // E5
          m(14.5, 71, "marimba"), // B4
          m(15.0, 74, "ceramic"), // D5
          m(15.5, 72, "marimba"), // C5
          m(16.0, 69, "marimba"), // A4
          m(17.5, 60, "marimba"), // C4
          m(18.0, 64, "marimba"), // E4
          m(18.5, 69, "ceramic"), // A4
          m(19.0, 71, "ceramic"), // B4
          m(20.5, 64, "marimba"), // E4
          m(21.0, 72, "ceramic"), // C5
          m(21.5, 71, "marimba"), // B4
          m(22.0, 69, "ceramic"), // A4
        ],
      },
      {
        id: "bass",
        trackChannel: "bass",
        minX: 535,
        startX: 590,
        maxX: 945,
        startY: 132,
        stepX: 84,
        dropPerHit: 28,
        barLen: 58,
        defaultInstrument: "piano",
        notes: [
          m(4.0, 45, "bass"), // A2
          m(4.5, 52, "bass"), // E3
          m(5.0, 57, "bass"), // A3
          m(7.0, 40, "bass"), // E2
          m(7.5, 52, "bass"), // E3
          m(8.0, 56, "bass"), // G#3
          m(10.0, 45, "bass"), // A2
          m(10.5, 52, "bass"), // E3
          m(11.0, 57, "bass"), // A3
          m(16.0, 45, "bass"), // A2
          m(16.5, 52, "bass"), // E3
          m(17.0, 57, "bass"), // A3
          m(19.0, 40, "bass"), // E2
          m(19.5, 52, "bass"), // E3
          m(20.0, 56, "bass"), // G#3
          m(22.0, 45, "bass"), // A2
          m(22.5, 52, "bass"), // E3
          m(23.0, 57, "bass"), // A3
        ],
      },
    ],
  },
  {
    id: "havana_groove",
    titleEn: "Havana Groove",
    titleVi: "Havana — Latin Groove",
    composer: "Latin Pop (G Minor)",
    subtitleEn: "Parallel Melody, Tresillo Drums & Habanera Bass cascading together",
    subtitleVi: "3 quả bóng Giai điệu + Trống Tresillo + Bass rơi song song theo zigzag",
    bpm: 105,
    scaleId: "g_dorian",
    loopBeats: 16,
    chains: [
      {
        id: "melody",
        trackChannel: "melody",
        minX: 40,
        startX: 85,
        maxX: 335,
        startY: 132,
        stepX: 82,
        dropPerHit: 30,
        barLen: 50,
        defaultInstrument: "piano",
        notes: [
          m(0.0, 67, "marimba"),  // G4
          m(0.5, 70, "ceramic"),  // Bb4
          m(1.0, 70, "ceramic"),  // Bb4
          m(1.5, 67, "marimba"),  // G4
          m(2.0, 67, "marimba"),  // G4
          m(2.5, 62, "marimba"),  // D4
          m(4.0, 67, "marimba"),  // G4
          m(4.5, 69, "marimba"),  // A4
          m(5.0, 70, "ceramic"),  // Bb4
          m(5.5, 74, "brass"),    // D5
          m(6.0, 72, "ceramic"),  // C5
          m(6.5, 70, "ceramic"),  // Bb4
          m(7.0, 69, "marimba"),  // A4
          m(8.0, 69, "marimba"),  // A4
          m(8.5, 70, "ceramic"),  // Bb4
          m(9.0, 69, "marimba"),  // A4
          m(9.5, 67, "marimba"),  // G4
          m(10.0, 66, "brass"),   // F#4
          m(10.5, 67, "marimba"), // G4
          m(11.0, 69, "brass"),   // A4
          m(12.0, 70, "ceramic"), // Bb4
          m(12.5, 70, "ceramic"), // Bb4
          m(13.0, 69, "marimba"), // A4
          m(13.5, 67, "marimba"), // G4
          m(14.5, 62, "marimba"), // D4
        ],
      },
      {
        id: "perc",
        trackChannel: "perc",
        minX: 375,
        startX: 420,
        maxX: 655,
        startY: 132,
        stepX: 82,
        dropPerHit: 30,
        barLen: 50,
        defaultInstrument: "bass",
        notes: [
          d(0.0, "kick", "bass", "KICK"),
          d(1.0, "clap", "marimba", "CLAP"),
          d(1.5, "kick", "bass", "KICK"),
          d(2.0, "snare", "brass", "SNARE"),
          d(3.0, "kick", "bass", "KICK"),
          d(3.5, "shaker", "marimba", "SHK"),
          d(4.0, "kick", "bass", "KICK"),
          d(5.0, "clap", "marimba", "CLAP"),
          d(5.5, "kick", "bass", "KICK"),
          d(6.0, "snare", "brass", "SNARE"),
          d(7.0, "kick", "bass", "KICK"),
          d(7.5, "hihat_closed", "ceramic", "HAT"),
          d(8.0, "kick", "bass", "KICK"),
          d(9.0, "clap", "marimba", "CLAP"),
          d(9.5, "kick", "bass", "KICK"),
          d(10.0, "snare", "brass", "SNARE"),
          d(11.0, "kick", "bass", "KICK"),
          d(11.5, "shaker", "marimba", "SHK"),
          d(12.0, "kick", "bass", "KICK"),
          d(13.0, "clap", "marimba", "CLAP"),
          d(13.5, "kick", "bass", "KICK"),
          d(14.0, "snare", "brass", "SNARE"),
          d(15.0, "kick", "bass", "KICK"),
        ],
      },
      {
        id: "bass",
        trackChannel: "bass",
        minX: 695,
        startX: 740,
        maxX: 970,
        startY: 132,
        stepX: 84,
        dropPerHit: 30,
        barLen: 58,
        defaultInstrument: "bass",
        notes: [
          m(0.0, 43, "bass"),  // G2
          m(1.5, 50, "bass"),  // D3
          m(3.0, 43, "bass"),  // G2
          m(4.0, 39, "bass"),  // Eb2
          m(5.5, 46, "bass"),  // Bb2
          m(7.0, 38, "bass"),  // D2
          m(8.0, 43, "bass"),  // G2
          m(9.5, 50, "bass"),  // D3
          m(11.0, 43, "bass"), // G2
          m(12.0, 39, "bass"), // Eb2
          m(13.5, 46, "bass"), // Bb2
          m(15.0, 38, "bass"), // D2
        ],
      },
    ],
  },
  {
    id: "canon_in_d",
    titleEn: "Canon in D",
    titleVi: "Canon in D (Pachelbel)",
    composer: "J. Pachelbel",
    subtitleEn: "Continuous baroque chime waterfall + descending 8-note bass ground",
    subtitleVi: "Thác nhạc chuông Pachelbel chảy liên tục cùng vòng bass 8 nốt song song",
    bpm: 84,
    scaleId: "f_lydian",
    loopBeats: 16,
    chains: [
      {
        id: "melody",
        trackChannel: "melody",
        minX: 55,
        startX: 110,
        maxX: 465,
        startY: 132,
        stepX: 82,
        dropPerHit: 28,
        barLen: 52,
        defaultInstrument: "musicBox",
        notes: [
          m(0.0, 78, "ceramic"), // F#5
          m(1.0, 76, "ceramic"), // E5
          m(2.0, 74, "ceramic"), // D5
          m(3.0, 73, "brass"),   // C#5
          m(4.0, 71, "marimba"), // B4
          m(5.0, 69, "marimba"), // A4
          m(6.0, 71, "marimba"), // B4
          m(7.0, 73, "brass"),   // C#5
          m(8.0, 74, "ceramic"), // D5
          m(8.5, 73, "brass"),   // C#5
          m(9.0, 71, "marimba"), // B4
          m(9.5, 69, "marimba"), // A4
          m(10.0, 67, "marimba"), // G4
          m(10.5, 66, "brass"),   // F#4
          m(11.0, 67, "marimba"), // G4
          m(11.5, 64, "marimba"), // E4
          m(12.0, 62, "marimba"), // D4
          m(12.5, 66, "brass"),   // F#4
          m(13.0, 69, "ceramic"), // A4
          m(13.5, 67, "marimba"), // G4
          m(14.0, 66, "brass"),   // F#4
          m(14.5, 62, "marimba"), // D4
          m(15.0, 66, "brass"),   // F#4
          m(15.5, 64, "marimba"), // E4
        ],
      },
      {
        id: "bass",
        trackChannel: "bass",
        minX: 535,
        startX: 590,
        maxX: 945,
        startY: 132,
        stepX: 84,
        dropPerHit: 28,
        barLen: 58,
        defaultInstrument: "bass",
        notes: [
          m(0.0, 50, "bass"),  // D3
          m(1.0, 45, "bass"),  // A2
          m(2.0, 47, "bass"),  // B2
          m(3.0, 42, "bass"),  // F#2
          m(4.0, 43, "bass"),  // G2
          m(5.0, 38, "bass"),  // D2
          m(6.0, 43, "bass"),  // G2
          m(7.0, 45, "bass"),  // A2
          m(8.0, 50, "bass"),  // D3
          m(9.0, 45, "bass"),  // A2
          m(10.0, 47, "bass"), // B2
          m(11.0, 42, "bass"), // F#2
          m(12.0, 43, "bass"), // G2
          m(13.0, 38, "bass"), // D2
          m(14.0, 43, "bass"), // G2
          m(15.0, 45, "bass"), // A2
        ],
      },
    ],
  },
  {
    id: "ode_to_joy",
    titleEn: "Ode to Joy",
    titleVi: "Ode to Joy (Beethoven)",
    composer: "L. v. Beethoven",
    subtitleEn: "Continuous Beethoven cascade with synchronized bass pillars",
    subtitleVi: "Giai điệu Giao hưởng số 9 nảy zigzag liên tục cùng bè trầm song song",
    bpm: 112,
    scaleId: "c_pentatonic",
    loopBeats: 32,
    chains: [
      {
        id: "melody",
        trackChannel: "melody",
        minX: 55,
        startX: 110,
        maxX: 465,
        startY: 132,
        stepX: 82,
        dropPerHit: 28,
        barLen: 52,
        defaultInstrument: "brass",
        notes: [
          m(0.0, 66, "marimba"), // F#4
          m(1.0, 66, "marimba"), // F#4
          m(2.0, 67, "ceramic"), // G4
          m(3.0, 69, "ceramic"), // A4
          m(4.0, 69, "ceramic"), // A4
          m(5.0, 67, "ceramic"), // G4
          m(6.0, 66, "marimba"), // F#4
          m(7.0, 64, "marimba"), // E4
          m(8.0, 62, "marimba"), // D4
          m(9.0, 62, "marimba"), // D4
          m(10.0, 64, "marimba"), // E4
          m(11.0, 66, "ceramic"), // F#4
          m(12.0, 66, "brass"),   // F#4
          m(13.5, 64, "marimba"), // E4
          m(14.0, 64, "marimba"), // E4
          m(16.0, 66, "marimba"), // F#4
          m(17.0, 66, "marimba"), // F#4
          m(18.0, 67, "ceramic"), // G4
          m(19.0, 69, "ceramic"), // A4
          m(20.0, 69, "ceramic"), // A4
          m(21.0, 67, "ceramic"), // G4
          m(22.0, 66, "marimba"), // F#4
          m(23.0, 64, "marimba"), // E4
          m(24.0, 62, "marimba"), // D4
          m(25.0, 62, "marimba"), // D4
          m(26.0, 64, "marimba"), // E4
          m(27.0, 66, "ceramic"), // F#4
          m(28.0, 64, "brass"),   // E4
          m(29.5, 62, "ceramic"), // D4
          m(30.0, 62, "ceramic"), // D4
        ],
      },
      {
        id: "bass",
        trackChannel: "bass",
        minX: 535,
        startX: 590,
        maxX: 945,
        startY: 132,
        stepX: 84,
        dropPerHit: 28,
        barLen: 58,
        defaultInstrument: "bass",
        notes: [
          m(0.0, 50, "bass"),  // D3
          m(2.0, 57, "bass"),  // A3
          m(4.0, 45, "bass"),  // A2
          m(6.0, 52, "bass"),  // E3
          m(8.0, 50, "bass"),  // D3
          m(10.0, 54, "bass"), // F#3
          m(12.0, 45, "bass"), // A2
          m(14.0, 52, "bass"), // E3
          m(16.0, 50, "bass"), // D3
          m(18.0, 57, "bass"), // A3
          m(20.0, 45, "bass"), // A2
          m(22.0, 52, "bass"), // E3
          m(24.0, 43, "bass"), // G2
          m(26.0, 50, "bass"), // D3
          m(28.0, 45, "bass"), // A2
          m(30.0, 38, "bass"), // D2
        ],
      },
    ],
  },
];
