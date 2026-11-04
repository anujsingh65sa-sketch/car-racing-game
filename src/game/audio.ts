export class RacingAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  private screechGain: GainNode | null = null;
  private boostGain: GainNode | null = null;
  private muted = false;
  private initialized = false;

  public init(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.35;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Dual-oscillator engine synth
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.value = 55;
      osc2.frequency.value = 110;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 240;
      filter.Q.value = 3.2;

      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(engGain);
      engGain.connect(master);

      osc1.start();
      osc2.start();

      this.engineOsc1 = osc1;
      this.engineOsc2 = osc2;
      this.engineFilter = filter;
      this.engineGain = engGain;

      // White noise buffer for tire screech & nitro whoosh
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      // Tire screech chain
      const screechSource = ctx.createBufferSource();
      screechSource.buffer = noiseBuffer;
      screechSource.loop = true;

      const screechFilter = ctx.createBiquadFilter();
      screechFilter.type = 'bandpass';
      screechFilter.frequency.value = 1150;
      screechFilter.Q.value = 6.5;

      const sGain = ctx.createGain();
      sGain.gain.value = 0;

      screechSource.connect(screechFilter);
      screechFilter.connect(sGain);
      sGain.connect(master);
      screechSource.start();
      this.screechGain = sGain;

      // Nitro boost chain
      const boostSource = ctx.createBufferSource();
      boostSource.buffer = noiseBuffer;
      boostSource.loop = true;

      const boostFilter = ctx.createBiquadFilter();
      boostFilter.type = 'bandpass';
      boostFilter.frequency.value = 520;
      boostFilter.Q.value = 1.8;

      const bGain = ctx.createGain();
      bGain.gain.value = 0;

      boostSource.connect(boostFilter);
      boostFilter.connect(bGain);
      bGain.connect(master);
      boostSource.start();
      this.boostGain = bGain;

      this.initialized = true;
    } catch {
      // Ignore audio errors if blocked by browser policy
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.35, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public updateTelemetry(
    active: boolean,
    rpmNormalized: number,
    throttle: boolean,
    slipAmount: number,
    boosting: boolean
  ): void {
    if (!this.initialized || !this.ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain) {
      return;
    }

    const now = this.ctx.currentTime;
    if (!active) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      if (this.screechGain) this.screechGain.gain.setTargetAtTime(0, now, 0.05);
      if (this.boostGain) this.boostGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const baseFreq = 44 + rpmNormalized * 118 + (boosting ? 26 : 0);
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.03);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.03);

    const cutoff = 210 + rpmNormalized * 1150 + (throttle ? 320 : 0) + (boosting ? 600 : 0);
    this.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.04);

    const targetEngGain = 0.22 + (throttle ? 0.12 : 0) + rpmNormalized * 0.1;
    this.engineGain.gain.setTargetAtTime(targetEngGain, now, 0.05);

    if (this.screechGain) {
      const targetScreech = Math.min(0.24, Math.max(0, (slipAmount - 0.28) * 0.45));
      this.screechGain.gain.setTargetAtTime(targetScreech, now, 0.04);
    }

    if (this.boostGain) {
      this.boostGain.gain.setTargetAtTime(boosting ? 0.28 : 0, now, 0.05);
    }
  }

  public playImpact(intensity = 1): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(125 * Math.min(1.4, Math.max(0.6, intensity)), now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.18);

    gain.gain.setValueAtTime(Math.min(0.65, 0.35 * intensity), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  public playCountdownBeep(isGo: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, now);

    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isGo ? 0.38 : 0.18));

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + (isGo ? 0.4 : 0.2));
  }

  public playLapChime(isFinish: boolean): void {
    if (!this.initialized || !this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = isFinish ? [523.25, 659.25, 783.99, 1046.5] : [587.33, 880];

    notes.forEach((freq, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const start = now + idx * 0.085;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.26, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.32);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + 0.34);
    });
  }

  public dispose(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.initialized = false;
  }
}
