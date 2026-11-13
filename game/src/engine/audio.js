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

  /** Фоновые слои: ветер снаружи, гул генератора, тон помещения. */
  _loop(freq, type, q, gain) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    n.connect(f); f.connect(g); g.connect(this.master); n.start();
    return { g, f };
  }

  initLayers() {
    if (!this.ctx || this.layers) return;
    const c = this.ctx;
    this.layers = { wind: this._loop(500, 'bandpass', 0.6, 0), room: this._loop(180, 'lowpass', 0.7, 0) };
    // генератор: пульсирующий низкий гул
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 7; const lg = c.createGain(); lg.gain.value = 0.25; lfo.connect(lg); lg.connect(am.gain);
    const g = c.createGain(); g.gain.value = 0;
    o.connect(f); f.connect(am); am.connect(g); g.connect(this.master); o.start(); lfo.start();
    this.layers.gen = { g };
  }

  /** env: { inside, genDist, voices(0..1), night } */
  ambience(dt, env) {
    if (!this.ctx) return;
    this.initLayers();
    const L = this.layers, t = this.ctx.currentTime;
    L.wind.g.gain.setTargetAtTime(env.inside ? 0.008 : 0.05 + env.night * 0.02, t, 0.5);
    L.wind.f.frequency.setTargetAtTime(380 + Math.sin(t * 0.3) * 160, t, 1);
    L.room.g.gain.setTargetAtTime(env.inside ? 0.04 : 0, t, 0.4);
    L.gen.g.gain.setTargetAtTime(Math.max(0, 1 - env.genDist / 22) * 0.05, t, 0.3);
    if (env.voices > 0 && Math.random() < dt * 1.2 * env.voices) this.murmur(env.voiceDist ?? 0.5);
    if (env.typing && Math.random() < dt * 9) this.type();
    if (env.morse && Math.random() < dt * 0.25) this.morse();
  }

  /** Неразборчивая речь: «гласные» через формантные фильтры. */
  murmur(dist = 0.5) {
    const c = this.ctx, t0 = c.currentTime;
    const o = c.createOscillator(); o.type = 'sawtooth';
    const base = 95 + Math.random() * 80;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 6;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 8;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(f1); o.connect(f2); f1.connect(g); f2.connect(g); g.connect(this.master);
    const n = 3 + (Math.random() * 6 | 0);
    let t = t0;
    const vol = 0.05 * (1 - dist);
    for (let i = 0; i < n; i++) {
      const d = 0.09 + Math.random() * 0.14;
      const v = [[700, 1100], [400, 2000], [300, 900], [500, 1700], [650, 1000]][(Math.random() * 5) | 0];
      o.frequency.setValueAtTime(base * (1 + (Math.random() - 0.5) * 0.15), t);
      f1.frequency.setValueAtTime(v[0], t); f2.frequency.setValueAtTime(v[1], t);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.linearRampToValueAtTime(vol * 0.3, t + d);
      t += d + (Math.random() < 0.2 ? 0.12 : 0.02);
    }
    g.gain.linearRampToValueAtTime(0, t + 0.05);
    o.start(t0); o.stop(t + 0.1);
  }

  morse() {
    const c = this.ctx; let t = c.currentTime;
    const o = c.createOscillator(); o.frequency.value = 820; const g = c.createGain(); g.gain.value = 0;
    o.connect(g); g.connect(this.master);
    for (let i = 0; i < 6 + (Math.random() * 6 | 0); i++) { const d = Math.random() < 0.5 ? 0.06 : 0.18; g.gain.setValueAtTime(0.02, t); g.gain.setValueAtTime(0, t + d); t += d + 0.06; }
    o.start(); o.stop(t + 0.05);
  }

  /** Пулемётная очередь. */
  mg(dist = 1) {
    if (!this.ctx) return;
    const n = 6 + (Math.random() * 8 | 0);
    const t0 = this.ctx.currentTime, near = 1 - dist;
    for (let i = 0; i < n; i++) this._noiseBurst(t0 + i * 0.075, 0.06 + dist * 0.15, 500 + near * 2200, 0.03 + near * 0.3, 'bandpass', 0.9);
  }

  /** Свист подлетающего снаряда. */
  whistle(near = 0.5) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1500, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.9);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 * (1.2 - near), t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 1);
  }

  /** Шаг по поверхности: wood | earth | mud. */
  stepOn(surface = 'earth', run = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (surface === 'wood') { this._noiseBurst(t, 0.06, 900 + Math.random() * 300, 0.1, 'bandpass', 3); this._noiseBurst(t + 0.01, 0.12, 180, 0.12, 'lowpass'); }
    else if (surface === 'mud') { this._noiseBurst(t, 0.18, 350 + Math.random() * 200, 0.1, 'bandpass', 4); this._noiseBurst(t + 0.08, 0.1, 1200, 0.03, 'highpass'); }
    else this._noiseBurst(t, run ? 0.08 : 0.1, 240 + Math.random() * 140, run ? 0.14 : 0.1, 'lowpass');
  }

  /** Патефон: старый вальс с треском пластинки. */
  gramophone(on) {
    if (!this.ctx) return false;
    if (this.gram) { clearInterval(this.gram.iv); this.gram.g.disconnect(); this.gram = null; if (on !== true) return false; }
    if (on === false) return false;
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = 0.05;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    g.connect(f); f.connect(this.master);
    const tune = [67, 71, 74, 74, 72, 71, 69, 0, 69, 72, 76, 76, 74, 72, 71, 0, 67, 71, 74, 79, 78, 76, 74, 72, 71, 69, 67, 0];
    const bass = [43, 50, 50, 45, 52, 52, 43, 50, 50, 38, 45, 45];
    let i = 0;
    const beat = 0.36;
    const tick = () => {
      const t = c.currentTime + 0.05;
      const n = tune[i % tune.length], b = bass[i % bass.length];
      const note = (m, dur, vol, type) => {
        if (!m) return;
        const o = c.createOscillator(); o.type = type; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
        const e = c.createGain(); e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(vol, t + 0.02); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(e); e.connect(g); o.start(t); o.stop(t + dur + 0.05);
      };
      note(n, beat * 0.95, 0.5, 'triangle');
      note(b, beat * 0.6, 0.35, 'sine');
      if (Math.random() < 0.5) this._noiseBurst(t, 0.03, 4000, 0.012, 'highpass');
      i++;
    };
    this.gram = { g, iv: setInterval(tick, beat * 1000) };
    return true;
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
