import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { InstrumentManager } from "../src/audio/InstrumentManager.ts";
import type { DrumId, MelodicInstrumentId } from "../src/audio/instruments/types.ts";

class MockAudioParam {
  public value = 1;
  public calls: Array<{ fn: string; val: number; time: number }> = [];
  setValueAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ fn: "setValueAtTime", val, time });
  }
  linearRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ fn: "linearRampToValueAtTime", val, time });
  }
  exponentialRampToValueAtTime(val: number, time: number) {
    assert.ok(val > 0, `exponentialRampToValueAtTime must receive > 0 (got ${val})`);
    this.value = val;
    this.calls.push({ fn: "exponentialRampToValueAtTime", val, time });
  }
  setTargetAtTime(val: number, time: number) {
    this.value = val;
    this.calls.push({ fn: "setTargetAtTime", val, time });
  }
  cancelScheduledValues() {
    // noop
  }
}

class MockNode {
  public id: number;
  public disconnected = false;
  public connectedTo: MockNode[] = [];
  constructor(id: number) {
    this.id = id;
  }
  connect(dest: MockNode) {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockScheduledSource extends MockNode {
  public onended: (() => void) | null = null;
  public type = "sine";
  public loop = false;
  public buffer: unknown = null;
  public frequency = new MockAudioParam();
  public detune = new MockAudioParam();
  public playbackRate = new MockAudioParam();
  public startedAt = 0;
  public stoppedAt = 0;
  start(when = 0) {
    this.startedAt = when;
  }
  stop(when = 0) {
    this.stoppedAt = when;
  }
}

class MockGainNode extends MockNode {
  public gain = new MockAudioParam();
}

class MockFilterNode extends MockNode {
  public type = "lowpass";
  public frequency = new MockAudioParam();
  public Q = new MockAudioParam();
  public gain = new MockAudioParam();
}

class MockDelayNode extends MockNode {
  public delayTime = new MockAudioParam();
}

class MockCompressorNode extends MockNode {
  public threshold = new MockAudioParam();
  public knee = new MockAudioParam();
  public ratio = new MockAudioParam();
  public attack = new MockAudioParam();
  public release = new MockAudioParam();
}

class MockPannerNode extends MockNode {
  public pan = new MockAudioParam();
}

class MockConvolverNode extends MockNode {
  public buffer: unknown = null;
}

class MockAudioBuffer {
  public sampleRate: number;
  public length: number;
  public duration: number;
  private channels: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number) {
    return this.channels[ch];
  }
}

class MockAudioContext {
  public currentTime = 0;
  public sampleRate = 44100;
  public state: AudioContextState = "running";
  public destination = new MockNode(0);
  public createdNodes: MockNode[] = [];
  public scheduledSources: MockScheduledSource[] = [];
  private nextId = 1;

  private track<T extends MockNode>(n: T): T {
    this.createdNodes.push(n);
    return n;
  }
  createGain() {
    return this.track(new MockGainNode(this.nextId++));
  }
  createBiquadFilter() {
    return this.track(new MockFilterNode(this.nextId++));
  }
  createDelay() {
    return this.track(new MockDelayNode(this.nextId++));
  }
  createDynamicsCompressor() {
    return this.track(new MockCompressorNode(this.nextId++));
  }
  createStereoPanner() {
    return this.track(new MockPannerNode(this.nextId++));
  }
  createConvolver() {
    return this.track(new MockConvolverNode(this.nextId++));
  }
  createOscillator() {
    const s = this.track(new MockScheduledSource(this.nextId++));
    this.scheduledSources.push(s);
    return s;
  }
  createBufferSource() {
    const s = this.track(new MockScheduledSource(this.nextId++));
    this.scheduledSources.push(s);
    return s;
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new MockAudioBuffer(channels, length, sampleRate);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
}

// 1. Verify all 9 WAV sample files exist, have valid RIFF/WAVE header, and total < 450 KB
const samplesDir = path.resolve("public/samples");
const expectedWavs = [
  "piano/C3.wav",
  "piano/C4.wav",
  "piano/C5.wav",
  "percussion/kick.wav",
  "percussion/snare.wav",
  "percussion/hihat-closed.wav",
  "percussion/hihat-open.wav",
  "percussion/clap.wav",
  "percussion/shaker.wav",
];

let totalSampleBytes = 0;
for (const rel of expectedWavs) {
  const full = path.join(samplesDir, rel);
  assert.ok(fs.existsSync(full), `Missing sample file: ${rel}`);
  const buf = fs.readFileSync(full);
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", `Invalid RIFF in ${rel}`);
  assert.equal(buf.toString("ascii", 8, 12), "WAVE", `Invalid WAVE in ${rel}`);
  totalSampleBytes += buf.length;
}
assert.ok(
  totalSampleBytes < 450 * 1024,
  `Sample bundle too large: ${totalSampleBytes} bytes`
);
console.log(
  `[PASS] All ${expectedWavs.length} WAV samples valid (${(totalSampleBytes / 1024).toFixed(1)} KB total)`
);

// 2. Test all 8 melodic + 6 drum instruments at Low, Medium, High velocity + future 'when'
const mockCtx = new MockAudioContext();
const manager = new InstrumentManager();
manager.initWithContext(mockCtx as unknown as AudioContext);
const persistentNodeCount = mockCtx.createdNodes.length;

const melodicInstruments: MelodicInstrumentId[] = [
  "marimba",
  "brass",
  "ceramic",
  "bass",
  "piano",
  "musicBox",
  "synthLead",
  "subBass",
];
const drums: DrumId[] = [
  "kick",
  "snare",
  "hihat_closed",
  "hihat_open",
  "clap",
  "shaker",
];
const velocities = [0.22, 0.65, 1.0];

let triggerTime = 0.05;
for (const inst of melodicInstruments) {
  for (const vel of velocities) {
    manager.playNote(inst, {
      freq: inst === "bass" || inst === "subBass" ? 110 : 440,
      velocity: vel,
      when: triggerTime,
      pan: -0.3,
    });
    triggerTime += 0.02;
  }
}

for (const drum of drums) {
  for (const vel of velocities) {
    manager.playDrum(drum, { velocity: vel, when: triggerTime, pan: 0.25 });
    triggerTime += 0.02;
  }
}

assert.ok(
  manager.voiceManager.getActiveCount() <= manager.voiceManager.getMaxVoices(),
  "VoiceManager exceeded maxVoices"
);
console.log(
  `[PASS] Triggered ${melodicInstruments.length} melodic + ${drums.length} drum instruments across 3 velocities`
);

// 3. Stress-test 60 simultaneous hits -> verify voice-stealing cap & 100% node disconnect cleanup
for (let i = 0; i < 60; i++) {
  manager.playNote(melodicInstruments[i % melodicInstruments.length], {
    freq: 220 + i * 10,
    velocity: 0.85,
    when: 1.0 + i * 0.004,
  });
}
assert.ok(
  manager.voiceManager.getActiveCount() <= 28,
  `Active voices must remain <= 28 under stress (got ${manager.voiceManager.getActiveCount()})`
);
assert.ok(
  manager.voiceManager.getTotalStolen() > 0,
  "VoiceManager must steal oldest voices when polyphony limit is reached"
);

// Simulate all scheduled sources finishing
for (const src of mockCtx.scheduledSources) {
  src.onended?.();
}
assert.equal(
  manager.voiceManager.getActiveCount(),
  0,
  "All voices must be released after sources end"
);

const voiceNodes = mockCtx.createdNodes.slice(persistentNodeCount);
const leakedNodes = voiceNodes.filter((n) => !n.disconnected);
assert.equal(
  leakedNodes.length,
  0,
  `Zero AudioNodes may leak after voices end (leaked: ${leakedNodes.length})`
);
console.log(
  `[PASS] Stress test: cap<=28 enforced (${manager.voiceManager.getTotalStolen()} voices stolen cleanly), 0/${voiceNodes.length} nodes leaked`
);
