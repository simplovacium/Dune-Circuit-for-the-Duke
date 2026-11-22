export class RacingAudioEngine {
  private ctx: AudioContext | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private nitroGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;
  private tireGain: GainNode | null = null;
  private tireFilter: BiquadFilterNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private muted = false;
  private initialized = false;

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(mute ? 0 : 0.08, this.ctx.currentTime, 0.05);
    }
    if (this.ctx && this.nitroGain && mute) {
      this.nitroGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
    if (this.ctx && this.tireGain && mute) {
      this.tireGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
  }

  public unlock(): void {
    if (this.initialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }

    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      // Engine harmonic pair
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.value = 65;
      osc2.frequency.value = 130;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      filter.Q.value = 2.4;

      const eGain = ctx.createGain();
      eGain.gain.value = 0;

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(eGain);
      eGain.connect(ctx.destination);

      osc1.start();
      osc2.start();

      // Shared white noise buffer for tire scrub and nitro whoosh
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const nFilter = ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.value = 900;
      nFilter.Q.value = 1.2;

      const nGain = ctx.createGain();
      nGain.gain.value = 0;

      const tFilter = ctx.createBiquadFilter();
      tFilter.type = 'bandpass';
      tFilter.frequency.value = 1450;
      tFilter.Q.value = 3.5;

      const tGain = ctx.createGain();
      tGain.gain.value = 0;

      noise.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(ctx.destination);

      noise.connect(tFilter);
      tFilter.connect(tGain);
      tGain.connect(ctx.destination);

      noise.start();

      this.engineOsc1 = osc1;
      this.engineOsc2 = osc2;
      this.engineFilter = filter;
      this.engineGain = eGain;
      this.nitroFilter = nFilter;
      this.nitroGain = nGain;
      this.tireFilter = tFilter;
      this.tireGain = tGain;
      this.noiseSource = noise;
      this.initialized = true;
    } catch {
      // AudioContext blocked or unavailable
    }
  }

  public updateDrive(params: {
    active: boolean;
    speedRatio: number;
    rpmRatio: number;
    nitroActive: boolean;
    slipRatio: number;
  }): void {
    if (!this.initialized || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (this.muted || !params.active) {
      this.engineGain?.gain.setTargetAtTime(0, now, 0.06);
      this.nitroGain?.gain.setTargetAtTime(0, now, 0.05);
      this.tireGain?.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const baseFreq = 58 + params.rpmRatio * 145 + (params.nitroActive ? 28 : 0);
    this.engineOsc1?.frequency.setTargetAtTime(baseFreq, now, 0.04);
    this.engineOsc2?.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.04);
    this.engineFilter?.frequency.setTargetAtTime(260 + params.rpmRatio * 980, now, 0.05);
    this.engineGain?.gain.setTargetAtTime(0.055 + params.speedRatio * 0.045, now, 0.05);

    this.nitroFilter?.frequency.setTargetAtTime(params.nitroActive ? 1250 : 600, now, 0.06);
    this.nitroGain?.gain.setTargetAtTime(params.nitroActive ? 0.08 : 0, now, 0.05);

    const scrubLevel = params.slipRatio > 0.18 ? Math.min(0.075, (params.slipRatio - 0.18) * 0.14) : 0;
    this.tireFilter?.frequency.setTargetAtTime(1200 + params.speedRatio * 650, now, 0.05);
    this.tireGain?.gain.setTargetAtTime(scrubLevel, now, 0.04);
  }

  public playTone(freq: number, durationSec: number, type: OscillatorType = 'sine', volume = 0.1): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  public playCountdown(isGo: boolean): void {
    if (isGo) {
      this.playTone(880, 0.35, 'triangle', 0.14);
    } else {
      this.playTone(440, 0.18, 'sine', 0.1);
    }
  }

  public playLapChime(isFinal: boolean): void {
    if (isFinal) {
      this.playTone(587.33, 0.15, 'triangle', 0.12);
      setTimeout(() => this.playTone(783.99, 0.18, 'triangle', 0.12), 110);
      setTimeout(() => this.playTone(1046.5, 0.35, 'triangle', 0.14), 230);
    } else {
      this.playTone(659.25, 0.14, 'triangle', 0.11);
      setTimeout(() => this.playTone(880, 0.22, 'triangle', 0.11), 110);
    }
  }

  public playBump(): void {
    this.playTone(95, 0.12, 'sawtooth', 0.08);
  }

  public playSpicePickup(): void {
    this.playTone(523.25, 0.12, 'triangle', 0.11);
    setTimeout(() => this.playTone(783.99, 0.16, 'sine', 0.11), 65);
    setTimeout(() => this.playTone(1046.5, 0.24, 'triangle', 0.1), 130);
  }

  public playLaserShot(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(640, now);
    osc.frequency.exponentialRampToValueAtTime(135, now + 0.11);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.13);
  }

  public playHitConfirm(): void {
    this.playTone(880, 0.07, 'triangle', 0.1);
    setTimeout(() => this.playTone(1174.66, 0.11, 'triangle', 0.1), 55);
  }

  public playFlatTire(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.26);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.29);
  }

  public playShieldBlock(): void {
    this.playTone(460, 0.08, 'sine', 0.1);
    setTimeout(() => this.playTone(690, 0.1, 'sine', 0.08), 45);
  }

  public playWormWarning(): void {
    this.playTone(72, 0.35, 'triangle', 0.11);
    setTimeout(() => this.playTone(62, 0.4, 'sine', 0.09), 180);
  }

  public playWormEmergeMetal(): void {
    if (this.muted) return;
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const master = this.ctx.createGain();
    master.gain.setValueAtTime(0.001, now);
    master.gain.linearRampToValueAtTime(0.24, now + 0.014);
    master.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
    master.connect(this.ctx.destination);

    // Metallic inharmonic clang & shriek partials (ratios ~1, 1.59, 2.63, 4.28, 6.7)
    const partials: Array<{ freq: number; endFreq: number; type: OscillatorType; gain: number; dur: number }> = [
      { freq: 185, endFreq: 148, type: 'sawtooth', gain: 0.28, dur: 0.72 },
      { freq: 294, endFreq: 252, type: 'triangle', gain: 0.24, dur: 0.76 },
      { freq: 487, endFreq: 422, type: 'square', gain: 0.12, dur: 0.58 },
      { freq: 792, endFreq: 715, type: 'sine', gain: 0.22, dur: 0.82 },
      { freq: 1240, endFreq: 1090, type: 'sine', gain: 0.16, dur: 0.65 },
    ];

    for (const part of partials) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = part.type;
      osc.frequency.setValueAtTime(part.freq, now);
      osc.frequency.exponentialRampToValueAtTime(part.endFreq, now + part.dur);
      g.gain.setValueAtTime(part.gain, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + part.dur);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + part.dur + 0.02);
    }

    // Resonant metallic scrape burst
    const scrapeLen = Math.floor(this.ctx.sampleRate * 0.36);
    const scrapeBuf = this.ctx.createBuffer(1, scrapeLen, this.ctx.sampleRate);
    const data = scrapeBuf.getChannelData(0);
    for (let i = 0; i < scrapeLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (scrapeLen * 0.45));
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = scrapeBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 9.5;
    bp.frequency.setValueAtTime(2400, now);
    bp.frequency.exponentialRampToValueAtTime(640, now + 0.34);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.45, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);
    noise.connect(bp);
    bp.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(now);
    noise.stop(now + 0.37);

    // Heavy subterranean breach thud
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(84, now);
    subOsc.frequency.exponentialRampToValueAtTime(34, now + 0.32);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.35);
  }

  public playWormImpact(): void {
    this.playTone(55, 0.32, 'sawtooth', 0.16);
    setTimeout(() => this.playTone(38, 0.25, 'triangle', 0.13), 70);
  }

  public playWormRetreat(): void {
    this.playTone(130, 0.14, 'sawtooth', 0.1);
    setTimeout(() => this.playTone(88, 0.22, 'triangle', 0.1), 80);
    setTimeout(() => this.playTone(640, 0.18, 'sine', 0.09), 150);
  }

  public dispose(): void {
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this.noiseSource?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
    this.initialized = false;
  }
}
