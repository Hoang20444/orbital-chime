import * as THREE from "three";
import { lengthToNote } from "../audio/scales.ts";
import { FONTS, MATERIALS, STAGE_H, TOKENS } from "../theme/tokens.ts";
import type {
  BarPiece,
  BumperPiece,
  Emitter,
  Marble,
  MaterialType,
  ResonanceRing,
  SplitterPiece,
  Vec2,
  WorldState,
} from "./types.ts";
import type { CameraState, RenderOptions } from "./renderer.ts";

interface BarMeshEntry {
  group: THREE.Group;
  body: THREE.Mesh;
  core: THREE.Mesh;
  pinA: THREE.Mesh;
  pinB: THREE.Mesh;
  material: MaterialType;
  silent: boolean;
  cachedLen: number;
}

interface BumperMeshEntry {
  group: THREE.Group;
  collar: THREE.Mesh;
  dome: THREE.Mesh;
  radius: number;
}

interface SplitterMeshEntry {
  group: THREE.Group;
  crystal: THREE.Mesh;
  radius: number;
}

interface EmitterMeshEntry {
  group: THREE.Group;
  ring: THREE.Mesh;
  radius: number;
}

interface RingMeshEntry {
  group: THREE.Group;
  torus: THREE.Mesh;
  core: THREE.Mesh;
  radius: number;
}

interface MarbleMeshEntry {
  group: THREE.Group;
  sphere: THREE.Mesh;
  trail: THREE.Mesh[];
}

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

export class OrbitalRenderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private sunLight: THREE.DirectionalLight;
  private shadowPlane: THREE.Mesh;
  private gridPoints: THREE.Points;

  private barGeoCache = new Map<string, THREE.ExtrudeGeometry>();
  private coreGeoCache = new Map<string, THREE.BoxGeometry>();

  private barMeshes = new Map<string, BarMeshEntry>();
  private bumperMeshes = new Map<string, BumperMeshEntry>();
  private splitterMeshes = new Map<string, SplitterMeshEntry>();
  private emitterMeshes = new Map<string, EmitterMeshEntry>();
  private ringMeshes = new Map<string, RingMeshEntry>();
  private marbleMeshes = new Map<number, MarbleMeshEntry>();

  private sharedMarbleGeo = new THREE.SphereGeometry(8, 24, 18);
  private sharedTrailGeo = new THREE.SphereGeometry(4.2, 10, 8);
  private sharedPinGeo = new THREE.CylinderGeometry(2.1, 2.3, 4.5, 14);

  private sharedMarbleMat = new THREE.MeshStandardMaterial({
    color: 0x13181c,
    roughness: 0.08,
    metalness: 0.36,
  });

  private barMaterials: Record<MaterialType, THREE.MeshStandardMaterial>;
  private silentMaterial: THREE.MeshStandardMaterial;
  private pinMaterial: THREE.MeshStandardMaterial;

  private raycaster = new THREE.Raycaster();
  private stagePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf7f5f0);

    this.camera = new THREE.PerspectiveCamera(34, 16 / 9, 10, 5000);

    // Sunlit warm studio lighting
    const hemi = new THREE.HemisphereLight(0xfffdf8, 0xd6cfc2, 1.35);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff7ea, 1.45);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 100;
    this.sunLight.shadow.camera.far = 1600;
    const d = 820;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    const rimLight = new THREE.DirectionalLight(0xdceeff, 0.42);
    rimLight.position.set(500, -400, 320);
    this.scene.add(rimLight);

    // Backdrop shadow-receiving studio plane at z = -22
    const planeGeo = new THREE.PlaneGeometry(6000, 16000);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.14 });
    this.shadowPlane = new THREE.Mesh(planeGeo, planeMat);
    this.shadowPlane.position.set(500, -2500, -22);
    this.shadowPlane.receiveShadow = true;
    this.scene.add(this.shadowPlane);

    // Subtle 3D studio dot grid at z = -21
    const dotPositions: number[] = [];
    for (let gx = -400; gx <= 1600; gx += 40) {
      for (let gy = -400; gy <= 4400; gy += 40) {
        dotPositions.push(gx, -gy, -21);
      }
    }
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(dotPositions, 3)
    );
    const dotMat = new THREE.PointsMaterial({
      color: 0xc8c2b6,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
    });
    this.gridPoints = new THREE.Points(dotGeo, dotMat);
    this.scene.add(this.gridPoints);

    this.barMaterials = {
      marimba: new THREE.MeshStandardMaterial({
        color: 0xd9954c,
        roughness: 0.44,
        metalness: 0.06,
      }),
      brass: new THREE.MeshStandardMaterial({
        color: 0xdfb448,
        roughness: 0.22,
        metalness: 0.78,
      }),
      ceramic: new THREE.MeshStandardMaterial({
        color: 0x6cb8a4,
        roughness: 0.16,
        metalness: 0.08,
      }),
      bass: new THREE.MeshStandardMaterial({
        color: 0x395c78,
        roughness: 0.34,
        metalness: 0.42,
      }),
    };

    this.silentMaterial = new THREE.MeshStandardMaterial({
      color: 0xdcd9d0,
      roughness: 0.54,
      metalness: 0.05,
    });

    this.pinMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4efe4,
      roughness: 0.25,
      metalness: 0.65,
    });
  }

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
    const baseDist = STAGE_H / (2 * Math.tan(fovRad * 0.5));
    const dist = baseDist / zoom;

    const fx = cameraState.focusX;
    const fy = -cameraState.focusY;

    // Gentle 3/4 studio perspective tilt so extruded 3D depth & shadows pop clearly
    this.camera.position.set(fx + 42 / zoom, fy - 110 / zoom, dist);
    this.camera.lookAt(fx, fy, 0);
    this.camera.updateMatrixWorld();

    // Keep directional sun shadow frustum centered around active view
    this.sunLight.position.set(fx - 340, fy + 380, 560);
    this.sunLight.target.position.set(fx, fy, 0);
    this.sunLight.target.updateMatrixWorld();
  }

  public screenToStage(
    clientX: number,
    clientY: number,
    rect: DOMRect
  ): Vec2 | null {
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
      bevelSegments: 2,
      steps: 1,
      bevelSize: 1.5,
      bevelThickness: 2.0,
      curveSegments: 10,
    });
    geo.translate(0, 0, -depth * 0.5);
    this.barGeoCache.set(key, geo);
    return geo;
  }

  private getCoreGeometry(halfLen: number): THREE.BoxGeometry {
    const qLen = Math.max(10, Math.round(halfLen * 1.1));
    const key = `core_${qLen}`;
    const existing = this.coreGeoCache.get(key);
    if (existing) return existing;
    const geo = new THREE.BoxGeometry(qLen, 2.2, 2.2);
    this.coreGeoCache.set(key, geo);
    return geo;
  }

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

      let entry = this.barMeshes.get(bar.id);
      const qLen = Math.round(len);
      if (!entry) {
        const group = new THREE.Group();
        const geo = this.getBarGeometry(halfLen, halfThick, depth);
        const baseMat = (
          bar.silent ? this.silentMaterial : this.barMaterials[bar.material]
        ).clone();
        const body = new THREE.Mesh(geo, baseMat);
        body.castShadow = true;
        body.receiveShadow = true;

        const coreMat = new THREE.MeshBasicMaterial({
          color: bar.material === "bass" ? 0x6ec8ff : 0x8ae8fa,
          transparent: true,
          opacity: bar.silent ? 0 : 0.35,
        });
        const core = new THREE.Mesh(this.getCoreGeometry(halfLen), coreMat);
        core.position.set(0, 0, depth * 0.5 + 1.4);

        const pinA = new THREE.Mesh(this.sharedPinGeo, this.pinMaterial);
        pinA.rotation.x = Math.PI * 0.5;
        pinA.position.set(-Math.max(4, halfLen - 8), 0, depth * 0.5 + 1.1);

        const pinB = new THREE.Mesh(this.sharedPinGeo, this.pinMaterial);
        pinB.rotation.x = Math.PI * 0.5;
        pinB.position.set(Math.max(4, halfLen - 8), 0, depth * 0.5 + 1.1);

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
          cachedLen: qLen,
        };
        this.barMeshes.set(bar.id, entry);
      } else if (entry.cachedLen !== qLen || entry.material !== bar.material || entry.silent !== !!bar.silent) {
        entry.body.geometry = this.getBarGeometry(halfLen, halfThick, depth);
        entry.core.geometry = this.getCoreGeometry(halfLen);
        entry.core.position.z = depth * 0.5 + 1.4;
        entry.pinA.position.set(-Math.max(4, halfLen - 8), 0, depth * 0.5 + 1.1);
        entry.pinB.position.set(Math.max(4, halfLen - 8), 0, depth * 0.5 + 1.1);
        const srcMat = bar.silent ? this.silentMaterial : this.barMaterials[bar.material];
        (entry.body.material as THREE.MeshStandardMaterial).copy(srcMat);
        entry.cachedLen = qLen;
        entry.material = bar.material;
        entry.silent = !!bar.silent;
      }

      const isSel = selectedId === bar.id;
      const bodyMat = entry.body.material as THREE.MeshStandardMaterial;
      bodyMat.emissive.setHex(
        isSel ? 0x3b2c1a : hitGlow > 0.04 ? 0x3c5258 : 0x000000
      );
      bodyMat.emissiveIntensity = isSel ? 0.35 : hitGlow * 0.55;

      const coreMat = entry.core.material as THREE.MeshBasicMaterial;
      coreMat.opacity = bar.silent ? 0 : 0.25 + hitGlow * 0.65;

      entry.group.position.set(midX, -midY - flex * 0.65, isSel ? 4 : 0);
      entry.group.rotation.z = -angle;
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
          new THREE.CylinderGeometry(bmp.radius, bmp.radius * 1.04, 14, 24),
          new THREE.MeshStandardMaterial({ color: 0xf0ebe1, roughness: 0.35 })
        );
        collar.rotation.x = Math.PI * 0.5;
        collar.castShadow = true;

        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(Math.max(6, bmp.radius - 3.5), 20, 14),
          new THREE.MeshStandardMaterial({
            color: 0xec7446,
            roughness: 0.24,
            metalness: 0.1,
          })
        );
        dome.position.z = 5;
        dome.scale.set(1, 1, 0.55);
        dome.castShadow = true;

        group.add(collar, dome);
        this.scene.add(group);
        entry = { group, collar, dome, radius: bmp.radius };
        this.bumperMeshes.set(bmp.id, entry);
      }
      const p = 1 + (bmp.pulse ?? 0) * 0.14;
      entry.group.position.set(bmp.x, -bmp.y, 0);
      entry.group.scale.set(p, p, 1);
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

  private syncSplitters(splitters: SplitterPiece[]): void {
    const alive = new Set<string>();
    for (const spl of splitters) {
      alive.add(spl.id);
      let entry = this.splitterMeshes.get(spl.id);
      if (!entry) {
        const group = new THREE.Group();
        const geo = new THREE.OctahedronGeometry(spl.radius * 0.95, 0);
        geo.scale(1.3, 0.72, 0.85);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xaed4f8,
          roughness: 0.1,
          metalness: 0.25,
          transparent: true,
          opacity: 0.82,
        });
        const crystal = new THREE.Mesh(geo, mat);
        crystal.castShadow = true;
        group.add(crystal);
        this.scene.add(group);
        entry = { group, crystal, radius: spl.radius };
        this.splitterMeshes.set(spl.id, entry);
      }
      const p = 1 + (spl.pulse ?? 0) * 0.18;
      entry.group.position.set(spl.x, -spl.y, 2);
      entry.group.scale.set(p, p, p);
      entry.crystal.rotation.y += 0.012;
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

  private syncEmitters(emitters: Emitter[]): void {
    const alive = new Set<string>();
    for (const em of emitters) {
      alive.add(em.id);
      let entry = this.emitterMeshes.get(em.id);
      if (!entry) {
        const group = new THREE.Group();
        const bezel = new THREE.Mesh(
          new THREE.CylinderGeometry(14, 15, 10, 24),
          this.barMaterials.brass
        );
        bezel.rotation.x = Math.PI * 0.5;
        bezel.castShadow = true;

        const face = new THREE.Mesh(
          new THREE.CylinderGeometry(10.5, 10.5, 11.2, 24),
          new THREE.MeshStandardMaterial({ color: 0xf5f2ea, roughness: 0.4 })
        );
        face.rotation.x = Math.PI * 0.5;

        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(7.2, 1.3, 8, 24),
          new THREE.MeshStandardMaterial({ color: 0xce5b46, roughness: 0.3 })
        );
        ring.position.z = 5.8;

        const core = new THREE.Mesh(
          new THREE.SphereGeometry(4, 14, 10),
          new THREE.MeshStandardMaterial({
            color: 0x1c2321,
            roughness: 0.15,
            metalness: 0.3,
          })
        );
        core.position.z = 5.5;

        group.add(bezel, face, ring, core);
        this.scene.add(group);
        entry = { group, ring, radius: 14 };
        this.emitterMeshes.set(em.id, entry);
      }
      const p = 1 + (em.pulse ?? 0) * 0.14;
      entry.group.position.set(em.x, -em.y, 2);
      entry.group.scale.set(p, p, 1);
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
          new THREE.TorusGeometry(r.radius, 3.2, 12, 32),
          new THREE.MeshStandardMaterial({
            color: 0xd9b14a,
            roughness: 0.25,
            metalness: 0.65,
          })
        );
        torus.castShadow = true;
        const core = new THREE.Mesh(
          new THREE.CircleGeometry(r.radius - 3, 28),
          new THREE.MeshBasicMaterial({
            color: 0x62b6a6,
            transparent: true,
            opacity: 0.18,
          })
        );
        group.add(torus, core);
        this.scene.add(group);
        entry = { group, torus, core, radius: r.radius };
        this.ringMeshes.set(r.id, entry);
      }
      entry.group.position.set(r.x, -r.y, 0);
      const coreMat = entry.core.material as THREE.MeshBasicMaterial;
      coreMat.opacity = 0.12 + r.charge * 0.42;
      const torusMat = entry.torus.material as THREE.MeshStandardMaterial;
      torusMat.color.setHex(r.charge > 0.85 ? 0x4ca696 : 0xd9b14a);
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

  private syncMarbles(marbles: Marble[], alpha: number): void {
    const alive = new Set<number>();
    for (const m of marbles) {
      alive.add(m.id);
      let entry = this.marbleMeshes.get(m.id);
      if (!entry) {
        const group = new THREE.Group();
        const sphere = new THREE.Mesh(this.sharedMarbleGeo, this.sharedMarbleMat);
        sphere.castShadow = true;
        group.add(sphere);

        const trail: THREE.Mesh[] = [];
        for (let i = 0; i < 6; i++) {
          const tm = new THREE.Mesh(
            this.sharedTrailGeo,
            new THREE.MeshBasicMaterial({
              color: 0x5ea8be,
              transparent: true,
              opacity: 0.16 * ((i + 1) / 6),
            })
          );
          this.scene.add(tm);
          trail.push(tm);
        }

        this.scene.add(group);
        entry = { group, sphere, trail };
        this.marbleMeshes.set(m.id, entry);
      }

      const ix = m.prevX + (m.x - m.prevX) * alpha;
      const iy = m.prevY + (m.y - m.prevY) * alpha;
      entry.group.position.set(ix, -iy, 2);

      const sScale = m.radius / 8;
      if (m.squash > 0.02) {
        entry.sphere.scale.set(
          sScale * (1 - m.squash * 0.12),
          sScale * (1 + m.squash * 0.12),
          sScale
        );
        entry.sphere.rotation.z = -m.squashAngle;
      } else {
        entry.sphere.scale.set(sScale, sScale, sScale);
      }

      const tLen = m.trail.length;
      for (let i = 0; i < entry.trail.length; i++) {
        const tm = entry.trail[i];
        const ptIdx = tLen - 1 - (entry.trail.length - 1 - i);
        if (ptIdx >= 0 && ptIdx < tLen) {
          const pt = m.trail[ptIdx];
          tm.visible = true;
          tm.position.set(pt.x, -pt.y, 1);
          const sc = 0.35 + ((i + 1) / entry.trail.length) * 0.55;
          tm.scale.set(sc, sc, sc);
        } else {
          tm.visible = false;
        }
      }
    }

    for (const [id, entry] of this.marbleMeshes.entries()) {
      if (!alive.has(id)) {
        this.scene.remove(entry.group);
        for (const tm of entry.trail) {
          this.scene.remove(tm);
          (tm.material as THREE.Material).dispose();
        }
        this.marbleMeshes.delete(id);
      }
    }
  }

  public render(
    world: WorldState,
    cameraState: CameraState,
    alpha: number,
    selectedId: string | null
  ): void {
    this.updateCamera(cameraState);
    this.syncBars(world.bars, selectedId);
    this.syncBumpers(world.bumpers);
    this.syncSplitters(world.splitters);
    this.syncEmitters(world.emitters);
    this.syncRings(world.rings);
    this.syncMarbles(world.marbles, alpha);
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
      const labelPos = this.projectToScreen(mx, topY, 10, viewW, viewH);

      if (isSel) {
        const pa = this.projectToScreen(bar.ax, bar.ay, 8, viewW, viewH);
        const pb = this.projectToScreen(bar.bx, bar.by, 8, viewW, viewH);
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
          const text =
            bar.noteLabel ?? lengthToNote(len, world.scaleId, bar.material).noteName;
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
        ctx.font = `600 10px ${FONTS.mono}`;
        ctx.fillStyle = "rgba(28, 35, 33, 0.58)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(bar.noteLabel, labelPos.x, labelPos.y);
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

    // 4. Ripples & crisp sunlit impact spark
    for (const rp of world.ripples) {
      const p = this.projectToScreen(rp.x, rp.y, 4, viewW, viewH);
      if (!p.visible) continue;
      const t = Math.min(1, rp.age / rp.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, (1 - t) * 0.65);
      ctx.strokeStyle = rp.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8 + rp.maxRadius * ease, 0, Math.PI * 2);
      ctx.stroke();

      if (rp.age < 0.14) {
        const st = rp.age / 0.14;
        const sAlpha = Math.pow(1 - st, 1.4);
        const rayLen = 14 + 4 * Math.sin(st * Math.PI);
        const rayW = 2.2 * (1 - st * 0.55);
        ctx.globalAlpha = 0.9 * sAlpha;
        ctx.fillStyle = "rgba(255, 248, 228, 0.95)";
        for (let i = 0; i < 4; i++) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((i * Math.PI) / 2 + Math.PI / 4);
          ctx.beginPath();
          ctx.moveTo(0, -rayLen);
          ctx.lineTo(rayW, 0);
          ctx.lineTo(0, rayLen);
          ctx.lineTo(-rayW, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // 5. Note popups
    for (const pop of world.popups) {
      const p = this.projectToScreen(pop.x, pop.y, 12, viewW, viewH);
      if (!p.visible) continue;
      const t = Math.min(1, pop.age / pop.duration);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t);
      ctx.font = `600 13px ${FONTS.mono}`;
      ctx.fillStyle = pop.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(pop.text, p.x, p.y - t * 18);
      ctx.restore();
    }
  }

  public dispose(): void {
    for (const geo of this.barGeoCache.values()) geo.dispose();
    for (const geo of this.coreGeoCache.values()) geo.dispose();
    this.barGeoCache.clear();
    this.coreGeoCache.clear();
    this.sharedMarbleGeo.dispose();
    this.sharedTrailGeo.dispose();
    this.sharedPinGeo.dispose();
    this.sharedMarbleMat.dispose();
    this.silentMaterial.dispose();
    this.pinMaterial.dispose();
    Object.values(this.barMaterials).forEach((m) => m.dispose());
    this.renderer.dispose();
  }
}
