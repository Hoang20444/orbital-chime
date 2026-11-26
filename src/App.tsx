import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lengthToNote } from "./audio/scales.ts";
import { synthEngine } from "./audio/synthEngine.ts";
import { rhythmEngine } from "./music/rhythm/rhythmSingleton.ts";
import { BarInspectorPill } from "./components/BarInspectorPill.tsx";
import { DockBar } from "./components/DockBar.tsx";
import { RailInspectorPill } from "./components/RailInspectorPill.tsx";
import { SongStudioModal } from "./components/SongStudioModal.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { WinBanner } from "./components/WinBanner.tsx";
import {
  deleteCustomSong,
  loadCustomSongs,
  saveCustomSong,
  type CustomSongDraft,
} from "./music/customSongsStore.ts";
import { LEVELS } from "./data/levels.ts";
import { MARBLE_SONGS } from "./data/marbleSongs.ts";
import { SANDBOX_PRESETS } from "./data/presets.ts";
import { sculptMarbleSong } from "./music/MarbleSongSculptor.ts";
import {
  barLength,
  closestPointOnSegment,
  distSq,
  FIXED_DT,
  simulateGhostPath,
  stepFixed,
} from "./engine/physics.ts";
import {
  computeViewport,
  renderWorld,
  screenToWorld,
  type CameraState,
  type ViewportTransform,
} from "./engine/renderer.ts";
import { OrbitalRenderer3D } from "./engine/renderer3d.ts";
import {
  applyEditableSnapshot,
  cloneEditableSnapshot,
  decodeSandboxShareHash,
  encodeSandboxShareHash,
  type EditableSnapshot,
} from "./engine/serializer.ts";
import { buildRailGeometry } from "./engine/railGeometry.ts";
import type {
  BarPiece,
  MaterialType,
  PieceBudget,
  ScaleId,
  ToolType,
  TransferRailPiece,
  WorldState,
} from "./engine/types.ts";
import {
  createWorldFromLevel,
  createWorldFromPreset,
} from "./engine/worldFactory.ts";
import { I18N, type Locale } from "./i18n.ts";
import { MATERIALS, STAGE_H, STAGE_W, TOKENS } from "./theme/tokens.ts";

const COMPLETED_STORAGE_KEY = "orbital_chime_completed_v1";

function isMaterialTool(tool: ToolType): tool is MaterialType {
  return (
    tool === "marimba" ||
    tool === "brass" ||
    tool === "ceramic" ||
    tool === "bass"
  );
}

type DragState =
  | { kind: "none" }
  | {
      kind: "draw_bar";
      ax: number;
      ay: number;
      bx: number;
      by: number;
      material: MaterialType;
      lastDegree: number;
    }
  | {
      kind: "move_bar";
      id: string;
      startWorldX: number;
      startWorldY: number;
      origAx: number;
      origAy: number;
      origBx: number;
      origBy: number;
      snapshotBefore: EditableSnapshot;
    }
  | {
      kind: "drag_end";
      id: string;
      end: "a" | "b";
      lastDegree: number;
      snapshotBefore: EditableSnapshot;
    }
  | {
      kind: "move_circle";
      targetType: "bumper" | "splitter" | "emitter";
      id: string;
      snapshotBefore: EditableSnapshot;
    }
  | {
      kind: "move_rail";
      id: string;
      startWorldX: number;
      startWorldY: number;
      origX: number;
      origY: number;
      snapshotBefore: EditableSnapshot;
    }
  | {
      kind: "drag_rail_handle";
      id: string;
      end: "entry" | "exit";
      origRot: number;
      origStartAngle: number;
      snapshotBefore: EditableSnapshot;
    }
  | {
      kind: "pan_camera";
      startClientX: number;
      startClientY: number;
      origFocusX: number;
      origFocusY: number;
    };

function clampToWorkspace(
  x: number,
  y: number,
  vp: ViewportTransform,
  mode: "puzzle" | "sandbox",
  pad = 20
): { x: number; y: number } {
  const minX = mode === "sandbox" ? vp.worldMinX + pad : pad;
  const maxX = mode === "sandbox" ? vp.worldMaxX - pad : STAGE_W - pad;
  const minY = mode === "sandbox" ? vp.worldMinY + pad : pad;
  const maxY = mode === "sandbox" ? vp.worldMaxY - pad : STAGE_H - pad;
  return {
    x: Math.max(minX, Math.min(maxX, x)),
    y: Math.max(minY, Math.min(maxY, y)),
  };
}

export const App: React.FC = () => {
  const [locale, setLocale] = useState<Locale>("en");
  const [mode, setMode] = useState<"puzzle" | "sandbox">(() =>
    window.location.hash.startsWith("#s=") ||
    window.location.hash.startsWith("#song=") ||
    window.location.hash.startsWith("#preset=") ||
    window.location.hash.startsWith("#studio=")
      ? "sandbox"
      : "puzzle"
  );
  const [levelIndex, setLevelIndex] = useState(0);
  const [presetId, setPresetId] = useState(SANDBOX_PRESETS[0].id);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [customSongs, setCustomSongs] = useState<CustomSongDraft[]>(() =>
    loadCustomSongs()
  );
  const [studioOpen, setStudioOpen] = useState(() =>
    window.location.hash.startsWith("#studio=")
  );
  const [studioDraft, setStudioDraft] = useState<CustomSongDraft | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolType>("marimba");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [winBannerVisible, setWinBannerVisible] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [showTip, setShowTip] = useState(true);
  const [completedIds, setCompletedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COMPLETED_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  const [scaleId, setScaleId] = useState<ScaleId>(LEVELS[0].scaleId);
  const [bpm, setBpm] = useState(LEVELS[0].bpm);
  const [followBall, setFollowBall] = useState(false);
  const [simSpeed, setSimSpeed] = useState<0.55 | 0.7 | 0.85 | 1>(1);
  const [zoomPct, setZoomPct] = useState(100);
  const [, setUiTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvas3dRef = useRef<HTMLCanvasElement | null>(null);
  const renderer3dRef = useRef<OrbitalRenderer3D | null>(null);
  const [is3d, setIs3d] = useState(true);
  const is3dRef = useRef(is3d);
  is3dRef.current = is3d;
  const worldRef = useRef<WorldState>(createWorldFromLevel(LEVELS[0], false));
  const undoStackRef = useRef<EditableSnapshot[]>([]);
  const redoStackRef = useRef<EditableSnapshot[]>([]);
  const dragRef = useRef<DragState>({ kind: "none" });
  const hoveredIdRef = useRef<string | null>(null);
  const vpRef = useRef<ViewportTransform>(computeViewport(1280, 720, 58, 78));
  const cameraRef = useRef<CameraState>({
    zoom: 1,
    focusX: STAGE_W * 0.5,
    focusY: STAGE_H * 0.5,
  });
  const followBallRef = useRef(followBall);
  const simSpeedRef = useRef(simSpeed);
  simSpeedRef.current = simSpeed;
  const followedMarbleIdRef = useRef<number | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const showHintRef = useRef(showHint);
  const modeRef = useRef(mode);
  const levelIndexRef = useRef(levelIndex);
  const selectedIdRef = useRef(selectedId);
  const studioOpenRef = useRef(studioOpen);

  followBallRef.current = followBall;
  isPlayingRef.current = isPlaying;
  showHintRef.current = showHint;
  modeRef.current = mode;
  levelIndexRef.current = levelIndex;
  selectedIdRef.current = selectedId;
  studioOpenRef.current = studioOpen;

  const t = I18N[locale];
  const currentLevel = LEVELS[levelIndex] ?? LEVELS[0];

  const syncUi = useCallback(() => {
    setUiTick((n) => n + 1);
  }, []);

  // Sync RhythmEngine BPM into current world
  useEffect(() => {
    rhythmEngine.setBpm(LEVELS[0].bpm);
    const u1 = rhythmEngine.transport.subscribe((snap, reason) => {
      if (reason === "bpm") {
        worldRef.current.bpm = snap.bpm;
        synthEngine.setBpm(snap.bpm);
        setBpm(snap.bpm);
      }
    });
    return () => {
      u1();
    };
  }, []);

  // Load Sandbox or Marble Song hash if present on initial mount
  useEffect(() => {
    if (window.location.hash.startsWith("#studio=")) {
      const base = createWorldFromPreset(SANDBOX_PRESETS[0]);
      worldRef.current = base;
      synthEngine.setBpm(base.bpm);
      rhythmEngine.setBpm(base.bpm);
      setBpm(base.bpm);
      setScaleId(base.scaleId);
      setMode("sandbox");
      setShowTip(false);
      syncUi();
    } else if (window.location.hash.startsWith("#preset=")) {
      const pid = window.location.hash.slice("#preset=".length).trim();
      const preset = SANDBOX_PRESETS.find((p) => p.id === pid);
      if (preset) {
        const w = createWorldFromPreset(preset);
        worldRef.current = w;
        setPresetId(preset.id);
        setMode("sandbox");
        synthEngine.setBpm(w.bpm);
        rhythmEngine.setBpm(w.bpm);
        setBpm(w.bpm);
        setScaleId(w.scaleId);
        setIsPlaying(true);
        setFollowBall(false);
        setShowTip(false);
        syncUi();
      }
    } else if (window.location.hash.startsWith("#song=")) {
      const songId = window.location.hash.slice("#song=".length).trim();
      const song = MARBLE_SONGS.find((s) => s.id === songId);
      if (song) {
        const w = sculptMarbleSong(song);
        worldRef.current = w;
        setActiveSongId(song.id);
        setMode("sandbox");
        synthEngine.setBpm(w.bpm);
        rhythmEngine.setBpm(w.bpm);
        setBpm(w.bpm);
        setScaleId(w.scaleId);
        setIsPlaying(true);
        setFollowBall(true);
        followedMarbleIdRef.current = null;
        cameraRef.current = { zoom: 0.66, focusX: STAGE_W * 0.5, focusY: 220 };
        setZoomPct(66);
        setShowTip(false);
        syncUi();
      }
    } else if (window.location.hash.startsWith("#s=")) {
      const decoded = decodeSandboxShareHash(window.location.hash);
      if (decoded) {
        const base = createWorldFromPreset(SANDBOX_PRESETS[0]);
        if (decoded.bpm) base.bpm = decoded.bpm;
        if (decoded.scaleId) base.scaleId = decoded.scaleId;
        if (decoded.bars) base.bars = decoded.bars;
        if (decoded.bumpers) base.bumpers = decoded.bumpers;
        if (decoded.splitters) base.splitters = decoded.splitters;
        if (decoded.rails) base.rails = decoded.rails;
        if (decoded.emitters && decoded.emitters.length > 0) {
          base.emitters = decoded.emitters;
        }
        worldRef.current = base;
        synthEngine.setBpm(base.bpm);
        rhythmEngine.setBpm(base.bpm);
        setBpm(base.bpm);
        setScaleId(base.scaleId);
        setShowTip(false);
        syncUi();
      }
    }
  }, [syncUi]);

  const computeRemainingBudget = useCallback((): PieceBudget => {
    if (modeRef.current === "sandbox") return {};
    const lvl = LEVELS[levelIndexRef.current] ?? LEVELS[0];
    const world = worldRef.current;
    const rem: PieceBudget = { ...lvl.budget };

    for (const b of world.bars) {
      if (!b.locked && rem[b.material] !== undefined) {
        rem[b.material] = (rem[b.material] ?? 0) - 1;
      }
    }
    for (const bmp of world.bumpers) {
      if (!bmp.locked && rem.bumper !== undefined) {
        rem.bumper = (rem.bumper ?? 0) - 1;
      }
    }
    for (const spl of world.splitters) {
      if (!spl.locked && rem.splitter !== undefined) {
        rem.splitter = (rem.splitter ?? 0) - 1;
      }
    }
    return rem;
  }, []);

  const remainingBudget = computeRemainingBudget();

  const pickFirstAvailableTool = useCallback((lvlIdx: number) => {
    const budget = LEVELS[lvlIdx]?.budget ?? {};
    const keys = Object.keys(budget) as ToolType[];
    if (keys.length > 0) {
      setActiveTool(keys[0]);
    }
  }, []);

  const loadPuzzleLevel = useCallback(
    (idx: number) => {
      setActiveSongId(null);
      const lvl = LEVELS[idx] ?? LEVELS[0];
      worldRef.current = createWorldFromLevel(lvl, false);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setLevelIndex(idx);
      setScaleId(lvl.scaleId);
      synthEngine.setBpm(lvl.bpm);
      rhythmEngine.setBpm(lvl.bpm);
      setBpm(lvl.bpm);
      setIsPlaying(false);
      setSelectedId(null);
      setShowHint(false);
      setWinBannerVisible(false);
      pickFirstAvailableTool(idx);
      syncUi();
    },
    [pickFirstAvailableTool, syncUi]
  );

  const loadSandboxPreset = useCallback(
    (id: string) => {
      setActiveSongId(null);
      const preset =
        SANDBOX_PRESETS.find((p) => p.id === id) ?? SANDBOX_PRESETS[0];
      worldRef.current = createWorldFromPreset(preset);
      undoStackRef.current = [];
      redoStackRef.current = [];
      setPresetId(preset.id);
      setScaleId(preset.scaleId);
      synthEngine.setBpm(preset.bpm);
      rhythmEngine.setBpm(preset.bpm);
      setBpm(preset.bpm);
      setIsPlaying(false);
      setSelectedId(null);
      setShowHint(false);
      setWinBannerVisible(false);
      setActiveTool("marimba");
      syncUi();
    },
    [syncUi]
  );

  const handleLoadSongWorld = useCallback(
    (newWorld: WorldState, songId: string) => {
      rhythmEngine.stop();
      worldRef.current = newWorld;
      undoStackRef.current = [];
      redoStackRef.current = [];
      setMode("sandbox");
      setActiveSongId(songId);
      setScaleId(newWorld.scaleId);
      synthEngine.setBpm(newWorld.bpm);
      rhythmEngine.setBpm(newWorld.bpm);
      setBpm(newWorld.bpm);
      setIsPlaying(true);
      setFollowBall(true);
      followedMarbleIdRef.current = null;
      cameraRef.current = { zoom: 0.66, focusX: STAGE_W * 0.5, focusY: 220 };
      setZoomPct(66);
      setSelectedId(null);
      setShowHint(false);
      setWinBannerVisible(false);
      setShowTip(false);
      syncUi();
    },
    [syncUi]
  );

  const handleChangeMode = useCallback(
    (nextMode: "puzzle" | "sandbox") => {
      synthEngine.unlock();
      synthEngine.playUiTick();
      setMode(nextMode);
      if (nextMode === "puzzle") {
        loadPuzzleLevel(levelIndexRef.current);
      } else {
        loadSandboxPreset(presetId);
      }
    },
    [loadPuzzleLevel, loadSandboxPreset, presetId]
  );

  const pushUndo = useCallback(() => {
    const stack = undoStackRef.current;
    stack.push(cloneEditableSnapshot(worldRef.current));
    if (stack.length > 40) stack.shift();
    redoStackRef.current = [];
  }, []);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    synthEngine.unlock();
    synthEngine.playUiTick();
    redoStackRef.current.push(cloneEditableSnapshot(worldRef.current));
    if (redoStackRef.current.length > 40) redoStackRef.current.shift();
    applyEditableSnapshot(worldRef.current, prev);
    setSelectedId(null);
    syncUi();
  }, [syncUi]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    synthEngine.unlock();
    synthEngine.playUiTick();
    undoStackRef.current.push(cloneEditableSnapshot(worldRef.current));
    if (undoStackRef.current.length > 40) undoStackRef.current.shift();
    applyEditableSnapshot(worldRef.current, next);
    setSelectedId(null);
    syncUi();
  }, [syncUi]);

  const handleDeleteSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const world = worldRef.current;
    const bIdx = world.bars.findIndex((b) => b.id === id && !b.locked);
    const bmpIdx = world.bumpers.findIndex((b) => b.id === id && !b.locked);
    const splIdx = world.splitters.findIndex((s) => s.id === id && !s.locked);
    const railIdx = (world.rails ?? []).findIndex((r) => r.id === id && !r.locked);
    const emIdx =
      modeRef.current === "sandbox" && world.emitters.length > 1
        ? world.emitters.findIndex((e) => e.id === id)
        : -1;

    if (bIdx < 0 && bmpIdx < 0 && splIdx < 0 && railIdx < 0 && emIdx < 0) return;
    pushUndo();
    if (bIdx >= 0) world.bars.splice(bIdx, 1);
    if (bmpIdx >= 0) world.bumpers.splice(bmpIdx, 1);
    if (splIdx >= 0) world.splitters.splice(splIdx, 1);
    if (railIdx >= 0) world.rails.splice(railIdx, 1);
    if (emIdx >= 0) world.emitters.splice(emIdx, 1);
    synthEngine.playUiTick();
    setSelectedId(null);
    syncUi();
  }, [pushUndo, syncUi]);

  const handleTogglePlay = useCallback(() => {
    synthEngine.unlock();
    const next = !isPlayingRef.current;
    if (!next) {
      worldRef.current.marbles = [];
      worldRef.current.beatClock = 0;
      worldRef.current.allChargedTimer = 0;
      worldRef.current.emitters.forEach((e) => {
        e.nextEmitBeat = e.phaseOffset;
      });
      worldRef.current.rings.forEach((r) => {
        r.charge = 0;
      });
    } else {
      setShowTip(false);
    }
    setIsPlaying(next);
  }, []);

  const handleResetOrClear = useCallback(() => {
    synthEngine.unlock();
    synthEngine.playUiTick();
    if (modeRef.current === "puzzle") {
      loadPuzzleLevel(levelIndexRef.current);
    } else {
      pushUndo();
      const w = worldRef.current;
      w.bars = [];
      w.bumpers = [];
      w.splitters = [];
      w.rails = [];
      w.marbles = [];
      w.emitters = [
        {
          id: `em_${Date.now()}`,
          x: 500,
          y: 95,
          vx: 0,
          vy: 0,
          beatInterval: 2,
          phaseOffset: 0,
          nextEmitBeat: 0,
        },
      ];
      setIsPlaying(false);
      setSelectedId(null);
      syncUi();
    }
  }, [loadPuzzleLevel, pushUndo, syncUi]);

  const handleShareLink = useCallback(async () => {
    const hash = encodeSandboxShareHash(worldRef.current);
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    window.history.replaceState(null, "", hash);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback if clipboard denied
    }
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  }, []);

  // Keyboard shortcuts: Space, 1-4, Ctrl+Z, Ctrl+Y / Ctrl+Shift+Z, Delete, R, H
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (studioOpenRef.current) return;
      if (
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      synthEngine.unlock();

      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        handleUndo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        handleDeleteSelected();
      } else if (e.key.toLowerCase() === "r") {
        handleResetOrClear();
      } else if (e.key.toLowerCase() === "h" && modeRef.current === "puzzle") {
        setShowHint((v) => !v);
      } else if (e.key.toLowerCase() === "f") {
        setFollowBall((v) => !v);
      } else if (e.key === "0") {
        setFollowBall(false);
        followedMarbleIdRef.current = null;
        cameraRef.current = { zoom: 1, focusX: STAGE_W * 0.5, focusY: STAGE_H * 0.5 };
        setZoomPct(100);
      } else if (e.key === "Tab" && followBallRef.current) {
        const marbles = worldRef.current.marbles;
        if (marbles.length > 1) {
          e.preventDefault();
          const idx = marbles.findIndex((m) => m.id === followedMarbleIdRef.current);
          followedMarbleIdRef.current = marbles[(idx + 1) % marbles.length].id;
        }
      } else if (e.key === "1") {
        setActiveTool("marimba");
      } else if (e.key === "2") {
        setActiveTool("brass");
      } else if (e.key === "3") {
        setActiveTool("ceramic");
      } else if (e.key === "4") {
        setActiveTool("bass");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleDeleteSelected,
    handleRedo,
    handleResetOrClear,
    handleTogglePlay,
    handleUndo,
  ]);

  // Main 120Hz Physics + HiDPI Render Loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let accumulator = 0;

    const frameLoop = (now: number) => {
      const rawDt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      accumulator += rawDt * simSpeedRef.current;

      const world = worldRef.current;
      const baseAudioTime = synthEngine.getCurrentTime();
      let tickStep = 0;

      while (accumulator >= FIXED_DT) {
        const events = stepFixed(world, isPlayingRef.current);
        const eventWhen =
          baseAudioTime > 0 ? baseAudioTime + tickStep * FIXED_DT : undefined;
        tickStep++;
        accumulator -= FIXED_DT;

        for (const ev of events) {
          if (ev.type === "bar_hit") {
            const color = ev.silentCue
              ? "rgba(130, 136, 130, 0.7)"
              : MATERIALS[ev.material].color;
            if (!ev.silentCue) {
              const noteName = synthEngine.playBarHit(
                ev.material,
                ev.length,
                world.scaleId,
                ev.x,
                ev.speed,
                eventWhen,
                {
                  fixedMidi: ev.fixedMidi,
                  instrumentOverride: ev.instrumentOverride,
                  drumOverride: ev.drumOverride,
                  noteLabel: ev.noteLabel,
                }
              );
              world.popups.push({
                x: ev.x,
                y: ev.y - 12,
                text: noteName,
                color,
                age: 0,
                duration: 0.65,
              });
            }
            world.ripples.push({
              x: ev.x,
              y: ev.y,
              color,
              age: 0,
              duration: ev.silentCue ? 0.32 : 0.48,
              maxRadius: ev.silentCue ? 22 : 34 + Math.min(24, ev.speed * 0.04),
              doubleRing: !ev.silentCue && (ev.material === "brass" || ev.material === "ceramic"),
            });
          } else if (ev.type === "bumper_hit") {
            if (!ev.silentCue) {
              synthEngine.playBumperHit(ev.x, ev.speed, eventWhen);
            }
            world.ripples.push({
              x: ev.x,
              y: ev.y,
              color: TOKENS.accent,
              age: 0,
              duration: 0.42,
              maxRadius: 42,
              doubleRing: true,
            });
          } else if (ev.type === "splitter_hit") {
            synthEngine.playSplitterChime(ev.x, eventWhen);
            world.ripples.push({
              x: ev.x,
              y: ev.y,
              color: TOKENS.ink,
              age: 0,
              duration: 0.36,
              maxRadius: 30,
              doubleRing: false,
            });
          } else if (ev.type === "rail_exit") {
            world.ripples.push({
              x: ev.x,
              y: ev.y,
              color: "#38E2FF",
              age: 0,
              duration: 0.42,
              maxRadius: 34,
              doubleRing: false,
            });
          } else if (ev.type === "ring_hit") {
            synthEngine.playRingCharge(
              ev.x,
              ev.ringIndex,
              world.scaleId,
              eventWhen
            );
            world.ripples.push({
              x: ev.x,
              y: ev.y,
              color: TOKENS.ringActive,
              age: 0,
              duration: 0.55,
              maxRadius: 46,
              doubleRing: true,
            });
          } else if (ev.type === "level_win") {
            synthEngine.playWinArpeggio(world.scaleId);
            setWinBannerVisible(true);
            const lvlId = LEVELS[levelIndexRef.current]?.id;
            if (lvlId) {
              setCompletedIds((prev) => {
                if (prev.includes(lvlId)) return prev;
                const next = [...prev, lvlId];
                try {
                  localStorage.setItem(
                    COMPLETED_STORAGE_KEY,
                    JSON.stringify(next)
                  );
                } catch {
                  // ignore storage quota errors
                }
                return next;
              });
            }
          }
        }
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const targetW = Math.round(rect.width * dpr);
        const targetH = Math.round(rect.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const topMargin = rect.width < 760 ? 102 : 56;
        const bottomMargin = rect.width < 760 ? 114 : 78;

        // Follow-ball camera tracking (keeps tracked marble smoothly centered)
        const cam = cameraRef.current;
        if (followBallRef.current) {
          const marbles = world.marbles;
          const target =
            marbles.find((m) => m.id === followedMarbleIdRef.current) ??
            marbles.find((m) => m.y >= -40 && m.y <= STAGE_H + 80) ??
            marbles[0] ??
            null;
          if (target) {
            followedMarbleIdRef.current = target.id;
            const alpha = isPlayingRef.current ? accumulator / FIXED_DT : 1;
            const tx = target.prevX + (target.x - target.prevX) * alpha;
            const ty =
              target.prevY +
              (target.y - target.prevY) * alpha +
              Math.max(-14, Math.min(28, target.vy * 0.06));
            const kx = Math.min(1, rawDt * 2.4);
            const ky = Math.min(1, rawDt * 3.4);
            cam.focusX += (tx - cam.focusX) * kx;
            cam.focusY += (ty - cam.focusY) * ky;
          } else {
            followedMarbleIdRef.current = null;
            const fallbackX = world.emitters[0]?.x ?? STAGE_W * 0.5;
            const fallbackY = world.emitters[0]?.y ?? STAGE_H * 0.5;
            const k = Math.min(1, rawDt * 5);
            cam.focusX += (fallbackX - cam.focusX) * k;
            cam.focusY += (fallbackY - cam.focusY) * k;
          }
        }

        const vp = computeViewport(
          rect.width,
          rect.height,
          topMargin,
          bottomMargin,
          cam
        );
        vpRef.current = vp;

        const interpAlpha = isPlayingRef.current ? accumulator / FIXED_DT : 1;
        const drag = dragRef.current;
        const draftBar =
          drag.kind === "draw_bar"
            ? {
                ax: drag.ax,
                ay: drag.ay,
                bx: drag.bx,
                by: drag.by,
                material: drag.material,
              }
            : null;

        const showGhost =
          !isPlayingRef.current || drag.kind !== "none" || selectedIdRef.current !== null;
        let ghostBranches: ReturnType<typeof simulateGhostPath> = [];
        if (showGhost) {
          if (draftBar && barLength(draftBar) >= 48) {
            world.bars.push({ id: "__draft__", ...draftBar });
            ghostBranches = simulateGhostPath(world, 175);
            world.bars.pop();
          } else {
            ghostBranches = simulateGhostPath(world, 175);
          }
        }

        const hintOverlay =
          modeRef.current === "puzzle" && showHintRef.current
            ? LEVELS[levelIndexRef.current]?.hintSolution ?? null
            : null;

        const renderOpts = {
          mode: modeRef.current,
          selectedId: selectedIdRef.current,
          hoveredId: hoveredIdRef.current,
          showGhost,
          ghostBranches,
          hintOverlay,
          draftBar,
          interpAlpha,
          followedMarbleId: followBallRef.current
            ? followedMarbleIdRef.current
            : null,
        };

        if (is3dRef.current && canvas3dRef.current) {
          if (!renderer3dRef.current) {
            try {
              renderer3dRef.current = new OrbitalRenderer3D(canvas3dRef.current);
            } catch {
              is3dRef.current = false;
              setIs3d(false);
            }
          }
          const r3d = renderer3dRef.current;
          if (r3d) {
            r3d.resize(rect.width, rect.height);
            r3d.render(world, cam, interpAlpha, selectedIdRef.current);
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
              r3d.renderOverlay(ctx, rect.width, rect.height, world, renderOpts);
            }
          }
        } else {
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            renderWorld(ctx, vp, world, renderOpts);
          }
        }
      }

      rafId = requestAnimationFrame(frameLoop);
    };

    rafId = requestAnimationFrame(frameLoop);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Hit-testing in logical stage coordinates
  const hitTestWorld = useCallback((wx: number, wy: number) => {
    const world = worldRef.current;

    for (let i = world.bars.length - 1; i >= 0; i--) {
      const b = world.bars[i];
      if (b.locked) continue;
      if (distSq(wx, wy, b.ax, b.ay) <= 18 * 18) {
        return { kind: "bar_end" as const, bar: b, end: "a" as const };
      }
      if (distSq(wx, wy, b.bx, b.by) <= 18 * 18) {
        return { kind: "bar_end" as const, bar: b, end: "b" as const };
      }
    }

    for (let i = world.bumpers.length - 1; i >= 0; i--) {
      const bmp = world.bumpers[i];
      if (bmp.locked) continue;
      if (distSq(wx, wy, bmp.x, bmp.y) <= (bmp.radius + 8) ** 2) {
        return { kind: "bumper" as const, item: bmp };
      }
    }

    for (let i = world.splitters.length - 1; i >= 0; i--) {
      const spl = world.splitters[i];
      if (spl.locked) continue;
      if (distSq(wx, wy, spl.x, spl.y) <= (spl.radius + 8) ** 2) {
        return { kind: "splitter" as const, item: spl };
      }
    }

    if (modeRef.current === "sandbox") {
      for (let i = world.emitters.length - 1; i >= 0; i--) {
        const em = world.emitters[i];
        if (distSq(wx, wy, em.x, em.y) <= 24 * 24) {
          return { kind: "emitter" as const, item: em };
        }
      }
    }

    for (let i = (world.rails ?? []).length - 1; i >= 0; i--) {
      const r = world.rails[i];
      if (r.locked) continue;
      const geom = buildRailGeometry(r);
      if (distSq(wx, wy, geom.entryPoint.x, geom.entryPoint.y) <= 18 * 18) {
        return { kind: "rail_handle" as const, rail: r, end: "entry" as const };
      }
      if (distSq(wx, wy, geom.exitPoint.x, geom.exitPoint.y) <= 18 * 18) {
        return { kind: "rail_handle" as const, rail: r, end: "exit" as const };
      }
      const pts = geom.centerPoints;
      for (let j = 0; j < pts.length - 1; j++) {
        const { cx, cy } = closestPointOnSegment(
          wx,
          wy,
          pts[j].x,
          pts[j].y,
          pts[j + 1].x,
          pts[j + 1].y
        );
        if (distSq(wx, wy, cx, cy) <= (geom.halfChannel + 8) ** 2) {
          return { kind: "rail_body" as const, rail: r };
        }
      }
    }

    for (let i = world.bars.length - 1; i >= 0; i--) {
      const b = world.bars[i];
      if (b.locked) continue;
      const { cx, cy } = closestPointOnSegment(wx, wy, b.ax, b.ay, b.bx, b.by);
      if (distSq(wx, wy, cx, cy) <= 16 * 16) {
        return { kind: "bar_body" as const, bar: b };
      }
    }

    return null;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    synthEngine.unlock();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pt =
      (is3dRef.current && renderer3dRef.current
        ? renderer3dRef.current.screenToStage(e.clientX, e.clientY, rect)
        : null) ?? screenToWorld(vpRef.current, e.clientX - rect.left, e.clientY - rect.top);

    // Clicking a marble while Follow mode is active locks camera onto that marble
    if (followBallRef.current && e.button === 0) {
      const clickedMarble = worldRef.current.marbles.find(
        (m) => distSq(pt.x, pt.y, m.x, m.y) <= (m.radius + 14) ** 2
      );
      if (clickedMarble) {
        followedMarbleIdRef.current = clickedMarble.id;
        return;
      }
    }

    const hit = hitTestWorld(pt.x, pt.y);

    if (e.button === 1 || (e.button === 2 && !hit)) {
      if (followBallRef.current) setFollowBall(false);
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = {
        kind: "pan_camera",
        startClientX: e.clientX,
        startClientY: e.clientY,
        origFocusX: cameraRef.current.focusX,
        origFocusY: cameraRef.current.focusY,
      };
      return;
    }

    if (e.button === 2) {
      if (hit) {
        const id =
          hit.kind === "bar_end" || hit.kind === "bar_body"
            ? hit.bar.id
            : hit.kind === "rail_handle" || hit.kind === "rail_body"
              ? hit.rail.id
              : hit.item.id;
        setSelectedId(id);
        selectedIdRef.current = id;
        handleDeleteSelected();
      }
      return;
    }

    setShowTip(false);
    canvas.setPointerCapture(e.pointerId);

    if (hit) {
      const snap = cloneEditableSnapshot(worldRef.current);
      if (hit.kind === "bar_end") {
        setSelectedId(hit.bar.id);
        const note = lengthToNote(
          barLength(hit.bar),
          worldRef.current.scaleId,
          hit.bar.material
        );
        dragRef.current = {
          kind: "drag_end",
          id: hit.bar.id,
          end: hit.end,
          lastDegree: note.degree,
          snapshotBefore: snap,
        };
      } else if (hit.kind === "bar_body") {
        setSelectedId(hit.bar.id);
        dragRef.current = {
          kind: "move_bar",
          id: hit.bar.id,
          startWorldX: pt.x,
          startWorldY: pt.y,
          origAx: hit.bar.ax,
          origAy: hit.bar.ay,
          origBx: hit.bar.bx,
          origBy: hit.bar.by,
          snapshotBefore: snap,
        };
      } else if (hit.kind === "rail_handle") {
        setSelectedId(hit.rail.id);
        dragRef.current = {
          kind: "drag_rail_handle",
          id: hit.rail.id,
          end: hit.end,
          origRot: hit.rail.rotation,
          origStartAngle: Math.atan2(pt.y - hit.rail.y, pt.x - hit.rail.x),
          snapshotBefore: snap,
        };
      } else if (hit.kind === "rail_body") {
        setSelectedId(hit.rail.id);
        dragRef.current = {
          kind: "move_rail",
          id: hit.rail.id,
          startWorldX: pt.x,
          startWorldY: pt.y,
          origX: hit.rail.x,
          origY: hit.rail.y,
          snapshotBefore: snap,
        };
      } else {
        setSelectedId(hit.item.id);
        dragRef.current = {
          kind: "move_circle",
          targetType: hit.kind,
          id: hit.item.id,
          snapshotBefore: snap,
        };
      }
      return;
    }

    setSelectedId(null);
    const clamped = clampToWorkspace(pt.x, pt.y, vpRef.current, mode);
    const rem = computeRemainingBudget();

    if (mode === "puzzle") {
      const left = rem[activeTool] ?? 0;
      if (left <= 0) {
        return;
      }
    }

    if (isMaterialTool(activeTool)) {
      dragRef.current = {
        kind: "draw_bar",
        ax: clamped.x,
        ay: clamped.y,
        bx: clamped.x,
        by: clamped.y,
        material: activeTool,
        lastDegree: -1,
      };
    } else {
      pushUndo();
      const w = worldRef.current;
      const newId = `${activeTool}_${Date.now()}`;
      if (activeTool === "bumper") {
        w.bumpers.push({ id: newId, x: clamped.x, y: clamped.y, radius: 22 });
        synthEngine.playBumperHit(clamped.x, 300);
      } else if (activeTool === "splitter") {
        w.splitters.push({ id: newId, x: clamped.x, y: clamped.y, radius: 20 });
        synthEngine.playSplitterChime(clamped.x);
      } else if (activeTool === "rail") {
        const newRail: TransferRailPiece = {
          id: newId,
          variant: "v",
          x: clamped.x,
          y: clamped.y,
          rotation: 0.12,
          armLength: 130,
          openingAngle: 88,
          curvature: 0.56,
          slopeBias: 0.08,
          channelWidth: 26,
          boost: 0.2,
        };
        if (!w.rails) w.rails = [];
        w.rails.push(newRail);
        synthEngine.playUiTick();
      } else if (activeTool === "emitter" && mode === "sandbox") {
        w.emitters.push({
          id: newId,
          x: clamped.x,
          y: clamped.y,
          vx: 0,
          vy: 0,
          beatInterval: 2,
          phaseOffset: 0,
          nextEmitBeat: Math.ceil(w.beatClock),
        });
        synthEngine.playUiTick();
      }
      setSelectedId(newId);
      syncUi();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const pt =
      (is3dRef.current && renderer3dRef.current
        ? renderer3dRef.current.screenToStage(e.clientX, e.clientY, rect)
        : null) ?? screenToWorld(vpRef.current, e.clientX - rect.left, e.clientY - rect.top);
    const clamped = clampToWorkspace(pt.x, pt.y, vpRef.current, mode);
    const drag = dragRef.current;

    if (drag.kind === "none") {
      const hit = hitTestWorld(pt.x, pt.y);
      hoveredIdRef.current = hit
        ? hit.kind === "bar_end" || hit.kind === "bar_body"
          ? hit.bar.id
          : hit.kind === "rail_handle" || hit.kind === "rail_body"
            ? hit.rail.id
            : hit.item.id
        : null;
      return;
    }

    if (drag.kind === "pan_camera") {
      const s = vpRef.current.scale || 1;
      cameraRef.current.focusX =
        drag.origFocusX - (e.clientX - drag.startClientX) / s;
      cameraRef.current.focusY =
        drag.origFocusY - (e.clientY - drag.startClientY) / s;
      return;
    }

    if (drag.kind === "draw_bar") {
      drag.bx = clamped.x;
      drag.by = clamped.y;
      const len = Math.hypot(drag.bx - drag.ax, drag.by - drag.ay);
      if (len >= 48) {
        const note = lengthToNote(len, worldRef.current.scaleId, drag.material);
        if (note.degree !== drag.lastDegree) {
          drag.lastDegree = note.degree;
          synthEngine.playNotePreviewTick(
            len,
            worldRef.current.scaleId,
            drag.material,
            (drag.ax + drag.bx) * 0.5
          );
        }
      }
    } else if (drag.kind === "move_bar") {
      const bar = worldRef.current.bars.find((b) => b.id === drag.id);
      if (!bar) return;
      const dx = pt.x - drag.startWorldX;
      const dy = pt.y - drag.startWorldY;
      bar.ax = drag.origAx + dx;
      bar.ay = drag.origAy + dy;
      bar.bx = drag.origBx + dx;
      bar.by = drag.origBy + dy;
    } else if (drag.kind === "drag_end") {
      const bar = worldRef.current.bars.find((b) => b.id === drag.id);
      if (!bar) return;
      const otherX = drag.end === "a" ? bar.bx : bar.ax;
      const otherY = drag.end === "a" ? bar.by : bar.ay;
      const dist = Math.hypot(clamped.x - otherX, clamped.y - otherY);
      if (dist >= 44) {
        if (drag.end === "a") {
          bar.ax = clamped.x;
          bar.ay = clamped.y;
        } else {
          bar.bx = clamped.x;
          bar.by = clamped.y;
        }
        const len = barLength(bar);
        const note = lengthToNote(len, worldRef.current.scaleId, bar.material);
        if (note.degree !== drag.lastDegree) {
          drag.lastDegree = note.degree;
          synthEngine.playNotePreviewTick(
            len,
            worldRef.current.scaleId,
            bar.material,
            (bar.ax + bar.bx) * 0.5
          );
        }
      }
    } else if (drag.kind === "move_rail") {
      const rail = (worldRef.current.rails ?? []).find((r) => r.id === drag.id);
      if (rail) {
        rail.x = drag.origX + (pt.x - drag.startWorldX);
        rail.y = drag.origY + (pt.y - drag.startWorldY);
      }
    } else if (drag.kind === "drag_rail_handle") {
      const rail = (worldRef.current.rails ?? []).find((r) => r.id === drag.id);
      if (rail) {
        const curAng = Math.atan2(pt.y - rail.y, pt.x - rail.x);
        rail.rotation = drag.origRot + (curAng - drag.origStartAngle);
        const dist = Math.hypot(pt.x - rail.x, pt.y - rail.y);
        rail.armLength = Math.max(65, Math.min(210, dist));
        syncUi();
      }
    } else if (drag.kind === "move_circle") {
      const w = worldRef.current;
      const arr =
        drag.targetType === "bumper"
          ? w.bumpers
          : drag.targetType === "splitter"
            ? w.splitters
            : w.emitters;
      const item = arr.find((i) => i.id === drag.id);
      if (item) {
        item.x = clamped.x;
        item.y = clamped.y;
      }
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (drag.kind === "pan_camera") {
      dragRef.current = { kind: "none" };
      return;
    }

    if (drag.kind === "draw_bar") {
      const len = Math.hypot(drag.bx - drag.ax, drag.by - drag.ay);
      if (len >= 48) {
        pushUndo();
        const newBar: BarPiece = {
          id: `bar_${Date.now()}`,
          ax: drag.ax,
          ay: drag.ay,
          bx: drag.bx,
          by: drag.by,
          material: drag.material,
        };
        worldRef.current.bars.push(newBar);
        setSelectedId(newBar.id);
        synthEngine.playBarHit(
          newBar.material,
          len,
          worldRef.current.scaleId,
          (newBar.ax + newBar.bx) * 0.5,
          360
        );
        syncUi();
      }
    } else if (
      drag.kind === "move_bar" ||
      drag.kind === "drag_end" ||
      drag.kind === "move_circle" ||
      drag.kind === "move_rail" ||
      drag.kind === "drag_rail_handle"
    ) {
      undoStackRef.current.push(drag.snapshotBefore);
      if (undoStackRef.current.length > 40) undoStackRef.current.shift();
      redoStackRef.current = [];
      syncUi();
    }
    dragRef.current = { kind: "none" };
  };

  const hasSelection = useMemo(() => {
    if (!selectedId) return false;
    const w = worldRef.current;
    return (
      w.bars.some((b) => b.id === selectedId && !b.locked) ||
      w.bumpers.some((b) => b.id === selectedId && !b.locked) ||
      w.splitters.some((s) => s.id === selectedId && !s.locked) ||
      (w.rails ?? []).some((r) => r.id === selectedId && !r.locked) ||
      (mode === "sandbox" &&
        w.emitters.length > 1 &&
        w.emitters.some((e) => e.id === selectedId))
    );
  }, [selectedId, mode, levelIndex]);

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const vp = vpRef.current;
    const cam = cameraRef.current;
    const factor = Math.exp(-e.deltaY * 0.0011);
    const nextZoom = Math.max(0.55, Math.min(3.0, cam.zoom * factor));

    if (!followBallRef.current) {
      const wx = (localX - vp.offsetX) / vp.scale;
      const wy = (localY - vp.offsetY) / vp.scale;
      const nextScale = vp.baseScale * nextZoom;
      const topMargin = rect.width < 760 ? 102 : 56;
      const bottomMargin = rect.width < 760 ? 114 : 78;
      const availH = Math.max(200, rect.height - topMargin - bottomMargin);
      const centerX = rect.width * 0.5;
      const centerY = topMargin + availH * 0.5;
      const nextOffsetX = localX - wx * nextScale;
      const nextOffsetY = localY - wy * nextScale;
      cam.focusX = (centerX - nextOffsetX) / nextScale;
      cam.focusY = (centerY - nextOffsetY) / nextScale;
    }
    cam.zoom = nextZoom;
    setZoomPct(Math.round(nextZoom * 100));
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      <TopBar
        t={t}
        locale={locale}
        onToggleLocale={() =>
          setLocale((prev) => (prev === "en" ? "vi" : "en"))
        }
        mode={mode}
        onChangeMode={handleChangeMode}
        levelIndex={levelIndex}
        onSelectLevel={loadPuzzleLevel}
        completedIds={completedIds}
        presetId={presetId}
        onSelectPreset={loadSandboxPreset}
        scaleId={scaleId}
        onChangeScale={(nextScale) => {
          synthEngine.unlock();
          synthEngine.playUiTick();
          worldRef.current.scaleId = nextScale;
          setScaleId(nextScale);
        }}
        bpm={bpm}
        onChangeBpm={(nextBpm) => {
          worldRef.current.bpm = nextBpm;
          synthEngine.setBpm(nextBpm);
          rhythmEngine.setBpm(nextBpm);
          setBpm(nextBpm);
        }}
        muted={muted}
        onToggleMute={() => {
          synthEngine.unlock();
          const next = !muted;
          synthEngine.setMuted(next);
          setMuted(next);
        }}
        activeSongId={activeSongId}
        isPlaying={isPlaying}
        customSongs={customSongs}
        onLoadSongWorld={handleLoadSongWorld}
        onOpenStudio={(draft) => {
          setStudioDraft(draft ?? null);
          setStudioOpen(true);
        }}
        onDeleteCustomSong={(id) => {
          setCustomSongs(deleteCustomSong(id));
        }}
      />

      {studioOpen && (
        <SongStudioModal
          locale={locale}
          initialDraft={studioDraft}
          initialTab={
            window.location.hash === "#studio=mp3" ? "import" : "compose"
          }
          onClose={() => setStudioOpen(false)}
          onSaveDraft={(draft) => {
            setCustomSongs(saveCustomSong(draft));
          }}
          onBuildSongWorld={(world, _song, draft) => {
            setCustomSongs(saveCustomSong(draft));
            handleLoadSongWorld(world, draft.id);
          }}
        />
      )}

      {mode === "sandbox" &&
        !studioOpen &&
        selectedId &&
        (() => {
          const bar = worldRef.current.bars.find((b) => b.id === selectedId);
          if (bar) {
            return (
              <BarInspectorPill
                locale={locale}
                bar={bar}
                scaleId={scaleId}
                onUpdateBar={(patch) => {
                  pushUndo();
                  Object.assign(bar, patch);
                  syncUi();
                }}
              />
            );
          }
          const rail = (worldRef.current.rails ?? []).find((r) => r.id === selectedId);
          if (rail) {
            return (
              <RailInspectorPill
                locale={locale}
                rail={rail}
                onUpdateRail={(patch) => {
                  pushUndo();
                  Object.assign(rail, patch);
                  syncUi();
                }}
              />
            );
          }
          return null;
        })()}

      {mode === "puzzle" && (
        <div
          style={{
            position: "fixed",
            top: 62,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            fontSize: 12,
            color: "var(--slate)",
            fontWeight: 500,
            backgroundColor: "rgba(247, 248, 245, 0.88)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "2px 11px",
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {locale === "vi" ? currentLevel.subtitleVi : currentLevel.subtitleEn}
        </div>
      )}

      <canvas
        ref={canvas3dRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: is3d ? "block" : "none",
          pointerEvents: "none",
        }}
      />

      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={handleCanvasWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "block",
          touchAction: "none",
          cursor: "crosshair",
        }}
      />

      {/* Camera HUD: Follow Ball & Mouse-Wheel Zoom */}
      <div
        style={{
          position: "fixed",
          top: 66,
          right: 14,
          zIndex: 18,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 8px",
          backgroundColor: "rgba(247, 248, 245, 0.94)",
          border: "1px solid var(--border-strong)",
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(28, 35, 33, 0.08)",
        }}
      >
        <button
          type="button"
          onClick={() => {
            synthEngine.unlock();
            synthEngine.playUiTick();
            setIs3d((v) => !v);
          }}
          className={`hw-btn ${is3d ? "is-selected" : ""}`}
          style={{
            padding: "4px 8px",
            fontSize: 11.5,
            fontFamily: "var(--font-mono), monospace",
            fontWeight: 700,
            backgroundColor: is3d ? "#1E4B63" : "#FFFFFF",
            color: is3d ? "#FFFFFF" : "var(--ink)",
            borderColor: is3d ? "#1E4B63" : "var(--border)",
          }}
          title={locale === "vi" ? "Chuyển chế độ 3D / 2D" : "Toggle 3D / 2D view"}
        >
          {is3d ? "3D" : "2D"}
        </button>

        <button
          type="button"
          onClick={() => {
            synthEngine.unlock();
            synthEngine.playUiTick();
            setFollowBall((v) => !v);
          }}
          className={`hw-btn ${followBall ? "is-selected" : ""}`}
          style={{
            padding: "4px 9px",
            fontSize: 11.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 5,
            background: followBall ? "#1C2321" : "#FFFFFF",
            color: followBall ? "#FFFFFF" : "var(--ink)",
            borderColor: followBall ? "#1C2321" : "var(--border)",
          }}
          title={locale === "vi" ? "Theo dõi bóng ở giữa màn hình (Phím F)" : "Follow ball in center (Key F)"}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: followBall ? "#CE5B46" : "var(--slate)",
              display: "inline-block",
            }}
          />
          <span>{locale === "vi" ? "Theo dõi bóng" : "Follow Ball"}</span>
        </button>

        {followBall && worldRef.current.marbles.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const marbles = worldRef.current.marbles;
              const idx = marbles.findIndex((m) => m.id === followedMarbleIdRef.current);
              followedMarbleIdRef.current = marbles[(idx + 1) % marbles.length].id;
              syncUi();
            }}
            className="hw-btn"
            style={{ padding: "4px 7px", fontSize: 11.5, fontWeight: 600 }}
            title={locale === "vi" ? "Đổi bóng theo dõi (Tab)" : "Next marble (Tab)"}
          >
            ↻
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            synthEngine.unlock();
            synthEngine.playUiTick();
            setSimSpeed((s) =>
              s === 0.7 ? 0.55 : s === 0.55 ? 1 : s === 1 ? 0.85 : 0.7
            );
          }}
          className="hw-btn"
          style={{
            padding: "4px 7px",
            fontSize: 11.5,
            fontFamily: "var(--font-mono), monospace",
            fontWeight: 600,
            color: simSpeed < 1 ? "#1E4B63" : "var(--ink)",
          }}
          title={locale === "vi" ? "Tốc độ (0.55x / 0.7x / 0.85x / 1.0x)" : "Speed (0.55x / 0.7x / 0.85x / 1.0x)"}
        >
          {simSpeed === 1 ? "1.0x" : `${simSpeed}x`}
        </button>

        <button
          type="button"
          onClick={() => {
            setFollowBall(false);
            followedMarbleIdRef.current = null;
            cameraRef.current = { zoom: 1, focusX: STAGE_W * 0.5, focusY: STAGE_H * 0.5 };
            setZoomPct(100);
          }}
          className="hw-btn"
          style={{
            padding: "4px 8px",
            fontSize: 11.5,
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            color: zoomPct !== 100 ? "#CE5B46" : "var(--slate)",
          }}
          title={locale === "vi" ? "Cuộn chuột để zoom · Bấm để đặt lại 100% (Phím 0)" : "Scroll to zoom · Click to reset 100% (Key 0)"}
        >
          {zoomPct}%
        </button>
      </div>

      {winBannerVisible && mode === "puzzle" && (
        <WinBanner
          t={t}
          hasNext={levelIndex < LEVELS.length - 1}
          onKeepListening={() => setWinBannerVisible(false)}
          onNextTrack={() => loadPuzzleLevel(levelIndex + 1)}
        />
      )}

      <DockBar
        t={t}
        mode={mode}
        isPlaying={isPlaying}
        onTogglePlay={handleTogglePlay}
        activeTool={activeTool}
        onSelectTool={(tool) => {
          synthEngine.unlock();
          synthEngine.playUiTick();
          setActiveTool(tool);
        }}
        remainingBudget={remainingBudget}
        hasSelection={hasSelection}
        onDeleteSelected={handleDeleteSelected}
        canUndo={undoStackRef.current.length > 0}
        canRedo={redoStackRef.current.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onResetOrClear={handleResetOrClear}
        showHint={showHint}
        onToggleHint={() => setShowHint((v) => !v)}
        onShareLink={handleShareLink}
        shareCopied={shareCopied}
        showTip={showTip && mode === "puzzle" && levelIndex === 0}
      />
    </div>
  );
};
