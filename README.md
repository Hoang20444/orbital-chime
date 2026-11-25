# Orbital Chime

A sunlit, matte architectural **kinetic music toy & physics puzzle** built with TypeScript, HTML5 Canvas (`120Hz` deterministic physics), and pure **Web Audio API** acoustic synthesis.

## Features

- **4 Physical Acoustic Materials (100% Web Audio API)**:
  - **Maple Marimba** (`#D49B54`): Warm wooden fundamental + fast 4th-harmonic decay + mallet click transient.
  - **Brushed Brass** (`#B58D3D`): High-rebound metallic chime with shimmering bell partials.
  - **Celadon Ceramic** (`#4D8A78`): Glassy harmonic bell with gentle beating shimmer.
  - **Slate Felt Bass** (`#466982`): Warm low-octave anchor with filtered transient punch.
  - Plus **1.85s procedural stereo studio reverb**, stereo panning mapped to canvas X, velocity-mapped timbre, and master dynamics compression.
- **12-Track Puzzle Album**: Learn naturally through trajectory feedback without text-heavy tutorials (bars, bumpers, prism splitters, polyrhythms).
- **Sandbox Studio**: Unlimited instruments, 5 harmonious scales, live BPM control (`60–150`), 3 ready-made musical presets, and **URL Share Links** (`#s=...`).
- **Bilingual UI**: 1-click **EN / VI** toggle.

## Controls

- **Drag on empty canvas**: Draw a new musical bar (length tunes its pitch along the active scale).
- **Drag bar body / endpoints**: Move, rotate, and tune live with real-time trajectory preview.
- **Right-click / `Delete`**: Remove selected piece (`Ctrl+Z` to undo, `R` to reset).
- **`Space`**: Play / Pause · **`1–4`**: Switch material · **`H`**: Toggle hint outline (Puzzle mode).

## Development & Publishing (itch.io)

```bash
npm install
npm run dev
npm run build
```

Upload `orbital-chime-itch.zip` directly to **itch.io** as an HTML5 project (`Kind of project: HTML`, enable *"This file will be played in the browser"*, recommended viewport `1280x720`, check *Fullscreen button*).

## YouTube Shorts 9:16 Showcase Hook Idea

> *"I built a music game with zero audio files—every wooden bar you draw plays a real harmonic note."*
> Record Track 01 → Track 07 (Prism Chord) → Sandbox *Perpetual Fountain* preset in vertical viewport, with crisp live bar flex and captions.
