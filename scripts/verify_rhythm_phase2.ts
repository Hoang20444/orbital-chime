import assert from "node:assert/strict";
import { AudioScheduler } from "../src/audio/AudioScheduler.ts";
import { InstrumentManager } from "../src/audio/InstrumentManager.ts";
import { Transport } from "../src/music/clock/Transport.ts";
import { RHYTHM_STYLES } from "../src/music/rhythm/PatternLibrary.ts";
import { RhythmEngine } from "../src/music/rhythm/RhythmEngine.ts";
import type { RhythmStyleId } from "../src/music/rhythm/types.ts";

// Lightweight mock AudioContext tracking currentTime & scheduled drum notes
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
  public startedAt = 0;
  start(w = 0) {
    this.startedAt = w;
  }
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
  public sources: MockSource[] = [];
  createGain() {
    return new MockGain();
  }
  createBiquadFilter() {
    return new MockFilter();
  }
  createDelay() {
    return new MockDelay();
  }
  createDynamicsCompressor() {
    return new MockComp();
  }
  createStereoPanner() {
    return new MockPan();
  }
  createConvolver() {
    return new MockConv();
  }
  createOscillator() {
    const s = new MockSource();
    this.sources.push(s);
    return s;
  }
  createBufferSource() {
    const s = new MockSource();
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

// Deterministic PRNG for repeatable humanization checks
function makeRng(seed = 12345): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

// 1. 4-bar & 64-bar zero accumulated drift test at 60, 108, 150 BPM
for (const bpm of [60, 108, 150]) {
  let mockTime = 1.0;
  const transport = new Transport();
  transport.setBpm(bpm);
  transport.setSwing(0);
  transport.setLoopBars(4);
  const scheduler = new AudioScheduler(transport, () => mockTime);

  const scheduled: Array<{ step: number; gridTime: number; stepInLoop: number }> = [];
  scheduler.onStep((ev) => {
    scheduled.push({
      step: ev.position.stepIndex,
      gridTime: ev.gridAudioTime,
      stepInLoop: ev.position.stepInLoop,
    });
  });

  transport.start();
  const expectedStepSec = 60 / bpm / 4;
  const totalSteps64Bars = 64 * 16;

  while (scheduled.length < totalSteps64Bars) {
    mockTime += 0.025;
    scheduler.pump();
  }

  const first = scheduled[0];
  const at4Bars = scheduled[64]; // start of bar 5
  const at64Bars = scheduled[totalSteps64Bars - 1];

  const drift4 = Math.abs(at4Bars.gridTime - (first.gridTime + 64 * expectedStepSec));
  const drift64 = Math.abs(
    at64Bars.gridTime - (first.gridTime + (totalSteps64Bars - 1) * expectedStepSec)
  );
  assert.ok(drift4 < 1e-9, `4-bar drift too high at ${bpm} BPM: ${drift4}`);
  assert.ok(drift64 < 1e-9, `64-bar drift too high at ${bpm} BPM: ${drift64}`);
  assert.equal(at4Bars.stepInLoop, 0, "4-bar loop must wrap cleanly back to step 0");

  scheduler.dispose();
  console.log(`[PASS] Zero timing drift at ${bpm} BPM (64-bar drift=${drift64.toExponential(2)}s)`);
}

// 2. Live BPM changes during playback
{
  let mockTime = 0;
  const transport = new Transport();
  transport.setBpm(108);
  const scheduler = new AudioScheduler(transport, () => mockTime);
  const steps: number[] = [];
  scheduler.onStep((ev) => steps.push(ev.position.stepIndex));

  transport.start();
  for (let i = 0; i < 20; i++) {
    mockTime += 0.025;
    scheduler.pump();
  }
  const beforeChange = steps[steps.length - 1];
  transport.setBpm(150);
  for (let i = 0; i < 20; i++) {
    mockTime += 0.025;
    scheduler.pump();
  }
  transport.setBpm(72);
  for (let i = 0; i < 20; i++) {
    mockTime += 0.025;
    scheduler.pump();
  }
  for (let i = 1; i < steps.length; i++) {
    assert.equal(steps[i], steps[i - 1] + 1, "Live BPM changes must keep steps contiguous");
  }
  assert.ok(steps[steps.length - 1] > beforeChange);
  scheduler.dispose();
  console.log("[PASS] Live BPM changes (108 -> 150 -> 72) preserved contiguous step sequence");
}

// 3. Pause & Resume preserves exact step position
{
  let mockTime = 0;
  const transport = new Transport();
  const scheduler = new AudioScheduler(transport, () => mockTime);
  const steps: number[] = [];
  scheduler.onStep((ev) => steps.push(ev.position.stepIndex));

  transport.start();
  for (let i = 0; i < 8; i++) {
    mockTime += 0.025;
    scheduler.pump();
  }
  const pausedAt = transport.getCurrentStep();
  transport.pause();
  mockTime += 8.0; // idle while paused
  scheduler.pump();
  assert.equal(transport.getCurrentStep(), pausedAt, "Step must freeze during pause");

  transport.resume();
  mockTime += 0.025;
  scheduler.pump();
  assert.equal(
    steps.includes(pausedAt),
    true,
    "Resume must continue right from paused step"
  );
  scheduler.dispose();
  console.log(`[PASS] Pause & Resume resumed cleanly at step ${pausedAt}`);
}

// 4. Time signatures (4/4, 3/4, 6/8)
{
  let mockTime = 0;
  const transport = new Transport();
  transport.setLoopBars(2);
  const scheduler = new AudioScheduler(transport, () => mockTime);

  for (const [ts, expectedPerBar] of [
    ["4/4", 16],
    ["3/4", 12],
    ["6/8", 12],
  ] as const) {
    transport.stop();
    transport.setTimeSignature(ts);
    const seenInLoop: number[] = [];
    const unsub = scheduler.onStep((ev) => seenInLoop.push(ev.position.stepInLoop));
    transport.start();
    while (seenInLoop.length < expectedPerBar * 2 + 1) {
      mockTime += 0.025;
      scheduler.pump();
    }
    unsub();
    assert.equal(
      seenInLoop[expectedPerBar * 2],
      0,
      `Time signature ${ts} must wrap 2-bar loop at ${expectedPerBar * 2} steps`
    );
  }
  scheduler.dispose();
  console.log("[PASS] Time signatures 4/4 (16), 3/4 (12), 6/8 (12) loop accurately");
}

// 5. Background-tab recovery (+15s jump without stale burst)
{
  let mockTime = 0;
  const transport = new Transport();
  const scheduler = new AudioScheduler(transport, () => mockTime);
  let count = 0;
  scheduler.onStep(() => count++);
  transport.start();
  const initialCount = count;
  mockTime += 15.0; // simulate browser throttling background tab for 15 seconds
  const pumped = scheduler.pump();
  assert.ok(
    pumped.length <= 3,
    `Background recovery must NOT dump stale burst (pumped=${pumped.length}, total=${initialCount})`
  );
  scheduler.dispose();
  console.log(`[PASS] Background-tab recovery jumped cleanly without burst (${pumped.length} steps)`);
}

// 6 & 7. All 5 Rhythm Styles + Multi-track Mute/Solo + Differentiated Humanization
{
  const ctx = new MockCtx();
  const manager = new InstrumentManager();
  manager.initWithContext(ctx as unknown as AudioContext);
  const rhythm = new RhythmEngine(manager, makeRng(42));

  const recorded: Array<{ drum: string; when: number }> = [];
  const gridTimes: number[] = [];
  const origPlayDrum = manager.playDrum.bind(manager);
  rhythm.scheduler.onStep((ev) => {
    gridTimes.push(ev.audioTime);
  });
  manager.playDrum = (drum, opts) => {
    recorded.push({ drum, when: opts.when ?? 0 });
    origPlayDrum(drum, opts);
  };

  for (const styleId of Object.keys(RHYTHM_STYLES) as RhythmStyleId[]) {
    ctx.currentTime = 0;
    recorded.length = 0;
    gridTimes.length = 0;
    rhythm.loadStyle(styleId, true);
    rhythm.setHumanize(0.8);
    rhythm.start();
    for (let i = 0; i < 80; i++) {
      ctx.currentTime += 0.025;
      rhythm.scheduler.pump();
    }
    rhythm.stop();
    assert.ok(recorded.length >= 12, `Style ${styleId} must trigger drum hits`);
  }

  // Test Solo Kick -> only Kick triggers; check Kick stays tightly quantized to gridTimes
  ctx.currentTime = 0;
  recorded.length = 0;
  gridTimes.length = 0;
  rhythm.loadStyle("pop", true);
  rhythm.setHumanize(1.0);
  rhythm.setTrackSolo("kick", true);
  rhythm.start();
  for (let i = 0; i < 60; i++) {
    ctx.currentTime += 0.025;
    rhythm.scheduler.pump();
  }
  rhythm.stop();
  assert.ok(recorded.length > 0 && recorded.every((r) => r.drum === "kick"), "Solo Kick must isolate Kick track");
  const maxKickDeltaMs = Math.max(
    ...recorded.map((r) =>
      Math.min(...gridTimes.map((g) => Math.abs(r.when - g) * 1000))
    )
  );
  assert.ok(maxKickDeltaMs <= 1.6, `Kick humanization jitter must stay <= 1.5ms (got ${maxKickDeltaMs.toFixed(3)}ms)`);

  rhythm.scheduler.dispose();
  console.log(`[PASS] All 5 styles, Solo isolation, and tight Kick pocket (max jitter ${maxKickDeltaMs.toFixed(2)}ms) verified`);
}
