export type GameState = 'title' | 'countdown' | 'playing' | 'paused' | 'finished';

export type CameraMode = 'chase' | 'hood' | 'far';

export interface LiveryOption {
  id: string;
  name: string;
  primary: number;
  accent: number;
  hex: string;
}

export const LIVERY_OPTIONS: LiveryOption[] = [
  { id: 'corsa', name: 'Corsa Red', primary: 0xdc2626, accent: 0xf8fafc, hex: '#DC2626' },
  { id: 'solar', name: 'Solar Amber', primary: 0xf59e0b, accent: 0x0f172a, hex: '#F59E0B' },
  { id: 'cobalt', name: 'Apex Cyan', primary: 0x0284c7, accent: 0x38bdf8, hex: '#0284C7' },
  { id: 'emerald', name: 'British Green', primary: 0x059669, accent: 0xfbbf24, hex: '#059669' },
];

export interface MinimapCar {
  x: number;
  z: number;
  isPlayer: boolean;
  color: string;
}

export interface HudSnapshot {
  gameState: GameState;
  countdownValue: number; // 3, 2, 1, 0 (GO!)
  speedKmh: number;
  gear: number;
  rpmNormalized: number; // 0..1
  nitro: number; // 0..100
  lap: number;
  totalLaps: number;
  position: number;
  totalCars: number;
  currentLapMs: number;
  bestLapMs: number | null;
  totalTimeMs: number;
  cameraMode: CameraMode;
  offTrack: boolean;
  boostActive: boolean;
  wrongWay: boolean;
  minimapCars: MinimapCar[];
  minimapTrack: Array<{ x: number; z: number }>;
}
