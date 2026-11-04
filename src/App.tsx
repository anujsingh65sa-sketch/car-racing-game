import React, { useEffect, useRef, useState } from 'react';
import { Camera, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { RaceEngine } from './game/RaceEngine';
import { HudSnapshot, LIVERY_OPTIONS, LiveryOption } from './game/types';

function formatLapTime(ms: number): string {
  const totalSeconds = Math.max(0, ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function formatOrdinal(pos: number): { num: string; suffix: string } {
  const suffixes = ['TH', 'ST', 'ND', 'RD'];
  const v = pos % 100;
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0];
  return { num: String(pos), suffix };
}

const INITIAL_HUD: HudSnapshot = {
  gameState: 'title',
  countdownValue: 3,
  speedKmh: 0,
  gear: 1,
  rpmNormalized: 0.18,
  nitro: 100,
  lap: 1,
  totalLaps: 3,
  position: 6,
  totalCars: 6,
  currentLapMs: 0,
  bestLapMs: null,
  totalTimeMs: 0,
  cameraMode: 'chase',
  offTrack: false,
  boostActive: false,
  wrongWay: false,
  minimapCars: [],
  minimapTrack: [],
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RaceEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [selectedLivery, setSelectedLivery] = useState<LiveryOption>(LIVERY_OPTIONS[0]);

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new RaceEngine(mountRef.current, (snapshot) => {
      setHud(snapshot);
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectLivery = (livery: LiveryOption) => {
    setSelectedLivery(livery);
    engineRef.current?.setLivery(livery);
  };

  const handleToggleMute = () => {
    if (!engineRef.current) return;
    const next = !muted;
    engineRef.current.setMuted(next);
    setMuted(next);
  };

  const handleStartRace = () => {
    engineRef.current?.startRace();
  };

  const handleTogglePause = () => {
    engineRef.current?.togglePause();
  };

  const handleReturnToTitle = () => {
    engineRef.current?.returnToTitle();
  };

  const handleCycleCamera = () => {
    engineRef.current?.cycleCamera();
  };

  const posFormatted = formatOrdinal(hud.position);
  const minimapPointsStr =
    hud.minimapTrack.length > 0
      ? hud.minimapTrack.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ')
      : '';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0B0E14] select-none">
      {/* Isolated 3D WebGL Canvas Mount */}
      <div ref={mountRef} className="fixed inset-0 w-full h-full" />

      {/* TITLE SCREEN OVERLAY */}
      {hud.gameState === 'title' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-6 sm:p-10">
          {/* Top-Right Mute Control */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleToggleMute}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-lg bg-[#0B0E14]/80 border border-white/15 text-slate-200 hover:text-white hover:border-white/30 transition-colors cursor-pointer"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          {/* Center-Left Bespoke SVG Title Lockup & Start CTA */}
          <div className="max-w-xl my-auto">
            <svg
              viewBox="0 0 420 96"
              className="w-full max-w-[380px] h-auto mb-5"
              role="img"
              aria-label="VELOCE GP"
            >
              <defs>
                <linearGradient id="veloceGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#F8FAFC" />
                  <stop offset="72%" stopColor="#E2E8F0" />
                  <stop offset="100%" stopColor="#F59E0B" />
                </linearGradient>
              </defs>
              {/* Racing Apex Accent Slash */}
              <polygon points="0,18 28,18 14,76 0,76" fill="#EF4444" />
              <polygon points="34,18 46,18 32,76 20,76" fill="#F59E0B" />
              <text
                x="60"
                y="68"
                fill="url(#veloceGrad)"
                fontFamily="'Chakra Petch', sans-serif"
                fontWeight="700"
                fontStyle="italic"
                fontSize="58"
                letterSpacing="3"
              >
                VELOCE
              </text>
              <text
                x="306"
                y="68"
                fill="#F59E0B"
                fontFamily="'Chakra Petch', sans-serif"
                fontWeight="700"
                fontStyle="italic"
                fontSize="58"
                letterSpacing="2"
              >
                GP
              </text>
            </svg>

            {/* Livery Swatches */}
            <div className="pointer-events-auto flex items-center gap-3 mb-7">
              <span className="text-xs font-medium text-slate-300 mr-1">Livery</span>
              {LIVERY_OPTIONS.map((livery) => {
                const active = selectedLivery.id === livery.id;
                return (
                  <button
                    key={livery.id}
                    type="button"
                    onClick={() => handleSelectLivery(livery)}
                    aria-label={`Select ${livery.name} livery`}
                    title={livery.name}
                    className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${
                      active
                        ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0B0E14] scale-110'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: livery.hex }}
                  />
                );
              })}
            </div>

            {/* Primary Start CTA */}
            <div className="pointer-events-auto flex items-center gap-4">
              <button
                type="button"
                onClick={handleStartRace}
                className="font-display inline-flex items-center gap-3 px-8 py-3.5 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] text-[#0B0E14] font-bold text-lg tracking-wider uppercase transition-colors cursor-pointer shadow-lg"
              >
                <Play className="w-5 h-5 fill-current" />
                Start Race
              </button>
            </div>
          </div>

          {/* Single Flat Control-Hint Line */}
          <div className="text-xs sm:text-sm text-slate-300/90 font-medium tracking-wide">
            WASD / Arrows Drive <span className="mx-2 text-slate-500">·</span> Space Nitro{' '}
            <span className="mx-2 text-slate-500">·</span> C Camera{' '}
            <span className="mx-2 text-slate-500">·</span> R Recover{' '}
            <span className="mx-2 text-slate-500">·</span> Esc Pause
          </div>
        </div>
      )}

      {/* ACTIVE RACING HUD (COUNTDOWN & PLAYING) */}
      {(hud.gameState === 'countdown' || hud.gameState === 'playing') && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-4 sm:p-6">
          {/* Top Perimeter Row */}
          <div className="flex items-start justify-between gap-4">
            {/* Top-Left: Position, Lap & Timers */}
            <div className="bg-[#0B0E14]/82 border border-white/12 rounded-lg px-4 py-2.5 flex items-center gap-5">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                  Pos
                </div>
                <div className="font-display text-2xl sm:text-3xl font-bold text-white leading-none tabular-nums">
                  {posFormatted.num}
                  <span className="text-sm text-[#F59E0B] ml-0.5">{posFormatted.suffix}</span>
                  <span className="text-xs text-slate-400 font-normal ml-1">/{hud.totalCars}</span>
                </div>
              </div>

              <div className="h-8 w-px bg-white/10" />

              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                  Lap
                </div>
                <div className="font-display text-2xl sm:text-3xl font-bold text-white leading-none tabular-nums">
                  {hud.lap}
                  <span className="text-sm text-slate-400 font-normal">/{hud.totalLaps}</span>
                </div>
              </div>

              <div className="hidden sm:block h-8 w-px bg-white/10" />

              <div className="hidden sm:block">
                <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                  Time
                </div>
                <div className="font-mono-tabular text-base font-bold text-slate-100 leading-tight">
                  {formatLapTime(hud.currentLapMs)}
                </div>
                {hud.bestLapMs !== null && (
                  <div className="font-mono-tabular text-[11px] text-[#06B6D4]">
                    Best {formatLapTime(hud.bestLapMs)}
                  </div>
                )}
              </div>
            </div>

            {/* Top-Right: Camera, Mute & Pause Controls */}
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleCycleCamera}
                title="Switch Camera (C)"
                className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-[#0B0E14]/82 border border-white/12 text-xs font-medium text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
              >
                <Camera className="w-4 h-4 text-[#F59E0B]" />
                <span className="hidden sm:inline capitalize">{hud.cameraMode}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#0B0E14]/82 border border-white/12 text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={handleTogglePause}
                aria-label="Pause race"
                className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#0B0E14]/82 border border-white/12 text-slate-200 hover:text-white hover:border-white/25 transition-colors cursor-pointer"
              >
                <Pause className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center Countdown or Wrong-Way Indicator */}
          <div className="my-auto flex flex-col items-center justify-center">
            {hud.gameState === 'countdown' && (
              <div className="font-display text-7xl sm:text-8xl font-bold italic tracking-wider text-white drop-shadow-[0_4px_18px_rgba(0,0,0,0.85)]">
                {hud.countdownValue > 0 ? (
                  hud.countdownValue
                ) : (
                  <span className="text-[#10B981]">GO!</span>
                )}
              </div>
            )}

            {hud.gameState === 'playing' && hud.wrongWay && (
              <div className="bg-[#DC2626]/90 border border-white/20 rounded-lg px-5 py-2 font-display text-xl font-bold tracking-wider uppercase text-white">
                Wrong Way
              </div>
            )}
          </div>

          {/* Bottom Perimeter Row: Minimap & Speedometer/Nitro */}
          <div className="flex items-end justify-between gap-4">
            {/* Bottom-Left: Circuit Radar Minimap */}
            <div className="hidden sm:block bg-[#0B0E14]/82 border border-white/12 rounded-lg p-2.5 w-32 h-32">
              <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
                {minimapPointsStr && (
                  <polyline
                    points={minimapPointsStr}
                    fill="none"
                    stroke="rgba(148, 163, 184, 0.45)"
                    strokeWidth="4.5"
                    strokeLinejoin="round"
                  />
                )}
                {hud.minimapCars.map((car, idx) => (
                  <circle
                    key={idx}
                    cx={car.x}
                    cy={car.z}
                    r={car.isPlayer ? 4.2 : 2.8}
                    fill={car.isPlayer ? '#F59E0B' : '#94A3B8'}
                    stroke="#0B0E14"
                    strokeWidth="1"
                  />
                ))}
              </svg>
            </div>

            {/* Mobile Touch Controls (visible on small screens) */}
            <div className="pointer-events-auto flex md:hidden items-center gap-2">
              <button
                type="button"
                onPointerDown={() => engineRef.current?.setTouchInput('left', true)}
                onPointerUp={() => engineRef.current?.setTouchInput('left', false)}
                onPointerLeave={() => engineRef.current?.setTouchInput('left', false)}
                className="w-14 h-14 rounded-lg bg-[#0B0E14]/85 border border-white/15 text-white font-display font-bold text-lg active:bg-white/20"
              >
                L
              </button>
              <button
                type="button"
                onPointerDown={() => engineRef.current?.setTouchInput('right', true)}
                onPointerUp={() => engineRef.current?.setTouchInput('right', false)}
                onPointerLeave={() => engineRef.current?.setTouchInput('right', false)}
                className="w-14 h-14 rounded-lg bg-[#0B0E14]/85 border border-white/15 text-white font-display font-bold text-lg active:bg-white/20"
              >
                R
              </button>
            </div>

            {/* Bottom-Right: Speedometer, Gear & Nitro */}
            <div className="bg-[#0B0E14]/82 border border-white/12 rounded-lg px-4 py-3 min-w-[190px] sm:min-w-[220px]">
              <div className="flex items-baseline justify-between gap-4">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono-tabular text-3xl sm:text-4xl font-bold text-white leading-none">
                    {hud.speedKmh}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    km/h
                  </span>
                </div>
                <div className="font-display text-lg font-bold text-[#F59E0B] tabular-nums">
                  G{hud.gear}
                </div>
              </div>

              {/* RPM Bar */}
              <div className="mt-2.5 h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{
                    width: `${Math.round(hud.rpmNormalized * 100)}%`,
                    backgroundColor: hud.rpmNormalized > 0.85 ? '#EF4444' : '#F59E0B',
                  }}
                />
              </div>

              {/* Nitro Boost Bar */}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#06B6D4]">
                  Nitro
                </span>
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#06B6D4] transition-all duration-75"
                    style={{ width: `${hud.nitro}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Mobile Right Touch Pedals */}
            <div className="pointer-events-auto flex md:hidden items-center gap-2">
              <button
                type="button"
                onPointerDown={() => engineRef.current?.setTouchInput('nitro', true)}
                onPointerUp={() => engineRef.current?.setTouchInput('nitro', false)}
                onPointerLeave={() => engineRef.current?.setTouchInput('nitro', false)}
                className="w-12 h-14 rounded-lg bg-[#06B6D4]/25 border border-[#06B6D4]/50 text-[#06B6D4] font-display font-bold text-xs"
              >
                NOS
              </button>
              <button
                type="button"
                onPointerDown={() => engineRef.current?.setTouchInput('throttle', true)}
                onPointerUp={() => engineRef.current?.setTouchInput('throttle', false)}
                onPointerLeave={() => engineRef.current?.setTouchInput('throttle', false)}
                className="w-14 h-14 rounded-lg bg-[#F59E0B]/90 text-[#0B0E14] font-display font-bold text-sm"
              >
                GAS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAUSE MODAL */}
      {hud.gameState === 'paused' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-[#0B0E14] border border-white/15 rounded-xl p-7 text-center shadow-2xl">
            <h2 className="font-display text-3xl font-bold uppercase tracking-wider text-white mb-6">
              Race Paused
            </h2>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleTogglePause}
                className="w-full py-3 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] text-[#0B0E14] font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleStartRace}
                className="w-full py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Restart Race
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                className="w-full py-3 rounded-lg border border-white/15 hover:border-white/30 text-slate-300 hover:text-white font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RACE FINISHED MODAL */}
      {hud.gameState === 'finished' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/65 p-4">
          <div className="w-full max-w-md bg-[#0B0E14] border border-white/15 rounded-xl p-7 text-center shadow-2xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-[#F59E0B] mb-1">
              Checkered Flag
            </div>
            <h2 className="font-display text-4xl font-bold uppercase tracking-wider text-white mb-6">
              Finished {posFormatted.num}
              {posFormatted.suffix}
            </h2>

            <div className="grid grid-cols-2 gap-4 py-4 px-4 mb-6 rounded-lg bg-slate-900/90 border border-white/10">
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Total Time</div>
                <div className="font-mono-tabular text-xl font-bold text-white mt-1">
                  {formatLapTime(hud.totalTimeMs)}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-400">Best Lap</div>
                <div className="font-mono-tabular text-xl font-bold text-[#06B6D4] mt-1">
                  {hud.bestLapMs !== null ? formatLapTime(hud.bestLapMs) : '--:--.--'}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleStartRace}
                className="flex-1 inline-flex items-center justify-center gap-2 py-3 px-5 rounded-lg bg-[#F59E0B] hover:bg-[#FBBF24] text-[#0B0E14] font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                Race Again
              </button>
              <button
                type="button"
                onClick={handleReturnToTitle}
                className="flex-1 py-3 px-5 rounded-lg border border-white/15 hover:border-white/30 text-slate-300 hover:text-white font-display font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Title Screen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
