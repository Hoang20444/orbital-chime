import type { DrumId } from "../../audio/instruments/types.ts";

export interface ParsedMidiNote {
  midi: number;
  velocity: number;
  channel: number;
  startTick: number;
  durationTicks: number;
  startBeat: number;
  durationBeats: number;
}

export interface ParsedMidiTrack {
  index: number;
  name: string;
  notes: ParsedMidiNote[];
  channels: number[];
  isPercussion: boolean;
  avgMidi: number;
  minMidi: number;
  maxMidi: number;
}

export interface ParsedMidiFile {
  format: number;
  ticksPerQuarter: number;
  bpm: number;
  totalBeats: number;
  tracks: ParsedMidiTrack[];
}

class BinaryCursor {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  public offset = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.bytes = buffer;
      this.view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength
      );
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
  }

  public get length(): number {
    return this.bytes.byteLength;
  }

  public readU8(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error("Unexpected EOF while reading MIDI byte");
    }
    return this.bytes[this.offset++];
  }

  public peekU8(): number {
    if (this.offset >= this.bytes.length) {
      throw new Error("Unexpected EOF while peeking MIDI byte");
    }
    return this.bytes[this.offset];
  }

  public readU16(): number {
    if (this.offset + 2 > this.bytes.length) {
      throw new Error("Unexpected EOF while reading MIDI uint16");
    }
    const v = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return v;
  }

  public readU32(): number {
    if (this.offset + 4 > this.bytes.length) {
      throw new Error("Unexpected EOF while reading MIDI uint32");
    }
    const v = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return v;
  }

  public readAscii(len: number): string {
    if (this.offset + len > this.bytes.length) {
      throw new Error("Unexpected EOF while reading MIDI ASCII chunk");
    }
    let out = "";
    for (let i = 0; i < len; i++) {
      out += String.fromCharCode(this.bytes[this.offset + i]);
    }
    this.offset += len;
    return out;
  }

  public readVLQ(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.readU8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) return value;
    }
    return value;
  }

  public skip(n: number): void {
    this.offset = Math.min(this.bytes.length, this.offset + Math.max(0, n));
  }
}

export function gmDrumMidiToDrumId(midi: number): DrumId {
  // General MIDI Channel 10 Percussion Map
  if (midi === 35 || midi === 36 || midi === 41 || midi === 43) return "kick";
  if (midi === 38 || midi === 40 || midi === 45 || midi === 47 || midi === 48 || midi === 50) {
    return "snare";
  }
  if (midi === 37 || midi === 39) return "clap";
  if (midi === 46 || midi === 49 || midi === 51 || midi === 52 || midi === 53 || midi === 55 || midi === 57 || midi === 59) {
    return "hihat_open";
  }
  if (midi === 42 || midi === 44) return "hihat_closed";
  if (midi === 54 || midi === 56 || midi === 69 || midi === 70 || midi === 82) {
    return "shaker";
  }
  return "hihat_closed";
}

export function parseMidiBuffer(data: ArrayBuffer | Uint8Array): ParsedMidiFile {
  const cur = new BinaryCursor(data);
  const headerTag = cur.readAscii(4);
  if (headerTag !== "MThd") {
    throw new Error("Invalid MIDI file: missing MThd header");
  }
  const headerLen = cur.readU32();
  if (headerLen < 6) {
    throw new Error("Invalid MIDI header length");
  }
  const format = cur.readU16();
  const trackCount = cur.readU16();
  const division = cur.readU16();
  if (headerLen > 6) {
    cur.skip(headerLen - 6);
  }
  // Support standard PPQ; if SMPTE timecode bit is set, fallback cleanly
  const ticksPerQuarter =
    (division & 0x8000) === 0 ? Math.max(1, division) : 480;

  let detectedBpm = 112;
  let tempoFound = false;
  let maxTick = 0;

  const parsedTracks: ParsedMidiTrack[] = [];

  for (let t = 0; t < trackCount && cur.offset + 8 <= cur.length; t++) {
    const tag = cur.readAscii(4);
    const chunkLen = cur.readU32();
    const chunkEnd = Math.min(cur.length, cur.offset + chunkLen);

    if (tag !== "MTrk") {
      cur.offset = chunkEnd;
      continue;
    }

    let tick = 0;
    let runningStatus = 0;
    let trackName = `Track ${t + 1}`;

    const active = new Map<
      string,
      { startTick: number; velocity: number; channel: number; midi: number }[]
    >();
    const rawNotes: ParsedMidiNote[] = [];
    const channelCounts = new Map<number, number>();

    while (cur.offset < chunkEnd) {
      const delta = cur.readVLQ();
      tick += delta;
      if (cur.offset >= chunkEnd) break;

      const peek = cur.peekU8();
      let status: number;
      if ((peek & 0x80) !== 0) {
        status = cur.readU8();
        if (status < 0xf0) {
          runningStatus = status;
        }
      } else {
        if (runningStatus === 0) {
          break;
        }
        status = runningStatus;
      }

      if (status === 0xff) {
        // Meta event
        if (cur.offset >= chunkEnd) break;
        const metaType = cur.readU8();
        const metaLen = cur.readVLQ();
        const metaEnd = Math.min(chunkEnd, cur.offset + metaLen);

        if (metaType === 0x51 && metaLen === 3 && cur.offset + 3 <= chunkEnd) {
          const b0 = cur.readU8();
          const b1 = cur.readU8();
          const b2 = cur.readU8();
          const usPerQuarter = (b0 << 16) | (b1 << 8) | b2;
          if (usPerQuarter > 0 && !tempoFound) {
            detectedBpm = Math.max(55, Math.min(180, Math.round(60_000_000 / usPerQuarter)));
            tempoFound = true;
          }
        } else if (metaType === 0x03 && metaLen > 0) {
          let label = "";
          while (cur.offset < metaEnd) {
            const c = cur.readU8();
            if (c >= 32 && c < 127) label += String.fromCharCode(c);
          }
          if (label.trim()) {
            trackName = label.trim();
          }
        } else if (metaType === 0x2f) {
          cur.offset = metaEnd;
          break;
        }
        cur.offset = metaEnd;
      } else if (status === 0xf0 || status === 0xf7) {
        const syxLen = cur.readVLQ();
        cur.offset = Math.min(chunkEnd, cur.offset + syxLen);
      } else {
        const eventType = status & 0xf0;
        const channel = status & 0x0f;

        if (eventType === 0xc0 || eventType === 0xd0) {
          if (cur.offset < chunkEnd) cur.readU8();
        } else {
          if (cur.offset + 2 > chunkEnd) {
            cur.offset = chunkEnd;
            break;
          }
          const d1 = cur.readU8();
          const d2 = cur.readU8();

          if (eventType === 0x90 && d2 > 0) {
            const key = `${channel}:${d1}`;
            const stack = active.get(key) ?? [];
            stack.push({
              startTick: tick,
              velocity: d2,
              channel,
              midi: d1,
            });
            active.set(key, stack);
            channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
          } else if (eventType === 0x80 || (eventType === 0x90 && d2 === 0)) {
            const key = `${channel}:${d1}`;
            const stack = active.get(key);
            if (stack && stack.length > 0) {
              const started = stack.pop()!;
              const dur = Math.max(1, tick - started.startTick);
              rawNotes.push({
                midi: started.midi,
                velocity: started.velocity,
                channel: started.channel,
                startTick: started.startTick,
                durationTicks: dur,
                startBeat: started.startTick / ticksPerQuarter,
                durationBeats: dur / ticksPerQuarter,
              });
            }
          }
        }
      }
    }

    // Flush any dangling notes at track end
    for (const stack of active.values()) {
      for (const started of stack) {
        const dur = Math.max(ticksPerQuarter / 2, tick - started.startTick);
        rawNotes.push({
          midi: started.midi,
          velocity: started.velocity,
          channel: started.channel,
          startTick: started.startTick,
          durationTicks: dur,
          startBeat: started.startTick / ticksPerQuarter,
          durationBeats: dur / ticksPerQuarter,
        });
      }
    }

    maxTick = Math.max(maxTick, tick);
    cur.offset = chunkEnd;

    if (rawNotes.length > 0) {
      rawNotes.sort((a, b) => a.startTick - b.startTick || b.midi - a.midi);
      let sumMidi = 0;
      let minMidi = 127;
      let maxMidi = 0;
      let ch9Count = 0;
      for (const n of rawNotes) {
        sumMidi += n.midi;
        if (n.midi < minMidi) minMidi = n.midi;
        if (n.midi > maxMidi) maxMidi = n.midi;
        if (n.channel === 9) ch9Count++;
      }
      const channels = Array.from(channelCounts.keys()).sort((a, b) => a - b);
      parsedTracks.push({
        index: parsedTracks.length,
        name: trackName,
        notes: rawNotes,
        channels,
        isPercussion: ch9Count >= rawNotes.length * 0.5,
        avgMidi: sumMidi / rawNotes.length,
        minMidi,
        maxMidi,
      });
    }
  }

  return {
    format,
    ticksPerQuarter,
    bpm: detectedBpm,
    totalBeats: Math.max(4, Math.ceil(maxTick / ticksPerQuarter)),
    tracks: parsedTracks,
  };
}
