// Синтезированный звук (WebAudio): звук — главный носитель информации в штабе.
export class Audio {
  constructor() {
    this.ctx = null;
    this.ringing = null;
    this.combat = 0; // интенсивность боя (0..1), громкость стрельбы
    this.distance = 1; // 1 — далеко, 0 — у штаба
    this.night = 0;
    this._t = 0;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    // буфер белого шума
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // фон: ветер/гул земли
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    this.amb = c.createGain(); this.amb.gain.value = 0.05;
    n.connect(f); f.connect(this.amb); this.amb.connect(this.master); n.start();
    this.ambF = f;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }
  suspend() { if (this.ctx) this.ctx.suspend(); }

  _noiseBurst(t, dur, freq, gain, type = 'lowpass', q = 0.7) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.5 + Math.random();
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  /** Разрыв: dist 0 — рядом (громко, ярко), 1 — далеко (глухо). */
  boom(dist = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.random() * 0.05;
    const near = 1 - dist;
    this._noiseBurst(t, 0.6 + dist * 1.6, 80 + near * 900, 0.15 + near * 0.9);
    this._noiseBurst(t, 1.5 + dist, 50, 0.25 + near * 0.5);
    if (near > 0.6) this.thud();
  }

  thud() {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5);
    const g = c.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
  }

  shot(dist = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + Math.random() * 0.03;
    const near = 1 - dist;
    this._noiseBurst(t, 0.08 + dist * 0.25, 400 + near * 2500, 0.03 + near * 0.25, 'bandpass', 0.8);
  }

  burst(dist = 1) {
    const n = 3 + (Math.random() * 6) | 0;
    for (let i = 0; i < n; i++) setTimeout(() => this.shot(dist), i * 85);
  }

  /** Обновление фоновых боевых звуков; вызывать каждый кадр. */
  update(dt) {
    if (!this.ctx) return;
    this._t += dt;
    const k = this.combat;
    if (k > 0.02) {
      if (Math.random() < dt * (0.5 + k * 5)) this.shot(Math.min(1, this.distance + Math.random() * 0.2));
      if (Math.random() < dt * k * 1.2) this.burst(Math.min(1, this.distance + 0.1));
    }
    if (this.ambF) this.ambF.frequency.value = 160 + (1 - this.night) * 140;
  }

  ringStart() {
    if (!this.ctx || this.ringing) return;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0; g.connect(this.master);
    const o1 = c.createOscillator(); o1.type = 'square'; o1.frequency.value = 1180;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 1420;
    const am = c.createGain(); am.gain.value = 0;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 22;
    const lg = c.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg); lg.connect(am.gain);
    o1.connect(am); o2.connect(am); am.connect(g);
    o1.start(); o2.start(); lfo.start();
    let on = true;
    const tick = () => {
      if (!this.ringing) return;
      const t = c.currentTime;
      g.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.01);
      on = !on;
      this.ringing.timer = setTimeout(tick, on ? 1600 : 1100);
    };
    this.ringing = { nodes: [o1, o2, lfo], g };
    tick();
  }

  ringStop() {
    if (!this.ringing) return;
    clearTimeout(this.ringing.timer);
    for (const n of this.ringing.nodes) n.stop();
    this.ringing.g.disconnect();
    this.ringing = null;
  }

  click() {
    if (!this.ctx) return;
    this._noiseBurst(this.ctx.currentTime, 0.03, 3000, 0.08, 'highpass');
  }

  type() {
    if (!this.ctx) return;
    this._noiseBurst(this.ctx.currentTime, 0.02, 2200 + Math.random() * 800, 0.025, 'bandpass', 2);
  }

  step() {
    if (!this.ctx) return;
    this._noiseBurst(this.ctx.currentTime, 0.09, 260 + Math.random() * 120, 0.12, 'lowpass');
  }

  radio(dur = 0.8) {
    if (!this.ctx) return;
    this._noiseBurst(this.ctx.currentTime, dur, 1800, 0.08, 'bandpass', 0.5);
  }

  door() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noiseBurst(t, 0.25, 500, 0.12, 'lowpass');
    this._noiseBurst(t + 0.15, 0.3, 300, 0.1, 'lowpass');
  }

  flare() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
    const g = c.createGain(); g.gain.setValueAtTime(0.02, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.9);
  }
}
