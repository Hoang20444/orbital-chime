import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { lengthToNote } from "../audio/scales.ts";
import { FONTS, MATERIALS, STAGE_H, TOKENS } from "../theme/tokens.ts";
import {
  buildRailGeometry,
  sampleRailCenter,
  type RailGeometry,
} from "./railGeometry.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  Marble,
  MaterialType,
  ResonanceRing,
  Ripple,
  SplitterPiece,
  TransferRailPiece,
  Vec2,
  WorldState,
} from "./types.ts";
import type { CameraState, RenderOptions } from "./renderer.ts";

/* ------------------------------------------------------------------ */
/*  Palette                                                            */
/* ------------------------------------------------------------------ */

const CORE_COLORS: Record<MaterialType, number> = {
  marimba: 0xffc77a,
  brass: 0xfff0a8,
  ceramic: 0x9ff5e2,
  bass: 0x7cc8ff,
};

const FLASH_COLORS: Record<MaterialType, number> = {
  marimba: 0xff9a3c,
  brass: 0xffd24a,
  ceramic: 0x46e0c0,
  bass: 0x3fa2ff,
};

const DEFAULT_MARBLE_TINT = new THREE.Color(0x6fd8ff);

/* ------------------------------------------------------------------ */
/*  Mesh bookkeeping                                                   */
/* ------------------------------------------------------------------ */

interface BarMeshEntry {
  group: THREE.Group;
  body: THREE.Mesh;
  core: THREE.Mesh;
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
}

interface SplitterMeshEntry {
  group: THREE.Group;
  crystal: THREE.Mesh;
}

interface EmitterMeshEntry {
  group: THREE.Group;
  spinRing: THREE.Mesh;
  glow: THREE.Sprite;
}

interface RingMeshEntry {
  group: THREE.Group;
  torus: THREE.Mesh;
  core: THREE.Mesh;
}

interface RailMeshEntry {
  group: THREE.Group;
  outerMesh: THREE.Mesh;
  innerMesh: THREE.Mesh;
  troughMesh: THREE.Mesh;
  outerStrip: THREE.Mesh;
  innerStrip: THREE.Mesh;
  travelSprite: THREE.Sprite;
  exitSprite: THREE.Sprite;
  sig: string;
  geom: RailGeometry;
}

interface MarbleMeshEntry {
  group: THREE.Group;
  sphere: THREE.Mesh;
  halo: THREE.Sprite;
  pool: THREE.Mesh;
  trail: THREE.Sprite[];
  tint: THREE.Color;
  flash: number;
}

interface ImpactRing {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  dur: number;
  maxR: number;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
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
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBackdropTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#ECE6DA");
  grad.addColorStop(0.55, "#E2DBD0");
  grad.addColorStop(1, "#D7DDD6");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildRibbonWallGeometry(
  pts: Vec2[],
  halfW: number,
  depth: number
): THREE.ExtrudeGeometry {
  const n = pts.length;
  const leftSide: Vec2[] = [];
  const rightSide: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[Math.max(0, i - 1)];
    const q = pts[Math.min(n - 1, i + 1)];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    leftSide.push({ x: pts[i].x + nx * halfW, y: -(pts[i].y + ny * halfW) });
    rightSide.push({ x: pts[i].x - nx * halfW, y: -(pts[i].y - ny * halfW) });
  }
  const shape = new THREE.Shape();
  shape.moveTo(leftSide[0].x, leftSide[0].y);
  for (let i = 1; i < n; i++) shape.lineTo(leftSide[i].x, leftSide[i].y);
  for (let i = n - 1; i >= 0; i--) shape.lineTo(rightSide[i].x, rightSide[i].y);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 1.1,
    bevelThickness: 1.4,
  });
  geo.translate(0, 0, -depth * 0.5);
  return geo;
}

function buildTroughGeometry(outer: Vec2[], inner: Vec2[]): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, -outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, -outer[i].y);
  for (let i = inner.length - 1; i >= 0; i--) shape.lineTo(inner[i].x, -inner[i].y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 3,
    bevelEnabled: false,
  });
  geo.translate(0, 0, -9);
  return geo;
}

function buildStripTube(pts: Vec2[], z: number): THREE.TubeGeometry {
  const vecs = pts.map((p) => new THREE.Vector3(p.x, -p.y, z));
  const curve = new THREE.CatmullRomCurve3(vecs);
  return new THREE.TubeGeometry(curve, 28, 0.95, 6, false);
}

function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000 * Math.PI * 2;
}

function parseRippleColor(css: string, out: THREE.Color): boolean {
  if (css.startsWith("rgba") || css.startsWith("rgb")) return false;
  out.set(css);
  return true;
}

/* ------------------------------------------------------------------ */
/*  Renderer                                                           */
/* ------------------------------------------------------------------ */

export class OrbitalRenderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private shadowPlane: THREE.Mesh;
  private gridPoints: THREE.Points;
  private envTexture: THREE.Texture;
  private backdrop: THREE.CanvasTexture;
  private softDot: THREE.CanvasTexture;

  private barGeoCache = new Map<string, THREE.ExtrudeGeometry>();
  private coreGeoCache = new Map<string, THREE.BoxGeometry>();

  private barMeshes = new Map<string, BarMeshEntry>();
  private bumperMeshes = new Map<string, BumperMeshEntry>();
  private splitterMeshes = new Map<string, SplitterMeshEntry>();
  private emitterMeshes = new Map<string, EmitterMeshEntry>();
  private ringMeshes = new Map<string, RingMeshEntry>();
  private railMeshes = new Map<string, RailMeshEntry>();
  private marbleMeshes = new Map<number, MarbleMeshEntry>();

  private sharedMarbleGeo = new THREE.SphereGeometry(8, 32, 24);
  private sharedPinGeo = new THREE.CylinderGeometry(2.1, 2.3, 4.5, 14);
  private sharedPoolGeo = new THREE.CircleGeometry(1, 32);
  private sharedRingGeo = new THREE.RingGeometry(0.86, 1, 56);

  private marbleMat: THREE.MeshPhysicalMaterial;
  private barMaterials: Record<MaterialType, THREE.MeshPhysicalMaterial>;
  private silentMaterial: THREE.MeshPhysicalMaterial;
  private pinMaterial: THREE.MeshPhysicalMaterial;
  private brassMat: THREE.MeshPhysicalMaterial;
  private railGraphiteMat: THREE.MeshPhysicalMaterial;
  private railTroughMat: THREE.MeshPhysicalMaterial;

  // Impact FX pools
  private impactRings: ImpactRing[] = [];
  private readonly SPARK_COUNT = 260;
  private sparkPoints: THREE.Points;
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private sparkVel: Float32Array;
  private sparkBase: Float32Array;
  private sparkLife: Float32Array;
  private sparkCursor = 0;
  private seenRipples = new WeakSet<Ripple>();

  // Ambient dust motes
  private readonly DUST_COUNT = 140;
  private dustPoints: THREE.Points;
  private dustPos: Float32Array;
  private dustVel: Float32Array;

  private raycaster = new THREE.Raycaster();
  private stagePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private lastTime = performance.now();
  private clock = 0;
  private tmpColor = new THREE.Color();

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
    this.renderer.toneMappingExposure = 0.88;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.backdrop = makeBackdropTexture();
    this.scene.background = this.backdrop;
    this.softDot = makeSoftDotTexture();

    // Soft studio reflections (makes brass shine gold & glaze look glossy)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 10, 6000);

    const hemi = new THREE.HemisphereLight(0xfffdf8, 0xd8cfc0, 0.55);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff4e2, 1.15);
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

    const rimLight = new THREE.DirectionalLight(0xd8ecff, 0.35);
    rimLight.position.set(600, -500, 300);
    this.scene.add(rimLight);

    // Shadow catcher closer to bars => tight, soft contact shadows
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 20000),
      new THREE.ShadowMaterial({ opacity: 0.2 })
    );
    this.shadowPlane.position.set(500, -4000, -10);
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    // Studio dot grid
    const dotPositions: number[] = [];
    for (let gx = -400; gx <= 1600; gx += 40) {
      for (let gy = -400; gy <= 6000; gy += 40) {
        dotPositions.push(gx, -gy, -9.5);
      }
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));
    this.gridPoints = new THREE.Points(
      dotGeo,
      new THREE.PointsMaterial({
        color: 0xbdb5a4,
        size: 2.4,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.5,
        map: this.softDot,
        depthWrite: false,
      })
    );
    this.scene.add(this.gridPoints);

    // Materials
    this.barMaterials = {
      marimba: new THREE.MeshPhysicalMaterial({
        color: 0xc8742c,
        roughness: 0.44,
        metalness: 0.04,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
        envMapIntensity: 0.55,
      }),
      brass: new THREE.MeshPhysicalMaterial({
        color: 0xdca228,
        roughness: 0.28,
        metalness: 0.88,
        clearcoat: 0.35,
        clearcoatRoughness: 0.22,
        envMapIntensity: 0.85,
      }),
      ceramic: new THREE.MeshPhysicalMaterial({
        color: 0x46a28a,
        roughness: 0.16,
        metalness: 0.04,
        clearcoat: 0.85,
        clearcoatRoughness: 0.08,
        envMapIntensity: 0.6,
      }),
      bass: new THREE.MeshPhysicalMaterial({
        color: 0x224666,
        roughness: 0.3,
        metalness: 0.5,
        clearcoat: 0.65,
        clearcoatRoughness: 0.16,
        envMapIntensity: 0.65,
      }),
    };
    this.brassMat = this.barMaterials.brass;

    this.silentMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xe2ded5,
      roughness: 0.5,
      metalness: 0.0,
      clearcoat: 0.3,
      transparent: true,
      opacity: 0.7,
    });

    this.pinMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xf7f2e8,
      roughness: 0.18,
      metalness: 1.0,
    });

    this.marbleMat = new THREE.MeshPhysicalMaterial({
      color: 0x0b0f13,
      roughness: 0.06,
      metalness: 0.25,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      envMapIntensity: 1.4,
    });

    this.railGraphiteMat = new THREE.MeshPhysicalMaterial({
      color: 0x242c36,
      roughness: 0.28,
      metalness: 0.82,
      clearcoat: 0.55,
      clearcoatRoughness: 0.18,
      envMapIntensity: 0.9,
    });

    this.railTroughMat = new THREE.MeshPhysicalMaterial({
      color: 0x161c24,
      roughness: 0.5,
      metalness: 0.65,
    });

    // Impact ring pool
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedRingGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.impactRings.push({ mesh, mat, age: 0, dur: 0.5, maxR: 40, active: false });
    }

    // Spark particle pool
    this.sparkPos = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkCol = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkVel = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkBase = new Float32Array(this.SPARK_COUNT * 3);
    this.sparkLife = new Float32Array(this.SPARK_COUNT);
    for (let i = 0; i < this.SPARK_COUNT; i++) this.sparkPos[i * 3 + 2] = -9999;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeo.setAttribute("color", new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkPoints = new THREE.Points(
      sparkGeo,
      new THREE.PointsMaterial({
        size: 6,
        map: this.softDot,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.sparkPoints.frustumCulled = false;
    this.scene.add(this.sparkPoints);

    // Floating dust motes around the camera focus
    this.dustPos = new Float32Array(this.DUST_COUNT * 3);
    this.dustVel = new Float32Array(this.DUST_COUNT * 3);
    for (let i = 0; i < this.DUST_COUNT; i++) {
      this.dustPos[i * 3] = (Math.random() - 0.5) * 1500;
      this.dustPos[i * 3 + 1] = (Math.random() - 0.5) * 1100;
      this.dustPos[i * 3 + 2] = -6 + Math.random() * 70;
      this.dustVel[i * 3] = (Math.random() - 0.5) * 6;
      this.dustVel[i * 3 + 1] = 3 + Math.random() * 7;
      this.dustVel[i * 3 + 2] = (Math.random() - 0.5) * 2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3));
    this.dustPoints = new THREE.Points(
      dustGeo,
      new THREE.PointsMaterial({
        color: 0xffe6b8,
        size: 4.2,
        map: this.softDot,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    this.dustPoints.frustumCulled = false;
    this.scene.add(this.dustPoints);
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

  public updateCamera(cameraState: CameraState): void {
    const zoom = Math.max(0.28, Math.min(2.6, cameraState.zoom));
    const fovRad = (this.camera.fov * Math.PI) / 180;
    const baseDist = (STAGE_H * 1.32) / (2 * Math.tan(fovRad * 0.5));
    const dist = baseDist / zoom;

    const fx = cameraState.focusX;
    const fy = -cameraState.focusY;

    // Gentle 3/4 studio tilt so extruded depth reads clearly
    this.camera.position.set(fx + 42 / zoom, fy - 110 / zoom, dist);
    this.camera.lookAt(fx, fy, 0);
    this.camera.updateMatrixWorld();

    // Near-frontal key light => compact contact shadows instead of long blobs
    this.sunLight.position.set(fx - 160, fy + 230, 760);
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
    const qLen = Math.max(10, Math.round(halfLen * 1.15));
    const key = `core_${qLen}`;
    const existing = this.coreGeoCache.get(key);
    if (existing) return existing;
    const geo = new THREE.BoxGeometry(qLen, 2.0, 1.2);
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
      const hitGlow = Math.min(1, Math.abs(flex) * 0.14);
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
          opacity: bar.silent ? 0 : 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const core = new THREE.Mesh(this.getCoreGeometry(halfLen), coreMat);
        core.position.set(0, 0, depth * 0.5 + 2.6);

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
        }
        entry.cachedLen = qLen;
        entry.material = bar.material;
        entry.silent = !!bar.silent;
      }

      const isSel = selectedId === bar.id;
      const bodyMat = entry.body.material as THREE.MeshPhysicalMaterial;
      if (isSel) {
        bodyMat.emissive.setHex(0x6b4a22);
        bodyMat.emissiveIntensity = 0.35;
      } else if (hitGlow > 0.03 && !bar.silent) {
        bodyMat.emissive.setHex(FLASH_COLORS[bar.material]);
        bodyMat.emissiveIntensity = hitGlow * 0.75;
      } else {
        bodyMat.emissiveIntensity = 0;
      }

      const coreMat = entry.core.material as THREE.MeshBasicMaterial;
      coreMat.opacity = bar.silent ? 0 : 0.32 + hitGlow * 0.68;

      // Visual-only life: gentle float + squash on impact (physics untouched)
      const bob = Math.sin(this.clock * 1.3 + entry.phase) * 1.1;
      entry.group.position.set(midX, -midY - flex * 0.65, (isSel ? 5 : 0) + bob);
      entry.group.rotation.z = -angle;
      entry.group.scale.set(1 + hitGlow * 0.035, 1 - hitGlow * 0.2, 1 + hitGlow * 0.12);
    }

    for (const [id, entry] of this.barMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        (entry.body.material as THREE.Material).dispose();
        (entry.core.material as THREE.Material).dispose();
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
          new THREE.CylinderGeometry(bmp.radius, bmp.radius * 1.04, 14, 32),
          new THREE.MeshPhysicalMaterial({ color: 0xf4efe6, roughness: 0.3, clearcoat: 0.6 })
        );
        collar.rotation.x = Math.PI * 0.5;
        collar.castShadow = true;

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(6, bmp.radius - 3.5), 28, 18),
          new THREE.MeshPhysicalMaterial({
            color: 0xf07a4a,
            roughness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
            emissive: new THREE.Color(0xff6a2e),
            emissiveIntensity: 0,
          })
        );
        dome.position.z = 5;
        dome.scale.set(1, 1, 0.55);
        dome.castShadow = true;

        group.add(collar, dome);
        this.scene.add(group);
        entry = { group, collar, dome };
        this.bumperMeshes.set(bmp.id, entry);
      }
      const pulse = bmp.pulse ?? 0;
      const p = 1 + pulse * 0.14;
      entry.group.position.set(bmp.x, -bmp.y, 0);
      entry.group.scale.set(p, p, 1 - pulse * 0.25);
      (entry.dome.material as THREE.MeshPhysicalMaterial).emissiveIntensity = pulse * 0.8;
    }

    for (const [id, entry] of this.bumperMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        entry.collar.geometry.dispose();
        (entry.collar.material as THREE.Material).dispose();
        entry.dome.geometry.dispose();
        (entry.dome.material as THREE.Material).dispose();
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
            color: 0xc9e2ff,
            roughness: 0.04,
            metalness: 0.1,
            clearcoat: 1,
            iridescence: 1,
            iridescenceIOR: 1.6,
            transparent: true,
            opacity: 0.85,
          })
        );
        crystal.castShadow = true;
        group.add(crystal);
        this.scene.add(group);
        entry = { group, crystal };
        this.splitterMeshes.set(spl.id, entry);
      }
      const p = 1 + (spl.pulse ?? 0) * 0.18;
      entry.group.position.set(spl.x, -spl.y, 2);
      entry.group.scale.set(p, p, p);
      entry.crystal.rotation.y += dt * 0.9;
    }

    for (const [id, entry] of this.splitterMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        entry.crystal.geometry.dispose();
        (entry.crystal.material as THREE.Material).dispose();
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
          new THREE.MeshPhysicalMaterial({ color: 0xf7f4ec, roughness: 0.35, clearcoat: 0.6 })
        );
        face.rotation.x = Math.PI * 0.5;

        const spinRing = new THREE.Mesh(
          new THREE.TorusGeometry(18.5, 0.9, 8, 48, Math.PI * 1.4),
          new THREE.MeshBasicMaterial({
            color: 0xe9875f,
            transparent: true,
            opacity: 0.75,
          })
        );
        spinRing.position.z = 3;

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(4, 18, 12),
          new THREE.MeshPhysicalMaterial({ color: 0x1c2321, roughness: 0.08, clearcoat: 1 })
        );
        core.position.z = 5.6;

        const glow = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.softDot,
            color: 0xffc27a,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        glow.scale.set(64, 64, 1);
        glow.position.z = 8;

        group.add(bezel, face, spinRing, core, glow);
        this.scene.add(group);
        entry = { group, spinRing, glow };
        this.emitterMeshes.set(em.id, entry);
      }
      const pulse = em.pulse ?? 0;
      const p = 1 + pulse * 0.14;
      entry.group.position.set(em.x, -em.y, 2);
      entry.group.scale.set(p, p, 1);
      entry.spinRing.rotation.z -= dt * (1.2 + pulse * 6);
      (entry.glow.material as THREE.SpriteMaterial).opacity = pulse * 0.7;
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
          new THREE.MeshPhysicalMaterial({ color: 0xe0b44c, roughness: 0.22, metalness: 1 })
        );
        torus.castShadow = true;
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(r.radius - 3, 36),
          new THREE.MeshBasicMaterial({
            color: 0x5fd0b8,
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        group.add(torus, core);
        this.scene.add(group);
        entry = { group, torus, core };
        this.ringMeshes.set(r.id, entry);
      }
      entry.group.position.set(r.x, -r.y, 0);
      (entry.core.material as THREE.MeshBasicMaterial).opacity = 0.1 + r.charge * 0.5;
      (entry.torus.material as THREE.MeshPhysicalMaterial).color.setHex(
        r.charge > 0.85 ? 0x4cc0a8 : 0xe0b44c
      );
    }

    for (const [id, entry] of this.ringMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        entry.torus.geometry.dispose();
        (entry.torus.material as THREE.Material).dispose();
        entry.core.geometry.dispose();
        (entry.core.material as THREE.Material).dispose();
        this.ringMeshes.delete(id);
      }
    }
  }

  private syncMarbles(marbles: Marble[], alpha: number, dt: number): void {
    const alive = new Set<number>();
    for (const m of marbles) {
      alive.add(m.id);
      let entry = this.marbleMeshes.get(m.id);
      if (!entry) {
        const group = new THREE.Group();
        const sphere = new THREE.Mesh(this.sharedMarbleGeo, this.marbleMat);
        sphere.castShadow = true;

        const halo = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.softDot,
            color: DEFAULT_MARBLE_TINT.clone(),
            transparent: true,
            opacity: 0.32,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        halo.scale.set(34, 34, 1);
        group.add(sphere, halo);

        const pool = new THREE.Mesh(
          this.sharedPoolGeo,
          new THREE.MeshBasicMaterial({
            color: DEFAULT_MARBLE_TINT.clone(),
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        this.scene.add(pool);

        const trail: THREE.Sprite[] = [];
        for (let i = 0; i < 9; i++) {
          const ts = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: this.softDot,
              color: DEFAULT_MARBLE_TINT.clone(),
              transparent: true,
              opacity: 0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            })
          );
          this.scene.add(ts);
          trail.push(ts);
        }

        this.scene.add(group);
        entry = {
          group,
          sphere,
          halo,
          pool,
          trail,
          tint: DEFAULT_MARBLE_TINT.clone(),
          flash: 0,
        };
        this.marbleMeshes.set(m.id, entry);
      }

      const ix = m.prevX + (m.x - m.prevX) * alpha;
      const iy = m.prevY + (m.y - m.prevY) * alpha;
      entry.group.position.set(ix, -iy, 2);

      // Squash & stretch along impact normal, springs back via m.squash decay
      const sScale = m.radius / 8;
      if (m.squash > 0.02) {
        entry.sphere.rotation.z = -m.squashAngle;
        entry.sphere.scale.set(
          sScale * (1 - m.squash * 0.16),
          sScale * (1 + m.squash * 0.16),
          sScale
        );
      } else {
        entry.sphere.scale.setScalar(sScale);
      }

      entry.flash = Math.max(0, entry.flash - dt * 3.2);
      const haloMat = entry.halo.material as THREE.SpriteMaterial;
      haloMat.color.copy(entry.tint);
      haloMat.opacity = 0.28 + entry.flash * 0.55;
      const hs = 30 + entry.flash * 22;
      entry.halo.scale.set(hs, hs, 1);

      const poolMat = entry.pool.material as THREE.MeshBasicMaterial;
      poolMat.color.copy(entry.tint);
      poolMat.opacity = 0.12 + entry.flash * 0.22;
      entry.pool.position.set(ix + 4, -iy - 6, -9);
      const ps = 20 + entry.flash * 14;
      entry.pool.scale.set(ps, ps, 1);

      const tLen = m.trail.length;
      const n = entry.trail.length;
      for (let i = 0; i < n; i++) {
        const ts = entry.trail[i];
        const ptIdx = tLen - n + i;
        const tMat = ts.material as THREE.SpriteMaterial;
        if (ptIdx >= 0 && ptIdx < tLen) {
          const pt = m.trail[ptIdx];
          const ratio = (i + 1) / n;
          ts.visible = true;
          ts.position.set(pt.x, -pt.y, 1.5);
          const sc = 5 + ratio * 13;
          ts.scale.set(sc, sc, 1);
          tMat.color.copy(entry.tint);
          tMat.opacity = ratio * 0.42;
        } else {
          ts.visible = false;
        }
      }
    }

    for (const [id, entry] of this.marbleMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.pool);
        (entry.halo.material as THREE.Material).dispose();
        (entry.pool.material as THREE.Material).dispose();
        for (const ts of entry.trail) {
          this.scene.remove(ts);
          (ts.material as THREE.Material).dispose();
        }
        this.marbleMeshes.delete(id);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*  Impact FX                                                     */
  /* -------------------------------------------------------------- */

  private spawnImpact(rp: Ripple, marbles: Marble[]): void {
    const color = this.tmpColor;
    const musical = parseRippleColor(rp.color, color);
    if (!musical) color.setHex(0xbfc4bd);

    // Expanding resonance ring
    const ring = this.impactRings.find((r) => !r.active) ?? this.impactRings[0];
    ring.active = true;
    ring.age = 0;
    ring.dur = rp.doubleRing ? 0.62 : 0.48;
    ring.maxR = Math.max(24, rp.maxRadius * 0.9);
    ring.mat.color.copy(color);
    ring.mesh.visible = true;
    ring.mesh.position.set(rp.x, -rp.y, 6);

    // Spark burst (small feedback tier: 6-10 particles)
    const count = musical ? (rp.doubleRing ? 10 : 7) : 3;
    for (let k = 0; k < count; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.SPARK_COUNT;
      const a = Math.random() * Math.PI * 2;
      const sp = 50 + Math.random() * 110;
      this.sparkPos[i * 3] = rp.x;
      this.sparkPos[i * 3 + 1] = -rp.y;
      this.sparkPos[i * 3 + 2] = 7;
      this.sparkVel[i * 3] = Math.cos(a) * sp;
      this.sparkVel[i * 3 + 1] = Math.sin(a) * sp * 0.7 + 70;
      this.sparkVel[i * 3 + 2] = Math.random() * 60;
      this.sparkBase[i * 3] = Math.min(1, color.r * 0.7 + 0.35);
      this.sparkBase[i * 3 + 1] = Math.min(1, color.g * 0.7 + 0.3);
      this.sparkBase[i * 3 + 2] = Math.min(1, color.b * 0.7 + 0.22);
      this.sparkLife[i] = 1;
    }

    // Tint the marble that caused this hit
    if (musical) {
      let best: MarbleMeshEntry | null = null;
      let bestD = 40 * 40;
      for (const m of marbles) {
        const d = (m.x - rp.x) ** 2 + (m.y - rp.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = this.marbleMeshes.get(m.id) ?? null;
        }
      }
      if (best) {
        best.tint.copy(color).lerp(new THREE.Color(0xffffff), 0.15);
        best.flash = 1;
      }
    }
  }

  private updateFx(world: WorldState, dt: number): void {
    for (const rp of world.ripples) {
      if (!this.seenRipples.has(rp) && rp.age < 0.1) {
        this.seenRipples.add(rp);
        this.spawnImpact(rp, world.marbles);
      }
    }

    for (const r of this.impactRings) {
      if (!r.active) continue;
      r.age += dt;
      const t = Math.min(1, r.age / r.dur);
      const ease = 1 - Math.pow(1 - t, 3);
      const s = 6 + r.maxR * ease;
      r.mesh.scale.set(s, s, 1);
      r.mat.opacity = (1 - t) * 0.75;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
      }
    }

    for (let i = 0; i < this.SPARK_COUNT; i++) {
      const life = this.sparkLife[i];
      if (life <= 0) continue;
      const nl = life - dt * 2.3;
      this.sparkLife[i] = nl;
      if (nl <= 0) {
        this.sparkPos[i * 3 + 2] = -9999;
        this.sparkCol[i * 3] = 0;
        this.sparkCol[i * 3 + 1] = 0;
        this.sparkCol[i * 3 + 2] = 0;
        continue;
      }
      this.sparkVel[i * 3 + 1] -= 300 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      const f = Math.pow(nl, 1.4);
      this.sparkCol[i * 3] = this.sparkBase[i * 3] * f;
      this.sparkCol[i * 3 + 1] = this.sparkBase[i * 3 + 1] * f;
      this.sparkCol[i * 3 + 2] = this.sparkBase[i * 3 + 2] * f;
    }
    const sg = this.sparkPoints.geometry;
    (sg.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (sg.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < this.DUST_COUNT; i++) {
      const ix = i * 3;
      this.dustPos[ix] += (this.dustVel[ix] + Math.sin(this.clock * 0.6 + i) * 3) * dt;
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
  /*  Frame                                                         */
  /* -------------------------------------------------------------- */

  private syncRails(rails: TransferRailPiece[], selectedId: string | null): void {
    const alive = new Set<string>();
    for (const rail of rails) {
      alive.add(rail.id);
      const sig = `${rail.variant}_${rail.armLength.toFixed(1)}_${rail.openingAngle.toFixed(1)}_${rail.curvature.toFixed(2)}_${rail.slopeBias.toFixed(2)}_${rail.channelWidth.toFixed(1)}_${rail.flipped ? 1 : 0}`;
      let entry = this.railMeshes.get(rail.id);

      const rebuildGeos = (geom: RailGeometry) => {
        const localOuter = geom.outerWall.map((p) => ({
          x: p.x - rail.x,
          y: p.y - rail.y,
        }));
        const localInner = geom.innerWall.map((p) => ({
          x: p.x - rail.x,
          y: p.y - rail.y,
        }));
        // Undo world transform? buildRailGeometry already rotated & translated.
        // Keeping mesh at (0,0,0) in world space avoids double-rotation math!
        void localOuter;
        void localInner;
      };
      void rebuildGeos;

      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.scene.remove(entry.group);
          entry.outerMesh.geometry.dispose();
          entry.innerMesh.geometry.dispose();
          entry.troughMesh.geometry.dispose();
          entry.outerStrip.geometry.dispose();
          entry.innerStrip.geometry.dispose();
          (entry.outerMesh.material as THREE.Material).dispose();
          (entry.outerStrip.material as THREE.Material).dispose();
          (entry.innerStrip.material as THREE.Material).dispose();
          (entry.travelSprite.material as THREE.Material).dispose();
          (entry.exitSprite.material as THREE.Material).dispose();
        }
        // Build geometries in local origin (0,0) and position group at (rail.x, -rail.y, 0) rotated by -rail.rotation
        const localRail: TransferRailPiece = {
          ...rail,
          x: 0,
          y: 0,
          rotation: 0,
        };
        const localGeom = buildRailGeometry(localRail);
        const worldGeom = buildRailGeometry(rail);

        const group = new THREE.Group();
        const wallMat = this.railGraphiteMat.clone();
        const outerMesh = new THREE.Mesh(
          buildRibbonWallGeometry(localGeom.outerWall, localGeom.wallThickness * 0.5, 16),
          wallMat
        );
        outerMesh.castShadow = true;
        outerMesh.receiveShadow = true;

        const innerMesh = new THREE.Mesh(
          buildRibbonWallGeometry(localGeom.innerWall, localGeom.wallThickness * 0.5, 16),
          wallMat
        );
        innerMesh.castShadow = true;
        innerMesh.receiveShadow = true;

        const troughMesh = new THREE.Mesh(
          buildTroughGeometry(localGeom.outerWall, localGeom.innerWall),
          this.railTroughMat
        );
        troughMesh.receiveShadow = true;

        const stripMatOuter = new THREE.MeshBasicMaterial({
          color: 0x38e2ff,
          transparent: true,
          opacity: 0.72,
        });
        const stripMatInner = stripMatOuter.clone();

        const outerStrip = new THREE.Mesh(
          buildStripTube(localGeom.outerWall, 9.6),
          stripMatOuter
        );
        const innerStrip = new THREE.Mesh(
          buildStripTube(localGeom.innerWall, 9.6),
          stripMatInner
        );

        const travelSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.softDot,
            color: 0x4ef0ff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        travelSprite.scale.set(42, 42, 1);

        const exitSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.softDot,
            color: 0x62f4ff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          })
        );
        exitSprite.scale.set(48, 48, 1);

        group.add(troughMesh, outerMesh, innerMesh, outerStrip, innerStrip, travelSprite);
        this.scene.add(group);
        this.scene.add(exitSprite);

        entry = {
          group,
          outerMesh,
          innerMesh,
          troughMesh,
          outerStrip,
          innerStrip,
          travelSprite,
          exitSprite,
          sig,
          geom: worldGeom,
        };
        this.railMeshes.set(rail.id, entry);
      }

      entry.geom = buildRailGeometry(rail);
      entry.group.position.set(rail.x, -rail.y, 0);
      entry.group.rotation.z = -rail.rotation;

      const glow = rail.activeGlow ?? 0;
      const isSel = selectedId === rail.id;
      const wallMat = entry.outerMesh.material as THREE.MeshPhysicalMaterial;
      wallMat.emissive.setHex(isSel ? 0x164e63 : 0x0b4b61);
      wallMat.emissiveIntensity = isSel ? 0.55 : glow * 0.48;

      const stripOp = 0.52 + glow * 0.48;
      (entry.outerStrip.material as THREE.MeshBasicMaterial).opacity = stripOp;
      (entry.innerStrip.material as THREE.MeshBasicMaterial).opacity = stripOp;

      if (glow > 0.04) {
        const localGeom = buildRailGeometry({ ...rail, x: 0, y: 0, rotation: 0 });
        const pt = sampleRailCenter(localGeom, rail.pulseT ?? 0.5);
        entry.travelSprite.visible = true;
        entry.travelSprite.position.set(pt.x, -pt.y, 6);
        (entry.travelSprite.material as THREE.SpriteMaterial).opacity = glow * 0.85;
      } else {
        entry.travelSprite.visible = false;
      }

      const exP = rail.exitPulse ?? 0;
      if (exP > 0.04 && rail.exitX !== undefined && rail.exitY !== undefined) {
        entry.exitSprite.visible = true;
        entry.exitSprite.position.set(rail.exitX, -rail.exitY, 8);
        const s = 28 + (1 - exP) * 34;
        entry.exitSprite.scale.set(s, s, 1);
        (entry.exitSprite.material as THREE.SpriteMaterial).opacity = exP * 0.78;
      } else {
        entry.exitSprite.visible = false;
      }
    }

    for (const [id, entry] of this.railMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        this.scene.remove(entry.exitSprite);
        entry.outerMesh.geometry.dispose();
        entry.innerMesh.geometry.dispose();
        entry.troughMesh.geometry.dispose();
        entry.outerStrip.geometry.dispose();
        entry.innerStrip.geometry.dispose();
        (entry.outerMesh.material as THREE.Material).dispose();
        (entry.outerStrip.material as THREE.Material).dispose();
        (entry.innerStrip.material as THREE.Material).dispose();
        (entry.travelSprite.material as THREE.Material).dispose();
        (entry.exitSprite.material as THREE.Material).dispose();
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

    this.updateCamera(cameraState);
    this.syncRails(world.rails ?? [], selectedId);
    this.syncBars(world.bars, selectedId);
    this.syncBumpers(world.bumpers);
    this.syncSplitters(world.splitters, dt);
    this.syncEmitters(world.emitters, dt);
    this.syncRings(world.rings);
    this.syncMarbles(world.marbles, alpha, dt);
    this.updateFx(world, dt);
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
        ctx.strokeStyle = "rgba(45, 92, 110, 0.28)";
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
          ctx.fillStyle = TOKENS.paper;
          ctx.strokeStyle = TOKENS.ink;
          ctx.lineWidth = 2.1;
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
          ctx.fillStyle = TOKENS.ink;
          ctx.beginPath();
          ctx.roundRect(labelPos.x - lw * 0.5, labelPos.y - 10, lw, 20, 6);
          ctx.fill();
          ctx.fillStyle = TOKENS.paper;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(text, labelPos.x, labelPos.y);
        }
      } else if (bar.noteLabel && labelPos.visible) {
        const flex = Math.min(1, Math.abs(bar.flexOffset ?? 0) * 0.14);
        ctx.font = `600 10px ${FONTS.mono}`;
        ctx.fillStyle = flex > 0.05 ? `rgba(28, 35, 33, ${0.6 + flex * 0.4})` : "rgba(28, 35, 33, 0.52)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(bar.noteLabel, labelPos.x, labelPos.y - flex * 4);
      }
    }

    // 2.5. Selected V-Rail handles & direction markers
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
        ctx.fillStyle = "#1E252D";
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
      ctx.strokeStyle = MATERIALS[db.material].color;
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.globalAlpha = 0.72;
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
      const pop01 = t < 0.18 ? 0.8 + (t / 0.18) * 0.35 : 1.15 - Math.min(0.15, (t - 0.18) * 0.4);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `700 ${Math.round(13 * pop01)}px ${FONTS.mono}`;
      ctx.fillStyle = pop.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pop.text, p.x, p.y - t * 20);
      ctx.restore();
    }

    // 5. Soft warm studio vignette
    const vg = ctx.createRadialGradient(
      viewW * 0.5,
      viewH * 0.48,
      Math.min(viewW, viewH) * 0.38,
      viewW * 0.5,
      viewH * 0.5,
      Math.max(viewW, viewH) * 0.78
    );
    vg.addColorStop(0, "rgba(120, 100, 76, 0)");
    vg.addColorStop(1, "rgba(120, 100, 76, 0.13)");
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
    this.sharedPoolGeo.dispose();
    this.sharedRingGeo.dispose();
    this.marbleMat.dispose();
    this.silentMaterial.dispose();
    this.pinMaterial.dispose();
    this.railGraphiteMat.dispose();
    this.railTroughMat.dispose();
    Object.values(this.barMaterials).forEach((m) => m.dispose());
    for (const entry of this.railMeshes.values()) {
      entry.outerMesh.geometry.dispose();
      entry.innerMesh.geometry.dispose();
      entry.troughMesh.geometry.dispose();
      entry.outerStrip.geometry.dispose();
      entry.innerStrip.geometry.dispose();
    }
    for (const r of this.impactRings) r.mat.dispose();
    this.sparkPoints.geometry.dispose();
    (this.sparkPoints.material as THREE.Material).dispose();
    this.dustPoints.geometry.dispose();
    (this.dustPoints.material as THREE.Material).dispose();
    this.gridPoints.geometry.dispose();
    (this.gridPoints.material as THREE.Material).dispose();
    this.shadowPlane.geometry.dispose();
    (this.shadowPlane.material as THREE.Material).dispose();
    this.envTexture.dispose();
    this.backdrop.dispose();
    this.softDot.dispose();
    this.renderer.dispose();
  }
}
