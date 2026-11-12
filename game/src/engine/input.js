// Управление: мышь/клавиатура и сенсорный экран.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.look = { x: 0, y: 0 };
    this.move = { x: 0, y: 0 };
    this.actPressed = false;
    this.menuPressed = false;
    this.enabled = true;
    this.touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.locked = false;

    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') this.actPressed = true;
      if (e.code === 'Escape' || e.code === 'Tab') { this.menuPressed = true; e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    canvas.addEventListener('mousedown', (e) => {
      if (this.touch) return;
      if (!this.locked && this.enabled) { canvas.requestPointerLock?.(); return; }
      if (e.button === 0 && this.enabled) this.actPressed = true;
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.look.x += e.movementX * 0.0022;
      this.look.y += e.movementY * 0.0022;
    });

    if (this.touch) this._initTouch();
  }

  _initTouch() {
    const ui = document.getElementById('touch');
    ui.classList.add('on');
    document.body.classList.add('touch');
    const stick = document.getElementById('stick'), knob = document.getElementById('knob');
    let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0, lookMoved = 0, lookStart = 0;
    const R = 50;
    ui.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const el = t.target;
        if (el.id === 'actbtn') { this.actPressed = true; continue; }
        if (el.id === 'menubtn') { this.menuPressed = true; continue; }
        if (t.clientX < innerWidth * 0.42 && stickId === null) {
          stickId = t.identifier;
          const r = stick.getBoundingClientRect();
          sx = r.left + r.width / 2; sy = r.top + r.height / 2;
          if (Math.hypot(t.clientX - sx, t.clientY - sy) > 90) {
            // стик «прыгает» под палец
            stick.style.left = (t.clientX - 60) + 'px';
            stick.style.top = (t.clientY - 60) + 'px'; stick.style.bottom = 'auto';
            sx = t.clientX; sy = t.clientY;
          }
          this._stick(t.clientX - sx, t.clientY - sy, knob, R);
        } else if (lookId === null) {
          lookId = t.identifier; lx = t.clientX; ly = t.clientY; lookMoved = 0; lookStart = performance.now();
        }
      }
      e.preventDefault();
    }, { passive: false });
    ui.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) this._stick(t.clientX - sx, t.clientY - sy, knob, R);
        if (t.identifier === lookId) {
          const dx = t.clientX - lx, dy = t.clientY - ly;
          lookMoved += Math.abs(dx) + Math.abs(dy);
          this.look.x += dx * 0.006; this.look.y += dy * 0.006;
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) { stickId = null; this._stick(0, 0, knob, R); }
        if (t.identifier === lookId) {
          lookId = null;
          // короткое касание без сдвига = действие
          if (lookMoved < 12 && performance.now() - lookStart < 300) this.actPressed = true;
        }
      }
    };
    ui.addEventListener('touchend', end);
    ui.addEventListener('touchcancel', end);
  }

  _stick(dx, dy, knob, R) {
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.left = (40 + dx) + 'px'; knob.style.top = (40 + dy) + 'px';
    this.move.x = dx / R; this.move.y = dy / R;
  }

  axes() {
    let x = this.move.x, y = this.move.y;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  consumeLook() { const l = { ...this.look }; this.look.x = this.look.y = 0; return l; }
  consumeAct() { const a = this.actPressed; this.actPressed = false; return a; }
  consumeMenu() { const a = this.menuPressed; this.menuPressed = false; return a; }

  release() { if (document.pointerLockElement) document.exitPointerLock(); }
  setTouchHot(hot) { const b = document.getElementById('actbtn'); if (b) b.classList.toggle('hot', hot); }
}
