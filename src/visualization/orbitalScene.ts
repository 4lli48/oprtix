import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { CartesianVector3D, StateVector } from '../types/orbital';
import { EARTH_RADIUS_KM } from '../physics/coordinates';

/**
 * PRESENTATION LAYER ONLY.
 * Positions come straight from the calculated ephemerides. The only transform applied is a
 * radial altitude exaggeration so that a ~420 km orbit is readable next to Earth. The factor is
 * exported so the UI can disclose it.
 */
export const ALTITUDE_EXAGGERATION = 12;
const EARTH_SCENE_R = 4;

export type SceneView = 'OVERVIEW' | 'SATELLITE' | 'ENCOUNTER';
export interface TagLabel {
  title: string;
  subtitle: string;
}

const COLOR = {
  primary:   0x4a9eca,  // blue — primary satellite
  secondary: 0xc07040,  // orange — secondary object
  danger:    0xc0464a,  // red — closest approach
  safe:      0x2fa878,  // green — post-maneuver
  neutral:   0xbbc4cf,  // silver — neutral elements
};

export function eciToScene(v: CartesianVector3D): THREE.Vector3 {
  const r = Math.hypot(v.x, v.y, v.z);
  const altRatio = (r - EARTH_RADIUS_KM) / EARTH_RADIUS_KM;
  const rs = EARTH_SCENE_R * (1 + altRatio * ALTITUDE_EXAGGERATION);
  const k = rs / r;
  // ECI z (Earth axis) -> scene +y
  return new THREE.Vector3(v.x * k, v.z * k, -v.y * k);
}

function dirToScene(v: CartesianVector3D): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y).normalize();
}

function markerTexture(color: string, shape: 'ring' | 'diamond' | 'target'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = 4.5;
  g.lineCap = 'round';
  if (shape === 'ring') {
    g.beginPath();
    g.arc(64, 64, 36, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      g.beginPath();
      g.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44);
      g.lineTo(64 + Math.cos(a) * 58, 64 + Math.sin(a) * 58);
      g.stroke();
    }
  } else if (shape === 'diamond') {
    g.beginPath();
    g.moveTo(64, 22);
    g.lineTo(106, 64);
    g.lineTo(64, 106);
    g.lineTo(22, 64);
    g.closePath();
    g.stroke();
  } else {
    // target / TCA marker
    g.beginPath();
    g.arc(64, 64, 18, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.arc(64, 64, 40, 0, Math.PI * 2);
    g.stroke();
    // crosshair
    g.lineWidth = 2;
    [[64,14,64,42],[64,86,64,114],[14,64,42,64],[86,64,114,64]].forEach(([x1,y1,x2,y2]) => {
      g.beginPath(); g.moveTo(x1,y1); g.lineTo(x2,y2); g.stroke();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Tag {
  el: HTMLDivElement;
  anchor: THREE.Object3D;
}

interface Playback {
  primary: StateVector[];
  secondary: StateVector[] | null;
  startedAt: number;
  tcaFraction: number;
  frozen: boolean;
  frozenFraction: number;
}

const PLAYBACK_MS = 14000;
const PLAYBACK_HOLD_MS = 1800;

export class OrbitalScene {
  /** Called every frame while a playback is active with the current scenario epoch (ms). */
  public onTick: ((epochMs: number | null) => void) | null = null;

  private container: HTMLElement;
  private tagLayer: HTMLElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private lineMaterials: LineMaterial[] = [];
  private resizeObserver: ResizeObserver;
  private earthMesh: THREE.Mesh;
  private earthRotation = 0;

  private primaryGroup: THREE.Group;
  private secondaryGroup: THREE.Group;
  private tcaMarker: THREE.Sprite;
  private burnMarker: THREE.Sprite;
  private collisionGroup: THREE.Group;
  private collisionShockwave!: THREE.Mesh;
  private collisionFlash!: THREE.Sprite;
  private collisionActive = false;
  private collisionOccurred = false;
  private tcaEpochMs: number | null = null;
  private visualPostTrajectory: StateVector[] | null = null;

  private primaryLine: Line2 | null = null;
  private secondaryLine: Line2 | null = null;
  private postLine: Line2 | null = null;
  private ghostLine: Line2 | null = null; // pre-maneuver trajectory (dim, for comparison)

  private tags: { primary: Tag; secondary: Tag };
  private primaryStatic: StateVector | null = null;
  private playback: Playback | null = null;

  private overview = { position: new THREE.Vector3(0, 20, 26), target: new THREE.Vector3() };
  private orbitNormal = new THREE.Vector3(0, 1, 0);
  private tcaPos: THREE.Vector3 | null = null;
  private transition: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private follow = false;
  private lastTickSecond = -1;
  private frameId = 0;
  private clock = new THREE.Clock();

  constructor(container: HTMLElement, tagLayer: HTMLElement) {
    this.container = container;
    this.tagLayer = tagLayer;

    this.scene.background = new THREE.Color(0x060709);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 500);
    this.camera.position.copy(this.overview.position);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.6;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 60;

    this.buildLighting();
    this.earthMesh = this.buildEarth();
    this.buildStars();
    this.buildNebulaBackground();

    this.primaryGroup = this.buildPrimary();
    this.secondaryGroup = this.buildSecondary();
    this.primaryGroup.visible = false;
    this.secondaryGroup.visible = false;
    this.scene.add(this.primaryGroup, this.secondaryGroup);

    this.tcaMarker = this.buildMarker(markerTexture('#c0464a', 'target'), 0.055);
    this.burnMarker = this.buildMarker(markerTexture('#bbc4cf', 'diamond'), 0.032);
    this.collisionGroup = this.buildCollisionEffect();
    this.scene.add(this.tcaMarker, this.burnMarker, this.collisionGroup);

    this.tags = {
      primary:   this.createTag('primary', this.primaryGroup),
      secondary: this.createTag('secondary', this.secondaryGroup),
    };

    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);
    this.onResize();
    this.animate();
  }

  /* ------------------------------------------------------------------ build */

  private buildLighting(): void {
    // Ambient — cold deep-space blue-black
    this.scene.add(new THREE.AmbientLight(0x0d1a2a, 2.8));

    // Sun — warm directional
    const sun = new THREE.DirectionalLight(0xfff5e8, 3.5);
    sun.position.set(30, 14, 22);
    this.scene.add(sun);

    // Subtle fill from Earth's "nightside reflection" — very cold/dim
    const fill = new THREE.DirectionalLight(0x182540, 0.4);
    fill.position.set(-20, -8, -15);
    this.scene.add(fill);
  }

  private buildEarth(): THREE.Mesh {
    // Try loading a real Earth texture; fall back to procedural on error
    const earthGeo = new THREE.SphereGeometry(EARTH_SCENE_R, 72, 72);

    // Earth surface: dark blue-grey with subtle variation
    const earthMat = new THREE.MeshStandardMaterial({
      color: 0x0d1e35,
      roughness: 0.88,
      metalness: 0.05,
    });
    const earth = new THREE.Mesh(earthGeo, earthMat);
    this.scene.add(earth);

    // Async-load real Earth texture — quietly falls back to procedural if unavailable
    const loader = new THREE.TextureLoader();
    loader.load(
      'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r161/examples/textures/land_ocean_ice_cloud_2048.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        earthMat.map = tex;
        earthMat.color.set(0xffffff);
        earthMat.roughness = 0.85;
        earthMat.needsUpdate = true;
      },
      undefined,
      () => { /* keep procedural fallback */ }
    );

    // Landmass suggestion — a slightly lighter overlay
    const landMat = new THREE.MeshStandardMaterial({
      color: 0x152b42,
      roughness: 0.92,
      metalness: 0,
      transparent: true,
      opacity: 0.55,
    });
    const land = new THREE.Mesh(new THREE.SphereGeometry(EARTH_SCENE_R * 1.001, 72, 72), landMat);
    this.scene.add(land);

    // Graticule — very subtle, just for spatial reference
    const pts: number[] = [];
    const R = EARTH_SCENE_R * 1.002;
    const seg = 120;
    const ring = (lat: number) => {
      const y = Math.sin(lat) * R;
      const rr = Math.cos(lat) * R;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        pts.push(Math.cos(a0) * rr, y, Math.sin(a0) * rr, Math.cos(a1) * rr, y, Math.sin(a1) * rr);
      }
    };
    for (const deg of [-60, -30, 0, 30, 60]) ring((deg * Math.PI) / 180);
    for (let m = 0; m < 12; m++) {
      const lon = (m / 12) * Math.PI * 2;
      for (let i = 0; i < seg / 2; i++) {
        const l0 = -Math.PI / 2 + (i / (seg / 2)) * Math.PI;
        const l1 = -Math.PI / 2 + ((i + 1) / (seg / 2)) * Math.PI;
        pts.push(
          Math.cos(l0) * Math.cos(lon) * R, Math.sin(l0) * R, Math.cos(l0) * Math.sin(lon) * R,
          Math.cos(l1) * Math.cos(lon) * R, Math.sin(l1) * R, Math.cos(l1) * Math.sin(lon) * R
        );
      }
    }
    const gratGeo = new THREE.BufferGeometry();
    gratGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(
      new THREE.LineSegments(gratGeo, new THREE.LineBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.18 }))
    );

    // Atmosphere glow — inner soft layer
    const atmoInner = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_R * 1.018, 64, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a4a7a,
        transparent: true,
        opacity: 0.09,
        side: THREE.FrontSide,
      })
    );
    this.scene.add(atmoInner);

    // Atmosphere glow — outer limb halo
    const atmoOuter = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_SCENE_R * 1.06, 64, 64),
      new THREE.MeshBasicMaterial({
        color: 0x2060a0,
        transparent: true,
        opacity: 0.045,
        side: THREE.BackSide,
      })
    );
    this.scene.add(atmoOuter);

    // City lights suggestion — very faint warm flicker on nightside (simple dim mesh)
    const nightMat = new THREE.MeshBasicMaterial({
      color: 0x3a2808,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(EARTH_SCENE_R * 1.001, 32, 32), nightMat));

    return earth;
  }

  private buildStars(): void {
    // Two layers: close bright stars and distant faint field
    const makeStarField = (n: number, rMin: number, rMax: number, size: number, opacity: number, color: number) => {
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = rMin + Math.random() * (rMax - rMin);
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        pos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
        pos[i * 3 + 2] = r * Math.cos(ph);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.scene.add(
        new THREE.Points(g, new THREE.PointsMaterial({
          color,
          size,
          sizeAttenuation: false,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }))
      );
    };

    makeStarField(900,  140, 180, 1.4, 0.55, 0x9ab0c8);
    makeStarField(1800, 180, 250, 0.9, 0.35, 0xc0cedd);
    makeStarField(300,  130, 145, 2.0, 0.70, 0xffffff);
  }

  private buildNebulaBackground(): void {
    // Subtle milky-way-style band — a large, slightly rotated torus-ish transparent mesh
    const nebulaGeo = new THREE.TorusGeometry(200, 60, 4, 48);
    const nebulaMat = new THREE.MeshBasicMaterial({
      color: 0x0c1a30,
      transparent: true,
      opacity: 0.06,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const nebula = new THREE.Mesh(nebulaGeo, nebulaMat);
    nebula.rotation.x = 0.4;
    nebula.rotation.z = 0.8;
    this.scene.add(nebula);
  }

  private buildMarker(tex: THREE.Texture, size: number): THREE.Sprite {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, sizeAttenuation: false, depthWrite: false })
    );
    s.scale.set(size, size, 1);
    s.visible = false;
    return s;
  }

  private buildCollisionEffect(): THREE.Group {
    const g = new THREE.Group();

    // 1. Expanding shockwave wireframe sphere
    const shockGeo = new THREE.SphereGeometry(0.18, 16, 16);
    const shockMat = new THREE.MeshBasicMaterial({
      color: 0xff3b30,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.collisionShockwave = new THREE.Mesh(shockGeo, shockMat);
    g.add(this.collisionShockwave);

    // 2. High-intensity radial flash sprite
    const flashCanvas = document.createElement('canvas');
    flashCanvas.width = flashCanvas.height = 128;
    const ctx = flashCanvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, '#ffaa33');
    grad.addColorStop(0.6, 'rgba(255, 50, 40, 0.75)');
    grad.addColorStop(1, 'rgba(255, 20, 20, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const flashTex = new THREE.CanvasTexture(flashCanvas);
    flashTex.colorSpace = THREE.SRGBColorSpace;

    this.collisionFlash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: flashTex,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.collisionFlash.scale.set(0.35, 0.35, 1);
    g.add(this.collisionFlash);

    g.visible = false;
    return g;
  }

  private buildPrimary(): THREE.Group {
    const g = new THREE.Group();

    // Materials
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e0, metalness: 0.7, roughness: 0.25 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x2a5a90, metalness: 0.6, roughness: 0.35 });
    const edgeMat  = new THREE.MeshStandardMaterial({ color: 0x7a9ab8, metalness: 0.8, roughness: 0.2 });
    const goldMat  = new THREE.MeshStandardMaterial({ color: 0x9a7a30, metalness: 0.9, roughness: 0.2 });

    // Main truss
    const truss = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.022, 0.022), bodyMat);
    g.add(truss);

    // Central hab module (cylinder)
    const hab = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.38, 16), bodyMat);
    hab.rotation.z = Math.PI / 2;
    g.add(hab);

    // Docking ports
    for (const x of [-0.1, 0.1]) {
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 10), edgeMat);
      port.rotation.z = Math.PI / 2;
      port.position.x = x;
      port.position.y = 0.055;
      g.add(port);
    }

    // Solar panels — 4 large panels
    for (const side of [-1, 1]) {
      for (const offset of [0.24, 0.5]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.008, 0.36), panelMat);
        panel.position.x = side * offset;
        g.add(panel);

        // Panel frame edge
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.185, 0.010, 0.365), edgeMat);
        frame.position.copy(panel.position);
        frame.position.y -= 0.001;
        g.add(frame);
      }
    }

    // Thermal radiators (gold foil colour)
    const radL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.22), goldMat);
    radL.position.set(0, -0.04, 0.12);
    const radR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.22), goldMat);
    radR.position.set(0, -0.04, -0.12);
    g.add(radL, radR);

    // Orbital ring marker (always visible — identifies the satellite)
    const marker = this.buildMarker(markerTexture('#4a9eca', 'ring'), 0.06);
    marker.visible = true;
    g.add(marker);

    return g;
  }

  private buildSecondary(): THREE.Group {
    const g = new THREE.Group();

    // Debris-like irregular shape
    const debMat = new THREE.MeshStandardMaterial({ color: COLOR.secondary, roughness: 0.75, metalness: 0.15 });
    g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), debMat));

    // Small fragment
    const frag = new THREE.Mesh(new THREE.DodecahedronGeometry(0.04, 0), debMat);
    frag.position.set(0.12, 0.05, 0.08);
    g.add(frag);

    // Diamond marker
    const marker = this.buildMarker(markerTexture('#c07040', 'diamond'), 0.045);
    marker.visible = true;
    g.add(marker);

    return g;
  }

  private createTag(kind: 'primary' | 'secondary', anchor: THREE.Object3D): Tag {
    const el = document.createElement('div');
    el.className = `scene-tag tag-${kind}`;
    el.style.display = 'none';
    el.innerHTML = `
      <svg class="tag-leader" width="26" height="30" viewBox="0 0 26 30"><line x1="0" y1="30" x2="26" y2="0"/></svg>
      <div class="tag-box"><span class="tag-title"></span><span class="tag-sub"></span></div>`;
    this.tagLayer.appendChild(el);
    return { el, anchor };
  }

  private setTag(tag: Tag, label: TagLabel, show: boolean): void {
    (tag.el.querySelector('.tag-title') as HTMLElement).textContent = label.title;
    (tag.el.querySelector('.tag-sub') as HTMLElement).textContent = label.subtitle;
    tag.el.style.display = show ? 'block' : 'none';
  }

  private makeLine(points: THREE.Vector3[], color: number, widthPx: number, opacity: number): Line2 {
    const geom = new LineGeometry();
    geom.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({ color, linewidth: widthPx, transparent: true, opacity, worldUnits: false });
    mat.resolution.set(this.container.clientWidth || 1, this.container.clientHeight || 1);
    this.lineMaterials.push(mat);
    const line = new Line2(geom, mat);
    this.scene.add(line);
    return line;
  }

  private removeLine(line: Line2 | null): null {
    if (line) {
      this.scene.remove(line);
      line.geometry.dispose();
      const mat = line.material as LineMaterial;
      this.lineMaterials = this.lineMaterials.filter((m) => m !== mat);
      mat.dispose();
    }
    return null;
  }

  /* ------------------------------------------------------------- public API */

  /** READY state: Earth, primary satellite, primary orbit. Nothing else. */
  public setPrimary(trajectory: StateVector[], state: StateVector, label: TagLabel): void {
    this.primaryLine = this.removeLine(this.primaryLine);
    this.primaryLine = this.makeLine(
      trajectory.map((p) => eciToScene(p.position)),
      COLOR.primary,
      1.8,
      0.80
    );
    this.primaryStatic = state;
    this.placePrimary(state.position, state.velocity);
    this.primaryGroup.visible = true;
    this.setTag(this.tags.primary, label, true);

    const p = eciToScene(state.position);
    const n = new THREE.Vector3(
      state.position.y * state.velocity.z - state.position.z * state.velocity.y,
      state.position.z * state.velocity.x - state.position.x * state.velocity.z,
      state.position.x * state.velocity.y - state.position.y * state.velocity.x
    );
    this.orbitNormal = dirToScene({ x: n.x, y: n.y, z: n.z });

    const aspect = this.camera.aspect || 1.6;
    const fit = Math.max(1, 1.2 / aspect);
    const dir = p.clone().normalize().multiplyScalar(0.45).add(this.orbitNormal.clone().multiplyScalar(0.8)).normalize();
    this.overview = { position: dir.multiplyScalar(p.length() * 3.9 * fit), target: new THREE.Vector3() };
    this.camera.position.copy(this.overview.position);
    this.controls.target.copy(this.overview.target);
    this.controls.update();
  }

  public showHazard(secondaryEphemeris: StateVector[], label: TagLabel): void {
    this.secondaryLine = this.removeLine(this.secondaryLine);
    this.secondaryLine = this.makeLine(
      secondaryEphemeris.map((p) => eciToScene(p.position)),
      COLOR.secondary,
      1.5,
      0.85
    );
    const first = secondaryEphemeris[0];
    this.secondaryGroup.position.copy(eciToScene(first.position));
    this.secondaryGroup.visible = true;
    this.setTag(this.tags.secondary, label, true);
  }

  public clearHazard(): void {
    this.secondaryLine = this.removeLine(this.secondaryLine);
    this.postLine = this.removeLine(this.postLine);
    this.ghostLine = this.removeLine(this.ghostLine);
    this.secondaryGroup.visible = false;
    this.tags.secondary.el.style.display = 'none';
    this.tcaMarker.visible = false;
    this.burnMarker.visible = false;
    this.collisionGroup.visible = false;
    this.collisionActive = false;
    this.collisionOccurred = false;
    this.visualPostTrajectory = null;
    this.tcaPos = null;
    this.tcaEpochMs = null;
    this.playback = null;
    this.follow = false;
    this.lastTickSecond = -1;
    this.onTick?.(null);
    if (this.primaryStatic) this.placePrimary(this.primaryStatic.position, this.primaryStatic.velocity);
  }

  /** Moves both objects along their calculated ephemerides (time-lapse). */
  public setPlayback(primary: StateVector[], secondary: StateVector[] | null): void {
    let tcaFraction = 0.714;
    if (secondary && secondary.length > 1 && primary.length > 1) {
      let minIdx = 0;
      let minDist = Infinity;
      const count = Math.min(primary.length, secondary.length);
      for (let i = 0; i < count; i++) {
        const p = primary[i].position;
        const s = secondary[i].position;
        const d = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z);
        if (d < minDist) {
          minDist = d;
          minIdx = i;
        }
      }
      tcaFraction = minIdx / Math.max(count - 1, 1);
    } else if (this.tcaEpochMs && primary.length > 1) {
      const t0 = primary[0].epoch.getTime();
      const t1 = primary[primary.length - 1].epoch.getTime();
      if (t1 > t0) {
        tcaFraction = Math.max(0, Math.min(1, (this.tcaEpochMs - t0) / (t1 - t0)));
      }
    }

    this.collisionOccurred = false;
    this.collisionGroup.visible = false;

    this.playback = {
      primary,
      secondary,
      startedAt: performance.now(),
      tcaFraction,
      frozen: false,
      frozenFraction: 0,
    };
  }

  public setClosestApproach(pos: CartesianVector3D | null, tcaEpochMs: number | null = null): void {
    if (!pos) {
      this.tcaMarker.visible = false;
      this.tcaPos = null;
      this.tcaEpochMs = null;
      this.collisionGroup.visible = false;
      this.collisionOccurred = false;
      return;
    }
    this.tcaPos = eciToScene(pos);
    this.tcaEpochMs = tcaEpochMs;
    this.tcaMarker.position.copy(this.tcaPos);
    this.tcaMarker.visible = true;
    if (this.collisionOccurred && this.tcaPos) {
      this.collisionGroup.position.copy(this.tcaPos);
    }

    // Ensure overview camera never lets Earth hide the maneuver
    if (this.isOccluded(this.tcaPos)) {
      const out = this.tcaPos.clone().normalize();
      const p = this.primaryGroup.position;
      const fit = Math.max(1, 1.2 / (this.camera.aspect || 1.6));
      const dist = p.length() * 3.9 * fit;
      const safeDir = out.clone().multiplyScalar(0.7).add(this.orbitNormal.clone().multiplyScalar(0.7)).normalize();
      this.overview.position.copy(safeDir.multiplyScalar(dist));
    }
  }

  public setManeuverPoint(pos: CartesianVector3D | null): void {
    if (!pos) {
      this.burnMarker.visible = false;
      return;
    }
    this.burnMarker.position.copy(eciToScene(pos));
    this.burnMarker.visible = true;
  }

  /**
   * Show original (pre-maneuver) trajectory as a dim ghost for visual comparison.
   * Call with null to clear.
   */
  public setOriginalTrajectory(trajectory: StateVector[] | null): void {
    this.ghostLine = this.removeLine(this.ghostLine);
    if (!trajectory) return;
    this.ghostLine = this.makeLine(
      trajectory.map((p) => eciToScene(p.position)),
      0x6e889e,
      1.6,
      0.50
    );
  }

  public clearOriginalTrajectory(): void {
    this.ghostLine = this.removeLine(this.ghostLine);
  }

  public getVisualPostTrajectory(): StateVector[] | null {
    return this.visualPostTrajectory;
  }

  private buildVisualPostTrajectory(
    trajectory: StateVector[],
    originalTrajectory: StateVector[] | null
  ): StateVector[] {
    if (!originalTrajectory || originalTrajectory.length === 0) {
      return trajectory;
    }

    // Visual amplification factor for physical maneuver displacement.
    // In LEO, 1-3 km physical clearance scaled by ~45 gives ~45-135 km visual displacement,
    // which translates to 0.4 - 1.0 scene units next to Earth (R=4) and satellite (1.1 units).
    // At burnEpoch, dx=dy=dz=0 so the branch point is perfectly seamless.
    const S_MANEUVER = 45;

    return trajectory.map((pt) => {
      const t = pt.epoch.getTime();
      let bestOrig = originalTrajectory[0];
      let bestDiff = Math.abs(bestOrig.epoch.getTime() - t);
      for (let i = 1; i < originalTrajectory.length; i++) {
        const diff = Math.abs(originalTrajectory[i].epoch.getTime() - t);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestOrig = originalTrajectory[i];
        } else if (diff > bestDiff) {
          break;
        }
      }

      if (bestDiff > 30000) {
        return pt;
      }

      const dx = pt.position.x - bestOrig.position.x;
      const dy = pt.position.y - bestOrig.position.y;
      const dz = pt.position.z - bestOrig.position.z;

      const deltaMag = Math.hypot(dx, dy, dz);
      if (deltaMag > 50) {
        return pt;
      }

      const dvx = pt.velocity.x - bestOrig.velocity.x;
      const dvy = pt.velocity.y - bestOrig.velocity.y;
      const dvz = pt.velocity.z - bestOrig.velocity.z;

      return {
        epoch: pt.epoch,
        position: {
          x: bestOrig.position.x + dx * S_MANEUVER,
          y: bestOrig.position.y + dy * S_MANEUVER,
          z: bestOrig.position.z + dz * S_MANEUVER,
        },
        velocity: {
          x: bestOrig.velocity.x + dvx * S_MANEUVER,
          y: bestOrig.velocity.y + dvy * S_MANEUVER,
          z: bestOrig.velocity.z + dvz * S_MANEUVER,
        },
      };
    });
  }

  /**
   * Show post-maneuver trajectory. Color = green if safe, red if collision.
   */
  public setPostManeuver(
    trajectory: StateVector[] | null,
    safe = true,
    originalTrajectory: StateVector[] | null = null
  ): void {
    this.postLine = this.removeLine(this.postLine);
    if (!trajectory) {
      this.visualPostTrajectory = null;
      this.collisionActive = false;
      this.collisionOccurred = false;
      this.collisionGroup.visible = false;
      return;
    }

    this.visualPostTrajectory = this.buildVisualPostTrajectory(trajectory, originalTrajectory);
    this.postLine = this.makeLine(
      this.visualPostTrajectory.map((p) => eciToScene(p.position)),
      safe ? COLOR.safe : COLOR.danger,
      2.8,
      1
    );

    this.collisionActive = !safe;
    this.collisionOccurred = false;
    // CRITICAL: Explosion must NEVER appear before contact!
    this.collisionGroup.visible = false;
  }

  public setView(view: SceneView): void {
    this.follow = false;
    if (view === 'OVERVIEW') {
      this.transition = { position: this.overview.position.clone(), target: this.overview.target.clone() };
    } else if (view === 'SATELLITE') {
      const p = this.primaryGroup.position.clone();
      const out = p.clone().normalize();
      this.transition = {
        target: p,
        position: p.clone().add(out.multiplyScalar(2.6)).add(this.orbitNormal.clone().multiplyScalar(1.7)),
      };
      this.follow = true;
    } else if (view === 'ENCOUNTER' && this.tcaPos) {
      const out = this.tcaPos.clone().normalize();
      this.transition = {
        target: this.tcaPos.clone(),
        position: this.tcaPos.clone().add(out.multiplyScalar(3.2)).add(this.orbitNormal.clone().multiplyScalar(2.0)),
      };
    }
  }

  /* --------------------------------------------------------------- internals */

  private placePrimary(position: CartesianVector3D, velocity: CartesianVector3D): void {
    const p = eciToScene(position);
    this.primaryGroup.position.copy(p);
    this.primaryGroup.lookAt(p.clone().add(dirToScene(velocity)));
  }

  private onResize(): void {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const m of this.lineMaterials) m.resolution.set(w, h);
  }

  private sample(arr: StateVector[], f: number): { pos: CartesianVector3D; vel: CartesianVector3D; ms: number } {
    const idx = f * (arr.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(arr.length - 1, i0 + 1);
    const t = idx - i0;
    const a = arr[i0];
    const b = arr[i1];
    const lerp = (u: number, v: number) => u + (v - u) * t;
    return {
      pos: { x: lerp(a.position.x, b.position.x), y: lerp(a.position.y, b.position.y), z: lerp(a.position.z, b.position.z) },
      vel: a.velocity,
      ms: lerp(a.epoch.getTime(), b.epoch.getTime()),
    };
  }

  private triggerCollision(pb: Playback, f: number): void {
    this.collisionOccurred = true;
    pb.frozen = true;
    pb.frozenFraction = f;

    // Contact point between satellite and debris
    const contactPos = this.secondaryGroup.visible
      ? this.primaryGroup.position.clone().add(this.secondaryGroup.position).multiplyScalar(0.5)
      : (this.tcaPos ?? this.primaryGroup.position.clone());
    this.collisionGroup.position.copy(contactPos);
    this.collisionGroup.visible = true;

    // Trigger initial explosion burst
    this.collisionShockwave.scale.set(0.18, 0.18, 0.18);
    this.collisionFlash.scale.set(0.65, 0.65, 1);
    (this.collisionShockwave.material as THREE.MeshBasicMaterial).opacity = 1.0;
  }

  private stepPlayback(): void {
    const pb = this.playback;
    if (!pb || pb.primary.length < 2) return;

    // 1. If collision occurred, freeze all motion on the exact impact frame!
    if (this.collisionActive && this.collisionOccurred && pb.frozen) {
      const p = this.sample(pb.primary, pb.frozenFraction);
      this.placePrimary(p.pos, p.vel);
      if (pb.secondary && pb.secondary.length > 1) {
        const s = this.sample(pb.secondary, pb.frozenFraction);
        this.secondaryGroup.position.copy(eciToScene(s.pos));
      }
      return;
    }

    // 2. Compute playback progression
    const duration = PLAYBACK_MS;
    const elapsed = performance.now() - pb.startedAt;
    let f = 0;

    if (this.collisionActive) {
      // Unsafe run: progress linearly up to collision point
      f = Math.min(elapsed / duration, 1);
    } else {
      // Safe run: smooth loop with hold
      const cycle = elapsed % (duration + PLAYBACK_HOLD_MS);
      f = Math.min(cycle, duration) / duration;
    }

    // 3. Check for contact before moving beyond TCA
    if (this.collisionActive && !this.collisionOccurred) {
      if (f >= pb.tcaFraction) {
        f = pb.tcaFraction;
        const pContact = this.sample(pb.primary, f);
        this.placePrimary(pContact.pos, pContact.vel);
        if (pb.secondary && pb.secondary.length > 1) {
          const sContact = this.sample(pb.secondary, f);
          this.secondaryGroup.position.copy(eciToScene(sContact.pos));
        }
        this.triggerCollision(pb, f);
        this.onTick?.(pContact.ms);
        return;
      }
    }

    const p = this.sample(pb.primary, f);
    this.placePrimary(p.pos, p.vel);
    if (pb.secondary && pb.secondary.length > 1) {
      const s = this.sample(pb.secondary, f);
      this.secondaryGroup.position.copy(eciToScene(s.pos));
    }

    // Secondary contact check: 3D scene physical distance
    if (this.collisionActive && !this.collisionOccurred && pb.secondary && pb.secondary.length > 1) {
      const dist = this.primaryGroup.position.distanceTo(this.secondaryGroup.position);
      if (dist <= 0.22) {
        this.triggerCollision(pb, f);
        this.onTick?.(p.ms);
        return;
      }
    }

    const sec = Math.floor(p.ms / 1000);
    if (sec !== this.lastTickSecond) {
      this.lastTickSecond = sec;
      this.onTick?.(p.ms);
    }
  }

  private isOccluded(p: THREE.Vector3): boolean {
    const c = this.camera.position;
    const d = p.clone().sub(c);
    const len = d.length();
    d.divideScalar(len);
    const b = c.dot(d);
    const disc = b * b - (c.lengthSq() - EARTH_SCENE_R * EARTH_SCENE_R);
    if (disc < 0) return false;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < len;
  }

  private updateTags(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    for (const tag of Object.values(this.tags)) {
      if (tag.el.style.display === 'none') continue;
      const world = tag.anchor.getWorldPosition(new THREE.Vector3());
      const v = world.clone().project(this.camera);
      if (v.z > 1) {
        tag.el.style.opacity = '0';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      tag.el.classList.toggle('flip', x > w - 200);
      tag.el.classList.toggle('drop', y < 70);
      tag.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      tag.el.style.opacity = this.isOccluded(world) ? '0.3' : '1';
    }
  }

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();

    // Slow Earth rotation
    this.earthRotation += dt * 0.018;
    this.earthMesh.rotation.y = this.earthRotation;

    // Gentle secondary debris tumble
    if (this.secondaryGroup.visible) {
      this.secondaryGroup.rotation.x += dt * 0.4;
      this.secondaryGroup.rotation.z += dt * 0.25;
    }

    // Animate collision event at encounter point ONLY when active AND contact has occurred
    if (this.collisionActive && this.collisionOccurred) {
      const time = performance.now() * 0.005;
      const pulse = 0.5 + 0.5 * Math.sin(time * 4);
      const shockScale = 0.5 + 0.5 * pulse;
      this.collisionShockwave.scale.set(shockScale, shockScale, shockScale);
      this.collisionShockwave.rotation.y += dt * 2.0;
      this.collisionShockwave.rotation.z += dt * 1.2;
      (this.collisionShockwave.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.5 * (1 - pulse);
      const flashScale = 0.35 + 0.25 * Math.abs(Math.sin(time * 5));
      this.collisionFlash.scale.set(flashScale, flashScale, 1);
    }

    this.stepPlayback();

    if (this.follow && !this.transition) {
      const delta = this.primaryGroup.position.clone().sub(this.controls.target);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }

    if (this.transition) {
      this.camera.position.lerp(this.transition.position, 0.08);
      this.controls.target.lerp(this.transition.target, 0.08);
      if (
        this.camera.position.distanceTo(this.transition.position) < 0.03 &&
        this.controls.target.distanceTo(this.transition.target) < 0.03
      ) {
        this.transition = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateTags();
  };

  public destroy(): void {
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
