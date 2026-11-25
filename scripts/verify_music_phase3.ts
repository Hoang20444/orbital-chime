import assert from "node:assert/strict";
import { InstrumentManager } from "../src/audio/InstrumentManager.ts";
import { FIXED_DT, stepFixed } from "../src/engine/physics.ts";
import {
  arrangeSong,
  SHOWCASE_SONGS,
} from "../src/music/arrangement/ArrangementEngine.ts";
import { generateBasslineBar } from "../src/music/harmony/BasslineEngine.ts";
import {
  buildVoicedProgression,
  getChordPitchClasses,
  PROGRESSIONS,
  type ProgressionId,
} from "../src/music/harmony/ChordEngine.ts";
import {
  buildKineticStageForSong,
  computeCueMarbleLaunch,
  CUE_LEAD_SEC,
} from "../src/music/events/PhysicsAdapter.ts";
import { generateFourBarPhrase } from "../src/music/melody/PhraseGenerator.ts";
import { SongDirector } from "../src/music/SongDirector.ts";

class MockParam {
  public value = 1;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
  }
  exponentialRampToValueAtTime(v: number) {
    assert.ok(v > 0);
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues() {}
}

class MockNode {
  public disconnected = false;
  connect(d: MockNode) {
    return d;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockSource extends MockNode {
  public onended: (() => void) | null = null;
  public loop = false;
  public buffer: unknown = null;
  public frequency = new MockParam();
  public detune = new MockParam();
  public playbackRate = new MockParam();
  start() {}
  stop() {}
}

class MockGain extends MockNode {
  public gain = new MockParam();
}
class MockFilter extends MockNode {
  public type = "lowpass";
  public frequency = new MockParam();
  public Q = new MockParam();
  public gain = new MockParam();
}
class MockDelay extends MockNode {
  public delayTime = new MockParam();
}
class MockComp extends MockNode {
  public threshold = new MockParam();
  public knee = new MockParam();
  public ratio = new MockParam();
  public attack = new MockParam();
  public release = new MockParam();
}
class MockPan extends MockNode {
  public pan = new MockParam();
}
class MockConv extends MockNode {
  public buffer: unknown = null;
}

class MockCtx {
  public currentTime = 0;
  public sampleRate = 44100;
  public state: AudioContextState = "running";
  public destination = new MockNode();
  public nodes: MockNode[] = [];
  public sources: MockSource[] = [];
  private track<T extends MockNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  createGain() {
    return this.track(new MockGain());
  }
  createBiquadFilter() {
    return this.track(new MockFilter());
  }
  createDelay() {
    return this.track(new MockDelay());
  }
  createDynamicsCompressor() {
    return this.track(new MockComp());
  }
  createStereoPanner() {
    return this.track(new MockPan());
  }
  createConvolver() {
    return this.track(new MockConv());
  }
  createOscillator() {
    const s = this.track(new MockSource());
    this.sources.push(s);
    return s;
  }
  createBufferSource() {
    const s = this.track(new MockSource());
    this.sources.push(s);
    return s;
  }
  createBuffer(_c: number, l: number, sr: number) {
    const d = new Float32Array(l);
    return { sampleRate: sr, length: l, duration: l / sr, getChannelData: () => d };
  }
  resume() {
    return Promise.resolve();
  }
}

// 1. ChordEngine smooth voice-leading across all 5 progressions
for (const pid of Object.keys(PROGRESSIONS) as ProgressionId[]) {
  const voiced = buildVoicedProgression(pid);
  assert.equal(voiced.length, 4);
  let totalMove = 0;
  let count = 0;
  for (let i = 1; i < voiced.length; i++) {
    const prev = voiced[i - 1].voicedNotes;
    const cur = voiced[i].voicedNotes;
    const len = Math.min(prev.length, cur.length);
    for (let k = 0; k < len; k++) {
      totalMove += Math.abs(cur[k] - prev[k]);
      count++;
    }
  }
  const avgMove = totalMove / count;
  assert.ok(avgMove <= 4.5, `Voice leading too jumpy in ${pid}: avg=${avgMove.toFixed(2)}`);
}
console.log("[PASS] ChordEngine voice-leading verified across all 5 progressions");

// 2. BasslineEngine beat-1 root alignment
for (const pid of Object.keys(PROGRESSIONS) as ProgressionId[]) {
  const chords = buildVoicedProgression(pid);
  const evs = generateBasslineBar(5, chords[0], chords[1], "pop", "verse");
  assert.ok(evs.length >= 2);
  assert.equal(evs[0].stepInBar, 0);
  assert.equal(evs[0].midi! % 12, chords[0].rootMidi % 12);
}
console.log("[PASS] BasslineEngine root alignment verified");

// 3. PhraseGenerator Call-and-Response (A == A' rhythm, Bar 4 resolution on chord tone)
{
  const chords = buildVoicedProgression("lofi_am");
  const phrase = generateFourBarPhrase({
    startBar: 1,
    chords,
    scaleId: "a_minor9",
    seed: 104,
    instrument: "marimba",
    energy: 0.9,
  });
  const bar1Steps = phrase.filter((e) => e.bar === 1).map((e) => e.stepInBar);
  const bar2Steps = phrase.filter((e) => e.bar === 2).map((e) => e.stepInBar);
  assert.deepEqual(bar1Steps, bar2Steps, "Motif A' must preserve Motif A rhythmic steps");

  const bar4Notes = phrase.filter((e) => e.bar === 4);
  const finalNote = bar4Notes[bar4Notes.length - 1];
  const bar4ChordPcs = getChordPitchClasses(chords[3].rootMidi, chords[3].quality);
  assert.ok(
    bar4ChordPcs.includes(finalNote.midi! % 12),
    "Bar 4 final note must resolve onto a Bar 4 chord tone"
  );
  console.log("[PASS] PhraseGenerator A -> A' -> B -> Resolution verified");
}

// 4. Full 16-bar SongDirector playback for both flagship songs (0 leaked AudioNodes, all 4 roles)
for (const song of SHOWCASE_SONGS) {
  const ctx = new MockCtx();
  const manager = new InstrumentManager();
  manager.initWithContext(ctx as unknown as AudioContext);
  const persistentNodes = ctx.nodes.length;

  const director = new SongDirector(manager);
  director.loadSong(song, false);
  director.setLoopEnabled(false);

  const spawnedCues: number[] = [];
  director.onSpawnCue(() => spawnedCues.push(1));

  const rolesPlayed = new Set<string>();
  const origNote = manager.playNote.bind(manager);
  const origDrum = manager.playDrum.bind(manager);
  manager.playNote = (inst, opts) => {
    rolesPlayed.add(inst);
    origNote(inst, opts);
  };
  manager.playDrum = (d, opts) => {
    rolesPlayed.add(d);
    origDrum(d, opts);
  };

  director.start();
  const durSec = (16 * 4 * 60) / song.bpm + 1.0;
  const pumps = Math.ceil(durSec / 0.025);
  for (let i = 0; i < pumps; i++) {
    ctx.currentTime += 0.025;
    director.scheduler.pump();
    assert.ok(manager.voiceManager.getActiveCount() <= 28);
  }

  for (const s of ctx.sources) s.onended?.();
  const leaked = ctx.nodes.slice(persistentNodes).filter((n) => !n.disconnected);
  assert.equal(leaked.length, 0, `Leaked audio nodes in ${song.id}: ${leaked.length}`);
  assert.ok(spawnedCues.length >= 20, `Expected >= 20 marble cues in ${song.id}`);
  assert.ok(rolesPlayed.has("kick") && rolesPlayed.has("piano"));
  director.scheduler.dispose();
  console.log(
    `[PASS] "${song.titleEn}" (${song.bpm} BPM, ~${Math.round((64 * 60) / song.bpm)}s): ${spawnedCues.length} marble cues, 0 leaked nodes`
  );
}

// 5. PhysicsAdapter IK cue precision check (impact within +-2 ticks of CUE_LEAD_SEC)
{
  const song = arrangeSong({ styleId: "pop", progressionId: "pop_lift", seed: 11 });
  const { world, targets } = buildKineticStageForSong(song);
  const bar = world.bars.find((b) => b.id === targets.melodyBarIds[3])!;
  const midX = (bar.ax + bar.bx) * 0.5;
  const midY = (bar.ay + bar.by) * 0.5;

  const marble = computeCueMarbleLaunch({
    targetId: bar.id,
    targetX: midX,
    targetY: midY,
    targetHalfThickness: 6,
    leadSec: CUE_LEAD_SEC,
    marbleId: 1,
    silentCue: true,
    arcSide: 0.4,
  });
  world.marbles.push(marble);

  let hitTick = -1;
  const maxTicks = Math.round(0.65 / FIXED_DT);
  for (let t = 0; t < maxTicks; t++) {
    const events = stepFixed(world, true);
    if (events.some((e) => e.type === "bar_hit" && e.barId === bar.id)) {
      hitTick = t;
      break;
    }
  }
  assert.ok(hitTick > 0, "IK cue marble must hit target bar");
  const hitTime = (hitTick + 1) * FIXED_DT;
  const deltaMs = Math.abs(hitTime - CUE_LEAD_SEC) * 1000;
  assert.ok(
    deltaMs <= 18,
    `IK cue hit timing drift too large: expected ${CUE_LEAD_SEC}s, got ${hitTime.toFixed(4)}s (${deltaMs.toFixed(1)}ms)`
  );
  console.log(`[PASS] PhysicsAdapter IK cue hit within ${deltaMs.toFixed(2)}ms of target ${CUE_LEAD_SEC}s`);
}
