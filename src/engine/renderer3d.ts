import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { lengthToNote } from "../audio/scales.ts";
import { FONTS, MATERIALS, STAGE_H } from "../theme/tokens.ts";
import {
  buildRailGeometry,
  sampleRailPose,
  type RailGeometry,
} from "./railGeometry.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  Marble,
  MaterialType,
  ResonanceRing,
  SplitterPiece,
  TransferRailPiece,
  Vec2,
  WorldState,
} from "./types.ts";
import type { CameraState, RenderOptions } from "./renderer.ts";

/* ------------------------------------------------------------------ */
/*  Nocturnal Studio Palette — Resting vs Lamp-Lit States              */
/* ------------------------------------------------------------------ */

const BAR_REST_COLORS: Record<MaterialType, number> = {
  marimba: 0x6c4220,
  brass: 0x785c1e,
  ceramic: 0x24584e,
  bass: 0x1c3550,
};

const BAR_LIT_COLORS: Record<MaterialType, number> = {
  marimba: 0xffc678,
  brass: 0xffef96,
  ceramic: 0x7efce4,
  bass: 0x7ec8ff,
};

const BAR_EMISSIVE_COLORS: Record<MaterialType, number> = {
  marimba: 0xff9228,
  brass: 0xffcc38,
  ceramic: 0x22ecc4,
  bass: 0x3292ff,
};

const BAR_WALL_LIGHT_COLORS: Record<MaterialType, number> = {
  marimba: 0xff9e3d,
  brass: 0xffd85a,
  ceramic: 0x34f5cf,
  bass: 0x4ca6ff,
};

const CORE_COLORS: Record<MaterialType, number> = {
  marimba: 0xffe8be,
  brass: 0xffffdf,
  ceramic: 0xd8fff6,
  bass: 0xd6eeff,
};

const LABEL_LIT_CSS: Record<MaterialType, string> = {
  marimba: "#FFCA7A",
  brass: "#FFE98A",
  ceramic: "#6CF7DC",
  bass: "#76C4FF",
};

const RAIL_CENTER_Z = 2;
const BACKWALL_Z = -11;

/* ------------------------------------------------------------------ */
/*  Mesh bookkeeping                                                   */
/* ------------------------------------------------------------------ */

interface BarMeshEntry {
  group: THREE.Group;
  body: THREE.Mesh;
  core: THREE.Mesh;
  wallWash: THREE.Mesh;
  pinA: THREE.Mesh;
  pinB: THREE.Mesh;
  material: MaterialType;
  silent: boolean;
  cachedLen: number;
  phase: number;
}

interface BumperMeshEntry {
  group: THREE.Group;
  collar: THREE.Mesh;
  dome: THREE.Mesh;
  ringTube: THREE.Mesh;
  wallWash: THREE.Mesh;
}

interface SplitterMeshEntry {
  group: THREE.Group;
  crystal: THREE.Mesh;
  wallWash: THREE.Mesh;
}

interface EmitterMeshEntry {
  group: THREE.Group;
  spinRing: THREE.Mesh;
  core: THREE.Mesh;
}

interface RingMeshEntry {
  group: THREE.Group;
  torus: THREE.Mesh;
  core: THREE.Mesh;
  wallWash: THREE.Mesh;
}

interface RailMeshEntry {
  group: THREE.Group;
  frontMesh: THREE.Mesh;
  backMesh: THREE.Mesh;
  frontStrip: THREE.Mesh;
  backStrip: THREE.Mesh;
  frontContactSprite: THREE.Sprite;
  backContactSprite: THREE.Sprite;
  wallWash: THREE.Mesh;
  sig: string;
  geom: RailGeometry;
}

interface MarbleMeshEntry {
  group: THREE.Group;
  sphere: THREE.Mesh;
}

interface ActiveLampLight {
  x: number;
  y: number;
  color: number;
  power: number;
  radius: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers & Procedural Architectural Textures                        */
/* ------------------------------------------------------------------ */

function makePillShape(halfLen: number, halfThick: number): THREE.Shape {
  const s = new THREE.Shape();
  const hl = Math.max(8, halfLen);
  const ht = Math.max(3, halfThick);
  const endR = Math.min(hl * 0.42, ht * 1.24);
  const pinX = Math.max(2, hl - endR);
  const waistY = ht * 0.88;
  const ctrlX = pinX * 0.46;

  s.moveTo(-pinX, -endR);
  s.bezierCurveTo(-ctrlX, -waistY, ctrlX, -waistY, pinX, -endR);
  s.absarc(pinX, 0, endR, -Math.PI / 2, Math.PI / 2, false);
  s.bezierCurveTo(ctrlX, waistY, -ctrlX, waistY, -pinX, endR);
  s.absarc(-pinX, 0, endR, Math.PI / 2, (Math.PI * 3) / 2, false);
  return s;
}

function makeSoftDotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.32, "rgba(255,255,255,0.48)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Wide, ultra-smooth feathered radial texture for backwall sconce illumination.
 * Strictly sits flush on the backwall (z = -10.1) behind instruments so the background
 * visibly catches warm/luminous light without ever creating a halo over the marble.
 */
function makeWallWashTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  grad.addColorStop(0.22, "rgba(255, 255, 255, 0.62)");
  grad.addColorStop(0.52, "rgba(255, 255, 255, 0.22)");
  grad.addColorStop(0.8, "rgba(255, 255, 255, 0.05)");
  grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBackdropTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  const base = g.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, "#090E18");
  base.addColorStop(0.5, "#0F1829");
  base.addColorStop(1, "#080C15");
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Seamless repeating architectural slate & celestial blueprint tile for the physical 3D backwall.
 * Reacts realistically to Three.js PointLights whenever nearby musical bars light up!
 */
function makeObservatoryWallTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;

  // Deep nocturnal obsidian-slate base so unlit areas stay dark while PointLights pop dramatically
  g.fillStyle = "#060B14";
  g.fillRect(0, 0, size, size);

  // Subtle organic slate cloud mottling (seamless wrap)
  let seed = 4219;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 36 + rand() * 88;
    const bright = rand() > 0.5;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if (x + ox + r < 0 || x + ox - r > size || y + oy + r < 0 || y + oy - r > size) {
          continue;
        }
        const rg = g.createRadialGradient(x + ox, y + oy, 2, x + ox, y + oy, r);
        rg.addColorStop(
          0,
          bright ? "rgba(22, 36, 62, 0.16)" : "rgba(2, 4, 10, 0.22)"
        );
        rg.addColorStop(1, "rgba(6, 11, 20, 0)");
        g.fillStyle = rg;
        g.fillRect(0, 0, size, size);
      }
    }
  }

  // Fine architectural sub-grid (64px) & primary panel seams (256px)
  g.strokeStyle = "rgba(74, 114, 168, 0.15)";
  g.lineWidth = 1;
  for (let p = 0; p < size; p += 64) {
    g.beginPath();
    g.moveTo(p + 0.5, 0);
    g.lineTo(p + 0.5, size);
    g.moveTo(0, p + 0.5);
    g.lineTo(size, p + 0.5);
    g.stroke();
  }

  g.strokeStyle = "rgba(108, 158, 220, 0.28)";
  g.lineWidth = 1.25;
  for (let p = 0; p < size; p += 256) {
    g.beginPath();
    g.moveTo(p + 0.5, 0);
    g.lineTo(p + 0.5, size);
    g.moveTo(0, p + 0.5);
    g.lineTo(size, p + 0.5);
    g.stroke();
  }

  // Delicate diagonal astronomical sightlines + precision "+" reticles at intersections
  g.strokeStyle = "rgba(88, 136, 194, 0.11)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(size, size);
  g.moveTo(size, 0);
  g.lineTo(0, size);
  g.stroke();

  // Subtle inlaid micro-ring at tile center (256, 256)
  g.strokeStyle = "rgba(202, 160, 92, 0.22)";
  g.lineWidth = 1.15;
  g.beginPath();
  g.arc(256, 256, 72, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([4, 6]);
  g.strokeStyle = "rgba(88, 172, 232, 0.2)";
  g.beginPath();
  g.arc(256, 256, 108, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);

  // Precision crosshairs at 128px intervals
  g.strokeStyle = "rgba(148, 196, 246, 0.34)";
  g.lineWidth = 1.2;
  for (let gx = 128; gx < size; gx += 256) {
    for (let gy = 128; gy < size; gy += 256) {
      g.beginPath();
      g.moveTo(gx - 5, gy);
      g.lineTo(gx + 5, gy);
      g.moveTo(gx, gy - 5);
      g.lineTo(gx, gy + 5);
      g.stroke();
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(18, 44);
  map.anisotropy = 4;

  // Matching subtle brushed-slate bump map so grazing PointLights reveal crisp surface grain
  const bc = document.createElement("canvas");
  bc.width = 256;
  bc.height = 256;
  const bg = bc.getContext("2d")!;
  bg.fillStyle = "#808080";
  bg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const v = Math.floor(114 + rand() * 28);
    bg.fillStyle = `rgb(${v},${v},${v})`;
    bg.fillRect(x, y, 2, 1);
  }
  bg.strokeStyle = "#666666";
  bg.lineWidth = 1.5;
  for (let p = 0; p < 256; p += 128) {
    bg.beginPath();
    bg.moveTo(p, 0);
    bg.lineTo(p, 256);
    bg.moveTo(0, p);
    bg.lineTo(256, p);
    bg.stroke();
  }

  const bumpMap = new THREE.CanvasTexture(bc);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(36, 88);

  return { map, bumpMap };
}

function buildDualRodTube(pts: Vec2[], z: number, radius: number): THREE.TubeGeometry {
  const vecs = pts.map((p) => new THREE.Vector3(p.x, -p.y, z));
  const curve = new THREE.CatmullRomCurve3(vecs);
  return new THREE.TubeGeometry(curve, 48, radius, 16, false);
}

function buildDualStripTube(
  pts: Vec2[],
  upNormals: Vec2[],
  upOffset: number,
  z: number
): THREE.TubeGeometry {
  const vecs = pts.map(
    (p, i) =>
      new THREE.Vector3(
        p.x + upNormals[i].x * upOffset,
        -(p.y + upNormals[i].y * upOffset),
        z
      )
  );
  const curve = new THREE.CatmullRomCurve3(vecs);
  return new THREE.TubeGeometry(curve, 40, 0.62, 8, false);
}

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (((h >>> 0) % 1000) / 1000) * Math.PI * 2;
}

/* ------------------------------------------------------------------ */
/*  Renderer                                                           */
/* ------------------------------------------------------------------ */

export class OrbitalRenderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private backwallMesh: THREE.Mesh;
  private wallMap: THREE.CanvasTexture;
  private wallBumpMap: THREE.CanvasTexture;
  private wallWashTex: THREE.CanvasTexture;
  private ornamentGroup: THREE.Group;
  private starPoints: THREE.Points;
  private envTexture: THREE.Texture;
  private backdrop: THREE.CanvasTexture;
  private softDot: THREE.CanvasTexture;

  // Pool of real 3D PointLights so glowing bars physically illuminate the backwall & nearby objects!
  private readonly LAMP_LIGHT_COUNT = 16;
  private lampLights: THREE.PointLight[] = [];
  private activeLampCandidates: ActiveLampLight[] = [];

  private barGeoCache = new Map<string, THREE.ExtrudeGeometry>();
  private coreGeoCache = new Map<string, THREE.BoxGeometry>();

  private barMeshes = new Map<string, BarMeshEntry>();
  private bumperMeshes = new Map<string, BumperMeshEntry>();
  private splitterMeshes = new Map<string, SplitterMeshEntry>();
  private emitterMeshes = new Map<string, EmitterMeshEntry>();
  private ringMeshes = new Map<string, RingMeshEntry>();
  private railMeshes = new Map<string, RailMeshEntry>();
  private marbleMeshes = new Map<number, MarbleMeshEntry>();

  private sharedMarbleGeo = new THREE.SphereGeometry(8, 36, 28);
  private sharedPinGeo = new THREE.CylinderGeometry(2.1, 2.3, 4.5, 14);
  private sharedRailCapGeo = new THREE.SphereGeometry(1, 14, 10);
  private sharedBridgeGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
  private sharedWashPlaneGeo = new THREE.PlaneGeometry(1, 1);

  private marbleMat: THREE.MeshPhysicalMaterial;
  private barMaterials: Record<MaterialType, THREE.MeshPhysicalMaterial>;
  private silentMaterial: THREE.MeshPhysicalMaterial;
  private pinMaterial: THREE.MeshPhysicalMaterial;
  private brassMat: THREE.MeshPhysicalMaterial;
  private railGraphiteMat: THREE.MeshPhysicalMaterial;
  private railChromeMat: THREE.MeshPhysicalMaterial;
  private inlayGoldMat: THREE.MeshStandardMaterial;
  private inlayCyanMat: THREE.MeshStandardMaterial;
  private constellationLineMat: THREE.LineBasicMaterial;
  private cameraViewMode: "perspective" | "front" = "perspective";

  // Subtle nocturnal stardust motes
  private readonly DUST_COUNT = 110;
  private dustPoints: THREE.Points;
  private dustPos: Float32Array;
  private dustVel: Float32Array;

  private raycaster = new THREE.Raycaster();
  private stagePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private lastTime = performance.now();
  private clock = 0;
  private tmpColorA = new THREE.Color();
  private tmpColorB = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.backdrop = makeBackdropTexture();
    this.scene.background = this.backdrop;
    this.softDot = makeSoftDotTexture();
    this.wallWashTex = makeWallWashTexture();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 10, 6000);

    // Moody nocturnal ambient base so unlit regions stay deep slate while PointLights pop vividly!
    const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x070b14, 0.38);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xe4eeff, 0.72);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 1800;
    const d = 820;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.radius = 4;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const rimLight = new THREE.DirectionalLight(0x5fa8ff, 0.24);
    rimLight.position.set(600, -500, 320);
    this.scene.add(rimLight);

    // Pool of real 3D PointLights (decay = 0 for predictable world-space studio falloff in Three r187)
    for (let i = 0; i < this.LAMP_LIGHT_COUNT; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 350, 0);
      pl.castShadow = false;
      this.scene.add(pl);
      this.lampLights.push(pl);
    }

    // Physical 3D Architectural Slate & Blueprint Backwall (receives shadows AND real PointLight!)
    const wallTex = makeObservatoryWallTextures();
    this.wallMap = wallTex.map;
    this.wallBumpMap = wallTex.bumpMap;
    this.backwallMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 20000),
      new THREE.MeshStandardMaterial({
        map: this.wallMap,
        bumpMap: this.wallBumpMap,
        bumpScale: 2.2,
        roughness: 0.86,
        metalness: 0.06,
        envMapIntensity: 0.02,
      })
    );
    this.backwallMesh.position.set(500, -4000, BACKWALL_Z);
    this.backwallMesh.receiveShadow = true;
    this.scene.add(this.backwallMesh);

    // Metallic brass & cyan architectural inlays flush against the observatory backwall
    this.inlayGoldMat = new THREE.MeshStandardMaterial({
      color: 0xd4a454,
      emissive: new THREE.Color(0x4c3614),
      emissiveIntensity: 0.35,
      roughness: 0.34,
      metalness: 0.76,
      transparent: true,
      opacity: 0.44,
      envMapIntensity: 0.12,
      depthWrite: false,
    });
    this.inlayCyanMat = new THREE.MeshStandardMaterial({
      color: 0x58a8e2,
      emissive: new THREE.Color(0x143b62),
      emissiveIntensity: 0.35,
      roughness: 0.36,
      metalness: 0.68,
      transparent: true,
      opacity: 0.38,
      envMapIntensity: 0.1,
      depthWrite: false,
    });
    this.constellationLineMat = new THREE.LineBasicMaterial({
      color: 0x6ba2d8,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.ornamentGroup = new THREE.Group();
    this.buildObservatoryOrnaments();
    this.scene.add(this.ornamentGroup);

    // Starlight & coordinate pinpoint nodes across the backwall
    const starPositions: number[] = [];
    const starColors: number[] = [];
    let sSeed = 918273;
    const sRand = () => {
      sSeed = (sSeed * 1664525 + 1013904223) >>> 0;
      return sSeed / 0xffffffff;
    };
    for (let i = 0; i < 620; i++) {
      const sx = -700 + sRand() * 2400;
      const sy = -300 + sRand() * 6800;
      starPositions.push(sx, -sy, BACKWALL_Z + 0.6);
      const warm = sRand() > 0.68;
      if (warm) {
        starColors.push(0.95, 0.82, 0.58);
      } else {
        starColors.push(0.55, 0.78, 1.0);
      }
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.Float32BufferAttribute(starColors, 3));
    this.starPoints = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        size: 3.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.52,
        map: this.softDot,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.scene.add(this.starPoints);

    // Resting instrument materials (moody satin finish; ignite like bulbs on hit!)
    this.barMaterials = {
      marimba: new THREE.MeshPhysicalMaterial({
        color: BAR_REST_COLORS.marimba,
        roughness: 0.36,
        metalness: 0.08,
        clearcoat: 0.48,
        clearcoatRoughness: 0.22,
        envMapIntensity: 0.45,
      }),
      brass: new THREE.MeshPhysicalMaterial({
        color: BAR_REST_COLORS.brass,
        roughness: 0.26,
        metalness: 0.78,
        clearcoat: 0.45,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.65,
      }),
      ceramic: new THREE.MeshPhysicalMaterial({
        color: BAR_REST_COLORS.ceramic,
        roughness: 0.16,
        metalness: 0.06,
        clearcoat: 0.88,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.52,
      }),
      bass: new THREE.MeshPhysicalMaterial({
        color: BAR_REST_COLORS.bass,
        roughness: 0.28,
        metalness: 0.48,
        clearcoat: 0.65,
        clearcoatRoughness: 0.15,
        envMapIntensity: 0.55,
      }),
    };

    this.brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xc89a38,
      roughness: 0.24,
      metalness: 0.88,
      clearcoat: 0.5,
      envMapIntensity: 0.85,
    });

    this.silentMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x2c3646,
      roughness: 0.42,
      metalness: 0.25,
      clearcoat: 0.35,
      transparent: true,
      opacity: 0.82,
    });

    this.pinMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xaec0d4,
      roughness: 0.22,
      metalness: 0.92,
      envMapIntensity: 0.9,
    });

    // Pure unchanging brushed-silver / pearl-steel marble — zero glow, zero halo, zero color shift!
    this.marbleMat = new THREE.MeshPhysicalMaterial({
      color: 0xdce5f0,
      roughness: 0.13,
      metalness: 0.58,
      clearcoat: 1.0,
      clearcoatRoughness: 0.05,
      envMapIntensity: 1.28,
    });

    this.railGraphiteMat = new THREE.MeshPhysicalMaterial({
      color: 0x1b2432,
      roughness: 0.22,
      metalness: 0.88,
      clearcoat: 0.8,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.95,
    });

    this.railChromeMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fb0c4,
      roughness: 0.2,
      metalness: 0.9,
      clearcoat: 0.75,
      clearcoatRoughness: 0.14,
      envMapIntensity: 1.05,
    });

    // Subtle nocturnal atmospheric dust motes
    this.dustPos = new Float32Array(this.DUST_COUNT * 3);
    this.dustVel = new Float32Array(this.DUST_COUNT * 3);
    for (let i = 0; i < this.DUST_COUNT; i++) {
      this.dustPos[i * 3] = (Math.random() - 0.5) * 1500;
      this.dustPos[i * 3 + 1] = (Math.random() - 0.5) * 1100;
      this.dustPos[i * 3 + 2] = -6 + Math.random() * 70;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 5;
      this.dustVel[i * 3 + 1] = 2.5 + Math.random() * 5.5;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3));
    this.dustPoints = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0x82acce,
        size: 3.2,
        map: this.softDot,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.dustPoints.frustumCulled = false;
    this.scene.add(this.dustPoints);
  }

  /**
   * Builds tasteful inlaid Orbital Astrolabe concentric rings, harmonic arcs, degree ticks,
   * and constellation geometry across the backwall so the background feels richly crafted
   * and catches real colored PointLight reflections when bars light up!
   */
  private buildObservatoryOrnaments(): void {
    const zInlay = BACKWALL_Z + 0.45;
    const medallions = [
      { x: 500, y: 350, scale: 1.0 },
      { x: 120, y: 740, scale: 0.68 },
      { x: 890, y: 820, scale: 0.72 },
      { x: 490, y: 1260, scale: 0.92 },
      { x: 80, y: 1720, scale: 0.66 },
      { x: 920, y: 1790, scale: 0.7 },
      { x: 500, y: 2220, scale: 0.9 },
      { x: 140, y: 2740, scale: 0.68 },
      { x: 880, y: 2820, scale: 0.68 },
      { x: 500, y: 3260, scale: 0.88 },
    ];

    for (let mIdx = 0; mIdx < medallions.length; mIdx++) {
      const m = medallions[mIdx];
      const g = new THREE.Group();
      g.position.set(m.x, -m.y, zInlay);

      const r1 = 155 * m.scale;
      const r2 = 245 * m.scale;
      const r3 = 340 * m.scale;

      // Primary brass harmonic ring
      const ring1 = new THREE.Mesh(
        new THREE.RingGeometry(r1 - 1.3, r1, 96),
        this.inlayGoldMat
      );
      // Outer cyan-slate orbital ring
      const ring2 = new THREE.Mesh(
        new THREE.RingGeometry(r2 - 1.1, r2, 112),
        this.inlayCyanMat
      );
      // Segmented outer astrolabe arcs
      const arcA = new THREE.Mesh(
        new THREE.RingGeometry(r3 - 1.2, r3, 64, 1, mIdx * 0.7, Math.PI * 0.58),
        this.inlayGoldMat
      );
      const arcB = new THREE.Mesh(
        new THREE.RingGeometry(
          r3 - 1.2,
          r3,
          64,
          1,
          mIdx * 0.7 + Math.PI,
          Math.PI * 0.58
        ),
        this.inlayCyanMat
      );
      g.add(ring1, ring2, arcA, arcB);

      // 24 radial degree ticks + cardinal crosshairs
      const tickVerts: number[] = [];
      for (let t = 0; t < 24; t++) {
        const a = (t / 24) * Math.PI * 2;
        const inner = t % 6 === 0 ? r2 - 14 : r2 - 6;
        const outer = t % 6 === 0 ? r2 + 14 : r2 + 6;
        tickVerts.push(
          Math.cos(a) * inner,
          Math.sin(a) * inner,
          0.1,
          Math.cos(a) * outer,
          Math.sin(a) * outer,
          0.1
        );
      }
      // Subtle center compass cross
      tickVerts.push(-22 * m.scale, 0, 0.1, 22 * m.scale, 0, 0.1);
      tickVerts.push(0, -22 * m.scale, 0.1, 0, 22 * m.scale, 0.1);

      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute("position", new THREE.Float32BufferAttribute(tickVerts, 3));
      g.add(new THREE.LineSegments(tickGeo, this.constellationLineMat));

      this.ornamentGroup.add(g);
    }

    // Delicate constellation polylines & nodes framing the left, center, and right margins
    const constellations: Vec2[][] = [
      [
        { x: -240, y: 160 },
        { x: -130, y: 240 },
        { x: -185, y: 370 },
        { x: -75, y: 470 },
      ],
      [
        { x: 1080, y: 180 },
        { x: 1190, y: 290 },
        { x: 1120, y: 430 },
        { x: 1230, y: 540 },
      ],
      [
        { x: 380, y: 520 },
        { x: 470, y: 610 },
        { x: 590, y: 575 },
        { x: 660, y: 680 },
      ],
      [
        { x: -220, y: 980 },
        { x: -110, y: 1110 },
        { x: -170, y: 1250 },
        { x: -60, y: 1360 },
      ],
      [
        { x: 1090, y: 1040 },
        { x: 1210, y: 1160 },
        { x: 1140, y: 1310 },
        { x: 1245, y: 1420 },
      ],
      [
        { x: 360, y: 1480 },
        { x: 485, y: 1560 },
        { x: 585, y: 1510 },
        { x: 650, y: 1630 },
      ],
    ];

    const cVerts: number[] = [];
    const nodeGeo = new THREE.CircleGeometry(2.6, 12);
    for (const poly of constellations) {
      for (let i = 0; i < poly.length; i++) {
        const pt = poly[i];
        const dot = new THREE.Mesh(nodeGeo, this.inlayGoldMat);
        dot.position.set(pt.x, -pt.y, zInlay + 0.15);
        this.ornamentGroup.add(dot);
        if (i + 1 < poly.length) {
          const nxt = poly[i + 1];
          cVerts.push(pt.x, -pt.y, zInlay + 0.1, nxt.x, -nxt.y, zInlay + 0.1);
        }
      }
    }
    const cLineGeo = new THREE.BufferGeometry();
    cLineGeo.setAttribute("position", new THREE.Float32BufferAttribute(cVerts, 3));
    this.ornamentGroup.add(new THREE.LineSegments(cLineGeo, this.constellationLineMat));
  }

  private makeWallWashMesh(colorHex: number): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({
      map: this.wallWashTex,
      color: colorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.sharedWashPlaneGeo, mat);
    mesh.position.z = BACKWALL_Z + 0.9;
    return mesh;
  }

  /* -------------------------------------------------------------- */
  /*  Camera & coordinate helpers                                   */
  /* -------------------------------------------------------------- */

  public resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  public setCameraViewMode(mode: "perspective" | "front"): void {
    this.cameraViewMode = mode;
  }

  public updateCamera(cameraState: CameraState): void {
    const zoom = Math.max(0.28, Math.min(2.6, cameraState.zoom));
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const baseDist = (STAGE_H * 1.32) / (2 * Math.tan(fovRad * 0.5));
    const dist = baseDist / zoom;

    const fx = cameraState.focusX;
    const fy = -cameraState.focusY;

    if (this.cameraViewMode === "front") {
      this.camera.position.set(fx, fy + dist * 0.055, dist * 0.998);
    } else {
      this.camera.position.set(fx - dist * 0.3, fy + dist * 0.62, dist * 0.73);
    }
    this.camera.lookAt(fx, fy, 0);
    this.camera.updateMatrixWorld();

    this.sunLight.position.set(fx - 180, fy + 280, 760);
    this.sunLight.target.position.set(fx, fy, 0);
    this.sunLight.target.updateMatrixWorld();

    this.dustPoints.position.set(fx, fy, 0);
  }

  public screenToStage(clientX: number, clientY: number, rect: DOMRect): Vec2 | null {
    const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.stagePlane, hit);
    if (!ok) return null;
    return { x: hit.x, y: -hit.y };
  }

  public projectToScreen(
    stageX: number,
    stageY: number,
    stageZ: number,
    viewW: number,
    viewH: number
  ): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(stageX, -stageY, stageZ);
    v.project(this.camera);
    const x = (v.x * 0.5 + 0.5) * viewW;
    const y = (-v.y * 0.5 + 0.5) * viewH;
    return { x, y, visible: v.z >= -1 && v.z <= 1 };
  }

  /* -------------------------------------------------------------- */
  /*  Geometry caches                                               */
  /* -------------------------------------------------------------- */

  private getBarGeometry(halfLen: number, halfThick: number, depth: number): THREE.ExtrudeGeometry {
    const qLen = Math.round(halfLen * 2);
    const qThick = Math.round(halfThick * 2);
    const key = `${qLen}_${qThick}_${depth}`;
    const existing = this.barGeoCache.get(key);
    if (existing) return existing;

    const shape = makePillShape(qLen * 0.5, qThick * 0.5);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 3,
      steps: 1,
      bevelSize: 1.8,
      bevelThickness: 2.4,
      curveSegments: 12,
    });
    geo.translate(0, 0, -depth * 0.5);
    this.barGeoCache.set(key, geo);
    return geo;
  }

  private getCoreGeometry(halfLen: number): THREE.BoxGeometry {
    const qLen = Math.max(10, Math.round(halfLen * 1.24));
    const key = `core_${qLen}`;
    const existing = this.coreGeoCache.get(key);
    if (existing) return existing;
    const geo = new THREE.BoxGeometry(qLen, 2.5, 1.4);
    this.coreGeoCache.set(key, geo);
    return geo;
  }

  /* -------------------------------------------------------------- */
  /*  Scene sync                                                    */
  /* -------------------------------------------------------------- */

  private syncBars(bars: BarPiece[], selectedId: string | null): void {
    const alive = new Set<string>();
    for (const bar of bars) {
      alive.add(bar.id);
      const dx = bar.bx - bar.ax;
      const dy = bar.by - bar.ay;
      const len = Math.max(16, Math.hypot(dx, dy));
      const halfLen = len * 0.5;
      const spec = MATERIALS[bar.material];
      const halfThick = spec.thickness * 0.5;
      const depth = bar.material === "bass" ? 20 : 15;
      const angle = Math.atan2(dy, dx);
      const midX = (bar.ax + bar.bx) * 0.5;
      const midY = (bar.ay + bar.by) * 0.5;
      const flex = bar.flexOffset ?? 0;

      const rawGlow = bar.glow ?? 0;
      const flexGlow = Math.min(1, Math.abs(flex) * 0.14);
      const bulb = bar.silent ? 0 : Math.max(rawGlow, flexGlow);
      const bulbEase = bulb > 0 ? Math.pow(bulb, 0.66) : 0;
      const qLen = Math.round(len);

      let entry = this.barMeshes.get(bar.id);
      if (!entry) {
        const group = new THREE.Group();
        const baseMat = (bar.silent ? this.silentMaterial : this.barMaterials[bar.material]).clone();
        const body = new THREE.Mesh(this.getBarGeometry(halfLen, halfThick, depth), baseMat);
        body.castShadow = true;
        body.receiveShadow = true;

        const coreMat = new THREE.MeshBasicMaterial({
          color: CORE_COLORS[bar.material],
          transparent: true,
          opacity: bar.silent ? 0 : 0.18,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const core = new THREE.Mesh(this.getCoreGeometry(halfLen), coreMat);
        core.position.set(0, 0, depth * 0.5 + 2.6);

        const wallWash = this.makeWallWashMesh(BAR_WALL_LIGHT_COLORS[bar.material]);
        this.scene.add(wallWash);

        const pinA = new THREE.Mesh(this.sharedPinGeo, this.pinMaterial);
        pinA.rotation.x = Math.PI * 0.5;
        const pinB = new THREE.Mesh(this.sharedPinGeo, this.pinMaterial);
        pinB.rotation.x = Math.PI * 0.5;

        group.add(body, core, pinA, pinB);
        this.scene.add(group);
        entry = {
          group,
          body,
          core,
          wallWash,
          pinA,
          pinB,
          material: bar.material,
          silent: !!bar.silent,
          cachedLen: -1,
          phase: hashPhase(bar.id),
        };
        this.barMeshes.set(bar.id, entry);
      }

      if (entry.cachedLen !== qLen || entry.material !== bar.material || entry.silent !== !!bar.silent) {
        entry.body.geometry = this.getBarGeometry(halfLen, halfThick, depth);
        entry.core.geometry = this.getCoreGeometry(halfLen);
        entry.core.position.z = depth * 0.5 + 2.6;
        const pinX = Math.max(4, halfLen - 8);
        entry.pinA.position.set(-pinX, 0, depth * 0.5 + 2.2);
        entry.pinB.position.set(pinX, 0, depth * 0.5 + 2.2);
        if (entry.material !== bar.material || entry.silent !== !!bar.silent) {
          const srcMat = bar.silent ? this.silentMaterial : this.barMaterials[bar.material];
          (entry.body.material as THREE.MeshPhysicalMaterial).copy(srcMat);
          (entry.core.material as THREE.MeshBasicMaterial).color.setHex(CORE_COLORS[bar.material]);
          (entry.wallWash.material as THREE.MeshBasicMaterial).color.setHex(
            BAR_WALL_LIGHT_COLORS[bar.material]
          );
        }
        entry.cachedLen = qLen;
        entry.material = bar.material;
        entry.silent = !!bar.silent;
      }

      const isSel = selectedId === bar.id;
      const bodyMat = entry.body.material as THREE.MeshPhysicalMaterial;
      if (!bar.silent) {
        this.tmpColorA.setHex(BAR_REST_COLORS[bar.material]);
        this.tmpColorB.setHex(BAR_LIT_COLORS[bar.material]);
        bodyMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, bulbEase * 0.94);

        bodyMat.emissive.setHex(BAR_EMISSIVE_COLORS[bar.material]);
        bodyMat.emissiveIntensity = isSel
          ? Math.max(0.55, 0.08 + bulbEase * 2.25)
          : 0.06 + bulbEase * 2.25;
      } else {
        bodyMat.emissive.setHex(0x38bdf8);
        bodyMat.emissiveIntensity = isSel ? 0.35 : 0.02;
      }

      const coreMat = entry.core.material as THREE.MeshBasicMaterial;
      coreMat.opacity = bar.silent ? 0 : 0.16 + bulbEase * 0.84;

      // Cast wide, soft lightbulb glow directly onto the observatory backwall behind this bar
      const washMat = entry.wallWash.material as THREE.MeshBasicMaterial;
      if (!bar.silent && bulbEase > 0.02) {
        entry.wallWash.visible = true;
        entry.wallWash.position.set(midX, -midY, BACKWALL_Z + 0.9);
        entry.wallWash.rotation.z = -angle;
        const wx = Math.max(195, len * 3.35) * (0.85 + bulbEase * 0.28);
        const wy = Math.max(165, len * 2.55) * (0.85 + bulbEase * 0.28);
        entry.wallWash.scale.set(wx, wy, 1);
        washMat.opacity = bulbEase * 0.54;

        this.activeLampCandidates.push({
          x: midX,
          y: -midY,
          color: BAR_WALL_LIGHT_COLORS[bar.material],
          power: bulbEase * 7.2,
          radius: 340,
        });
      } else {
        entry.wallWash.visible = false;
      }

      const bob = Math.sin(this.clock * 1.3 + entry.phase) * 0.9;
      entry.group.position.set(midX, -midY - flex * 0.55, (isSel ? 5 : 0) + bob);
      entry.group.rotation.z = -angle;
      entry.group.scale.set(1 + flexGlow * 0.025, 1 - flexGlow * 0.14, 1 + bulbEase * 0.06);
    }

    for (const [id, entry] of this.barMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.wallWash);
        (entry.body.material as THREE.Material).dispose();
        (entry.core.material as THREE.Material).dispose();
        (entry.wallWash.material as THREE.Material).dispose();
        this.barMeshes.delete(id);
      }
    }
  }

  private syncBumpers(bumpers: BumperPiece[]): void {
    const alive = new Set<string>();
    for (const bmp of bumpers) {
      alive.add(bmp.id);
      let entry = this.bumperMeshes.get(bmp.id);
      if (!entry) {
        const group = new THREE.Group();
        const collar = new THREE.Mesh(
          new THREE.CylinderGeometry(bmp.radius, bmp.radius * 1.05, 14, 32),
          new THREE.MeshPhysicalMaterial({
            color: 0x222c3a,
            roughness: 0.28,
            metalness: 0.75,
            clearcoat: 0.65,
          })
        );
        collar.rotation.x = Math.PI * 0.5;
        collar.castShadow = true;

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(6, bmp.radius - 3.4), 28, 18),
          new THREE.MeshPhysicalMaterial({
            color: 0x7c3626,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
            emissive: new THREE.Color(0xff5e2b),
            emissiveIntensity: 0.08,
          })
        );
        dome.position.z = 5;
        dome.scale.set(1, 1, 0.58);
        dome.castShadow = true;

        const ringTube = new THREE.Mesh(
          new THREE.TorusGeometry(Math.max(7, bmp.radius - 1.8), 1.05, 10, 36),
          new THREE.MeshBasicMaterial({
            color: 0xff9a5a,
            transparent: true,
            opacity: 0.28,
          })
        );
        ringTube.position.z = 6.2;

        const wallWash = this.makeWallWashMesh(0xff7638);
        this.scene.add(wallWash);

        group.add(collar, dome, ringTube);
        this.scene.add(group);
        entry = { group, collar, dome, ringTube, wallWash };
        this.bumperMeshes.set(bmp.id, entry);
      }

      const pulse = bmp.pulse ?? 0;
      const bulb = pulse > 0 ? Math.pow(pulse, 0.65) : 0;
      const p = 1 + pulse * 0.1;
      entry.group.position.set(bmp.x, -bmp.y, 0);
      entry.group.scale.set(p, p, 1 - pulse * 0.16);

      const domeMat = entry.dome.material as THREE.MeshPhysicalMaterial;
      this.tmpColorA.setHex(0x7c3626);
      this.tmpColorB.setHex(0xffb278);
      domeMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, bulb);
      domeMat.emissiveIntensity = 0.08 + bulb * 2.3;

      (entry.ringTube.material as THREE.MeshBasicMaterial).opacity = 0.24 + bulb * 0.76;

      const washMat = entry.wallWash.material as THREE.MeshBasicMaterial;
      if (bulb > 0.02) {
        entry.wallWash.visible = true;
        entry.wallWash.position.set(bmp.x, -bmp.y, BACKWALL_Z + 0.9);
        const ws = bmp.radius * 14.5 * (0.82 + bulb * 0.3);
        entry.wallWash.scale.set(ws, ws, 1);
        washMat.opacity = bulb * 0.5;

        this.activeLampCandidates.push({
          x: bmp.x,
          y: -bmp.y,
          color: 0xff783c,
          power: bulb * 6.2,
          radius: 300,
        });
      } else {
        entry.wallWash.visible = false;
      }
    }

    for (const [id, entry] of this.bumperMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.wallWash);
        entry.collar.geometry.dispose();
        (entry.collar.material as THREE.Material).dispose();
        entry.dome.geometry.dispose();
        (entry.dome.material as THREE.Material).dispose();
        entry.ringTube.geometry.dispose();
        (entry.ringTube.material as THREE.Material).dispose();
        (entry.wallWash.material as THREE.Material).dispose();
        this.bumperMeshes.delete(id);
      }
    }
  }

  private syncSplitters(splitters: SplitterPiece[], dt: number): void {
    const alive = new Set<string>();
    for (const spl of splitters) {
      alive.add(spl.id);
      let entry = this.splitterMeshes.get(spl.id);
      if (!entry) {
        const group = new THREE.Group();
        const geo = new THREE.OctahedronGeometry(spl.radius * 0.95, 0);
        geo.scale(1.3, 0.72, 0.85);
        const crystal = new THREE.Mesh(
          geo,
          new THREE.MeshPhysicalMaterial({
            color: 0x5c7ea8,
            roughness: 0.06,
            metalness: 0.12,
            clearcoat: 1,
            iridescence: 1,
            iridescenceIOR: 1.6,
            emissive: new THREE.Color(0x52e5ff),
            emissiveIntensity: 0.1,
            transparent: true,
            opacity: 0.9,
          })
        );
        crystal.castShadow = true;

        const wallWash = this.makeWallWashMesh(0x58e8ff);
        this.scene.add(wallWash);

        group.add(crystal);
        this.scene.add(group);
        entry = { group, crystal, wallWash };
        this.splitterMeshes.set(spl.id, entry);
      }
      const pulse = spl.pulse ?? 0;
      const bulb = pulse > 0 ? Math.pow(pulse, 0.65) : 0;
      const p = 1 + pulse * 0.14;
      entry.group.position.set(spl.x, -spl.y, 2);
      entry.group.scale.set(p, p, p);
      entry.crystal.rotation.y += dt * 0.9;

      const cMat = entry.crystal.material as THREE.MeshPhysicalMaterial;
      this.tmpColorA.setHex(0x5c7ea8);
      this.tmpColorB.setHex(0xc4f8ff);
      cMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, bulb);
      cMat.emissiveIntensity = 0.1 + bulb * 2.25;

      const washMat = entry.wallWash.material as THREE.MeshBasicMaterial;
      if (bulb > 0.02) {
        entry.wallWash.visible = true;
        entry.wallWash.position.set(spl.x, -spl.y, BACKWALL_Z + 0.9);
        const ws = spl.radius * 14 * (0.85 + bulb * 0.28);
        entry.wallWash.scale.set(ws, ws * 0.85, 1);
        washMat.opacity = bulb * 0.48;

        this.activeLampCandidates.push({
          x: spl.x,
          y: -spl.y,
          color: 0x58e8ff,
          power: bulb * 6.0,
          radius: 300,
        });
      } else {
        entry.wallWash.visible = false;
      }
    }

    for (const [id, entry] of this.splitterMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.wallWash);
        entry.crystal.geometry.dispose();
        (entry.crystal.material as THREE.Material).dispose();
        (entry.wallWash.material as THREE.Material).dispose();
        this.splitterMeshes.delete(id);
      }
    }
  }

  private syncEmitters(emitters: Emitter[], dt: number): void {
    const alive = new Set<string>();
    for (const em of emitters) {
      alive.add(em.id);
      let entry = this.emitterMeshes.get(em.id);
      if (!entry) {
        const group = new THREE.Group();
        const bezel = new THREE.Mesh(new THREE.CylinderGeometry(14, 15, 10, 32), this.brassMat);
        bezel.rotation.x = Math.PI * 0.5;
        bezel.castShadow = true;

        const face = new THREE.Mesh(
          new THREE.CylinderGeometry(10.5, 10.5, 11.2, 32),
          new THREE.MeshPhysicalMaterial({ color: 0x1a2332, roughness: 0.3, clearcoat: 0.7 })
        );
        face.rotation.x = Math.PI * 0.5;

        const spinRing = new THREE.Mesh(
          new THREE.TorusGeometry(18.5, 0.9, 8, 48, Math.PI * 1.4),
          new THREE.MeshBasicMaterial({
            color: 0xf59e56,
            transparent: true,
            opacity: 0.65,
          })
        );
        spinRing.position.z = 3;

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(4, 18, 12),
          new THREE.MeshPhysicalMaterial({
            color: 0xffb870,
            roughness: 0.15,
            emissive: new THREE.Color(0xff8438),
            emissiveIntensity: 0.35,
          })
        );
        core.position.z = 5.6;

        group.add(bezel, face, spinRing, core);
        this.scene.add(group);
        entry = { group, spinRing, core };
        this.emitterMeshes.set(em.id, entry);
      }
      const pulse = em.pulse ?? 0;
      const p = 1 + pulse * 0.1;
      entry.group.position.set(em.x, -em.y, 2);
      entry.group.scale.set(p, p, 1);
      entry.spinRing.rotation.z -= dt * (1.2 + pulse * 5);
      (entry.core.material as THREE.MeshPhysicalMaterial).emissiveIntensity =
        0.3 + pulse * 1.8;
    }

    for (const [id, entry] of this.emitterMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.emitterMeshes.delete(id);
      }
    }
  }

  private syncRings(rings: ResonanceRing[]): void {
    const alive = new Set<string>();
    for (const r of rings) {
      alive.add(r.id);
      let entry = this.ringMeshes.get(r.id);
      if (!entry) {
        const group = new THREE.Group();
        const torus = new THREE.Mesh(
          new THREE.TorusGeometry(r.radius, 3.2, 14, 48),
          new THREE.MeshPhysicalMaterial({
            color: 0x8c6d2e,
            roughness: 0.24,
            metalness: 0.88,
            emissive: new THREE.Color(0x2ce6b8),
            emissiveIntensity: 0.05,
          })
        );
        torus.castShadow = true;
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(r.radius - 3, 36),
          new THREE.MeshBasicMaterial({
            color: 0x3ef0c8,
            transparent: true,
            opacity: 0.08,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        const wallWash = this.makeWallWashMesh(0x38f2c8);
        this.scene.add(wallWash);
        group.add(torus, core);
        this.scene.add(group);
        entry = { group, torus, core, wallWash };
        this.ringMeshes.set(r.id, entry);
      }
      entry.group.position.set(r.x, -r.y, 0);
      const charge = Math.max(0, Math.min(1, r.charge));
      const tMat = entry.torus.material as THREE.MeshPhysicalMaterial;
      this.tmpColorA.setHex(0x8c6d2e);
      this.tmpColorB.setHex(0x5ff7d2);
      tMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, charge);
      tMat.emissiveIntensity = 0.05 + charge * 1.85;
      (entry.core.material as THREE.MeshBasicMaterial).opacity = 0.06 + charge * 0.36;

      if (charge > 0.04) {
        entry.wallWash.visible = true;
        entry.wallWash.position.set(r.x, -r.y, BACKWALL_Z + 0.9);
        const ws = r.radius * 8.8;
        entry.wallWash.scale.set(ws, ws, 1);
        (entry.wallWash.material as THREE.MeshBasicMaterial).opacity = charge * 0.46;

        this.activeLampCandidates.push({
          x: r.x,
          y: -r.y,
          color: 0x38f2c8,
          power: charge * 5.8,
          radius: 300,
        });
      } else {
        entry.wallWash.visible = false;
      }
    }

    for (const [id, entry] of this.ringMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.wallWash);
        entry.torus.geometry.dispose();
        (entry.torus.material as THREE.Material).dispose();
        entry.core.geometry.dispose();
        (entry.core.material as THREE.Material).dispose();
        (entry.wallWash.material as THREE.Material).dispose();
        this.ringMeshes.delete(id);
      }
    }
  }

  /**
   * Pure physical marble sphere ONLY — zero halo sprite, zero floor light pool,
   * zero glowing trail, zero color/flash mutation on collision.
   */
  private syncMarbles(marbles: Marble[], alpha: number, dt: number): void {
    const alive = new Set<number>();
    for (const m of marbles) {
      alive.add(m.id);
      let entry = this.marbleMeshes.get(m.id);
      if (!entry) {
        const group = new THREE.Group();
        const sphere = new THREE.Mesh(this.sharedMarbleGeo, this.marbleMat);
        sphere.castShadow = true;
        sphere.receiveShadow = true;
        group.add(sphere);
        this.scene.add(group);
        entry = { group, sphere };
        this.marbleMeshes.set(m.id, entry);
      }

      const ix = m.prevX + (m.x - m.prevX) * alpha;
      const iy = m.prevY + (m.y - m.prevY) * alpha;
      entry.group.position.set(ix, -iy, 2);

      const sScale = m.radius / 8;
      entry.sphere.scale.setScalar(sScale);
      entry.sphere.rotation.z -= (m.vx * dt) / Math.max(4, m.radius);
    }

    for (const [id, entry] of this.marbleMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.marbleMeshes.delete(id);
      }
    }
  }

  private syncLampLights(): void {
    if (this.activeLampCandidates.length > this.LAMP_LIGHT_COUNT) {
      this.activeLampCandidates.sort((a, b) => b.power - a.power);
    }
    for (let i = 0; i < this.LAMP_LIGHT_COUNT; i++) {
      const pl = this.lampLights[i];
      const cand = this.activeLampCandidates[i];
      if (cand && cand.power > 0.03) {
        pl.color.setHex(cand.color);
        pl.intensity = cand.power;
        pl.distance = cand.radius;
        pl.position.set(cand.x, cand.y, 18);
      } else {
        pl.intensity = 0;
      }
    }
  }

  private updateAtmosphere(dt: number): void {
    for (let i = 0; i < this.DUST_COUNT; i++) {
      const ix = i * 3;
      this.dustPos[ix] += (this.dustVel[ix] + Math.sin(this.clock * 0.6 + i) * 2.5) * dt;
      this.dustPos[ix + 1] += this.dustVel[ix + 1] * dt;
      this.dustPos[ix + 2] += this.dustVel[ix + 2] * dt;
      if (this.dustPos[ix + 1] > 550) this.dustPos[ix + 1] = -550;
      if (this.dustPos[ix] > 760) this.dustPos[ix] = -760;
      if (this.dustPos[ix] < -760) this.dustPos[ix] = 760;
      if (this.dustPos[ix + 2] > 70 || this.dustPos[ix + 2] < -6) this.dustVel[ix + 2] *= -1;
    }
    (this.dustPoints.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  /* -------------------------------------------------------------- */
  /*  Curved Dual-Support Rails                                     */
  /* -------------------------------------------------------------- */

  private syncRails(rails: TransferRailPiece[], selectedId: string | null): void {
    const alive = new Set<string>();
    for (const rail of rails) {
      alive.add(rail.id);
      const rSpacing = Math.max(9, Math.min(14.5, rail.railSpacing || 12.8));
      const bSpacing = Math.max(24, Math.min(96, rail.bridgeSpacing || 52));
      const sig = `${rail.variant}_${rail.armLength.toFixed(1)}_${rail.openingAngle.toFixed(1)}_${rail.curvature.toFixed(2)}_${rail.slopeBias.toFixed(2)}_${rSpacing.toFixed(1)}_${bSpacing.toFixed(0)}_${rail.flipped ? 1 : 0}`;
      let entry = this.railMeshes.get(rail.id);

      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.scene.remove(entry.group);
          this.scene.remove(entry.wallWash);
          entry.frontMesh.geometry.dispose();
          entry.backMesh.geometry.dispose();
          entry.frontStrip.geometry.dispose();
          entry.backStrip.geometry.dispose();
          (entry.frontMesh.material as THREE.Material).dispose();
          (entry.frontStrip.material as THREE.Material).dispose();
          (entry.backStrip.material as THREE.Material).dispose();
          (entry.frontContactSprite.material as THREE.Material).dispose();
          (entry.backContactSprite.material as THREE.Material).dispose();
          (entry.wallWash.material as THREE.Material).dispose();
        }

        const localRail: TransferRailPiece = {
          ...rail,
          x: 0,
          y: 0,
          rotation: 0,
        };
        const localGeom = buildRailGeometry(localRail);
        const worldGeom = buildRailGeometry(rail);
        const rodR = localGeom.rodRadius;
        const halfS = localGeom.railSpacing * 0.5;

        const group = new THREE.Group();
        const wallMat = this.railGraphiteMat.clone();
        const frontMesh = new THREE.Mesh(
          buildDualRodTube(localGeom.centerPoints, halfS, rodR),
          wallMat
        );
        frontMesh.castShadow = true;
        frontMesh.receiveShadow = true;

        const backMesh = new THREE.Mesh(
          buildDualRodTube(localGeom.centerPoints, -halfS, rodR),
          wallMat
        );
        backMesh.castShadow = true;
        backMesh.receiveShadow = true;

        const capPoints = [
          localGeom.centerPoints[0],
          localGeom.centerPoints[localGeom.centerPoints.length - 1],
        ];
        const caps: THREE.Mesh[] = [];
        for (const zOff of [halfS, -halfS]) {
          for (const pt of capPoints) {
            const cap = new THREE.Mesh(this.sharedRailCapGeo, this.railChromeMat);
            cap.position.set(pt.x, -pt.y, zOff);
            cap.scale.setScalar(rodR * 0.99);
            cap.castShadow = true;
            cap.receiveShadow = true;
            caps.push(cap);
          }
        }

        const bridges: THREE.Mesh[] = [];
        for (const br of localGeom.bridges) {
          const bridge = new THREE.Mesh(this.sharedBridgeGeo, this.railChromeMat);
          bridge.rotation.x = Math.PI * 0.5;
          bridge.scale.set(1.95, localGeom.railSpacing, 1.95);
          bridge.position.set(
            br.point.x - br.upNormal.x * 1.65,
            -(br.point.y - br.upNormal.y * 1.65),
            0
          );
          bridge.castShadow = true;
          bridge.receiveShadow = true;
          bridges.push(bridge);
        }

        const standoffs: THREE.Mesh[] = [];
        for (const st of localGeom.standoffs) {
          const post = new THREE.Mesh(this.sharedBridgeGeo, this.railChromeMat);
          post.rotation.x = Math.PI * 0.5;
          post.scale.set(2.1, 6.4, 2.1);
          post.position.set(
            st.point.x - st.upNormal.x * 1.0,
            -(st.point.y - st.upNormal.y * 1.0),
            -halfS - 3.2
          );
          post.castShadow = true;
          post.receiveShadow = true;
          standoffs.push(post);
        }

        const stripMatFront = new THREE.MeshBasicMaterial({
          color: 0x38e2ff,
          transparent: true,
          opacity: 0.3,
        });
        const stripMatBack = stripMatFront.clone();

        const frontStrip = new THREE.Mesh(
          buildDualStripTube(
            localGeom.centerPoints,
            localGeom.upNormals,
            rodR * 0.72,
            halfS + rodR * 0.55
          ),
          stripMatFront
        );
        const backStrip = new THREE.Mesh(
          buildDualStripTube(
            localGeom.centerPoints,
            localGeom.upNormals,
            rodR * 0.72,
            -(halfS + rodR * 0.55)
          ),
          stripMatBack
        );

        const makeContactSprite = () => {
          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.softDot,
              color: 0x7ef6ff,
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          sp.scale.set(14, 14, 1);
          return sp;
        };
        const frontContactSprite = makeContactSprite();
        const backContactSprite = makeContactSprite();

        const wallWash = this.makeWallWashMesh(0x2ee4ff);
        this.scene.add(wallWash);

        group.add(
          backMesh,
          frontMesh,
          ...caps,
          ...bridges,
          ...standoffs,
          backStrip,
          frontStrip,
          backContactSprite,
          frontContactSprite
        );
        this.scene.add(group);

        entry = {
          group,
          frontMesh,
          backMesh,
          frontStrip,
          backStrip,
          frontContactSprite,
          backContactSprite,
          wallWash,
          sig,
          geom: worldGeom,
        };
        this.railMeshes.set(rail.id, entry);
      }

      entry.geom = buildRailGeometry(rail);
      entry.group.position.set(rail.x, -rail.y, RAIL_CENTER_Z);
      entry.group.rotation.z = -rail.rotation;

      const glow = rail.activeGlow ?? 0;
      const bulb = glow > 0 ? Math.pow(glow, 0.7) : 0;
      const isSel = selectedId === rail.id;
      const wallMat = entry.frontMesh.material as THREE.MeshPhysicalMaterial;
      this.tmpColorA.setHex(0x1b2432);
      this.tmpColorB.setHex(0x326288);
      wallMat.color.copy(this.tmpColorA).lerp(this.tmpColorB, bulb * 0.88);
      wallMat.emissive.setHex(isSel ? 0x1e88b8 : 0x18a0d8);
      wallMat.emissiveIntensity = isSel ? Math.max(0.55, bulb * 1.55) : 0.04 + bulb * 1.55;

      const stripOp = 0.28 + bulb * 0.72;
      (entry.frontStrip.material as THREE.MeshBasicMaterial).opacity = stripOp;
      (entry.backStrip.material as THREE.MeshBasicMaterial).opacity = stripOp;

      const washMat = entry.wallWash.material as THREE.MeshBasicMaterial;
      if (bulb > 0.04) {
        const localGeom = buildRailGeometry({ ...rail, x: 0, y: 0, rotation: 0 });
        const pose = sampleRailPose(localGeom, rail.pulseT ?? 0.5);
        const cx = pose.point.x + pose.upNormal.x * (localGeom.rodRadius * 0.7);
        const cy = -(pose.point.y + pose.upNormal.y * (localGeom.rodRadius * 0.7));
        const zOff = localGeom.railSpacing * 0.5;
        entry.frontContactSprite.visible = true;
        entry.frontContactSprite.position.set(cx, cy, zOff);
        (entry.frontContactSprite.material as THREE.SpriteMaterial).opacity = bulb * 0.72;
        entry.backContactSprite.visible = true;
        entry.backContactSprite.position.set(cx, cy, -zOff);
        (entry.backContactSprite.material as THREE.SpriteMaterial).opacity = bulb * 0.72;

        // Backwall cyan neon tube wash behind the Dual-Support Rail
        const wPose = sampleRailPose(entry.geom, 0.5);
        entry.wallWash.visible = true;
        entry.wallWash.position.set(wPose.point.x, -wPose.point.y, BACKWALL_Z + 0.9);
        entry.wallWash.rotation.z = -rail.rotation;
        const span = Math.max(185, entry.geom.totalLength * 2.25);
        entry.wallWash.scale.set(span, Math.max(145, span * 0.65), 1);
        washMat.opacity = bulb * 0.44;

        this.activeLampCandidates.push({
          x: wPose.point.x,
          y: -wPose.point.y,
          color: 0x38e2ff,
          power: bulb * 5.6,
          radius: 320,
        });
      } else {
        entry.frontContactSprite.visible = false;
        entry.backContactSprite.visible = false;
        entry.wallWash.visible = false;
      }
    }

    for (const [id, entry] of this.railMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.wallWash);
        entry.frontMesh.geometry.dispose();
        entry.backMesh.geometry.dispose();
        entry.frontStrip.geometry.dispose();
        entry.backStrip.geometry.dispose();
        (entry.frontMesh.material as THREE.Material).dispose();
        (entry.frontStrip.material as THREE.Material).dispose();
        (entry.backStrip.material as THREE.Material).dispose();
        (entry.frontContactSprite.material as THREE.Material).dispose();
        (entry.backContactSprite.material as THREE.Material).dispose();
        (entry.wallWash.material as THREE.Material).dispose();
        this.railMeshes.delete(id);
      }
    }
  }

  public render(
    world: WorldState,
    cameraState: CameraState,
    alpha: number,
    selectedId: string | null
  ): void {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.clock += dt;
    this.activeLampCandidates.length = 0;

    this.updateCamera(cameraState);
    this.syncRails(world.rails ?? [], selectedId);
    this.syncBars(world.bars, selectedId);
    this.syncBumpers(world.bumpers);
    this.syncSplitters(world.splitters, dt);
    this.syncEmitters(world.emitters, dt);
    this.syncRings(world.rings);
    this.syncMarbles(world.marbles, alpha, dt);
    this.syncLampLights();
    this.updateAtmosphere(dt);
    this.renderer.render(this.scene, this.camera);
  }

  public renderOverlay(
    ctx: CanvasRenderingContext2D,
    viewW: number,
    viewH: number,
    world: WorldState,
    opts: RenderOptions
  ): void {
    ctx.clearRect(0, 0, viewW, viewH);

    // 1. Ghost prediction ribbons
    if (opts.showGhost && opts.ghostBranches.length > 0) {
      for (const branch of opts.ghostBranches) {
        if (branch.points.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = "rgba(116, 178, 224, 0.34)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 5]);
        ctx.beginPath();
        let started = false;
        for (const pt of branch.points) {
          const p = this.projectToScreen(pt.x, pt.y, 2, viewW, viewH);
          if (!p.visible) continue;
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else {
            ctx.lineTo(p.x, p.y);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. Note labels & selection handles
    for (const bar of world.bars) {
      const isSel = opts.selectedId === bar.id;
      const mx = (bar.ax + bar.bx) * 0.5;
      const topY = Math.min(bar.ay, bar.by) - (isSel ? 22 : 14);
      const labelPos = this.projectToScreen(mx, topY, 12, viewW, viewH);

      if (isSel) {
        const pa = this.projectToScreen(bar.ax, bar.ay, 10, viewW, viewH);
        const pb = this.projectToScreen(bar.bx, bar.by, 10, viewW, viewH);
        [pa, pb].forEach((pt) => {
          if (!pt.visible) return;
          ctx.fillStyle = "#141D2B";
          ctx.strokeStyle = "#56D8FF";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });

        if (labelPos.visible) {
          const len = Math.hypot(bar.bx - bar.ax, bar.by - bar.ay);
          const text = bar.noteLabel ?? lengthToNote(len, world.scaleId, bar.material).noteName;
          ctx.font = `600 12px ${FONTS.mono}`;
          const lw = ctx.measureText(text).width + 14;
          ctx.fillStyle = "rgba(20, 29, 43, 0.94)";
          ctx.strokeStyle = "rgba(86, 216, 255, 0.65)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.roundRect(labelPos.x - lw * 0.5, labelPos.y - 10, lw, 20, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#EDF3FA";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, labelPos.x, labelPos.y);
        }
      } else if (bar.noteLabel && labelPos.visible) {
        const bulb = Math.max(bar.glow ?? 0, Math.min(1, Math.abs(bar.flexOffset ?? 0) * 0.14));
        ctx.font = `600 10px ${FONTS.mono}`;
        ctx.fillStyle =
          bulb > 0.06
            ? LABEL_LIT_CSS[bar.material]
            : "rgba(164, 182, 204, 0.52)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(bar.noteLabel, labelPos.x, labelPos.y - bulb * 3);
      }
    }

    // 2.5. Selected Dual-Support Rail handles & direction markers
    for (const rail of world.rails ?? []) {
      if (opts.selectedId !== rail.id) continue;
      const geom = buildRailGeometry(rail);
      const pEntry = this.projectToScreen(geom.entryPoint.x, geom.entryPoint.y, 10, viewW, viewH);
      const pExit = this.projectToScreen(geom.exitPoint.x, geom.exitPoint.y, 10, viewW, viewH);
      const pCenter = this.projectToScreen(rail.x, rail.y, 10, viewW, viewH);
      [
        { pt: pEntry, label: "IN", col: "#38E2FF" },
        { pt: pExit, label: "OUT", col: "#F7A64B" },
      ].forEach(({ pt, label, col }) => {
        if (!pt.visible) return;
        ctx.fillStyle = "#121A26";
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.font = `700 9px ${FONTS.mono}`;
        ctx.fillStyle = col;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, pt.x, pt.y - 14);
      });
      if (pCenter.visible) {
        ctx.strokeStyle = "rgba(56, 226, 255, 0.7)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(pCenter.x, pCenter.y, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 3. Draft bar preview
    if (opts.draftBar) {
      const db = opts.draftBar;
      const pa = this.projectToScreen(db.ax, db.ay, 6, viewW, viewH);
      const pb = this.projectToScreen(db.bx, db.by, 6, viewW, viewH);
      ctx.save();
      ctx.strokeStyle = LABEL_LIT_CSS[db.material];
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.82;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.restore();
    }

    // 4. Note popups
    for (const pop of world.popups) {
      const p = this.projectToScreen(pop.x, pop.y, 14, viewW, viewH);
      if (!p.visible) continue;
      const t = Math.min(1, pop.age / pop.duration);
      const pop01 = t < 0.18 ? 0.85 + (t / 0.18) * 0.25 : 1.1 - Math.min(0.1, (t - 0.18) * 0.3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `700 ${Math.round(13 * pop01)}px ${FONTS.mono}`;
      ctx.fillStyle = pop.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pop.text, p.x, p.y - t * 22);
      ctx.restore();
    }

    // 5. Subtle nocturnal cinema vignette + corner framing ticks
    const vg = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.48,
      Math.min(viewW, viewH) * 0.42,
      viewW * 0.5,
      viewH * 0.5,
      Math.max(viewW, viewH) * 0.78
    );
    vg.addColorStop(0, "rgba(4, 7, 12, 0)");
    vg.addColorStop(1, "rgba(4, 7, 12, 0.34)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, viewW, viewH);
  }

  public dispose(): void {
    for (const geo of this.barGeoCache.values()) geo.dispose();
    for (const geo of this.coreGeoCache.values()) geo.dispose();
    this.barGeoCache.clear();
    this.coreGeoCache.clear();
    this.sharedMarbleGeo.dispose();
    this.sharedPinGeo.dispose();
    this.sharedRailCapGeo.dispose();
    this.sharedBridgeGeo.dispose();
    this.sharedWashPlaneGeo.dispose();
    this.marbleMat.dispose();
    this.brassMat.dispose();
    this.silentMaterial.dispose();
    this.pinMaterial.dispose();
    this.railGraphiteMat.dispose();
    this.railChromeMat.dispose();
    this.inlayGoldMat.dispose();
    this.inlayCyanMat.dispose();
    this.constellationLineMat.dispose();
    Object.values(this.barMaterials).forEach((m) => m.dispose());
    for (const entry of this.barMeshes.values()) {
      (entry.body.material as THREE.Material).dispose();
      (entry.core.material as THREE.Material).dispose();
      (entry.wallWash.material as THREE.Material).dispose();
    }
    for (const entry of this.railMeshes.values()) {
      entry.frontMesh.geometry.dispose();
      entry.backMesh.geometry.dispose();
      entry.frontStrip.geometry.dispose();
      entry.backStrip.geometry.dispose();
      (entry.frontMesh.material as THREE.Material).dispose();
      (entry.frontStrip.material as THREE.Material).dispose();
      (entry.backStrip.material as THREE.Material).dispose();
      (entry.frontContactSprite.material as THREE.Material).dispose();
      (entry.backContactSprite.material as THREE.Material).dispose();
      (entry.wallWash.material as THREE.Material).dispose();
    }
    this.ornamentGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
      }
    });
    this.starPoints.geometry.dispose();
    (this.starPoints.material as THREE.Material).dispose();
    this.dustPoints.geometry.dispose();
    (this.dustPoints.material as THREE.Material).dispose();
    this.backwallMesh.geometry.dispose();
    (this.backwallMesh.material as THREE.Material).dispose();
    this.wallMap.dispose();
    this.wallBumpMap.dispose();
    this.wallWashTex.dispose();
    this.envTexture.dispose();
    this.backdrop.dispose();
    this.softDot.dispose();
    this.renderer.dispose();
  }
}
