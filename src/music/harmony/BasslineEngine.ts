import type {
  ChordSpec,
  MusicalEvent,
  SectionType,
} from "../events/MusicalEvent.ts";
import type { RhythmStyleId } from "../rhythm/types.ts";

function bassRootMidi(chordRoot: number): number {
  let m = chordRoot;
  while (m > 47) m -= 12; // place solidly in E1..B2 (MIDI 28..47)
  while (m < 33) m += 12;
  return m;
}

export function generateBasslineBar(
  barNumber: number,
  chord: ChordSpec,
  nextChord: ChordSpec,
  styleId: RhythmStyleId,
  section: SectionType
): MusicalEvent[] {
  if (section === "intro") {
    // Sparse warm bass swell only on bars 3-4 of intro
    if (barNumber < 3) return [];
    const root = bassRootMidi(chord.rootMidi);
    return [
      {
        id: `bass_${barNumber}_0`,
        bar: barNumber,
        stepInBar: 0,
        globalStep: (barNumber - 1) * 16,
        durationSteps: 12,
        midi: root,
        velocity: 0.62,
        role: "bass",
        instrument: "subBass",
      },
    ];
  }

  const root = bassRootMidi(chord.rootMidi);
  const fifth = root + 7;
  const octave = root + 12;
  const nextRoot = bassRootMidi(nextChord.rootMidi);
  const approach = nextRoot > root ? nextRoot - 1 : nextRoot + 2;
  const instrument = styleId === "funk" || styleId === "pop" ? "bass" : "subBass";
  const events: MusicalEvent[] = [];

  const pushNote = (step: number, midi: number, dur: number, vel: number) => {
    events.push({
      id: `bass_${barNumber}_${step}`,
      bar: barNumber,
      stepInBar: step,
      globalStep: (barNumber - 1) * 16 + step,
      durationSteps: dur,
      midi,
      velocity: section === "chorus" ? Math.min(1, vel + 0.08) : vel,
      role: "bass",
      instrument,
    });
  };

  if (section === "outro") {
    pushNote(0, root, 10, 0.64);
    pushNote(10, fifth, 4, 0.48);
    return events;
  }

  if (styleId === "lofi" || styleId === "hiphop") {
    pushNote(0, root, 6, 0.84);
    pushNote(6, fifth, 3, 0.62);
    pushNote(10, root, 4, 0.74);
    if (section === "chorus") {
      pushNote(14, approach, 2, 0.56);
    }
  } else if (styleId === "edm") {
    // Driving offbeat / 8th groove
    for (let s = 0; s < 16; s += 2) {
      const isDown = s % 4 === 0;
      pushNote(s, isDown ? root : octave, 2, isDown ? 0.82 : 0.68);
    }
  } else if (styleId === "funk") {
    pushNote(0, root, 3, 0.86);
    pushNote(3, octave, 2, 0.64);
    pushNote(6, fifth, 3, 0.72);
    pushNote(10, root, 2, 0.78);
    pushNote(12, fifth, 2, 0.68);
    pushNote(14, approach, 2, 0.74);
  } else {
    // Pop pocket
    pushNote(0, root, 5, 0.84);
    pushNote(6, root, 2, 0.64);
    pushNote(8, fifth, 4, 0.74);
    pushNote(12, octave, 2, 0.66);
    pushNote(14, approach, 2, 0.62);
  }

  return events;
}
