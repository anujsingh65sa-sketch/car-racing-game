import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RacingAudio } from './audio';
import { buildRaceCar, RaceCarRig } from './carModel';
import { createProceduralTextures, ProceduralTextures } from './textures';
import { BARRIER_HALF_WIDTH, CircuitTrack, TRACK_HALF_WIDTH } from './track';
import { CameraMode, GameState, HudSnapshot, LIVERY_OPTIONS, LiveryOption } from './types';

const VelocityMotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeedBlur: { value: 0.0 },
    uCameraDelta: { value: new THREE.Vector2(0, 0) },
    uChromatic: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeedBlur;
    uniform vec2 uCameraDelta;
    uniform float uChromatic;
    varying vec2 vUv;

    void main() {
      vec2 center = vec2(0.5, 0.45);
      vec2 toCenter = center - vUv;
      float dist = length(toCenter);

      // Keep the center focal zone around the player's car sharp while streaking the periphery
      float peripheralMask = smoothstep(0.14, 0.62, dist);
      vec2 radialDir = dist > 0.0001 ? (toCenter / dist) : vec2(0.0);

      vec2 blurVec = radialDir * (uSpeedBlur * peripheralMask) + uCameraDelta * (0.45 + 0.55 * peripheralMask);

      // Clamp maximum sample offset to prevent artifacts
      float blurLen = length(blurVec);
      if (blurLen > 0.065) {
        blurVec = (blurVec / blurLen) * 0.065;
      }

      if (blurLen < 0.0004) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec3 accum = vec3(0.0);
      const int SAMPLES = 10;
      for (int i = 0; i < SAMPLES; i++) {
        float t = (float(i) / float(SAMPLES - 1)) - 0.5;
        vec2 sampleUv = clamp(vUv + blurVec * t, vec2(0.001), vec2(0.999));
        accum += texture2D(tDiffuse, sampleUv).rgb;
      }
      vec3 color = accum / float(SAMPLES);

      // Subtle peripheral chromatic aberration at high velocity / nitro
      if (uChromatic > 0.0001) {
        vec2 caOffset = radialDir * uChromatic * peripheralMask;
        float r = texture2D(tDiffuse, clamp(vUv - caOffset, vec2(0.001), vec2(0.999))).r;
        float b = texture2D(tDiffuse, clamp(vUv + caOffset, vec2(0.001), vec2(0.999))).b;
        color.r = mix(color.r, r, 0.55);
        color.b = mix(color.b, b, 0.55);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

// Pre-allocated math helpers (zero GC in render loop)
const _vecA = new THREE.Vector3();
const _vecB = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _pColor = new THREE.Color();

interface RivalCar {
  rig: RaceCarRig;
  x: number;
  z: number;
  yaw: number;
  speed: number;
  baseMaxSpeed: number;
  laneOffset: number;
  targetLaneOffset: number;
  laneTimer: number;
  sampleIndex: number;
  t: number;
  lap: number;
  passedHalf: boolean;
  totalProgress: number;
  colorHex: string;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

export class RaceEngine {
  private container: HTMLElement;
  private onHudUpdate: (snapshot: HudSnapshot) => void;

  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private motionBlurPass!: ShaderPass;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private textures!: ProceduralTextures;
  private track!: CircuitTrack;
  private audio = new RacingAudio();

  private prevCamPos = new THREE.Vector3();
  private prevCamYaw = 0;
  private smoothedCamDelta = new THREE.Vector2();
  private smoothedSpeedBlur = 0;

  private isSoftwareGl = false;
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();

  // Game state
  private gameState: GameState = 'title';
  private countdownTimer = 0;
  private lastCountdownInt = 4;
  private cameraMode: CameraMode = 'chase';
  private selectedLivery: LiveryOption = LIVERY_OPTIONS[0];

  // Player physics state
  private playerRig!: RaceCarRig;
  private px = 0;
  private pz = 152;
  private pyaw = 0;
  private pspeed = 0; // m/s (max ~78 m/s = 280 km/h, boost ~92 m/s = 331 km/h)
  private steerAngle = 0;
  private lateralVel = 0;
  private nitro = 100;
  private boostActive = false;
  private offTrack = false;
  private wrongWay = false;
  private wheelSpin = 0;

  // Lap & race progress
  private readonly totalLaps = 3;
  private playerSampleIdx = 0;
  private playerT = 0;
  private playerLap = 1;
  private passedSector1 = false;
  private passedSector2 = false;
  private playerTotalProgress = 0;
  private currentLapMs = 0;
  private bestLapMs: number | null = null;
  private totalTimeMs = 0;

  // Game feel: hitstop & camera shake
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private currentFov = 62;
  private camRoll = 0;
  private titleOrbitAngle = 0.55;

  // Rivals
  private rivals: RivalCar[] = [];

  // Pooled 3D Particles
  private readonly maxParticles = 140;
  private particles: Particle[] = [];
  private particleMesh!: THREE.InstancedMesh;

  // Input state: continuous held vs edge-triggered justPressed
  private heldKeys = new Set<string>();
  private touchState = {
    left: false,
    right: false,
    throttle: false,
    brake: false,
    nitro: false,
  };

  private hudEmitAccum = 0;

  constructor(container: HTMLElement, onHudUpdate: (snapshot: HudSnapshot) => void) {
    this.container = container;
    this.onHudUpdate = onHudUpdate;

    this.initThree();
    this.initSceneObjects();
    this.bindEvents();
    this.resetRacePositions();
    this.emitHudSnapshot();
    this.startLoop();
  }

  private detectSoftwareWebGL(): boolean {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return false;
    }
  }

  private initThree(): void {
    this.isSoftwareGl = this.detectSoftwareWebGL();

    const renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !this.isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    renderer.setSize(width, height);

    this.container.innerHTML = '';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x0f172a);
    scene.background = skyColor;
    scene.fog = new THREE.FogExp2(0x0f172a, 0.0023);
    this.scene = scene;

    // Mandatory RoomEnvironment PMREM studio reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(62, width / height, 0.3, 950);
    this.camera = camera;

    // 3-Point Warm/Cool Studio & Outdoor Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffedd5, 2.2);
    keyLight.position.set(120, 180, 90);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 10;
    keyLight.shadow.camera.far = 520;
    const d = 140;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xf59e0b, 0.85);
    rimLight.position.set(-140, 65, -120);
    scene.add(rimLight);

    // Post-processing pipeline: RenderPass -> Velocity & Camera Motion Blur -> OutputPass
    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(width, height);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const motionBlurPass = new ShaderPass(VelocityMotionBlurShader);
    composer.addPass(motionBlurPass);
    this.motionBlurPass = motionBlurPass;

    const outputPass = new OutputPass();
    composer.addPass(outputPass);

    this.composer = composer;
  }

  private initSceneObjects(): void {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.textures = createProceduralTextures(maxAniso);
    this.track = new CircuitTrack(this.scene, this.textures);

    // Player Car
    this.playerRig = buildRaceCar({
      primaryColor: this.selectedLivery.primary,
      accentColor: this.selectedLivery.accent,
      contactShadowTexture: this.textures.contactShadow,
    });
    this.scene.add(this.playerRig.root);

    // 5 AI Rival Cars with distinct liveries
    const rivalConfigs = [
      { primary: 0x0284c7, accent: 0xf8fafc, hex: '#0284C7', speed: 69.5 },
      { primary: 0xf59e0b, accent: 0x0f172a, hex: '#F59E0B', speed: 67.5 },
      { primary: 0x10b981, accent: 0xfef08a, hex: '#10B981', speed: 65.5 },
      { primary: 0x8b5cf6, accent: 0x38bdf8, hex: '#8B5CF6', speed: 63.5 },
      { primary: 0xe11d48, accent: 0xfde047, hex: '#E11D48', speed: 61.5 },
    ];

    rivalConfigs.forEach((cfg) => {
      const rig = buildRaceCar({
        primaryColor: cfg.primary,
        accentColor: cfg.accent,
        contactShadowTexture: this.textures.contactShadow,
      });
      this.scene.add(rig.root);
      this.rivals.push({
        rig,
        x: 0,
        z: 0,
        yaw: 0,
        speed: 0,
        baseMaxSpeed: cfg.speed,
        laneOffset: 0,
        targetLaneOffset: 0,
        laneTimer: 1 + Math.random() * 2,
        sampleIndex: 0,
        t: 0,
        lap: 1,
        passedHalf: false,
        totalProgress: 0,
        colorHex: cfg.hex,
      });
    });

    // Pooled 3D Particle InstancedMesh
    const pGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleMesh = new THREE.InstancedMesh(pGeo, pMat, this.maxParticles);
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleMesh.frustumCulled = false;
    this.scene.add(this.particleMesh);

    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -50,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size: 1,
        color: 0xffffff,
      });
      _dummy.position.set(0, -50, 0);
      _dummy.scale.set(0, 0, 0);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _pColor.setHex(0xffffff));
    }

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private resetRacePositions(): void {
    const N = this.track.samples.length;

    // Place player at P6 on the starting grid (slightly behind start line)
    const playerStartIdx = (N - 18) % N;
    const pSample = this.track.samples[playerStartIdx];
    const pLane = -2.6;
    this.px = pSample.point.x + pSample.right.x * pLane;
    this.pz = pSample.point.z + pSample.right.z * pLane;
    this.pyaw = Math.atan2(-pSample.tangent.x, -pSample.tangent.z);
    this.pspeed = 0;
    this.steerAngle = 0;
    this.lateralVel = 0;
    this.nitro = 100;
    this.boostActive = false;
    this.offTrack = false;
    this.wrongWay = false;
    this.playerSampleIdx = playerStartIdx;
    this.playerT = pSample.t;
    this.playerLap = 1;
    this.passedSector1 = false;
    this.passedSector2 = false;
    this.playerTotalProgress = -0.025;
    this.currentLapMs = 0;
    this.totalTimeMs = 0;

    this.syncCarTransform(this.playerRig, this.px, this.pz, this.pyaw, 0, 0, false, false);

    // Place 5 rivals staggered ahead on the grid (P1..P5)
    this.rivals.forEach((rival, idx) => {
      const gridSlot = 5 - idx; // 5 down to 1
      const sIdx = (N - 3 - gridSlot * 3) % N;
      const s = this.track.samples[sIdx];
      const lane = (gridSlot % 2 === 0 ? -2.6 : 2.6);
      rival.x = s.point.x + s.right.x * lane;
      rival.z = s.point.z + s.right.z * lane;
      rival.yaw = Math.atan2(-s.tangent.x, -s.tangent.z);
      rival.speed = 0;
      rival.laneOffset = lane;
      rival.targetLaneOffset = lane;
      rival.sampleIndex = sIdx;
      rival.t = s.t;
      rival.lap = 1;
      rival.passedHalf = false;
      rival.totalProgress = -((N - sIdx) / N);
      this.syncCarTransform(rival.rig, rival.x, rival.z, rival.yaw, 0, 0, false, false);
    });
  }

  public setLivery(livery: LiveryOption): void {
    this.selectedLivery = livery;
    this.playerRig.bodyPaintMat.color.setHex(livery.primary);
    this.playerRig.accentPaintMat.color.setHex(livery.accent);
  }

  public startRace(): void {
    this.audio.init();
    this.resetRacePositions();
    this.gameState = 'countdown';
    this.countdownTimer = 3.2;
    this.lastCountdownInt = 4;
    this.updateGantryLights(3);
    this.emitHudSnapshot();
  }

  public togglePause(): void {
    if (this.gameState === 'playing') {
      this.gameState = 'paused';
      this.audio.updateTelemetry(false, 0, false, 0, false);
      this.emitHudSnapshot();
    } else if (this.gameState === 'paused') {
      this.gameState = 'playing';
      this.emitHudSnapshot();
    }
  }

  public returnToTitle(): void {
    this.gameState = 'title';
    this.resetRacePositions();
    this.audio.updateTelemetry(false, 0, false, 0, false);
    this.updateGantryLights(0);
    this.emitHudSnapshot();
  }

  public cycleCamera(): void {
    const order: CameraMode[] = ['chase', 'hood', 'far'];
    const next = order[(order.indexOf(this.cameraMode) + 1) % order.length];
    this.cameraMode = next;
    this.emitHudSnapshot();
  }

  public setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  public isMuted(): boolean {
    return this.audio.isMuted();
  }

  public setTouchInput(control: keyof typeof this.touchState, pressed: boolean): void {
    this.touchState[control] = pressed;
  }

  private recoverToTrack(): void {
    if (this.gameState !== 'playing') return;
    const s = this.track.samples[this.playerSampleIdx];
    this.px = s.point.x;
    this.pz = s.point.z;
    this.pyaw = Math.atan2(-s.tangent.x, -s.tangent.z);
    this.pspeed = Math.max(18, this.pspeed * 0.5);
    this.lateralVel = 0;
  }

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }

    const wasHeld = this.heldKeys.has(e.code);
    this.heldKeys.add(e.code);

    // Edge-triggered actions (justPressed)
    if (!wasHeld) {
      if (e.code === 'Escape') {
        if (this.gameState === 'playing' || this.gameState === 'paused') {
          this.togglePause();
        }
      } else if (e.code === 'KeyC') {
        if (this.gameState === 'playing' || this.gameState === 'countdown') {
          this.cycleCamera();
        }
      } else if (e.code === 'KeyR') {
        this.recoverToTrack();
      } else if (e.code === 'Enter' || e.code === 'Space') {
        if (this.gameState === 'title' || this.gameState === 'finished') {
          this.startRace();
        }
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private handleWindowBlur = (): void => {
    this.heldKeys.clear();
    this.touchState.left = false;
    this.touchState.right = false;
    this.touchState.throttle = false;
    this.touchState.brake = false;
    this.touchState.nitro = false;
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.handleWindowBlur();
      if (this.gameState === 'playing') {
        this.togglePause();
      }
    }
  };

  private handleResize = (): void => {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  };

  private startLoop(): void {
    const afterDraw = (cb: () => void) => {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    };

    const tick = () => {
      if (this.disposed) return;
      const now = performance.now();
      const rawDt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      const dt = Math.min(rawDt, 0.05);

      this.update(dt);
      if (this.isSoftwareGl) {
        this.renderer.render(this.scene, this.camera);
        afterDraw(tick);
      } else {
        this.composer.render();
        this.frameId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      afterDraw(tick);
    } else {
      this.frameId = requestAnimationFrame(tick);
    }
  }

  private update(dt: number): void {
    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      this.updateParticles(dt * 0.25);
      return;
    }

    if (this.gameState === 'title') {
      this.titleOrbitAngle += dt * 0.22;
      this.updateTitleCamera(dt);
      this.updateParticles(dt);
      return;
    }

    if (this.gameState === 'paused') {
      return;
    }

    if (this.gameState === 'countdown') {
      this.countdownTimer -= dt;
      const ceilVal = Math.max(0, Math.ceil(this.countdownTimer));
      if (ceilVal !== this.lastCountdownInt && ceilVal <= 3) {
        this.lastCountdownInt = ceilVal;
        this.audio.playCountdownBeep(ceilVal === 0);
        this.updateGantryLights(ceilVal);
        this.emitHudSnapshot();
      }
      if (this.countdownTimer <= 0) {
        this.gameState = 'playing';
        this.emitHudSnapshot();
      }
      this.updateGameplayCamera(dt);
      return;
    }

    if (this.gameState === 'playing') {
      this.currentLapMs += dt * 1000;
      this.totalTimeMs += dt * 1000;
      this.updatePlayerPhysics(dt);
      this.updateRivals(dt);
      this.resolveCarCollisions();
    } else if (this.gameState === 'finished') {
      // Coast car gently after finish
      this.pspeed = THREE.MathUtils.damp(this.pspeed, 24, 1.5, dt);
      this.updateRivals(dt);
      this.audio.updateTelemetry(false, 0, false, 0, false);
    }

    this.updateParticles(dt);
    this.updateGameplayCamera(dt);

    this.hudEmitAccum += dt;
    if (this.hudEmitAccum >= 0.05) {
      this.hudEmitAccum = 0;
      this.emitHudSnapshot();
    }
  }

  private updateGantryLights(countdownVal: number): void {
    const lights = this.track.countdownLights;
    if (lights.length < 3) return;
    if (countdownVal === 3) {
      lights[0].color.setHex(0xef4444);
      lights[1].color.setHex(0x1e293b);
      lights[2].color.setHex(0x1e293b);
    } else if (countdownVal === 2) {
      lights[0].color.setHex(0xef4444);
      lights[1].color.setHex(0xf59e0b);
      lights[2].color.setHex(0x1e293b);
    } else if (countdownVal === 1) {
      lights[0].color.setHex(0xef4444);
      lights[1].color.setHex(0xf59e0b);
      lights[2].color.setHex(0xef4444);
    } else {
      lights[0].color.setHex(0x10b981);
      lights[1].color.setHex(0x10b981);
      lights[2].color.setHex(0x10b981);
    }
  }

  private updatePlayerPhysics(dt: number): void {
    const throttle = this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp') || this.touchState.throttle;
    const brake = this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown') || this.touchState.brake;
    const steerLeft = this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft') || this.touchState.left;
    const steerRight = this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight') || this.touchState.right;
    const wantBoost = this.heldKeys.has('Space') || this.heldKeys.has('ShiftLeft') || this.touchState.nitro;

    // Track query
    const trackInfo = this.track.getTrackInfo(this.px, this.pz, this.playerSampleIdx);
    this.playerSampleIdx = trackInfo.sampleIndex;
    this.playerT = trackInfo.t;
    this.offTrack = trackInfo.distanceFromCenter > TRACK_HALF_WIDTH;

    // Check boost pads
    for (let i = 0; i < this.track.boostPads.length; i++) {
      const pad = this.track.boostPads[i];
      const dx = this.px - pad.position.x;
      const dz = this.pz - pad.position.z;
      if (dx * dx + dz * dz < 11.5) {
        this.nitro = Math.min(100, this.nitro + 35 * dt * 4);
        this.pspeed = Math.max(this.pspeed, 82);
      }
    }

    // Nitro boost logic
    this.boostActive = wantBoost && this.nitro > 1 && throttle;
    if (this.boostActive) {
      this.nitro = Math.max(0, this.nitro - 26 * dt);
    } else {
      this.nitro = Math.min(100, this.nitro + 4.5 * dt);
    }

    // Longitudinal acceleration & braking
    const maxSpeed = this.boostActive ? 92 : this.offTrack ? 44 : 76;
    const accelRate = this.boostActive ? 48 : 31;

    if (throttle) {
      if (this.pspeed < maxSpeed) {
        this.pspeed += accelRate * dt;
      } else {
        this.pspeed = THREE.MathUtils.damp(this.pspeed, maxSpeed, 3.0, dt);
      }
    } else if (brake) {
      if (this.pspeed > 0) {
        this.pspeed -= 52 * dt;
      } else {
        this.pspeed = Math.max(-22, this.pspeed - 24 * dt);
      }
    } else {
      // Natural rolling resistance + aero drag
      const drag = this.offTrack ? 3.2 : 0.85;
      this.pspeed = THREE.MathUtils.damp(this.pspeed, 0, drag, dt);
    }

    // Steering with speed-sensitive curve
    const targetSteer = (steerLeft ? 1 : 0) - (steerRight ? 1 : 0);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, targetSteer * 0.52, 12, dt);

    const speedFactor = Math.min(1, Math.abs(this.pspeed) / 14);
    const highSpeedStability = 1 - Math.min(0.42, (Math.abs(this.pspeed) / 92) * 0.42);
    const reverseSign = this.pspeed >= -0.5 ? 1 : -1;
    const yawRate = this.steerAngle * 2.55 * speedFactor * highSpeedStability * reverseSign;
    this.pyaw += yawRate * dt;

    // Forward & right vectors
    _forward.set(-Math.sin(this.pyaw), 0, -Math.cos(this.pyaw));
    _right.set(Math.cos(this.pyaw), 0, -Math.sin(this.pyaw));

    // Subtle lateral drift/slip on sharp high-speed turns
    const slipTarget = -this.steerAngle * Math.abs(this.pspeed) * 0.14;
    this.lateralVel = THREE.MathUtils.damp(this.lateralVel, slipTarget, this.offTrack ? 4.5 : 8.5, dt);

    this.px += (_forward.x * this.pspeed + _right.x * this.lateralVel) * dt;
    this.pz += (_forward.z * this.pspeed + _right.z * this.lateralVel) * dt;

    // Guardrail barrier collision & bounce
    const postInfo = this.track.getTrackInfo(this.px, this.pz, this.playerSampleIdx);
    if (postInfo.distanceFromCenter > BARRIER_HALF_WIDTH - 1.05) {
      const sign = postInfo.signedOffset >= 0 ? 1 : -1;
      const clampedOffset = sign * (BARRIER_HALF_WIDTH - 1.05);
      this.px = postInfo.point.x + postInfo.right.x * clampedOffset;
      this.pz = postInfo.point.z + postInfo.right.z * clampedOffset;

      // Align yaw slightly toward track tangent & apply impact feedback
      const trackYaw = Math.atan2(-postInfo.tangent.x, -postInfo.tangent.z);
      const yawDiff = Math.atan2(Math.sin(trackYaw - this.pyaw), Math.cos(trackYaw - this.pyaw));
      this.pyaw += yawDiff * 0.45;

      if (Math.abs(this.pspeed) > 22) {
        this.shakeIntensity = Math.min(0.65, Math.abs(this.pspeed) / 110);
        this.hitstopTimer = 0.035;
        this.audio.playImpact(Math.abs(this.pspeed) / 75);
        this.spawnBurst(this.px, 0.5, this.pz, 14, 0xfbbf24);
      }
      this.pspeed *= 0.72;
    }

    // Wrong-way detection
    const dotForward = _forward.x * postInfo.tangent.x + _forward.z * postInfo.tangent.z;
    this.wrongWay = this.pspeed > 10 && dotForward < -0.35;

    // Off-road dust particles & subtle rumble
    if (this.offTrack && Math.abs(this.pspeed) > 15) {
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.08);
      if (Math.random() < 0.45) {
        this.spawnBurst(this.px, 0.15, this.pz, 1, 0x78716c);
      }
    }

    // Nitro exhaust particles
    if (this.boostActive && Math.random() < 0.8) {
      this.spawnBurst(
        this.px - _forward.x * 2.2,
        0.32,
        this.pz - _forward.z * 2.2,
        1,
        0x38bdf8
      );
    }

    // Update lap & sector checkpoints
    this.updatePlayerLapProgress(postInfo.t);

    // Update 3D car rig & audio
    this.wheelSpin -= this.pspeed * dt * 2.6;
    const bodyRoll = -this.steerAngle * Math.min(1, Math.abs(this.pspeed) / 50) * 0.09;
    this.syncCarTransform(
      this.playerRig,
      this.px,
      this.pz,
      this.pyaw,
      this.steerAngle,
      bodyRoll,
      brake,
      this.boostActive
    );

    const speedKmh = Math.abs(this.pspeed) * 3.6;
    const { rpmNormalized } = this.computeGearAndRpm(speedKmh);
    const slipAmount = Math.abs(this.steerAngle) * (Math.abs(this.pspeed) / 75);
    this.audio.updateTelemetry(true, rpmNormalized, throttle, slipAmount, this.boostActive);
  }

  private updatePlayerLapProgress(t: number): void {
    if (t > 0.28 && t < 0.55) {
      this.passedSector1 = true;
    }
    if (this.passedSector1 && t > 0.62 && t < 0.88) {
      this.passedSector2 = true;
    }

    // Crossed start/finish line after completing both sectors
    if (this.passedSector1 && this.passedSector2 && t < 0.12) {
      if (this.bestLapMs === null || this.currentLapMs < this.bestLapMs) {
        this.bestLapMs = this.currentLapMs;
      }
      this.currentLapMs = 0;
      this.passedSector1 = false;
      this.passedSector2 = false;

      if (this.playerLap >= this.totalLaps) {
        this.playerLap = this.totalLaps;
        this.playerTotalProgress = this.totalLaps + 0.01;
        this.gameState = 'finished';
        this.audio.playLapChime(true);
        this.emitHudSnapshot();
        return;
      } else {
        this.playerLap += 1;
        this.audio.playLapChime(false);
      }
    }

    const effectiveT = !this.passedSector1 && t > 0.85 ? t - 1 : t;
    this.playerTotalProgress = (this.playerLap - 1) + effectiveT;
  }

  private updateRivals(dt: number): void {
    const N = this.track.samples.length;

    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];

      // Subtle rubber-banding so races stay competitive
      const progressDiff = this.playerTotalProgress - r.totalProgress;
      const rubberBand = THREE.MathUtils.clamp(progressDiff * 18, -5.5, 6.5);
      const targetSpeed = r.baseMaxSpeed + rubberBand;
      r.speed = THREE.MathUtils.damp(r.speed, targetSpeed, 1.8, dt);

      // Periodic lane changes
      r.laneTimer -= dt;
      if (r.laneTimer <= 0) {
        r.laneTimer = 2.2 + Math.random() * 3.0;
        r.targetLaneOffset = (Math.random() - 0.5) * (TRACK_HALF_WIDTH * 1.25);
      }
      r.laneOffset = THREE.MathUtils.damp(r.laneOffset, r.targetLaneOffset, 2.2, dt);

      // Advance along track spline
      const deltaT = (r.speed * dt) / this.track.totalLength;
      const prevT = r.t;
      r.t = (r.t + deltaT) % 1;
      if (r.t > 0.4 && r.t < 0.7) r.passedHalf = true;
      if (r.passedHalf && prevT > 0.85 && r.t < 0.15) {
        r.lap += 1;
        r.passedHalf = false;
      }
      r.totalProgress = (r.lap - 1) + r.t;

      const sIdx = Math.floor(r.t * N) % N;
      r.sampleIndex = sIdx;
      const s = this.track.samples[sIdx];

      r.x = s.point.x + s.right.x * r.laneOffset;
      r.z = s.point.z + s.right.z * r.laneOffset;
      const targetYaw = Math.atan2(-s.tangent.x, -s.tangent.z);
      const yawDiff = Math.atan2(Math.sin(targetYaw - r.yaw), Math.cos(targetYaw - r.yaw));
      r.yaw += yawDiff * Math.min(1, dt * 8);

      this.syncCarTransform(r.rig, r.x, r.z, r.yaw, yawDiff * 0.6, 0, false, false);
    }
  }

  private resolveCarCollisions(): void {
    const minDist = 2.45;
    const minDistSq = minDist * minDist;

    for (let i = 0; i < this.rivals.length; i++) {
      const r = this.rivals[i];
      const dx = this.px - r.x;
      const dz = this.pz - r.z;
      const dSq = dx * dx + dz * dz;

      if (dSq < minDistSq && dSq > 0.0001) {
        const dist = Math.sqrt(dSq);
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minDist - dist;

        this.px += nx * overlap * 0.65;
        this.pz += nz * overlap * 0.65;
        r.x -= nx * overlap * 0.35;
        r.z -= nz * overlap * 0.35;

        this.pspeed *= 0.88;
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.38);
        this.hitstopTimer = 0.03;
        this.audio.playImpact(0.85);
        this.spawnBurst((this.px + r.x) * 0.5, 0.55, (this.pz + r.z) * 0.5, 10, 0xf8fafc);
      }
    }
  }

  private syncCarTransform(
    rig: RaceCarRig,
    x: number,
    z: number,
    yaw: number,
    steer: number,
    roll: number,
    braking: boolean,
    boosting: boolean
  ): void {
    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = yaw;
    rig.bodyTiltGroup.rotation.z = roll;

    rig.frontLeftSteer.rotation.y = steer;
    rig.frontRightSteer.rotation.y = steer;

    for (let i = 0; i < rig.wheelSpinMeshes.length; i++) {
      rig.wheelSpinMeshes[i].rotation.x = this.wheelSpin;
    }

    rig.brakeLightMat.emissiveIntensity = braking ? 4.2 : 1.2;

    rig.flameLeft.visible = boosting;
    rig.flameRight.visible = boosting;
    if (boosting) {
      const flicker = 0.8 + Math.random() * 0.55;
      rig.flameLeft.scale.set(1, 1, flicker);
      rig.flameRight.scale.set(1, 1, flicker);
    }
  }

  private spawnBurst(x: number, y: number, z: number, count: number, color: number): void {
    let spawned = 0;
    for (let i = 0; i < this.maxParticles && spawned < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x + (Math.random() - 0.5) * 0.4;
        p.y = y + Math.random() * 0.25;
        p.z = z + (Math.random() - 0.5) * 0.4;
        p.vx = (Math.random() - 0.5) * 6;
        p.vy = 1.5 + Math.random() * 4;
        p.vz = (Math.random() - 0.5) * 6;
        p.life = 0;
        p.maxLife = 0.28 + Math.random() * 0.25;
        p.size = 0.7 + Math.random() * 0.9;
        p.color = color;
        spawned++;
      }
    }
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      dirty = true;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.active = false;
        _dummy.position.set(0, -50, 0);
        _dummy.scale.set(0, 0, 0);
        _dummy.updateMatrix();
        this.particleMesh.setMatrixAt(i, _dummy.matrix);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 9.8 * dt;

      const s = p.size * (1 - p.life / p.maxLife);
      _dummy.position.set(p.x, p.y, p.z);
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      this.particleMesh.setMatrixAt(i, _dummy.matrix);
      this.particleMesh.setColorAt(i, _pColor.setHex(p.color));
    }

    if (dirty) {
      this.particleMesh.instanceMatrix.needsUpdate = true;
      if (this.particleMesh.instanceColor) {
        this.particleMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  private updateTitleCamera(dt: number): void {
    const radius = 8.2;
    const camX = this.px + Math.sin(this.titleOrbitAngle) * radius;
    const camZ = this.pz + Math.cos(this.titleOrbitAngle) * radius;
    _camPos.set(camX, 2.65, camZ);
    _camTarget.set(this.px, 0.85, this.pz);

    this.camera.position.lerp(_camPos, Math.min(1, dt * 6));
    this.camera.lookAt(_camTarget);
    if (Math.abs(this.camera.fov - 52) > 0.1) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, 52, 5, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateGameplayCamera(dt: number): void {
    _forward.set(-Math.sin(this.pyaw), 0, -Math.cos(this.pyaw));

    if (this.cameraMode === 'hood') {
      _camPos.set(this.px - _forward.x * 0.25, 1.28, this.pz - _forward.z * 0.25);
      _camTarget.set(this.px - _forward.x * 24, 1.05, this.pz - _forward.z * 24);
      this.camera.position.copy(_camPos);
      this.camera.lookAt(_camTarget);
    } else {
      const distBack = this.cameraMode === 'far' ? 9.6 : 6.6;
      const heightUp = this.cameraMode === 'far' ? 3.8 : 2.55;

      _camPos.set(
        this.px - _forward.x * distBack,
        heightUp,
        this.pz - _forward.z * distBack
      );
      _camTarget.set(
        this.px + _forward.x * 8.5,
        1.15,
        this.pz + _forward.z * 8.5
      );

      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, _camPos.x, 11, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, _camPos.y, 11, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, _camPos.z, 11, dt);

      // Decaying camera shake on impacts
      if (this.shakeIntensity > 0.005) {
        this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
        this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity * 0.7;
        this.shakeIntensity = THREE.MathUtils.damp(this.shakeIntensity, 0, 12, dt);
      }

      this.camera.lookAt(_camTarget);

      // Subtle camera roll into turns
      const targetRoll = -this.steerAngle * Math.min(1, Math.abs(this.pspeed) / 60) * 0.045;
      this.camRoll = THREE.MathUtils.damp(this.camRoll, targetRoll, 8, dt);
      this.camera.rotation.z += this.camRoll;
    }

    // Dynamic FOV widening with speed & nitro boost
    const speedNorm = Math.min(1, Math.abs(this.pspeed) / 90);
    const targetFov = 62 + speedNorm * 14 + (this.boostActive ? 5 : 0);
    this.currentFov = THREE.MathUtils.damp(this.currentFov, targetFov, 6, dt);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.updateMotionBlurUniforms(dt);
  }

  private updateMotionBlurUniforms(dt: number): void {
    if (!this.motionBlurPass) return;

    const safeDt = Math.max(dt, 0.001);
    // 1. Vehicle speed radial streak component (kicks in smoothly above ~85 km/h)
    const speedKmh = Math.abs(this.pspeed) * 3.6;
    const speedFactor = THREE.MathUtils.clamp((speedKmh - 85) / 215, 0, 1);
    const targetSpeedBlur =
      (this.gameState === 'playing' || this.gameState === 'finished')
        ? speedFactor * speedFactor * 0.036 + (this.boostActive ? 0.016 : 0)
        : 0;
    this.smoothedSpeedBlur = THREE.MathUtils.damp(this.smoothedSpeedBlur, targetSpeedBlur, 10, dt);

    // 2. Camera movement & angular yaw velocity projected to screen space
    _vecA.subVectors(this.camera.position, this.prevCamPos);
    const camRight = _right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const camUp = _vecB.set(0, 1, 0).applyQuaternion(this.camera.quaternion);

    const lateralMove = _vecA.dot(camRight) / safeDt;
    const verticalMove = _vecA.dot(camUp) / safeDt;

    const currentYaw = Math.atan2(
      -this.camera.matrixWorld.elements[8],
      -this.camera.matrixWorld.elements[10]
    );
    const yawDelta = Math.atan2(
      Math.sin(currentYaw - this.prevCamYaw),
      Math.cos(currentYaw - this.prevCamYaw)
    );
    const yawRate = yawDelta / safeDt;

    const rawDeltaX = THREE.MathUtils.clamp(-yawRate * 0.0085 - lateralMove * 0.00022, -0.025, 0.025);
    const rawDeltaY = THREE.MathUtils.clamp(-verticalMove * 0.00022, -0.018, 0.018);

    const activeScale = this.gameState === 'playing' ? 1 : 0;
    this.smoothedCamDelta.x = THREE.MathUtils.damp(this.smoothedCamDelta.x, rawDeltaX * activeScale, 12, dt);
    this.smoothedCamDelta.y = THREE.MathUtils.damp(this.smoothedCamDelta.y, rawDeltaY * activeScale, 12, dt);

    this.motionBlurPass.uniforms.uSpeedBlur.value = this.smoothedSpeedBlur;
    this.motionBlurPass.uniforms.uCameraDelta.value.copy(this.smoothedCamDelta);
    this.motionBlurPass.uniforms.uChromatic.value =
      this.smoothedSpeedBlur * 0.14 + (this.boostActive ? 0.0022 : 0);

    this.prevCamPos.copy(this.camera.position);
    this.prevCamYaw = currentYaw;
  }

  private computeGearAndRpm(speedKmh: number): { gear: number; rpmNormalized: number } {
    if (speedKmh < 5) return { gear: 1, rpmNormalized: 0.18 };
    const thresholds = [0, 52, 98, 145, 195, 245, 340];
    let gear = 1;
    for (let g = 1; g <= 6; g++) {
      if (speedKmh >= thresholds[g - 1]) {
        gear = g;
      }
    }
    const low = thresholds[gear - 1];
    const high = thresholds[gear];
    const rpmNormalized = THREE.MathUtils.clamp((speedKmh - low) / (high - low), 0.22, 0.98);
    return { gear, rpmNormalized };
  }

  private computePlayerPosition(): number {
    let pos = 1;
    for (let i = 0; i < this.rivals.length; i++) {
      if (this.rivals[i].totalProgress > this.playerTotalProgress) {
        pos++;
      }
    }
    return pos;
  }

  private emitHudSnapshot(): void {
    const speedKmh = Math.round(Math.abs(this.pspeed) * 3.6);
    const { gear, rpmNormalized } = this.computeGearAndRpm(speedKmh);

    // Compute normalized minimap coordinates for player & rivals
    const minimapCars = [
      ...this.rivals.map((r) => ({
        x: this.track.minimapTrack[Math.floor(r.t * 90) % 90].x,
        z: this.track.minimapTrack[Math.floor(r.t * 90) % 90].z,
        isPlayer: false,
        color: r.colorHex,
      })),
      {
        x: this.track.minimapTrack[Math.floor(this.playerT * 90) % 90].x,
        z: this.track.minimapTrack[Math.floor(this.playerT * 90) % 90].z,
        isPlayer: true,
        color: this.selectedLivery.hex,
      },
    ];

    this.onHudUpdate({
      gameState: this.gameState,
      countdownValue: Math.max(0, Math.ceil(this.countdownTimer)),
      speedKmh,
      gear,
      rpmNormalized,
      nitro: Math.round(this.nitro),
      lap: this.playerLap,
      totalLaps: this.totalLaps,
      position: this.computePlayerPosition(),
      totalCars: this.rivals.length + 1,
      currentLapMs: this.currentLapMs,
      bestLapMs: this.bestLapMs,
      totalTimeMs: this.totalTimeMs,
      cameraMode: this.cameraMode,
      offTrack: this.offTrack,
      boostActive: this.boostActive,
      wrongWay: this.wrongWay,
      minimapCars,
      minimapTrack: this.track.minimapTrack,
    });
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    this.audio.dispose();
    this.textures.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
