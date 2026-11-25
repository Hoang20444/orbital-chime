import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 22050
ROOT_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = ROOT_DIR / "public" / "samples"


def write_wav_mono(path: Path, samples: list[float], sample_rate: int = SAMPLE_RATE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = max((abs(s) for s in samples), default=1.0)
    scale = 0.92 / peak if peak > 0.92 else 1.0
    packed = bytearray()
    for s in samples:
        v = max(-0.98, min(0.98, s * scale))
        packed.extend(struct.pack("<h", int(v * 32767)))
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(bytes(packed))


def generate_piano_note(freq: float, duration: float = 1.15) -> list[float]:
    n_samples = int(SAMPLE_RATE * duration)
    random.seed(int(freq * 100))
    # Physical acoustic piano: slight string inharmonicity + coupled 2-string chorus + felt hammer transient
    b_inharmonic = 0.00018
    partials = [
        (1, 1.00, 1.7),
        (2, 0.42, 2.5),
        (3, 0.20, 3.4),
        (4, 0.11, 4.5),
        (5, 0.06, 5.8),
        (6, 0.03, 7.2),
    ]
    attack_len = int(0.004 * SAMPLE_RATE)
    fade_tail = int(0.08 * SAMPLE_RATE)
    out: list[float] = []
    lp = 0.0

    for i in range(n_samples):
        t = i / SAMPLE_RATE
        attack = i / attack_len if i < attack_len else 1.0
        tail = (n_samples - i) / fade_tail if i > n_samples - fade_tail else 1.0

        tone = 0.0
        for n, amp, decay_rate in partials:
            if n * freq >= SAMPLE_RATE * 0.42:
                continue
            inharm = n * math.sqrt(1.0 + b_inharmonic * n * n)
            f_n = freq * inharm
            env = math.exp(-t * decay_rate)
            # Coupled unison string slight detuning (+0.6 Hz) for organic warmth
            s1 = math.sin(2.0 * math.pi * f_n * t)
            s2 = math.sin(2.0 * math.pi * (f_n + 0.55) * t + 0.2)
            tone += (0.65 * s1 + 0.35 * s2) * amp * env

        # Soft felt hammer thump in first 14ms
        hammer = 0.0
        if t < 0.016:
            noise = random.uniform(-1.0, 1.0)
            lp = lp * 0.72 + noise * 0.28
            hammer = lp * math.exp(-t * 210.0) * 0.28

        out.append((tone * 0.52 + hammer) * attack * tail)

    return out


def generate_kick() -> list[float]:
    dur = 0.34
    n_samples = int(SAMPLE_RATE * dur)
    phase = 0.0
    out: list[float] = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        # Punchy exponential pitch sweep 148 Hz -> 46 Hz
        freq = 46.0 + 102.0 * math.exp(-t * 34.0)
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        body = math.sin(phase) * math.exp(-t * 10.5)
        # Subtle warm 2nd harmonic saturation so kick cuts through laptop speakers
        warmth = math.tanh(body * 1.6) * 0.72
        click = math.sin(2.0 * math.pi * 1650.0 * t) * math.exp(-t * 260.0) * 0.22
        env = min(1.0, i / 45.0)
        tail = (n_samples - i) / 300.0 if i > n_samples - 300 else 1.0
        out.append((warmth + click) * env * tail)
    return out


def generate_snare() -> list[float]:
    dur = 0.24
    n_samples = int(SAMPLE_RATE * dur)
    random.seed(101)
    phase = 0.0
    hp_prev = 0.0
    hp_in_prev = 0.0
    out: list[float] = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        freq = 135.0 + 62.0 * math.exp(-t * 48.0)
        phase += 2.0 * math.pi * freq / SAMPLE_RATE
        shell = math.sin(phase) * math.exp(-t * 22.0) * 0.55

        white = random.uniform(-1.0, 1.0)
        hp = 0.84 * (hp_prev + white - hp_in_prev)
        hp_prev = hp
        hp_in_prev = white
        wires = hp * math.exp(-t * 16.5) * 0.65

        env = min(1.0, i / 30.0)
        tail = (n_samples - i) / 260.0 if i > n_samples - 260 else 1.0
        out.append((shell + wires) * env * tail)
    return out


def generate_hihat(open_hat: bool) -> list[float]:
    dur = 0.38 if open_hat else 0.085
    decay = 9.5 if open_hat else 58.0
    n_samples = int(SAMPLE_RATE * dur)
    random.seed(202 if open_hat else 203)
    # 6 metallic ratios + filtered air noise
    partials = [2950.0, 3840.0, 4710.0, 5630.0, 6820.0, 7910.0]
    hp_prev = 0.0
    hp_in_prev = 0.0
    out: list[float] = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        metal = sum(math.sin(2.0 * math.pi * f * t) for f in partials) / len(partials)
        white = random.uniform(-1.0, 1.0)
        hp = 0.88 * (hp_prev + white - hp_in_prev)
        hp_prev = hp
        hp_in_prev = white
        env = math.exp(-t * decay) * min(1.0, i / 24.0)
        tail = (n_samples - i) / 240.0 if i > n_samples - 240 else 1.0
        out.append((metal * 0.38 + hp * 0.62) * env * tail)
    return out


def generate_clap() -> list[float]:
    dur = 0.22
    n_samples = int(SAMPLE_RATE * dur)
    random.seed(303)
    lp = 0.0
    hp_prev = 0.0
    hp_in_prev = 0.0
    bursts = [0.0, 0.011, 0.022, 0.034]
    out: list[float] = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        white = random.uniform(-1.0, 1.0)
        hp = 0.78 * (hp_prev + white - hp_in_prev)
        hp_prev = hp
        hp_in_prev = white
        lp = lp * 0.45 + hp * 0.55

        burst_env = 0.0
        for b_start in bursts:
            if t >= b_start:
                dt = t - b_start
                burst_env += math.exp(-dt * 120.0)
        tail_env = math.exp(-max(0.0, t - 0.032) * 18.0) * 0.65
        env = min(1.2, burst_env * 0.45 + tail_env)
        fade = (n_samples - i) / 240.0 if i > n_samples - 240 else 1.0
        out.append(lp * env * fade)
    return out


def generate_shaker() -> list[float]:
    dur = 0.11
    n_samples = int(SAMPLE_RATE * dur)
    random.seed(404)
    hp_prev = 0.0
    hp_in_prev = 0.0
    out: list[float] = []
    for i in range(n_samples):
        t = i / SAMPLE_RATE
        white = random.uniform(-1.0, 1.0)
        hp = 0.89 * (hp_prev + white - hp_in_prev)
        hp_prev = hp
        hp_in_prev = white
        env = math.sin(math.pi * min(1.0, t / dur)) ** 1.3
        out.append(hp * env * 0.65)
    return out


def main() -> None:
    write_wav_mono(SAMPLES_DIR / "piano" / "C3.wav", generate_piano_note(130.81, 1.25))
    write_wav_mono(SAMPLES_DIR / "piano" / "C4.wav", generate_piano_note(261.63, 1.15))
    write_wav_mono(SAMPLES_DIR / "piano" / "C5.wav", generate_piano_note(523.25, 1.05))

    write_wav_mono(SAMPLES_DIR / "percussion" / "kick.wav", generate_kick())
    write_wav_mono(SAMPLES_DIR / "percussion" / "snare.wav", generate_snare())
    write_wav_mono(SAMPLES_DIR / "percussion" / "hihat-closed.wav", generate_hihat(False))
    write_wav_mono(SAMPLES_DIR / "percussion" / "hihat-open.wav", generate_hihat(True))
    write_wav_mono(SAMPLES_DIR / "percussion" / "clap.wav", generate_clap())
    write_wav_mono(SAMPLES_DIR / "percussion" / "shaker.wav", generate_shaker())

    files = sorted(SAMPLES_DIR.rglob("*.wav"))
    total_bytes = sum(f.stat().st_size for f in files)
    for f in files:
        print(f"Generated {f.relative_to(ROOT_DIR)} ({f.stat().st_size} bytes)")
    print(f"Total sample bundle: {len(files)} files, {total_bytes / 1024:.1f} KB")


if __name__ == "__main__":
    main()
