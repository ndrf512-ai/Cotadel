// Бумажный интерфейс: доклады, телефонограммы, документы. Минимальный HUD.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export class UI {
  constructor(audio) {
    this.audio = audio;
    this.paper = $('paper');
    this.sheet = $('sheet');
    this.page = null;
    this.typing = null;
    this.onClose = null;
    this.sheet.addEventListener('click', (e) => { if (this.typing && e.target.tagName !== 'BUTTON') this.finishTyping(); });
    addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) {
        const b = this.sheet.querySelectorAll('.opts button:not(:disabled)')[n - 1];
        if (b) { b.click(); e.preventDefault(); }
      }
    });
  }

  get isOpen() { return this.paper.classList.contains('on'); }

  /**
   * page: { hdr:[l,r], who, text, html, options:[{label,fn,disabled,cls}], stamp, grid, noType, onClose }
   */
  open(page) {
    if (!this.isOpen) this.onClose = page.onClose || null;
    this.page = page;
    this.paper.classList.add('on');
    document.body.classList.add('paper');
    const hdr = page.hdr ? `<div class="hdr"><span>${esc(page.hdr[0] || '')}</span><span>${esc(page.hdr[1] || '')}</span></div>` : '';
    const who = page.who ? `<div class="who">${esc(page.who)}</div>` : '';
    const stamp = page.stamp ? `<div class="stamp">${esc(page.stamp)}</div>` : '';
    const flash = page.flash ? `<div class="flash">${esc(page.flash)}</div>` : '';
    this.sheet.innerHTML = `${hdr}${stamp}${who}${flash}<div class="txt"></div>${page.html ? `<div class="extra">${page.html}</div>` : ''}<div class="opts${page.grid ? ' grid' : ''}${page.panel ? ' panel' : ''}"></div>`;
    const txt = this.sheet.querySelector('.txt');
    this.buildOptions(page);
    this.sheet.scrollTop = 0;
    if (page.text && !page.noType) this.type(txt, page.text);
    else txt.textContent = page.text || '';
    if (!page.text) txt.style.minHeight = '0';
  }

  buildOptions(page) {
    const box = this.sheet.querySelector('.opts');
    box.innerHTML = '';
    const opts = page.options && page.options.length ? page.options : [{ label: 'Закрыть', fn: () => undefined, cls: 'back' }];
    let n = 0;
    opts.forEach((o) => {
      if (o.header !== undefined) { const h = document.createElement('div'); h.className = 'label' + (o.hot ? ' hot' : ''); h.textContent = o.header; box.appendChild(h); return; }
      const i = n++;
      const b = document.createElement('button');
      b.innerHTML = `${opts.length > 1 && i < 9 && !o.small ? `<span style="opacity:.5">${i + 1}.</span> ` : ''}${esc(o.label)}`;
      if (o.small) b.classList.add('small');
      if (o.cls) b.className = o.cls;
      const dis = typeof o.disabled === 'function' ? o.disabled() : o.disabled;
      if (dis) b.disabled = true;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio?.click();
        this.finishTyping();
        let r;
        try { r = o.fn ? o.fn() : undefined; } catch (err) { console.error(err); r = undefined; }
        if (r === undefined || r === null || r.close) { this.close(); return; }
        if (r.keep) return;
        const next = { hdr: page.hdr, who: r.who ?? page.who, ...r };
        if (!next.options || !next.options.length) next.options = [{ label: r.closeLabel || 'Отбой', fn: () => undefined, cls: 'back' }];
        if (!next.text && !next.html && r.text === '') { this.close(); return; }
        this.open(next);
      });
      box.appendChild(b);
    });
  }

  type(el, text) {
    this.finishTyping();
    let i = 0;
    el.textContent = '';
    const speed = 3;
    const step = () => {
      if (!this.typing) return;
      i = Math.min(text.length, i + speed);
      el.textContent = text.slice(0, i);
      if (i % 6 < speed) this.audio?.type();
      if (i >= text.length) { this.typing = null; return; }
      this.typing.raf = requestAnimationFrame(step);
    };
    this.typing = { el, text, raf: requestAnimationFrame(step) };
  }

  finishTyping() {
    if (!this.typing) return;
    cancelAnimationFrame(this.typing.raf);
    this.typing.el.textContent = this.typing.text;
    this.typing = null;
  }

  close() {
    this.finishTyping();
    this.paper.classList.remove('on');
    document.body.classList.remove('paper');
    this.sheet.innerHTML = '';
    const f = this.onClose; this.onClose = null; this.page = null;
    f && f();
  }

  // ----- HUD -----
  prompt(text, hot) {
    $('prompt').textContent = text || '';
    $('cross').classList.toggle('hot', !!hot);
  }

  subs(sub) {
    const el = $('subs');
    if (!sub || performance.now() > sub.until) { if (el.innerHTML) el.innerHTML = ''; return; }
    const html = sub.who ? `<b>${esc(sub.who)}:</b> ${esc(sub.text)}` : esc(sub.text);
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  fade(on) { $('fade').style.opacity = on ? 1 : 0; }
}

export { esc };
