'use strict';
(() => {
  const S = { me: null, shellKey: '', modals: new Set() };
  const app = document.getElementById('app');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  // ───────────────────────── formatting ─────────────────────────

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtN = (n) => Number(n || 0).toLocaleString('th-TH');
  const fmtB = (n) => '฿' + Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const fmtB0 = (n) => '฿' + Math.round(Number(n || 0)).toLocaleString('th-TH');
  const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtDTY = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtD = (ymd) => (ymd ? new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');
  const signed = (n) => (n > 0 ? '+' + fmtN(n) : n < 0 ? '−' + fmtN(-n) : '0');
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const startOfDay = (s) => new Date(s + 'T00:00:00');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const initial = (name) => (name || '?').trim().replace(/^[เแโใไ]/, '').charAt(0).toUpperCase() || '?';
  const abbr = (p) => ((p.sku.split('-')[1] || p.sku).replace(/[^A-Z]/g, '').slice(0, 2) || p.sku.slice(0, 2));
  const ic = (name, size) => `<cs-i name="${name}"${size ? ` size="${size}"` : ''}></cs-i>`;
  const CORNERS = '<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>';
  const qs = (o) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) p.set(k, v);
    const s = p.toString();
    return s ? '?' + s : '';
  };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const STATUS = { ok: 'ปกติ', low: 'ใกล้หมด', out: 'หมด', exp: 'ใกล้หมดอายุ', expired: 'หมดอายุ' };
  const TYPE = { in: { label: 'รับเข้า', icon: 'in' }, out: { label: 'จ่ายออก', icon: 'out' }, adj: { label: 'ปรับยอด', icon: 'adjust' } };
  const stTag = (s) => `<span class="tag st-${s}">${STATUS[s]}</span>`;
  const tyTag = (t) => `<span class="tag t-${t}">${TYPE[t].label}</span>`;
  const daysLabel = (d) => (d < 0 ? `หมดอายุแล้ว ${-d} วัน` : d === 0 ? 'หมดอายุวันนี้' : `อีก ${d} วัน`);
  const empty = (icon, text, extra = '') => `<div class="empty">${ic(icon, 32)}<div>${text}</div>${extra}</div>`;
  const can = (perm) => !!S.me?.store?.perms?.[perm];

  function thumb(p, cls = '') {
    if (p.hasImage) return `<div class="thumb ${cls}"><img src="/api/products/${p.id}/image?v=${encodeURIComponent(p.updatedAt || '')}" alt="" loading="lazy"></div>`;
    return `<div class="thumb ${cls}">${esc(abbr(p))}</div>`;
  }

  // ───────────────────────── api ─────────────────────────

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json', 'X-CS': '1' } : { 'X-CS': '1' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบการเชื่อมต่อ');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.startsWith('/api/auth')) {
      S.me = null;
      S.shellKey = '';
      go('/login');
      throw new Error(data.error || 'กรุณาเข้าสู่ระบบ');
    }
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data;
  }
  const GET = (u) => api('GET', u);
  const POST = (u, b = {}) => api('POST', u, b);
  const PUT = (u, b = {}) => api('PUT', u, b);
  const DEL = (u, b = {}) => api('DELETE', u, b);

  async function loadMe() {
    try {
      const res = await fetch('/api/me', { credentials: 'same-origin' });
      S.me = res.ok ? await res.json() : null;
    } catch {
      S.me = null;
    }
    return S.me;
  }

  async function refreshMe() {
    const prevKey = shellKey();
    await loadMe();
    if (!S.me) return go('/login');
    if (shellKey() !== prevKey) render();
    else updateShellBits();
  }

  // ───────────────────────── ui primitives ─────────────────────────

  function toast(msg, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `${ic(type === 'err' ? 'alert' : 'check', 18)}<span>${esc(msg)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), type === 'err' ? 5000 : 3000);
  }

  function modal({ title, body, actions = [], wide = false, onMount }) {
    return new Promise((resolve) => {
      const bd = document.createElement('div');
      bd.className = 'dialog-backdrop';
      bd.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="dialog-head"><div class="dialog-title">${esc(title)}</div><button type="button" class="btn btn-ghost btn-ico plain" data-close aria-label="ปิด">${ic('x', 20)}</button></div>
        <div class="stack">${body}</div>
        ${actions.length ? `<div class="dialog-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.cls || 'btn-secondary'}" data-i="${i}">${a.label}</button>`).join('')}</div>` : ''}
      </div>`;
      const dlg = bd.firstElementChild;
      let cleanup = null;
      let closed = false;
      const close = (v) => {
        if (closed) return;
        closed = true;
        try { cleanup?.(); } catch { /* ignore */ }
        bd.remove();
        S.modals.delete(close);
        document.removeEventListener('keydown', onKey);
        if (!S.modals.size) document.body.style.overflow = '';
        resolve(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(null); });
      $('[data-close]', dlg).addEventListener('click', () => close(null));
      $$('[data-i]', dlg).forEach((btn) => btn.addEventListener('click', async () => {
        const a = actions[Number(btn.dataset.i)];
        if (!a.onClick) return close(a.value ?? null);
        const err = $('.form-err', dlg);
        if (err) err.hidden = true;
        btn.disabled = true;
        try {
          const r = await a.onClick(dlg);
          if (r !== false) close(r ?? true);
        } catch (e) {
          if (err) { err.textContent = e.message; err.hidden = false; } else toast(e.message, 'err');
        } finally {
          if (btn.isConnected) btn.disabled = false;
        }
      }));
      document.addEventListener('keydown', onKey);
      document.body.appendChild(bd);
      document.body.style.overflow = 'hidden';
      S.modals.add(close);
      cleanup = onMount?.(dlg, close) || null;
      const first = $('input:not([type=hidden]), select, textarea', dlg);
      if (first && matchMedia('(hover: hover)').matches) first.focus();
    });
  }

  const closeAllModals = () => [...S.modals].forEach((c) => c(null));

  function confirmBox(title, text, okLabel = 'ยืนยัน', danger = false) {
    return modal({
      title,
      body: `<div class="dialog-body">${text}</div>`,
      actions: [{ label: 'ยกเลิก', value: false }, { label: okLabel, cls: danger ? 'btn-danger' : 'btn-primary', value: true }],
    });
  }

  function onSubmit(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[type=submit]', form);
      const err = $('.form-err', form);
      if (err) err.hidden = true;
      if (btn) btn.disabled = true;
      try {
        await fn(Object.fromEntries(new FormData(form)), form);
      } catch (ex) {
        if (err) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } else toast(ex.message, 'err');
      } finally {
        if (btn && btn.isConnected) btn.disabled = false;
      }
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('โหลดไลบรารีไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)'));
      document.head.appendChild(s);
    });
  }

  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = crypto.getRandomValues(new Uint32Array(10));
    return [...a].map((n) => chars[n % chars.length]).join('') + (a[0] % 90 + 10);
  }

  function downloadCSV(name, rows) {
    const cell = (v) => {
      if (typeof v === 'number') return String(v);
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function resizeImage(file, max = 480) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์รูปไม่ได้')); };
      img.src = url;
    });
  }

  // — barcode / QR —

  function scanCode(title = 'สแกน Barcode / QR') {
    return modal({
      title,
      body: `<div id="reader"><span class="small">กำลังเปิดกล้อง…</span></div>
        <div class="scan-note" id="scan-msg">เล็งกล้องไปที่ Barcode หรือ QR ของสินค้า</div>
        <form class="field" id="scan-form"><label for="scan-manual">หรือพิมพ์ / ยิงเครื่องสแกนที่ช่องนี้</label>
          <div style="display:flex;gap:8px"><input class="input" id="scan-manual" autocomplete="off" autocapitalize="characters" placeholder="บาร์โค้ด หรือ SKU">
          <button class="btn btn-primary" type="submit">ตกลง</button></div></form>`,
      onMount(dlg, close) {
        let scanner = null;
        let closed = false;
        const msg = $('#scan-msg', dlg);
        const reader = $('#reader', dlg);
        $('#scan-form', dlg).addEventListener('submit', (e) => {
          e.preventDefault();
          const v = $('#scan-manual', dlg).value.trim();
          if (v) close(v);
        });
        const stop = () => {
          if (scanner && scanner.isScanning) scanner.stop().then(() => scanner.clear()).catch(() => {});
        };
        (async () => {
          if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            reader.hidden = true;
            msg.textContent = 'กล้องใช้ได้เมื่อเปิดเว็บผ่าน HTTPS หรือ localhost เท่านั้น — พิมพ์รหัสด้านล่างแทนได้';
            return;
          }
          try {
            if (!window.Html5Qrcode) await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
            if (closed) return;
            reader.innerHTML = '';
            scanner = new window.Html5Qrcode('reader', { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
            await scanner.start(
              { facingMode: 'environment' },
              { fps: 10, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.85, 320)), height: Math.floor(Math.min(h * 0.6, 180)) }) },
              (text) => { navigator.vibrate?.(60); close(text.trim()); },
              () => {},
            );
            if (closed) stop();
          } catch (e) {
            reader.hidden = true;
            msg.textContent = 'เปิดกล้องไม่ได้ (' + (e?.message || e) + ') — พิมพ์รหัสด้านล่างแทนได้';
          }
        })();
        return () => { closed = true; stop(); };
      },
    });
  }

  let qrLib = null;
  async function qrSvg(text) {
    if (!window.qrcode) {
      qrLib ||= loadScript('https://unpkg.com/qrcode-generator@1.4.4/qrcode.js');
      await qrLib;
    }
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  }

  async function printLabels(p) {
    let svg = '';
    try { svg = await qrSvg(p.barcode || p.sku); } catch (e) { toast(e.message, 'err'); return; }
    const MAX = 60;
    const clampN = (v) => Math.min(MAX, Math.max(1, Math.floor(Number(v)) || 1));
    const labelHtml = (price) => `<div class="label">${svg}<div><b>${esc(p.name)}</b><br>${esc(p.sku)}${p.barcode ? '<br>' + esc(p.barcode) : ''}${price ? '<br>' + fmtB(p.price) : ''}</div></div>`;
    const opts = await modal({
      title: 'พิมพ์ฉลาก QR',
      wide: true,
      body: `<div class="dialog-body">${esc(p.name)} · ${esc(p.barcode || p.sku)}</div>
        <div class="lbl-controls">
          <div class="field"><label for="lbl-n">จำนวนฉลาก (สูงสุด ${MAX})</label>
            <div class="stepper"><button type="button" class="btn btn-secondary btn-ico" data-step="-1" aria-label="ลด">${ic('minus', 18)}</button>
            <input class="input" id="lbl-n" type="number" inputmode="numeric" min="1" max="${MAX}" value="1">
            <button type="button" class="btn btn-secondary btn-ico" data-step="1" aria-label="เพิ่ม">${ic('plus', 18)}</button></div></div>
          <label class="check"><input type="checkbox" id="lbl-price" checked> แสดงราคา</label>
        </div>
        <div class="lbl-head"><b>ตัวอย่างก่อนพิมพ์</b><span class="small" id="lbl-count"></span></div>
        <div class="lbl-preview"><div class="lbl-sheet" id="lbl-sheet"></div></div>
        <div class="small muted">ฉลากขนาด 60 มม. · ในหน้าต่างพิมพ์เลือกขนาดกระดาษและ "บันทึกเป็น PDF" ได้</div>`,
      actions: [
        { label: 'ยกเลิก' },
        { label: ic('printer') + 'พิมพ์', cls: 'btn-primary', onClick: (dlg) => ({ n: clampN($('#lbl-n', dlg).value), price: $('#lbl-price', dlg).checked }) },
      ],
      onMount(dlg) {
        const input = $('#lbl-n', dlg);
        const price = $('#lbl-price', dlg);
        const draw = () => {
          const n = clampN(input.value);
          $('#lbl-sheet', dlg).innerHTML = labelHtml(price.checked).repeat(n);
          $('#lbl-count', dlg).textContent = `${fmtN(n)} ฉลาก`;
        };
        $$('[data-step]', dlg).forEach((b) => b.addEventListener('click', () => {
          input.value = clampN(clampN(input.value) + Number(b.dataset.step));
          draw();
        }));
        input.addEventListener('input', draw);
        input.addEventListener('change', () => { input.value = clampN(input.value); draw(); });
        price.addEventListener('change', draw);
        draw();
      },
    });
    if (!opts) return;
    $('#print-area').innerHTML = labelHtml(opts.price).repeat(opts.n);
    document.body.classList.add('print-label');
    const done = () => { document.body.classList.remove('print-label'); $('#print-area').innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  // ───────────────────────── routing ─────────────────────────

  const ROUTES = [
    ['/login', viewLogin, { public: true }],
    ['/register', viewRegister, { public: true }],
    ['/', viewDashboard, { nav: 'dash' }],
    ['/products', viewProducts, { nav: 'products' }],
    ['/products/new', viewProductForm, { nav: 'products', perm: 'product.edit' }],
    ['/products/:id', viewProduct, { nav: 'products' }],
    ['/products/:id/edit', viewProductForm, { nav: 'products', perm: 'product.edit' }],
    ['/move/:type', viewMove, { nav: (p) => 'move-' + p.type }],
    ['/history', viewHistory, { nav: 'history' }],
    ['/alerts', viewAlerts, { nav: 'alerts' }],
    ['/reports', viewReports, { nav: 'reports', perm: 'report' }],
    ['/users', viewUsers, { nav: 'users', perm: 'users' }],
    ['/settings', viewSettings, { nav: 'settings' }],
    ['/more', viewMore, { nav: 'more' }],
  ].map(([pattern, view, opts]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { re, keys, view, opts };
  });

  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [path, q = ''] = h.split('?');
    return { path: path || '/', query: Object.fromEntries(new URLSearchParams(q)) };
  }

  function go(path) {
    if (location.hash === '#' + path) render();
    else location.hash = '#' + path;
    return null;
  }

  const replaceQuery = (path, params) => history.replaceState(null, '', '#' + path + qs(params));

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    closeAllModals();
    const { path, query } = parseHash();
    let route = null, params = {};
    for (const r of ROUTES) {
      const m = r.re.exec(path);
      if (m) { route = r; params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); break; }
    }
    if (!route) return go('/');
    if (S.me === null && !S.triedMe) { S.triedMe = true; await loadMe(); if (seq !== renderSeq) return; }

    if (route.opts.public) {
      if (S.me) return go('/');
      S.shellKey = '';
      const out = await route.view({ params, query });
      if (seq !== renderSeq || !out) return;
      app.innerHTML = out.html;
      out.mount?.(app);
      return;
    }
    if (!S.me) return go('/login');
    if (!S.me.store) return renderNoStore();

    ensureShell();
    const navKey = typeof route.opts.nav === 'function' ? route.opts.nav(params) : route.opts.nav;
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === navKey || (navKey === 'more' && a.dataset.nav === 'more')));
    const view = $('#view');
    if (route.opts.perm && !can(route.opts.perm)) { view.innerHTML = forbidden(); return; }
    const loader = setTimeout(() => { if (seq === renderSeq) view.innerHTML = `<div class="page">${empty('clock', 'กำลังโหลด…')}</div>`; }, 180);
    try {
      const out = await route.view({ params, query });
      clearTimeout(loader);
      if (seq !== renderSeq || !out) return;
      view.innerHTML = out.html;
      window.scrollTo(0, 0);
      out.mount?.(view);
    } catch (e) {
      clearTimeout(loader);
      if (seq !== renderSeq) return;
      view.innerHTML = `<div class="page">${empty('alert', esc(e.message), '<a class="btn btn-secondary" href="#/">กลับหน้าแรก</a>')}</div>`;
    }
  }

  const forbidden = () => `<div class="page">${empty('alert', 'บทบาทของคุณในร้านนี้ไม่มีสิทธิ์ใช้งานหน้านี้', '<a class="btn btn-secondary" href="#/">กลับหน้าแรก</a>')}</div>`;

  // ───────────────────────── shell ─────────────────────────

  const shellKey = () => (S.me?.store ? `${S.me.user.id}|${S.me.store.id}|${S.me.store.role}` : '');

  function navItems() {
    return [
      { nav: 'dash', href: '#/', icon: 'grid', label: 'Dashboard' },
      { nav: 'products', href: '#/products', icon: 'package', label: 'สินค้า' },
      { nav: 'move-in', href: '#/move/in', icon: 'in', label: 'รับสินค้าเข้า', perm: 'stock.move' },
      { nav: 'move-out', href: '#/move/out', icon: 'out', label: 'จ่าย/เบิกสินค้า', perm: 'stock.move' },
      { nav: 'move-adj', href: '#/move/adj', icon: 'adjust', label: 'ปรับยอดสต็อก', perm: 'stock.adjust' },
      { nav: 'history', href: '#/history', icon: 'history', label: 'ประวัติการเคลื่อนไหว' },
      { nav: 'alerts', href: '#/alerts', icon: 'bell', label: 'แจ้งเตือน', badge: true },
      { nav: 'reports', href: '#/reports', icon: 'chart', label: 'รายงาน', perm: 'report' },
    ].filter((i) => !i.perm || can(i.perm));
  }

  function ensureShell() {
    const key = shellKey();
    if (S.shellKey === key && $('#view')) { updateShellBits(); return; }
    S.shellKey = key;
    const navLink = (i) => `<a href="${i.href}" data-nav="${i.nav}" title="${esc(i.label)}">${ic(i.icon, 20)}<span class="lbl">${i.label}</span>${i.badge ? '<span class="tag tag-accent" data-bind="badge-tag"></span>' : ''}</a>`;
    const bottom = can('stock.move')
      ? [['dash', '#/', 'grid', 'หน้าแรก'], ['products', '#/products', 'package', 'สินค้า'], ['move-in', '#/move/in', 'in', 'รับเข้า'], ['move-out', '#/move/out', 'out', 'จ่ายออก'], ['more', '#/more', 'menu', 'เพิ่มเติม']]
      : [['dash', '#/', 'grid', 'หน้าแรก'], ['products', '#/products', 'package', 'สินค้า'], ['alerts', '#/alerts', 'bell', 'แจ้งเตือน'], ['history', '#/history', 'history', 'ประวัติ'], ['more', '#/more', 'menu', 'เพิ่มเติม']];
    app.innerHTML = `<div class="shell">
      <aside class="side">
        <a class="brand" href="#/"><div class="brand-mark">${ic('package', 20)}</div><div><div class="brand-name">CosmoStock</div><div class="brand-tag">จัดการคลังง่าย สต็อกแม่น ธุรกิจเติบโต</div></div></a>
        <button type="button" class="btn btn-secondary store-btn" data-act="store">${ic('store')}<span class="nm" data-bind="store"></span>${ic('down', 16)}</button>
        <nav class="nav">${navItems().map(navLink).join('')}</nav>
        <div class="nav-sec">บัญชีและร้าน</div>
        <nav class="nav">
          ${can('users') ? navLink({ nav: 'users', href: '#/users', icon: 'users', label: 'ผู้ใช้และสิทธิ์' }) : ''}
          ${navLink({ nav: 'settings', href: '#/settings', icon: 'settings', label: 'ตั้งค่า' })}
        </nav>
        <div class="side-user">
          <div class="avatar" data-bind="initial"></div>
          <div class="who"><div class="nm" data-bind="user"></div><div class="rl" data-bind="role"></div></div>
          <button type="button" class="btn btn-ghost btn-ico plain" data-act="logout" title="ออกจากระบบ" aria-label="ออกจากระบบ">${ic('logout', 20)}</button>
        </div>
      </aside>
      <div class="content">
        <header class="top">
          <div class="brand-mark" style="width:32px;height:32px">${ic('package')}</div>
          <button type="button" class="btn store-pick" data-act="store"><span class="t1">CosmoStock</span><span class="t2"><span data-bind="store"></span>${ic('down', 14)}</span></button>
          <button type="button" class="btn btn-ghost btn-ico plain" data-act="scan" aria-label="สแกน">${ic('scan', 20)}</button>
          <a class="btn btn-ghost btn-ico bell" href="#/alerts" aria-label="แจ้งเตือน">${ic('bell', 20)}<span class="badge" data-bind="badge"></span></a>
          <a class="avatar" href="#/more" style="text-decoration:none" data-bind="initial" aria-label="บัญชี"></a>
        </header>
        <main class="main" id="view"></main>
      </div>
      <nav class="bottom">${bottom.map(([nav, href, icon, label]) => `<a href="${href}" data-nav="${nav}">${ic(icon, 22)}${label}${nav === 'alerts' ? '<span class="badge" data-bind="badge"></span>' : ''}</a>`).join('')}</nav>
    </div>`;
    updateShellBits();
  }

  function updateShellBits() {
    const { user, store } = S.me;
    const count = store.alertCount;
    $$('[data-bind=store]').forEach((e) => { e.textContent = store.name; });
    $$('[data-bind=user]').forEach((e) => { e.textContent = user.name; });
    $$('[data-bind=role]').forEach((e) => { e.textContent = store.roleLabel; });
    $$('[data-bind=initial]').forEach((e) => { e.textContent = initial(user.name); });
    $$('[data-bind=badge], [data-bind=badge-tag]').forEach((e) => { e.textContent = count > 99 ? '99+' : String(count); e.hidden = !count; });
  }

  async function switchStore() {
    const { stores, store } = S.me;
    const id = await modal({
      title: 'เลือกร้านที่ต้องการจัดการ',
      body: `<div class="stack" style="gap:8px">${stores.map((s) => `<button type="button" class="store-opt ${s.id === store.id ? 'on' : ''}" data-id="${s.id}">${ic('store', 20)}<span class="nm">${esc(s.name)}<div class="small muted">${esc(s.roleLabel)}</div></span>${s.id === store.id ? ic('check') : ''}</button>`).join('')}</div>
        <a href="#/settings" class="small" data-new>＋ เพิ่มร้าน / สาขาใหม่</a>`,
      onMount(dlg, close) {
        $$('[data-id]', dlg).forEach((b) => b.addEventListener('click', () => close(Number(b.dataset.id))));
        $('[data-new]', dlg).addEventListener('click', () => close(null));
      },
    });
    if (!id || id === store.id) return;
    try {
      S.me = await POST('/api/me/store', { storeId: id });
      toast('สลับไปที่ ' + S.me.store.name);
      go('/');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function logout() {
    try { await POST('/api/auth/logout'); } catch { /* ignore */ }
    S.me = null;
    S.shellKey = '';
    go('/login');
  }

  async function globalScan() {
    const code = await scanCode();
    if (!code) return;
    try {
      const { product } = await GET('/api/lookup' + qs({ code }));
      if (product) return go(`/products/${product.id}`);
      if (can('product.edit') && await confirmBox('ไม่พบสินค้า', `ไม่พบสินค้าที่มีรหัส <b>${esc(code)}</b> ต้องการเพิ่มสินค้าใหม่ด้วยรหัสนี้หรือไม่?`, 'เพิ่มสินค้าใหม่')) {
        go('/products/new' + qs({ barcode: code }));
      } else if (!can('product.edit')) toast(`ไม่พบสินค้ารหัส ${code}`, 'err');
    } catch (e) { toast(e.message, 'err'); }
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'store') { e.preventDefault(); switchStore(); }
    else if (act === 'logout') { e.preventDefault(); logout(); }
    else if (act === 'scan') { e.preventDefault(); globalScan(); }
  });

  function renderNoStore() {
    S.shellKey = '';
    app.innerHTML = authLayout(`<form class="card blueprint auth-card" id="f" novalidate>${CORNERS}
      <div class="card-kicker">ยังไม่มีร้าน</div>
      <div class="card-title">สวัสดี ${esc(S.me.user.name)}</div>
      <div class="dialog-body">บัญชีของคุณยังไม่ได้อยู่ในร้านใด ขอให้เจ้าของร้านเชิญคุณเข้าร้าน หรือสร้างร้านใหม่ของคุณเอง</div>
      <div class="field"><label for="sn">ชื่อร้านใหม่</label><input class="input" id="sn" name="name" required maxlength="80" placeholder="เช่น Rose Beauty · สาขาสยาม"></div>
      <div class="form-err" hidden></div>
      <button class="btn btn-primary blueprint" type="submit" style="min-height:48px">${CORNERS}สร้างร้าน</button>
      <button class="btn btn-secondary" type="button" data-act="logout">${ic('logout')}ออกจากระบบ</button>
    </form>`);
    onSubmit($('#f'), async (d) => {
      S.me = await POST('/api/stores', { name: d.name });
      go('/');
    });
  }

  // ───────────────────────── auth views ─────────────────────────

  function authLayout(inner) {
    return `<div class="auth">
      <div class="auth-hero">
        <div class="brand"><div class="brand-mark">${ic('package', 24)}</div><span class="brand-name">CosmoStock</span></div>
        <div><h1>จัดการคลังง่าย<br>สต็อกแม่น<br>ธุรกิจเติบโต</h1>
        <p>ระบบจัดการคลังสินค้าเครื่องสำอาง ใช้ได้ทั้งมือถือ แท็บเล็ต และคอมพิวเตอร์</p></div>
        <div class="small" style="color:var(--color-accent-300)">© ${new Date().getFullYear() + 543} CosmoStock</div>
      </div>
      <div class="auth-side">
        <div class="auth-mhead">
          <div class="brand-mark" style="width:48px;height:48px">${ic('package', 26)}</div>
          <div><h1>CosmoStock</h1><p>จัดการคลังง่าย สต็อกแม่น ธุรกิจเติบโต</p></div>
        </div>
        ${inner}
        <div class="small muted" style="margin-top:20px;text-align:center">v1.0 · ระบบจัดการคลังสินค้าเครื่องสำอาง</div>
      </div>
    </div>`;
  }

  const authTabs = (on) => `<div class="seg"><a class="seg-opt ${on === 'login' ? 'on' : ''}" href="#/login">เข้าสู่ระบบ</a><a class="seg-opt ${on === 'register' ? 'on' : ''}" href="#/register">สมัครร้านใหม่</a></div>`;

  const pwField = (id, name, label, auto) => `<div class="field"><label for="${id}">${label}</label>
    <div class="input-icon"><input class="input" id="${id}" name="${name}" type="password" required autocomplete="${auto}" style="padding-left:10px;padding-right:48px">
    <button type="button" class="btn btn-ghost btn-ico eye plain" data-eye="${id}" aria-label="แสดงรหัสผ่าน">${ic('eye')}</button></div></div>`;

  function bindEyes(root) {
    $$('[data-eye]', root).forEach((b) => b.addEventListener('click', () => {
      const i = $('#' + b.dataset.eye, root);
      i.type = i.type === 'password' ? 'text' : 'password';
    }));
  }

  async function viewLogin() {
    return {
      html: authLayout(`<form class="card blueprint auth-card" id="f" novalidate>${CORNERS}
        ${authTabs('login')}
        <div class="field"><label for="em">อีเมล</label><input class="input" id="em" name="email" type="email" inputmode="email" autocomplete="username" required autocapitalize="none" spellcheck="false"></div>
        ${pwField('pw', 'password', 'รหัสผ่าน', 'current-password')}
        <div class="pw-row"><label class="check"><input type="checkbox" name="remember" checked>จดจำฉัน</label><a href="#" data-forgot style="padding:12px 0">ลืมรหัสผ่าน?</a></div>
        <div class="form-err" hidden></div>
        <button class="btn btn-primary blueprint" type="submit" style="min-height:50px;font-size:17px;width:100%">${CORNERS}เข้าสู่ระบบ</button>
        <div class="small muted">ถ้าบัญชีอยู่หลายร้าน เลือกร้านได้จากเมนูด้านบนหลังเข้าสู่ระบบ</div>
      </form>`),
      mount(root) {
        bindEyes(root);
        $('[data-forgot]', root).addEventListener('click', (e) => {
          e.preventDefault();
          modal({ title: 'ลืมรหัสผ่าน', body: '<div class="dialog-body">ให้เจ้าของร้านตั้งรหัสผ่านใหม่ให้ที่เมนู <b>ผู้ใช้และสิทธิ์</b> → ปุ่มกุญแจ ข้างชื่อของคุณ<br><br>ถ้าคุณเป็นเจ้าของร้านเอง ให้ติดต่อผู้ดูแลระบบของโปรเจกต์</div>', actions: [{ label: 'เข้าใจแล้ว', cls: 'btn-primary' }] });
        });
        onSubmit($('#f', root), async (d) => {
          await POST('/api/auth/login', { email: d.email, password: d.password, remember: !!d.remember });
          await loadMe();
          go('/');
        });
      },
    };
  }

  async function viewRegister() {
    return {
      html: authLayout(`<form class="card blueprint auth-card" id="f" novalidate>${CORNERS}
        ${authTabs('register')}
        <div class="field"><label for="sn">ชื่อร้าน *</label><input class="input" id="sn" name="storeName" required maxlength="80" placeholder="เช่น Rose Beauty · สาขาสยาม"></div>
        <div class="field"><label for="nm">ชื่อของคุณ *</label><input class="input" id="nm" name="name" required maxlength="80" autocomplete="name"></div>
        <div class="field"><label for="em">อีเมล *</label><input class="input" id="em" name="email" type="email" inputmode="email" autocomplete="email" required autocapitalize="none" spellcheck="false"></div>
        ${pwField('pw', 'password', 'รหัสผ่าน * (อย่างน้อย 8 ตัวอักษร)', 'new-password')}
        ${pwField('pw2', 'password2', 'ยืนยันรหัสผ่าน *', 'new-password')}
        <div class="form-err" hidden></div>
        <button class="btn btn-primary blueprint" type="submit" style="min-height:50px;font-size:17px;width:100%">${CORNERS}สร้างร้านและเข้าใช้งาน</button>
        <div class="small muted">คุณจะเป็น "เจ้าของร้าน" และเชิญพนักงานเข้าร้านได้ภายหลัง ข้อมูลของแต่ละร้านแยกจากกัน</div>
      </form>`),
      mount(root) {
        bindEyes(root);
        onSubmit($('#f', root), async (d) => {
          if (d.password !== d.password2) throw new Error('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
          await POST('/api/auth/register', d);
          await loadMe();
          toast('สร้างร้านเรียบร้อย ยินดีต้อนรับสู่ CosmoStock');
          go('/');
        });
      },
    };
  }

  // ───────────────────────── shared fragments ─────────────────────────

  function mvLi(m) {
    const tag = m.deleted ? 'div' : 'a';
    return `<${tag} class="li" ${m.deleted ? '' : `href="#/products/${m.productId}"`}>
      <span class="mv-ico ${m.type}">${ic(TYPE[m.type].icon)}</span>
      <div class="mid"><div class="t">${esc(m.name)}${m.deleted ? ' <span class="small muted">(ลบแล้ว)</span>' : ''}</div>
        <div class="s">${fmtDT(m.at)} · ${esc(m.by || '—')} · ${esc(m.docNo)}</div>${m.note || m.lotInfo ? `<div class="s">${esc([m.lotInfo, m.note].filter(Boolean).join(' · '))}</div>` : ''}</div>
      <div class="end"><div class="q ${m.qty > 0 ? 'pos' : 'neg'}">${signed(m.qty)}</div><div class="small muted">${fmtN(m.before)} → ${fmtN(m.after)}</div></div>
    </${tag}>`;
  }

  function mvTable(rows, { product = true } = {}) {
    return `<div class="table-wrap"><table class="table"><thead><tr><th>วันที่</th>${product ? '<th>สินค้า</th>' : ''}<th>ประเภท</th><th>เลขที่</th><th>ผู้ทำรายการ</th><th class="right">จำนวน</th><th class="right">คงเหลือ</th><th>ล็อต / หมายเหตุ</th></tr></thead><tbody>
      ${rows.map((m) => `<tr><td class="nowrap">${fmtDT(m.at)}</td>
        ${product ? `<td>${m.deleted ? esc(m.name) + ' <span class="small muted">(ลบแล้ว)</span>' : `<a href="#/products/${m.productId}" style="color:inherit">${esc(m.name)}</a>`}</td>` : ''}
        <td>${tyTag(m.type)}</td><td class="nowrap">${esc(m.docNo)}</td><td>${esc(m.by || '—')}</td>
        <td class="right num ${m.qty > 0 ? 'pos' : 'neg'}" style="font-weight:600">${signed(m.qty)}</td><td class="right num">${fmtN(m.after)}</td>
        <td class="small muted">${esc([m.lotInfo, m.note].filter(Boolean).join(' · ')) || '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
  }

  const mvBoth = (rows, opts) => (rows.length
    ? `<div class="hide-mobile">${mvTable(rows, opts)}</div><div class="list only-mobile">${rows.map(mvLi).join('')}</div>`
    : empty('history', 'ยังไม่มีรายการเคลื่อนไหว'));

  // ───────────────────────── dashboard ─────────────────────────

  async function viewDashboard() {
    const d = await GET('/api/dashboard');
    const st = S.me.store;
    const k = d.kpi;
    const maxV = Math.max(1, ...d.months.flatMap((m) => [m.in, m.out]));
    const pct = (v) => (v / maxV * 100).toFixed(1) + '%';
    const monthName = (m) => new Date(m.year, m.month, 1).toLocaleDateString('th-TH', { month: 'short' });
    const catMax = Math.max(1, ...d.categories.map((c) => c.value));
    const alertHtml = [
      ...d.alerts.low.map((a) => `<a class="alert-item ${a.kind === 'out' ? 'hot' : ''}" href="#/products/${a.productId}">${ic(a.kind === 'out' ? 'alert' : 'package')}
        <div class="tx"><b>${a.kind === 'out' ? 'หมดสต็อก' : 'สต็อกต่ำ'}</b> · ${esc(a.name)}<div class="small muted">คงเหลือ ${fmtN(a.qty)} / จุดสั่งซื้อ ${fmtN(a.reorderPoint)}</div></div>
        <span class="tag ${a.kind === 'out' ? 'st-out' : 'st-low'}">${fmtN(a.qty)}</span></a>`),
      ...d.alerts.expiring.map((e) => `<a class="alert-item exp" href="#/products/${e.productId}">${ic('clock')}
        <div class="tx"><b>${e.days < 0 ? 'หมดอายุแล้ว' : 'ใกล้หมดอายุ'}</b> · ${esc(e.name)}<div class="small muted">${esc(e.lotNo || 'ไม่ระบุล็อต')} · ${fmtN(e.qty)} ${esc(e.unit)} · ${fmtD(e.expiry)}</div></div>
        <span class="tag ${e.days < 0 ? 'st-expired' : 'st-exp'}">${e.days < 0 ? 'หมดอายุ' : e.days + ' วัน'}</span></a>`),
    ];
    const quick = [
      can('stock.move') && `<a class="btn btn-secondary" href="#/move/in">${ic('in', 20)}รับเข้า</a>`,
      can('stock.move') && `<a class="btn btn-secondary" href="#/move/out">${ic('out', 20)}จ่ายออก</a>`,
      can('stock.adjust') && `<a class="btn btn-secondary" href="#/move/adj">${ic('adjust', 20)}ปรับยอด</a>`,
      `<button type="button" class="btn btn-primary" data-act="scan">${ic('scan', 20)}สแกน</button>`,
    ].filter(Boolean);
    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>ภาพรวมคลังสินค้า</h2><div class="sub">${new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })} · ${esc(st.name)}</div></div>
          <div class="acts hide-mobile">
            <form id="qf" class="input-icon" style="width:280px">${ic('search')}<input class="input" name="q" placeholder="ค้นหาสินค้า / บาร์โค้ด"></form>
            ${can('stock.move') ? `<a class="btn btn-secondary" href="#/move/out">${ic('out')}จ่ายออก</a><a class="btn btn-primary blueprint" href="#/move/in">${CORNERS}${ic('in')}รับสินค้าเข้า</a>` : ''}
          </div>
        </div>
        <div class="quick only-mobile" style="grid-template-columns:repeat(${quick.length},1fr)">${quick.join('')}</div>
        <div class="kpis blueprint">${CORNERS}
          <a class="kpi" href="#/products"><div class="k">สินค้าทั้งหมด</div><div class="v">${fmtN(k.sku)} <small>SKU</small></div></a>
          <div class="kpi"><div class="k">คงเหลือรวม</div><div class="v">${fmtN(k.qty)} <small>ชิ้น</small></div></div>
          <div class="kpi"><div class="k">มูลค่าคลัง (ราคาทุน)</div><div class="v">${fmtB0(k.value)}</div></div>
          <a class="kpi warn" href="#/alerts"><div class="k">ใกล้หมด</div><div class="v">${fmtN(k.low)}</div></a>
          <a class="kpi warn" href="#/alerts"><div class="k">หมดสต็อก</div><div class="v">${fmtN(k.out)}</div></a>
          <a class="kpi exp" href="#/alerts?tab=exp"><div class="k">ใกล้หมดอายุ (≤ ${d.alerts.expiryDays} วัน)</div><div class="v">${fmtN(k.expiring)}</div></a>
        </div>
        <div class="grid-2">
          <div class="card blueprint">${CORNERS}
            <div class="card-head"><div class="card-title">สินค้าเข้า-ออก 6 เดือน (ชิ้น)</div>
              <span class="legend"><i style="background:var(--color-accent-2-400)"></i>รับเข้า</span><span class="legend"><i style="background:var(--color-accent-400)"></i>จ่ายออก</span></div>
            <div class="chart">${d.months.map((m) => `<div class="col"><div class="bar in" style="height:${pct(m.in)}" title="รับเข้า ${fmtN(m.in)}"></div><div class="bar out" style="height:${pct(m.out)}" title="จ่ายออก ${fmtN(m.out)}"></div></div>`).join('')}</div>
            <div class="chart-x">${d.months.map((m) => `<span>${monthName(m)}</span>`).join('')}</div>
          </div>
          <div class="card blueprint">${CORNERS}
            <div class="card-head"><div class="card-title">แจ้งเตือนสำคัญ</div><a href="#/alerts" class="small">ดูทั้งหมด</a></div>
            ${alertHtml.length ? `<div class="stack" style="gap:8px">${alertHtml.slice(0, 6).join('')}</div>` : empty('check', 'ไม่มีสินค้าที่ต้องดูแลตอนนี้')}
          </div>
        </div>
        <div class="grid-2">
          <div class="card blueprint">${CORNERS}
            <div class="card-head"><div class="card-title">รายการเคลื่อนไหวล่าสุด</div><a href="#/history" class="small">ประวัติทั้งหมด</a></div>
            ${mvBoth(d.recent)}
          </div>
          <div class="card blueprint">${CORNERS}
            <div class="card-title">มูลค่าคงคลังตามหมวดหมู่</div>
            ${d.categories.length ? d.categories.map((c) => `<div class="catbar"><span>${esc(c.name)}</span><div class="track"><div style="width:${(c.value / catMax * 100).toFixed(1)}%"></div></div><span class="right num">${fmtB0(c.value)}</span></div>`).join('') : empty('chart', 'ยังไม่มีข้อมูล')}
          </div>
        </div>
      </div>`,
      mount(root) {
        $('#qf', root)?.addEventListener('submit', (e) => {
          e.preventDefault();
          go('/products' + qs({ q: e.target.q.value.trim() }));
        });
      },
    };
  }

  // ───────────────────────── products ─────────────────────────

  async function deleteProduct(p) {
    return modal({
      title: `ลบสินค้า "${p.name}"?`,
      body: `<div class="dialog-body">สินค้าจะถูกซ่อนจากรายการและการค้นหา ประวัติการเคลื่อนไหวเดิมยังเก็บไว้เพื่อใช้ในรายงาน</div>
        <div class="field"><label for="cf">พิมพ์ SKU "${esc(p.sku)}" เพื่อยืนยัน</label><input class="input" id="cf" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
        <div class="form-err" hidden></div>`,
      actions: [{ label: 'ยกเลิก' }, {
        label: ic('trash') + 'ลบสินค้า',
        cls: 'btn-danger',
        onClick: async (dlg) => {
          await DEL(`/api/products/${p.id}`, { confirmSku: $('#cf', dlg).value });
          toast(`ลบ "${p.name}" แล้ว`);
          refreshMe();
          return true;
        },
      }],
    });
  }

  async function viewProducts({ query }) {
    const state = { q: query.q || '', cat: query.cat || '', status: query.status || '' };
    const [{ categories }, first] = await Promise.all([GET('/api/categories'), GET('/api/products' + qs(state))]);
    let products = first.products;
    const editable = can('product.edit');

    const listHtml = () => {
      if (!products.length) {
        return empty('package', state.q || state.cat || state.status ? 'ไม่พบสินค้าที่ตรงกับการค้นหา' : 'ยังไม่มีสินค้าในร้านนี้',
          editable ? '<a class="btn btn-primary" href="#/products/new">' + ic('plus') + 'เพิ่มสินค้าแรก</a>' : '');
      }
      return `<div class="card blueprint hide-mobile" style="padding:6px 14px">${CORNERS}<div class="table-wrap"><table class="table">
          <thead><tr><th>สินค้า</th><th>SKU</th><th>หมวดหมู่</th><th class="right">ราคาขาย</th><th class="right">คงเหลือ</th><th>สถานะ</th><th class="right">จัดการ</th></tr></thead>
          <tbody>${products.map((p) => `<tr>
            <td><div class="pn">${thumb(p, 'sm')}<a href="#/products/${p.id}">${esc(p.name)}</a></div></td>
            <td class="nowrap">${esc(p.sku)}</td><td>${esc(p.category || '—')}</td><td class="right num">${fmtB(p.price)}</td>
            <td class="right num" style="font-weight:600">${fmtN(p.qty)} <span class="small muted">${esc(p.unit)}</span></td><td>${stTag(p.status)}</td>
            <td class="acts">
              ${can('stock.move') ? `<a class="btn btn-ghost btn-ico plain" href="#/move/in?product=${p.id}" title="รับเข้า">${ic('in')}</a>` : ''}
              ${editable ? `<a class="btn btn-ghost btn-ico plain" href="#/products/${p.id}/edit" title="แก้ไข">${ic('edit')}</a>` : ''}
              ${can('product.delete') ? `<button type="button" class="btn btn-ghost btn-ico plain" data-del="${p.id}" title="ลบ">${ic('trash')}</button>` : ''}
            </td></tr>`).join('')}</tbody></table></div></div>
        <div class="list only-mobile">${products.map((p) => `<a class="li" href="#/products/${p.id}">${thumb(p, '')}
          <div class="mid"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.sku)} · ${esc(p.category || '—')}</div></div>
          <div class="end"><span class="q">${fmtN(p.qty)}</span>${stTag(p.status)}</div></a>`).join('')}</div>`;
    };

    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>สินค้า <span class="muted" style="font-size:18px" id="pcount">${products.length} รายการ</span></h2></div>
          <div class="acts">
            <button type="button" class="btn btn-secondary" id="csv">${ic('download')}ส่งออก CSV</button>
            ${editable ? `<a class="btn btn-primary blueprint hide-mobile" href="#/products/new">${CORNERS}${ic('plus')}เพิ่มสินค้า</a>` : ''}
          </div>
        </div>
        <div class="toolbar">
          <div class="input-icon">${ic('search')}<input class="input" id="q" type="search" placeholder="ค้นหาชื่อ, SKU, บาร์โค้ด" value="${esc(state.q)}" autocomplete="off"></div>
          <button type="button" class="btn btn-secondary btn-ico" id="scan" title="สแกน" aria-label="สแกน">${ic('scan', 20)}</button>
          <select class="input" id="status" aria-label="สถานะ">
            ${[['', 'สถานะ: ทั้งหมด'], ['alert', 'ต้องดูแล'], ['ok', 'ปกติ'], ['low', 'ใกล้หมด'], ['out', 'หมด'], ['exp', 'ใกล้หมดอายุ'], ['expired', 'หมดอายุ']]
              .map(([v, l]) => `<option value="${v}" ${state.status === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="chips" id="cats">${['', ...categories].map((c) => `<button type="button" class="chip ${state.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c || 'ทั้งหมด')}</button>`).join('')}</div>
        <div id="plist">${listHtml()}</div>
        ${editable ? `<a class="btn btn-primary blueprint fab only-mobile" href="#/products/new">${CORNERS}${ic('plus', 20)}เพิ่มสินค้า</a>` : ''}
      </div>`,
      mount(root) {
        const reload = async () => {
          replaceQuery('/products', state);
          try {
            products = (await GET('/api/products' + qs(state))).products;
            $('#plist', root).innerHTML = listHtml();
            $('#pcount', root).textContent = `${products.length} รายการ`;
          } catch (e) { toast(e.message, 'err'); }
        };
        const q = $('#q', root);
        q.addEventListener('input', debounce(() => { state.q = q.value.trim(); reload(); }, 250));
        q.addEventListener('keydown', async (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const code = q.value.trim();
          if (!code) return;
          const { product } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (product) go(`/products/${product.id}`);
        });
        $('#scan', root).addEventListener('click', async () => {
          const code = await scanCode();
          if (!code) return;
          const { product } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (product) return go(`/products/${product.id}`);
          q.value = code; state.q = code; reload();
          toast(`ไม่พบสินค้ารหัส ${code}`, 'err');
        });
        $('#status', root).addEventListener('change', (e) => { state.status = e.target.value; reload(); });
        $('#cats', root).addEventListener('click', (e) => {
          const b = e.target.closest('[data-cat]');
          if (!b) return;
          state.cat = b.dataset.cat;
          $$('[data-cat]', root).forEach((x) => x.classList.toggle('on', x === b));
          reload();
        });
        $('#plist', root).addEventListener('click', async (e) => {
          const b = e.target.closest('[data-del]');
          if (!b) return;
          const p = products.find((x) => x.id === Number(b.dataset.del));
          if (p && await deleteProduct(p)) reload();
        });
        $('#csv', root).addEventListener('click', () => downloadCSV(`cosmostock-products-${ymd(new Date())}.csv`, [
          ['SKU', 'ชื่อสินค้า', 'หมวดหมู่', 'บาร์โค้ด', 'หน่วย', 'ราคาทุน', 'ราคาขาย', 'จุดสั่งซื้อ', 'คงเหลือ', 'มูลค่าคงคลัง', 'สถานะ', 'หมดอายุใกล้สุด'],
          ...products.map((p) => [p.sku, p.name, p.category, p.barcode, p.unit, p.cost, p.price, p.reorderPoint, p.qty, p.qty * p.cost, STATUS[p.status], p.nextExpiry || '']),
        ]));
      },
    };
  }

  async function viewProduct({ params }) {
    const { product: p, lots, history, historyTotal } = await GET(`/api/products/${params.id}`);
    const exp = p.nextExpiry;
    const expHot = exp && p.daysToExpiry <= S.me.store.expiryDays;
    return {
      html: `<div class="page">
        <a href="#/products" class="btn btn-ghost back plain" style="align-self:flex-start">${ic('left')}สินค้าทั้งหมด</a>
        <div class="detail-head">
          ${thumb(p, 'xl')}
          <div class="ttl">
            <div class="card-kicker" style="color:var(--color-accent-700)">${esc(p.category || 'ไม่ระบุหมวด')} · ${esc(p.sku)}</div>
            <h2>${esc(p.name)}</h2>
            <div class="small muted">ราคาทุน ${fmtB(p.cost)} · ราคาขาย ${fmtB(p.price)} · จุดสั่งซื้อ ${fmtN(p.reorderPoint)} ${esc(p.unit)}${p.trackExpiry ? ' · ติดตามล็อต/วันหมดอายุ' : ''}</div>
            <div style="margin-top:8px">${stTag(p.status)}</div>
          </div>
          <div class="acts" style="display:flex;gap:8px">
            ${can('product.edit') ? `<a class="btn btn-secondary" href="#/products/${p.id}/edit">${ic('edit')}แก้ไข</a>` : ''}
            ${can('product.delete') ? `<button type="button" class="btn btn-secondary btn-ico" id="del" style="color:var(--color-accent-700)" aria-label="ลบสินค้า">${ic('trash')}</button>` : ''}
          </div>
        </div>
        <div class="pstats blueprint">${CORNERS}
          <div><div class="small muted">คงเหลือ</div><div class="balance" style="font-size:30px">${fmtN(p.qty)} <small style="font-size:15px">${esc(p.unit)}</small></div></div>
          <div><div class="small muted">มูลค่าคงคลัง</div><div class="balance" style="font-size:30px">${fmtB0(p.qty * p.cost)}</div></div>
          <div><div class="small muted">ล็อตที่มีอยู่</div><div class="balance" style="font-size:30px">${fmtN(lots.length)}</div></div>
          <div style="${expHot ? 'background:var(--color-accent-2-100)' : ''}"><div class="small muted">หมดอายุใกล้สุด</div><div class="balance" style="font-size:26px;${expHot ? 'color:var(--color-accent-2-700)' : ''}">${exp ? fmtD(exp) : '—'}</div>${exp ? `<div class="small muted">${daysLabel(p.daysToExpiry)}</div>` : ''}</div>
          <div class="qrbox"><div class="qr" id="qr"></div><div class="small" style="font-family:ui-monospace,monospace;overflow-wrap:anywhere">${esc(p.barcode || p.sku)}</div></div>
        </div>
        <div class="actions-4">
          ${can('stock.move') ? `<a class="btn btn-primary" href="#/move/in?product=${p.id}">${ic('in')}รับเข้า</a><a class="btn btn-secondary" href="#/move/out?product=${p.id}">${ic('out')}จ่าย/เบิก</a>` : ''}
          ${can('stock.adjust') ? `<a class="btn btn-secondary" href="#/move/adj?product=${p.id}">${ic('adjust')}ปรับยอด</a>` : ''}
          <button type="button" class="btn btn-secondary" id="print">${ic('printer')}พิมพ์ฉลาก QR</button>
        </div>
        <div class="grid-2e">
          <div class="card blueprint">${CORNERS}
            <div class="card-head"><div class="card-title">ประวัติการเคลื่อนไหว</div>${historyTotal > history.length ? `<a class="small" href="#/history?productId=${p.id}">ดูทั้งหมด (${fmtN(historyTotal)})</a>` : ''}</div>
            ${mvBoth(history, { product: false })}
          </div>
          <div class="card blueprint">${CORNERS}
            <div class="card-title">ล็อตสินค้า</div>
            ${lots.length ? `<table class="table rtable"><thead><tr><th>ล็อต</th><th>รับเข้า</th><th>หมดอายุ</th><th class="right">คงเหลือ</th></tr></thead><tbody>
              ${lots.map((l) => `<tr><td class="lead" data-label="">${esc(l.lotNo || 'ไม่ระบุล็อต')}</td><td data-label="รับเข้า">${fmtD(ymd(new Date(l.receivedAt)))}</td>
                <td data-label="หมดอายุ">${l.expiry ? (l.days <= S.me.store.expiryDays ? `<span class="tag ${l.days < 0 ? 'st-expired' : 'st-exp'}">${fmtD(l.expiry)} · ${daysLabel(l.days)}</span>` : fmtD(l.expiry)) : '—'}</td>
                <td class="right num" data-label="คงเหลือ">${fmtN(l.qty)}</td></tr>`).join('')}</tbody></table>`
              : empty('package', 'ยังไม่มีสินค้าในคลัง')}
            <div class="small muted">จ่ายออกจะตัดจากล็อตที่หมดอายุก่อนเสมอ (FEFO)</div>
          </div>
        </div>
      </div>`,
      mount(root) {
        qrSvg(p.barcode || p.sku).then((svg) => { const el = $('#qr', root); if (el) el.innerHTML = svg; }).catch(() => {});
        $('#print', root).addEventListener('click', () => printLabels(p));
        $('#del', root)?.addEventListener('click', async () => { if (await deleteProduct(p)) go('/products'); });
      },
    };
  }

  async function viewProductForm({ params, query }) {
    const editing = !!params.id;
    const [{ categories }, detail] = await Promise.all([GET('/api/categories'), editing ? GET(`/api/products/${params.id}`) : null]);
    const p = detail?.product || { name: '', sku: '', barcode: query.barcode || '', category: '', unit: 'ชิ้น', cost: '', price: '', reorderPoint: 10, trackExpiry: false };
    let image;
    const back = editing ? `#/products/${p.id}` : '#/products';
    const f = (name, label, attrs = '', value = p[name]) => `<div class="field"><label for="f-${name}">${label}</label><input class="input" id="f-${name}" name="${name}" value="${esc(value ?? '')}" ${attrs}></div>`;
    return {
      html: `<div class="page narrow">
        <div class="page-head"><a href="${back}" class="btn btn-ghost btn-ico plain back" aria-label="กลับ">${ic('left', 22)}</a><div class="ttl"><h2>${editing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2></div></div>
        <form id="pf" class="card blueprint form-card" novalidate>${CORNERS}
          <div class="img-pick">
            <div id="pimg">${editing ? thumb(p, 'lg') : `<div class="thumb lg">${ic('image', 26)}</div>`}</div>
            <div class="small muted">รูปสินค้า (ไม่บังคับ)<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
              <label class="btn btn-secondary" style="position:relative">${ic('camera')}อัปโหลดรูป<input type="file" id="file" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label>
              <button type="button" class="btn btn-ghost" id="rmimg" ${p.hasImage ? '' : 'hidden'}>ลบรูป</button></div></div>
          </div>
          ${f('name', 'ชื่อสินค้า *', 'required maxlength="120" placeholder="เช่น ลิปสติก Velvet Rose"')}
          <div class="row">
            ${f('sku', 'SKU *', 'required maxlength="40" autocapitalize="characters" spellcheck="false" placeholder="เช่น MU-LP04"')}
            <div class="field"><label for="f-category">หมวดหมู่</label><input class="input" id="f-category" name="category" list="catlist" value="${esc(p.category)}" maxlength="40" placeholder="เลือกหรือพิมพ์ใหม่">
              <datalist id="catlist">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          </div>
          <div class="field"><label for="f-barcode">บาร์โค้ด</label><div style="display:flex;gap:8px">
            <input class="input" id="f-barcode" name="barcode" value="${esc(p.barcode)}" maxlength="64" inputmode="numeric" placeholder="สแกนหรือพิมพ์" style="flex:1;min-width:0">
            <button type="button" class="btn btn-secondary btn-ico" id="scanbc" aria-label="สแกนบาร์โค้ด">${ic('scan', 20)}</button></div></div>
          <div class="row">
            ${f('cost', 'ราคาทุน (฿)', 'type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"')}
            ${f('price', 'ราคาขาย (฿)', 'type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"')}
          </div>
          <div class="row">
            ${f('unit', 'หน่วย', 'maxlength="20"')}
            ${f('reorderPoint', 'จุดสั่งซื้อ (แจ้งเตือนเมื่อเหลือไม่เกิน)', 'type="number" inputmode="numeric" min="0" step="1"')}
          </div>
          <label class="check"><input type="checkbox" name="trackExpiry" id="track" ${p.trackExpiry ? 'checked' : ''}>ติดตามล็อตและวันหมดอายุ</label>
          ${editing ? '' : `<div class="stack" style="gap:10px;border-top:1px solid var(--color-divider);padding-top:14px">
            <div class="card-kicker" style="color:var(--color-accent-700)">ยอดยกมา (ไม่บังคับ)</div>
            <div class="row3">
              ${f('initialQty', 'จำนวนเริ่มต้น', 'type="number" inputmode="numeric" min="0" step="1" placeholder="0"', '')}
              <div class="field lotf"><label for="f-lotNo">เลขล็อต</label><input class="input" id="f-lotNo" name="lotNo" maxlength="40"></div>
              <div class="field lotf"><label for="f-expiry">วันหมดอายุ</label><input class="input" id="f-expiry" name="expiry" type="date"></div>
            </div></div>`}
          <div class="form-err" hidden></div>
          <div class="form-foot sticky">
            <a class="btn btn-secondary" href="${back}">ยกเลิก</a>
            <button type="submit" class="btn btn-primary blueprint">${CORNERS}บันทึกสินค้า</button>
          </div>
        </form>
      </div>`,
      mount(root) {
        const form = $('#pf', root);
        const track = $('#track', root);
        const syncLot = () => $$('.lotf', root).forEach((e) => { e.hidden = !track.checked; });
        track.addEventListener('change', syncLot);
        syncLot();
        $('#file', root).addEventListener('change', async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          try {
            image = await resizeImage(file);
            $('#pimg', root).innerHTML = `<div class="thumb lg"><img src="${image}" alt=""></div>`;
            $('#rmimg', root).hidden = false;
          } catch (ex) { toast(ex.message, 'err'); }
          e.target.value = '';
        });
        $('#rmimg', root).addEventListener('click', () => {
          image = null;
          $('#pimg', root).innerHTML = `<div class="thumb lg">${ic('image', 26)}</div>`;
          $('#rmimg', root).hidden = true;
        });
        $('#scanbc', root).addEventListener('click', async () => {
          const code = await scanCode('สแกนบาร์โค้ดสินค้า');
          if (code) $('#f-barcode', root).value = code;
        });
        $('#f-barcode', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
        onSubmit(form, async (d) => {
          const body = {
            name: d.name, sku: d.sku, barcode: d.barcode, category: d.category, unit: d.unit,
            cost: d.cost, price: d.price, reorderPoint: d.reorderPoint === '' ? 0 : Number(d.reorderPoint), trackExpiry: !!d.trackExpiry,
          };
          if (image !== undefined) body.image = image;
          if (editing) {
            await PUT(`/api/products/${p.id}`, body);
            toast('บันทึกการแก้ไขแล้ว');
            go(`/products/${p.id}`);
          } else {
            if (image === undefined) body.image = null;
            if (d.initialQty) Object.assign(body, { initialQty: Number(d.initialQty), lotNo: d.trackExpiry ? d.lotNo : '', expiry: d.trackExpiry ? d.expiry : '' });
            const { id } = await POST('/api/products', body);
            toast('เพิ่มสินค้าแล้ว');
            refreshMe();
            go(`/products/${id}`);
          }
        });
      },
    };
  }

  // ───────────────────────── stock movements ─────────────────────────

  const MOVE = {
    in: { title: 'รับสินค้าเข้า', short: 'รับเข้า', btn: 'บันทึกรับเข้า', qty: 'จำนวนที่รับเข้า', note: 'ผู้จำหน่าย / หมายเหตุ', reasons: ['บจก. บิวตี้ซัพพลาย', 'สั่งซื้อเพิ่ม', 'รับคืนจากลูกค้า', 'โอนจากสาขาอื่น'] },
    out: { title: 'จ่าย / เบิกสินค้า', short: 'จ่าย/เบิก', btn: 'บันทึกจ่ายออก', qty: 'จำนวนที่จ่ายออก', note: 'เหตุผล / หมายเหตุ', reasons: ['ขายหน้าร้าน', 'ขายออนไลน์', 'เบิกใช้ในร้าน', 'ส่งสาขาอื่น', 'ทดลอง/แจกลูกค้า', 'ของเสีย/หมดอายุ'] },
    adj: { title: 'ปรับยอดสต็อก', short: 'ปรับยอด', btn: 'บันทึกปรับยอด', qty: 'จำนวนที่นับได้จริง', note: 'เหตุผลการปรับยอด *', reasons: ['นับสต็อกประจำเดือน', 'สินค้าชำรุด/แตก', 'สินค้าสูญหาย', 'บันทึกผิดพลาด'] },
  };

  async function viewMove({ params, query }) {
    const type = params.type;
    if (!MOVE[type]) return go('/');
    const allowed = { in: can('stock.move'), out: can('stock.move'), adj: can('stock.adjust') };
    if (!allowed[type]) return { html: forbidden() };
    const T = MOVE[type];
    const st = { product: null, lots: [] };
    if (query.product) {
      try { const d = await GET(`/api/products/${query.product}`); st.product = d.product; st.lots = d.lots; } catch { /* product gone */ }
    }
    return {
      html: `<div class="page narrow">
        <div class="page-head"><div class="ttl"><h2>${T.title}</h2><div class="sub">บันทึกการเคลื่อนไหวสต็อก · ${esc(S.me.store.name)}</div></div></div>
        <div class="seg" id="tabs"></div>
        <form id="mf" class="stack" novalidate autocomplete="off">
          <div class="field"><label>สินค้า *</label><div id="pick"></div></div>
          <div id="fields" class="stack"></div>
          <div class="form-err" hidden></div>
          <div class="form-foot sticky">
            <div class="grow"><div class="small muted">หลังบันทึก</div><div class="balance" id="bal">—</div></div>
            <button type="submit" class="btn btn-primary blueprint" id="go" style="min-height:50px;font-size:16px">${CORNERS}${T.btn}</button>
          </div>
        </form>
      </div>`,
      mount(root) {
        const form = $('#mf', root);
        const renderTabs = () => {
          $('#tabs', root).innerHTML = Object.entries(MOVE).map(([t, m]) => `<a class="seg-opt ${t === type ? 'on' : ''} ${allowed[t] ? '' : 'disabled'}" href="#/move/${t}${st.product ? '?product=' + st.product.id : ''}">${m.short}</a>`).join('');
        };
        const pick = async (id) => {
          try {
            const d = await GET(`/api/products/${id}`);
            st.product = d.product; st.lots = d.lots;
            replaceQuery(`/move/${type}`, { product: id });
            renderAll();
          } catch (e) { toast(e.message, 'err'); }
        };
        const lookupAndPick = async (code) => {
          const { product } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (product) { pick(product.id); return true; }
          toast(`ไม่พบสินค้ารหัส ${code}`, 'err');
          return false;
        };
        const renderPick = () => {
          const box = $('#pick', root);
          const p = st.product;
          if (p) {
            box.innerHTML = `<div class="card blueprint picked">${CORNERS}${thumb(p)}
              <div class="mid"><div class="card-title">${esc(p.name)}</div><div class="card-meta">SKU ${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</div></div>
              <div class="right"><div class="small muted">คงเหลือ</div><div class="balance">${fmtN(p.qty)}</div></div>
              <button type="button" class="btn btn-ghost btn-ico plain" id="unpick" aria-label="เปลี่ยนสินค้า">${ic('x', 20)}</button></div>`;
            $('#unpick', box).addEventListener('click', () => { st.product = null; replaceQuery(`/move/${type}`, {}); renderAll(); $('#ps', root)?.focus(); });
            return;
          }
          box.innerHTML = `<div class="picker"><div style="display:flex;gap:8px">
              <div class="input-icon">${ic('search')}<input class="input" id="ps" type="search" placeholder="พิมพ์ชื่อ / SKU หรือยิงบาร์โค้ด" autocomplete="off"></div>
              <button type="button" class="btn btn-primary btn-ico" id="pscan" aria-label="สแกน">${ic('scan', 20)}</button></div>
            <div class="picker-list" id="pl" hidden></div></div>
            <div class="small muted" style="margin-top:6px">${ic('camera', 14)} กดปุ่มสแกนเพื่อใช้กล้องมือถือ หรือใช้เครื่องยิงบาร์โค้ดที่ช่องค้นหา</div>`;
          const input = $('#ps', box);
          const list = $('#pl', box);
          let results = [];
          const search = debounce(async () => {
            const q = input.value.trim();
            if (!q) { list.hidden = true; return; }
            results = (await GET('/api/products' + qs({ q })).catch(() => ({ products: [] }))).products.slice(0, 8);
            list.innerHTML = results.length
              ? results.map((r) => `<button type="button" data-id="${r.id}">${thumb(r, 'sm')}<span style="flex:1;min-width:0"><div>${esc(r.name)}</div><div class="small muted">${esc(r.sku)} · คงเหลือ ${fmtN(r.qty)}</div></span>${stTag(r.status)}</button>`).join('')
              : '<div class="empty" style="padding:16px">ไม่พบสินค้า</div>';
            list.hidden = false;
          }, 200);
          input.addEventListener('input', search);
          input.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const code = input.value.trim();
            if (!code) return;
            const { product } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
            if (product) pick(product.id);
            else if (results[0]) pick(results[0].id);
          });
          list.addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) pick(Number(b.dataset.id)); });
          document.addEventListener('click', function off(e) {
            if (!list.isConnected) return document.removeEventListener('click', off);
            if (!box.contains(e.target)) list.hidden = true;
          });
          $('#pscan', box).addEventListener('click', async () => { const code = await scanCode(); if (code) lookupAndPick(code); });
        };
        const lotFields = (show) => `<div class="row lotrow" ${show ? '' : 'hidden'}>
            <div class="field"><label for="m-lot">เลขล็อต</label><input class="input" id="m-lot" name="lotNo" maxlength="40" list="lotlist" placeholder="เช่น LOT-2610A">
              <datalist id="lotlist">${st.lots.filter((l) => l.lotNo).map((l) => `<option value="${esc(l.lotNo)}">`).join('')}</datalist></div>
            <div class="field"><label for="m-exp">วันหมดอายุ</label><input class="input" id="m-exp" name="expiry" type="date"></div></div>`;
        const renderFields = () => {
          const p = st.product;
          const box = $('#fields', root);
          if (!p) {
            box.innerHTML = `<div class="card blueprint">${CORNERS}${empty('scan', 'เลือกสินค้าด้วยการค้นหาหรือสแกนบาร์โค้ดก่อน')}</div>`;
            $('#go', root).disabled = true;
            $('#bal', root).textContent = '—';
            return;
          }
          $('#go', root).disabled = false;
          const startQty = type === 'adj' ? p.qty : 1;
          box.innerHTML = `
            ${type === 'adj' ? `<div class="small muted">ยอดในระบบตอนนี้ <b style="color:var(--color-text)">${fmtN(p.qty)} ${esc(p.unit)}</b> — กรอกจำนวนที่นับได้จริง ระบบจะคำนวณส่วนต่างให้</div>` : ''}
            <div class="field"><label for="m-qty">${T.qty} (${esc(p.unit)})</label>
              <div class="stepper"><button type="button" class="btn" data-step="-1" aria-label="ลด">${ic('minus', 20)}</button>
              <input class="input num" id="m-qty" name="${type === 'adj' ? 'newQty' : 'qty'}" type="number" inputmode="numeric" min="${type === 'adj' ? 0 : 1}" step="1" value="${startQty}">
              <button type="button" class="btn" data-step="1" aria-label="เพิ่ม">${ic('plus', 20)}</button></div></div>
            ${type === 'in' ? lotFields(p.trackExpiry) : ''}
            ${type === 'adj' ? lotFields(false) : ''}
            ${type === 'out' && st.lots.some((l) => l.lotNo || l.expiry) ? `<div class="small muted">ระบบจะตัดจากล็อตที่หมดอายุก่อน: ${st.lots.slice(0, 3).map((l) => `${esc(l.lotNo || 'ไม่ระบุล็อต')} (${fmtN(l.qty)}${l.expiry ? ', ' + fmtD(l.expiry) : ''})`).join(' → ')}</div>` : ''}
            <div class="field"><label for="m-note">${T.note}</label>
              <div class="reason-chips" style="margin-bottom:8px">${T.reasons.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
              <input class="input" id="m-note" name="note" maxlength="200" ${type === 'adj' ? 'required' : ''}></div>`;
          const qty = $('#m-qty', box);
          const update = () => {
            const n = Math.max(0, Math.floor(Number(qty.value) || 0));
            const after = type === 'in' ? p.qty + n : type === 'out' ? p.qty - n : n;
            const diff = after - p.qty;
            $('#bal', root).innerHTML = `${fmtN(p.qty)} → <span class="${after < 0 ? 'neg' : diff >= 0 ? 'pos' : 'neg'}">${fmtN(after)}</span>${type === 'adj' ? ` <span class="small muted">(${signed(diff)})</span>` : ''}`;
            if (type === 'adj') $('.lotrow', box).hidden = !(p.trackExpiry && diff > 0);
          };
          qty.addEventListener('input', update);
          $$('[data-step]', box).forEach((b) => b.addEventListener('click', () => {
            qty.value = Math.max(Number(qty.min), (Math.floor(Number(qty.value) || 0)) + Number(b.dataset.step));
            update();
          }));
          $$('[data-reason]', box).forEach((b) => b.addEventListener('click', () => {
            $('#m-note', box).value = b.dataset.reason;
            $$('[data-reason]', box).forEach((x) => x.classList.toggle('on', x === b));
          }));
          update();
        };
        const renderAll = () => { renderTabs(); renderPick(); renderFields(); };
        renderAll();
        onSubmit(form, async (d) => {
          if (!st.product) throw new Error('กรุณาเลือกสินค้า');
          const body = { type, productId: st.product.id, note: d.note || '', lotNo: d.lotNo || '', expiry: d.expiry || '' };
          if (type === 'adj') {
            body.newQty = Number(d.newQty);
            if (!body.note.trim()) throw new Error('กรุณาระบุเหตุผลการปรับยอด');
          } else body.qty = Number(d.qty);
          const r = await POST('/api/movements', body);
          toast(`บันทึก ${r.docNo} แล้ว · ${r.name} คงเหลือ ${fmtN(r.after)} ${r.unit}`);
          await pick(st.product.id);
          refreshMe();
        });
      },
    };
  }

  // ───────────────────────── history ─────────────────────────

  async function viewHistory({ query }) {
    const state = {
      q: query.q || '', type: query.type || '', range: query.range || '30',
      from: query.from || ymd(addDays(new Date(), -29)), to: query.to || ymd(new Date()), productId: query.productId || '',
    };
    let productName = '';
    if (state.productId) productName = (await GET(`/api/products/${state.productId}`).catch(() => null))?.product?.name || 'สินค้าที่เลือก';
    const apiQuery = (extra = {}) => {
      let from = '', to = '';
      if (state.range === 'custom') {
        from = startOfDay(state.from).toISOString();
        to = addDays(startOfDay(state.to), 1).toISOString();
      } else if (state.range !== 'all') {
        from = addDays(startOfDay(ymd(new Date())), -(Number(state.range) - 1)).toISOString();
      }
      return qs({ q: state.q, type: state.type, from, to, productId: state.productId, ...extra });
    };
    let rows = [], total = 0;
    const load = async (append = false) => {
      const d = await GET('/api/movements' + apiQuery({ limit: 50, offset: append ? rows.length : 0 }));
      rows = append ? rows.concat(d.rows) : d.rows;
      total = d.total;
    };
    await load();
    const types = [['', 'ทั้งหมด'], ['in', 'รับเข้า'], ['out', 'จ่ายออก'], ['adj', 'ปรับยอด']];
    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>ประวัติการเคลื่อนไหว</h2><div class="sub" id="hcount"></div></div>
          <div class="acts"><button type="button" class="btn btn-secondary" id="csv">${ic('download')}ส่งออก CSV</button></div>
        </div>
        <div class="toolbar">
          <div class="input-icon">${ic('search')}<input class="input" id="q" type="search" placeholder="ค้นหาสินค้า / SKU / เลขที่เอกสาร / ล็อต" value="${esc(state.q)}"></div>
          <select class="input" id="range" aria-label="ช่วงเวลา">${[['7', '7 วัน'], ['30', '30 วัน'], ['90', '90 วัน'], ['365', '1 ปี'], ['all', 'ทั้งหมด'], ['custom', 'กำหนดเอง']].map(([v, l]) => `<option value="${v}" ${state.range === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <div class="toolbar" id="custom" ${state.range === 'custom' ? '' : 'hidden'} style="flex-wrap:nowrap">
            <input class="input" type="date" id="from" value="${state.from}" aria-label="ตั้งแต่"><span>–</span><input class="input" type="date" id="to" value="${state.to}" aria-label="ถึง"></div>
        </div>
        <div class="chips" id="types">${types.map(([v, l]) => `<button type="button" class="chip ${state.type === v ? 'on' : ''}" data-type="${v}">${l}</button>`).join('')}
          ${state.productId ? `<a class="chip on" href="#/history">${esc(productName)} ${ic('x', 14)}</a>` : ''}</div>
        <div class="card blueprint">${CORNERS}<div id="hlist"></div></div>
      </div>`,
      mount(root) {
        const paint = () => {
          $('#hlist', root).innerHTML = mvBoth(rows) + (rows.length < total ? `<button type="button" class="btn btn-secondary more-btn" id="more">โหลดเพิ่ม (${fmtN(total - rows.length)})</button>` : '');
          $('#hcount', root).textContent = `${fmtN(total)} รายการ`;
          $('#more', root)?.addEventListener('click', async () => { await load(true).catch((e) => toast(e.message, 'err')); paint(); });
        };
        const reload = async () => {
          replaceQuery('/history', { q: state.q, type: state.type, range: state.range === '30' ? '' : state.range, from: state.range === 'custom' ? state.from : '', to: state.range === 'custom' ? state.to : '', productId: state.productId });
          try { await load(); paint(); } catch (e) { toast(e.message, 'err'); }
        };
        paint();
        $('#q', root).addEventListener('input', debounce((e) => { state.q = e.target.value.trim(); reload(); }, 250));
        $('#range', root).addEventListener('change', (e) => { state.range = e.target.value; $('#custom', root).hidden = state.range !== 'custom'; reload(); });
        $('#from', root).addEventListener('change', (e) => { if (e.target.value) { state.from = e.target.value; reload(); } });
        $('#to', root).addEventListener('change', (e) => { if (e.target.value) { state.to = e.target.value; reload(); } });
        $('#types', root).addEventListener('click', (e) => {
          const b = e.target.closest('[data-type]');
          if (!b) return;
          state.type = b.dataset.type;
          $$('[data-type]', root).forEach((x) => x.classList.toggle('on', x === b));
          reload();
        });
        $('#csv', root).addEventListener('click', async () => {
          try {
            const d = await GET('/api/movements' + apiQuery({ limit: 1000 }));
            downloadCSV(`cosmostock-history-${ymd(new Date())}.csv`, [
              ['วันเวลา', 'เลขที่', 'ประเภท', 'SKU', 'สินค้า', 'จำนวน', 'ก่อน', 'หลัง', 'ล็อต', 'วันหมดอายุ', 'หมายเหตุ', 'ผู้ทำรายการ'],
              ...d.rows.map((m) => [fmtDTY(m.at), m.docNo, TYPE[m.type].label, m.sku, m.name, m.qty, m.before, m.after, m.lotInfo || '', m.expiry || '', m.note || '', m.by || '']),
            ]);
          } catch (e) { toast(e.message, 'err'); }
        });
      },
    };
  }

  // ───────────────────────── alerts ─────────────────────────

  async function viewAlerts({ query }) {
    const d = await GET('/api/alerts');
    let tab = query.tab === 'exp' ? 'exp' : 'low';
    const lowHtml = () => (d.low.length ? d.low.map((a) => {
      const w = a.reorderPoint ? Math.min(100, a.qty / a.reorderPoint * 100) : 0;
      return `<div class="card blueprint" style="gap:10px">${CORNERS}
        <div style="display:flex;align-items:center;gap:10px"><span style="color:${a.kind === 'out' ? 'var(--color-accent-700)' : 'var(--color-accent-600)'}">${ic(a.kind === 'out' ? 'alert' : 'package', 20)}</span>
          <div style="flex:1;min-width:0"><div class="card-kicker" style="color:var(--color-accent-700)">${a.kind === 'out' ? 'หมดสต็อก' : 'สต็อกต่ำ'}</div><a class="card-title" href="#/products/${a.productId}" style="color:inherit;text-decoration:none;font-size:16px">${esc(a.name)}</a></div>
          <span class="small muted">${esc(a.sku)}</span></div>
        <div class="progress"><div style="width:${w.toFixed(0)}%"></div></div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="flex:1;font-size:13px" class="muted">คงเหลือ ${fmtN(a.qty)} / จุดสั่งซื้อ ${fmtN(a.reorderPoint)} ${esc(a.unit)}</span>
          ${can('stock.move') ? `<a class="btn btn-secondary" href="#/move/in?product=${a.productId}">${ic('in')}รับเข้า</a>` : ''}</div>
      </div>`;
    }).join('') : empty('check', 'ไม่มีสินค้าใกล้หมดหรือหมดสต็อก'));
    const expHtml = () => (d.expiring.length ? `<div class="list">${d.expiring.map((e) => `<a class="li" href="#/products/${e.productId}">
        <span style="color:var(--color-accent-2-600)">${ic('clock', 20)}</span>
        <div class="mid"><div class="t">${esc(e.name)}</div><div class="s">${esc(e.lotNo || 'ไม่ระบุล็อต')} · ${fmtN(e.qty)} ${esc(e.unit)} · หมดอายุ ${fmtD(e.expiry)}</div></div>
        <span class="tag ${e.days < 0 ? 'st-expired' : 'st-exp'}">${e.days < 0 ? 'หมดอายุแล้ว' : e.days + ' วัน'}</span></a>`).join('')}</div>`
      : empty('check', `ไม่มีล็อตที่จะหมดอายุภายใน ${d.expiryDays} วัน`));
    return {
      html: `<div class="page narrow">
        <div class="page-head"><div class="ttl"><h2>แจ้งเตือน</h2><div class="sub">สินค้าที่ต่ำกว่าจุดสั่งซื้อ และล็อตที่จะหมดอายุภายใน ${d.expiryDays} วัน</div></div>
          ${can('settings') ? `<div class="acts"><a class="btn btn-secondary" href="#/settings">${ic('settings')}ตั้งค่าการแจ้งเตือน</a></div>` : ''}</div>
        <div class="seg" id="tabs">
          <a class="seg-opt ${tab === 'low' ? 'on' : ''}" href="#" data-tab="low">สต็อกใกล้หมด (${d.low.length})</a>
          <a class="seg-opt ${tab === 'exp' ? 'on' : ''}" href="#" data-tab="exp">ใกล้หมดอายุ (${d.expiring.length})</a></div>
        <div class="stack" id="alist">${tab === 'low' ? lowHtml() : expHtml()}</div>
      </div>`,
      mount(root) {
        $('#tabs', root).addEventListener('click', (e) => {
          const b = e.target.closest('[data-tab]');
          if (!b) return;
          e.preventDefault();
          tab = b.dataset.tab;
          $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b));
          $('#alist', root).innerHTML = tab === 'low' ? lowHtml() : expHtml();
          replaceQuery('/alerts', { tab: tab === 'exp' ? 'exp' : '' });
        });
      },
    };
  }

  // ───────────────────────── reports ─────────────────────────

  async function viewReports({ query }) {
    const today = new Date();
    const state = {
      tab: ['stock', 'movement', 'expiring', 'category'].includes(query.tab) ? query.tab : 'stock',
      from: query.from || ymd(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: query.to || ymd(today),
    };
    let data;
    const load = async () => {
      data = await GET('/api/reports' + qs({ from: startOfDay(state.from).toISOString(), to: addDays(startOfDay(state.to), 1).toISOString() }));
    };
    await load();
    const TABS = { stock: ['package', 'สต็อกคงเหลือ', 'คงเหลือ'], movement: ['history', 'เคลื่อนไหวตามช่วงเวลา', 'เคลื่อนไหว'], expiring: ['clock', 'สินค้าใกล้หมดอายุ', 'หมดอายุ'], category: ['chart', 'มูลค่าคลังตามหมวด', 'ตามหมวด'] };
    const presets = [
      ['เดือนนี้', ymd(new Date(today.getFullYear(), today.getMonth(), 1)), ymd(today)],
      ['เดือนก่อน', ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), ymd(new Date(today.getFullYear(), today.getMonth(), 0))],
      ['90 วัน', ymd(addDays(today, -89)), ymd(today)],
      ['ปีนี้', ymd(new Date(today.getFullYear(), 0, 1)), ymd(today)],
    ];

    const tables = {
      stock: () => {
        const rows = data.stock;
        const tq = rows.reduce((s, p) => s + p.qty, 0), tv = rows.reduce((s, p) => s + p.qty * p.cost, 0);
        return {
          html: `<table class="table rtable"><thead><tr><th>สินค้า</th><th>SKU</th><th>หมวดหมู่</th><th class="right">คงเหลือ</th><th class="right">ราคาทุน</th><th class="right">มูลค่า</th><th>สถานะ</th></tr></thead><tbody>
            ${rows.map((p) => `<tr><td class="lead" data-label="">${esc(p.name)}</td><td data-label="SKU">${esc(p.sku)}</td><td data-label="หมวดหมู่">${esc(p.category || '—')}</td>
              <td class="right num" data-label="คงเหลือ">${fmtN(p.qty)}</td><td class="right num" data-label="ราคาทุน">${fmtB(p.cost)}</td><td class="right num" data-label="มูลค่า" style="font-weight:600">${fmtB(p.qty * p.cost)}</td><td data-label="สถานะ">${stTag(p.status)}</td></tr>`).join('')}
            <tr class="total"><td class="lead" data-label="" style="font-weight:600">รวม ${fmtN(rows.length)} SKU</td><td></td><td></td><td class="right num" data-label="คงเหลือรวม" style="font-weight:600">${fmtN(tq)}</td><td></td><td class="right num" data-label="มูลค่ารวม" style="font-weight:600">${fmtB(tv)}</td><td></td></tr></tbody></table>`,
          csv: [['SKU', 'สินค้า', 'หมวดหมู่', 'คงเหลือ', 'หน่วย', 'ราคาทุน', 'มูลค่า', 'สถานะ'], ...rows.map((p) => [p.sku, p.name, p.category, p.qty, p.unit, p.cost, p.qty * p.cost, STATUS[p.status]]), ['', 'รวม', '', tq, '', '', tv, '']],
        };
      },
      movement: () => {
        const rows = data.movement;
        return {
          html: rows.length ? `<table class="table rtable"><thead><tr><th>สินค้า</th><th>SKU</th><th class="right">รับเข้า</th><th class="right">จ่ายออก</th><th class="right">ปรับยอด</th><th class="right">คงเหลือปัจจุบัน</th></tr></thead><tbody>
            ${rows.map((r) => `<tr><td class="lead" data-label="">${esc(r.name)}${r.deleted ? ' <span class="small muted">(ลบแล้ว)</span>' : ''}</td><td data-label="SKU">${esc(r.sku)}</td>
              <td class="right num pos" data-label="รับเข้า">${fmtN(r.in)}</td><td class="right num neg" data-label="จ่ายออก">${fmtN(r.out)}</td><td class="right num" data-label="ปรับยอด">${signed(r.adj)}</td><td class="right num" data-label="คงเหลือ" style="font-weight:600">${fmtN(r.qty)}</td></tr>`).join('')}
            <tr class="total"><td class="lead" data-label="" style="font-weight:600">รวม</td><td></td><td class="right num" data-label="รับเข้า" style="font-weight:600">${fmtN(data.summary.in)}</td><td class="right num" data-label="จ่ายออก" style="font-weight:600">${fmtN(data.summary.out)}</td><td class="right num" data-label="ปรับยอด" style="font-weight:600">${signed(data.summary.adj)}</td><td></td></tr></tbody></table>`
            : empty('history', 'ไม่มีการเคลื่อนไหวในช่วงเวลานี้'),
          csv: [['SKU', 'สินค้า', 'หมวดหมู่', 'รับเข้า', 'จ่ายออก', 'ปรับยอด', 'คงเหลือปัจจุบัน'], ...rows.map((r) => [r.sku, r.name, r.category, r.in, r.out, r.adj, r.qty])],
        };
      },
      expiring: () => {
        const rows = data.expiring;
        return {
          html: rows.length ? `<table class="table rtable"><thead><tr><th>สินค้า</th><th>ล็อต</th><th>หมดอายุ</th><th class="right">เหลือ (วัน)</th><th class="right">จำนวน</th></tr></thead><tbody>
            ${rows.map((e) => `<tr><td class="lead" data-label="">${esc(e.name)}</td><td data-label="ล็อต">${esc(e.lotNo || '—')}</td><td data-label="หมดอายุ">${fmtD(e.expiry)}</td>
              <td class="right" data-label="เหลือ"><span class="tag ${e.days < 0 ? 'st-expired' : 'st-exp'}">${e.days < 0 ? 'หมดอายุแล้ว' : e.days + ' วัน'}</span></td><td class="right num" data-label="จำนวน">${fmtN(e.qty)} ${esc(e.unit)}</td></tr>`).join('')}</tbody></table>`
            : empty('check', `ไม่มีล็อตที่จะหมดอายุภายใน ${S.me.store.expiryDays} วัน`),
          csv: [['SKU', 'สินค้า', 'ล็อต', 'วันหมดอายุ', 'เหลือ (วัน)', 'จำนวน'], ...rows.map((e) => [e.sku, e.name, e.lotNo, e.expiry, e.days, e.qty])],
        };
      },
      category: () => {
        const rows = data.categories;
        const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
        return {
          html: `<table class="table rtable"><thead><tr><th>หมวดหมู่</th><th class="right">จำนวน SKU</th><th class="right">คงเหลือ</th><th class="right">รับเข้า</th><th class="right">จ่ายออก</th><th class="right">มูลค่าคงเหลือ</th></tr></thead><tbody>
            ${rows.map((r) => `<tr><td class="lead" data-label="">${esc(r.category)}</td><td class="right num" data-label="จำนวน SKU">${fmtN(r.sku)}</td><td class="right num" data-label="คงเหลือ">${fmtN(r.qty)}</td>
              <td class="right num" data-label="รับเข้า">${fmtN(r.in)}</td><td class="right num" data-label="จ่ายออก">${fmtN(r.out)}</td><td class="right num" data-label="มูลค่า" style="font-weight:600">${fmtB(r.value)}</td></tr>`).join('')}
            <tr class="total"><td class="lead" data-label="" style="font-weight:600">รวม</td><td class="right num" data-label="จำนวน SKU" style="font-weight:600">${fmtN(sum('sku'))}</td><td class="right num" data-label="คงเหลือ" style="font-weight:600">${fmtN(sum('qty'))}</td>
              <td class="right num" data-label="รับเข้า" style="font-weight:600">${fmtN(sum('in'))}</td><td class="right num" data-label="จ่ายออก" style="font-weight:600">${fmtN(sum('out'))}</td><td class="right num" data-label="มูลค่า" style="font-weight:600">${fmtB(sum('value'))}</td></tr></tbody></table>`,
          csv: [['หมวดหมู่', 'จำนวน SKU', 'คงเหลือ', 'รับเข้า', 'จ่ายออก', 'ปรับยอด', 'มูลค่าคงเหลือ'], ...rows.map((r) => [r.category, r.sku, r.qty, r.in, r.out, r.adj, r.value])],
        };
      },
    };

    const summaryHtml = () => `<div class="kpis k4 blueprint">${CORNERS}
      <div class="kpi"><div class="k">รับเข้าทั้งช่วง</div><div class="v">${fmtN(data.summary.in)} <small>ชิ้น</small></div></div>
      <div class="kpi"><div class="k">จ่ายออกทั้งช่วง</div><div class="v">${fmtN(data.summary.out)} <small>ชิ้น</small></div></div>
      <div class="kpi"><div class="k">ปรับยอดสุทธิ</div><div class="v">${signed(data.summary.adj)} <small>ชิ้น</small></div></div>
      <div class="kpi"><div class="k">มูลค่าคลังปัจจุบัน</div><div class="v">${fmtB0(data.summary.value)}</div></div></div>`;

    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>รายงาน</h2><div class="sub">${esc(S.me.store.name)} · <span id="rng"></span></div></div>
          <div class="acts no-print">
            <button type="button" class="btn btn-secondary" id="pdf">${ic('file')}PDF / พิมพ์</button>
            <button type="button" class="btn btn-primary blueprint" id="csv">${CORNERS}${ic('download')}ส่งออก Excel (CSV)</button>
          </div>
        </div>
        <div class="toolbar no-print">
          <div class="field"><label for="from">ตั้งแต่</label><input class="input" type="date" id="from" value="${state.from}"></div>
          <div class="field"><label for="to">ถึง</label><input class="input" type="date" id="to" value="${state.to}"></div>
          <div class="chips" style="align-self:flex-end">${presets.map(([l, f, t], i) => `<button type="button" class="chip" data-preset="${i}">${l}</button>`).join('')}</div>
        </div>
        <div class="seg no-print" id="tabs" style="grid-auto-columns:minmax(0,1fr)">${Object.entries(TABS).map(([k, [icon, l, short]]) => `<a href="#" class="seg-opt ${state.tab === k ? 'on' : ''}" data-tab="${k}">${ic(icon)}<span class="hide-mobile">${l}</span><span class="only-mobile small">${short}</span></a>`).join('')}</div>
        <div id="sum"></div>
        <div class="card blueprint">${CORNERS}<div class="card-title" id="rtitle"></div><div id="rbody"></div></div>
      </div>`,
      mount(root) {
        const paint = () => {
          $('#sum', root).innerHTML = summaryHtml();
          $('#rtitle', root).textContent = TABS[state.tab][1];
          $('#rbody', root).innerHTML = tables[state.tab]().html;
          $('#rng', root).textContent = `${fmtD(state.from)} – ${fmtD(state.to)}`;
          replaceQuery('/reports', { tab: state.tab === 'stock' ? '' : state.tab, from: state.from, to: state.to });
        };
        const reload = async () => { try { await load(); paint(); } catch (e) { toast(e.message, 'err'); } };
        paint();
        $('#from', root).addEventListener('change', (e) => { if (e.target.value) { state.from = e.target.value; reload(); } });
        $('#to', root).addEventListener('change', (e) => { if (e.target.value) { state.to = e.target.value; reload(); } });
        $$('[data-preset]', root).forEach((b) => b.addEventListener('click', () => {
          const [, f, t] = presets[Number(b.dataset.preset)];
          state.from = f; state.to = t;
          $('#from', root).value = f; $('#to', root).value = t;
          reload();
        }));
        $('#tabs', root).addEventListener('click', (e) => {
          const b = e.target.closest('[data-tab]');
          if (!b) return;
          e.preventDefault();
          state.tab = b.dataset.tab;
          $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b));
          paint();
        });
        $('#pdf', root).addEventListener('click', () => window.print());
        $('#csv', root).addEventListener('click', () => downloadCSV(`cosmostock-report-${state.tab}-${state.from}_${state.to}.csv`, tables[state.tab]().csv));
      },
    };
  }

  // ───────────────────────── users & permissions ─────────────────────────

  async function showCredentials(title, email, password) {
    await modal({
      title,
      body: `<div class="dialog-body">ส่งข้อมูลนี้ให้ผู้ใช้เพื่อเข้าสู่ระบบ และแนะนำให้เปลี่ยนรหัสผ่านที่หน้า "ตั้งค่า" หลังเข้าใช้ครั้งแรก</div>
        <div class="demo-box" style="font-size:15px;color:var(--color-text)">อีเมล: <b>${esc(email)}</b><br>รหัสผ่าน: <b style="font-family:ui-monospace,monospace">${esc(password)}</b></div>`,
      actions: [{
        label: 'คัดลอก', onClick: async () => {
          try { await navigator.clipboard.writeText(`CosmoStock\nอีเมล: ${email}\nรหัสผ่าน: ${password}\n${location.origin}`); toast('คัดลอกแล้ว'); } catch { toast('คัดลอกไม่ได้ กรุณาจดไว้', 'err'); }
          return false;
        },
      }, { label: 'เสร็จสิ้น', cls: 'btn-primary' }],
    });
  }

  async function viewUsers() {
    const d = await GET('/api/members');
    const roleOpts = (sel) => Object.entries(d.roles).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>ผู้ใช้และสิทธิ์</h2><div class="sub">${esc(S.me.store.name)} — ผู้ใช้เห็นเฉพาะข้อมูลของร้านที่ได้รับเชิญ</div></div>
          <div class="acts"><button type="button" class="btn btn-primary blueprint" id="invite">${CORNERS}${ic('userplus')}เชิญผู้ใช้</button></div>
        </div>
        <div class="grid-2e">
          <div class="card blueprint">${CORNERS}<div class="card-title">สมาชิกในร้าน (${d.members.length})</div>
            <table class="table rtable"><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
            ${d.members.map((m) => `<tr>
              <td class="lead" data-label=""><div class="pn"><div class="avatar">${esc(initial(m.name))}</div><div style="min-width:0"><div>${esc(m.name)}${m.isMe ? ' <span class="tag tag-accent">คุณ</span>' : ''}</div><div class="small muted" style="overflow-wrap:anywhere">${esc(m.email)}</div></div></div></td>
              <td data-label="บทบาท"><select class="input" data-role="${m.id}" ${m.isMe ? 'disabled title="เปลี่ยนบทบาทของตัวเองไม่ได้"' : ''} style="min-width:140px">${roleOpts(m.role)}</select></td>
              <td data-label="เข้าใช้ล่าสุด" class="small">${m.lastLogin ? fmtDTY(m.lastLogin) : 'ยังไม่เคยเข้าใช้'}</td>
              <td class="acts" data-label="">${m.isMe ? '' : `<button type="button" class="btn btn-ghost btn-ico plain" data-reset="${m.id}" title="ตั้งรหัสผ่านใหม่">${ic('key')}</button><button type="button" class="btn btn-ghost btn-ico plain" data-remove="${m.id}" title="นำออกจากร้าน">${ic('trash')}</button>`}</td>
            </tr>`).join('')}</tbody></table></div>
          <div class="card blueprint">${CORNERS}<div class="card-title">สิทธิ์ตามบทบาท</div>
            <div class="table-wrap"><table class="table perm"><thead><tr><th>การใช้งาน</th>${Object.values(d.roles).map((r) => `<th>${r}</th>`).join('')}</tr></thead><tbody>
            ${d.matrix.map((row) => `<tr><td>${esc(row.label)}</td>${row.cells.map((c) => `<td class="${c ? 'perm-yes' : 'perm-no'}">${ic(c ? 'check' : 'minus')}</td>`).join('')}</tr>`).join('')}
            </tbody></table></div></div>
        </div>
      </div>`,
      mount(root) {
        const byId = (id) => d.members.find((m) => m.id === Number(id));
        $$('[data-role]', root).forEach((s) => s.addEventListener('change', async () => {
          const m = byId(s.dataset.role);
          try {
            await PUT(`/api/members/${m.id}`, { role: s.value });
            toast(`เปลี่ยนบทบาท ${m.name} เป็น ${d.roles[s.value]} แล้ว`);
            m.role = s.value;
          } catch (e) { toast(e.message, 'err'); s.value = m.role; }
        }));
        $$('[data-remove]', root).forEach((b) => b.addEventListener('click', async () => {
          const m = byId(b.dataset.remove);
          if (!await confirmBox('นำผู้ใช้ออกจากร้าน?', `<b>${esc(m.name)}</b> จะไม่สามารถเข้าดูข้อมูลของร้านนี้ได้อีก (บัญชีและประวัติที่เคยบันทึกยังอยู่)`, 'นำออก', true)) return;
          try { await DEL(`/api/members/${m.id}`); toast('นำออกจากร้านแล้ว'); render(); } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-reset]', root).forEach((b) => b.addEventListener('click', async () => {
          const m = byId(b.dataset.reset);
          const pw = await modal({
            title: `ตั้งรหัสผ่านใหม่ให้ ${m.name}`,
            body: `<div class="field"><label for="np">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label><div style="display:flex;gap:8px"><input class="input" id="np" value="${genPassword()}" style="font-family:ui-monospace,monospace"><button type="button" class="btn btn-secondary" id="gen">สุ่มใหม่</button></div></div>
              <div class="small muted">ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์ และต้องใช้รหัสใหม่นี้เข้าสู่ระบบ</div><div class="form-err" hidden></div>`,
            onMount(dlg) { $('#gen', dlg).addEventListener('click', () => { $('#np', dlg).value = genPassword(); }); },
            actions: [{ label: 'ยกเลิก' }, { label: 'บันทึกรหัสผ่าน', cls: 'btn-primary', onClick: async (dlg) => { const v = $('#np', dlg).value; await PUT(`/api/members/${m.id}`, { password: v }); return v; } }],
          });
          if (pw) showCredentials('ตั้งรหัสผ่านใหม่แล้ว', m.email, pw);
        }));
        $('#invite', root).addEventListener('click', async () => {
          const res = await modal({
            title: 'เชิญผู้ใช้เข้าร้าน',
            wide: true,
            body: `<div class="field"><label for="iv-em">อีเมล *</label><input class="input" id="iv-em" type="email" inputmode="email" autocapitalize="none" spellcheck="false"></div>
              <div class="field"><label for="iv-nm">ชื่อ-นามสกุล</label><input class="input" id="iv-nm" maxlength="80"></div>
              <div class="field"><label for="iv-rl">บทบาท</label><select class="input" id="iv-rl">${roleOpts('staff')}</select></div>
              <div class="field"><label for="iv-pw">รหัสผ่านเริ่มต้น</label><div style="display:flex;gap:8px"><input class="input" id="iv-pw" value="${genPassword()}" style="font-family:ui-monospace,monospace"><button type="button" class="btn btn-secondary" id="gen">สุ่มใหม่</button></div>
                <div class="hint">ถ้าอีเมลนี้มีบัญชี CosmoStock อยู่แล้ว ระบบจะเพิ่มเข้าร้านโดยใช้รหัสผ่านเดิมของเขา</div></div>
              <div class="form-err" hidden></div>`,
            onMount(dlg) { $('#gen', dlg).addEventListener('click', () => { $('#iv-pw', dlg).value = genPassword(); }); },
            actions: [{ label: 'ยกเลิก' }, {
              label: ic('userplus') + 'เพิ่มเข้าร้าน', cls: 'btn-primary',
              onClick: async (dlg) => {
                const body = { email: $('#iv-em', dlg).value, name: $('#iv-nm', dlg).value, role: $('#iv-rl', dlg).value, password: $('#iv-pw', dlg).value };
                const r = await POST('/api/members', body);
                return { ...body, created: r.created };
              },
            }],
          });
          if (!res) return;
          toast('เพิ่มผู้ใช้เข้าร้านแล้ว');
          if (res.created) await showCredentials('สร้างบัญชีผู้ใช้แล้ว', res.email.trim().toLowerCase(), res.password);
          render();
        });
      },
    };
  }

  // ───────────────────────── settings & more ─────────────────────────

  async function viewSettings() {
    const { user, store, stores } = S.me;
    return {
      html: `<div class="page narrow">
        <div class="page-head"><div class="ttl"><h2>ตั้งค่า</h2><div class="sub">${esc(user.email)}</div></div></div>
        ${can('settings') ? `<form class="card blueprint form-card" id="sf" novalidate>${CORNERS}
          <div class="card-title">ตั้งค่าร้าน · ${esc(store.name)}</div>
          <div class="field"><label for="s-nm">ชื่อร้าน / สาขา</label><input class="input" id="s-nm" name="name" value="${esc(store.name)}" maxlength="80" required></div>
          <div class="field"><label for="s-ed">แจ้งเตือนสินค้าใกล้หมดอายุล่วงหน้า (วัน)</label><input class="input" id="s-ed" name="expiryDays" type="number" inputmode="numeric" min="1" max="730" value="${store.expiryDays}">
            <div class="hint">จุดสั่งซื้อ (แจ้งเตือนสต็อกต่ำ) ตั้งแยกได้ในหน้าแก้ไขสินค้าแต่ละตัว</div></div>
          <div class="form-err" hidden></div>
          <div class="form-foot"><button type="submit" class="btn btn-primary">บันทึกการตั้งค่าร้าน</button></div>
        </form>` : ''}
        <form class="card blueprint form-card" id="af" novalidate>${CORNERS}
          <div class="card-title">บัญชีของฉัน</div>
          <div class="field"><label for="a-nm">ชื่อที่แสดง</label><input class="input" id="a-nm" name="name" value="${esc(user.name)}" maxlength="80" required></div>
          <div class="form-err" hidden></div>
          <div class="form-foot"><button type="submit" class="btn btn-secondary">บันทึกชื่อ</button></div>
        </form>
        <form class="card blueprint form-card" id="pf" novalidate>${CORNERS}
          <div class="card-title">เปลี่ยนรหัสผ่าน</div>
          ${pwField('p-cur', 'current', 'รหัสผ่านปัจจุบัน', 'current-password')}
          ${pwField('p-new', 'next', 'รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)', 'new-password')}
          ${pwField('p-new2', 'next2', 'ยืนยันรหัสผ่านใหม่', 'new-password')}
          <div class="form-err" hidden></div>
          <div class="form-foot"><button type="submit" class="btn btn-primary">${ic('key')}เปลี่ยนรหัสผ่าน</button></div>
        </form>
        <div class="card blueprint form-card">${CORNERS}
          <div class="card-title">ร้านของฉัน (${stores.length})</div>
          <div class="stack" style="gap:8px">${stores.map((s) => `<button type="button" class="store-opt ${s.id === store.id ? 'on' : ''}" data-sw="${s.id}">${ic('store', 20)}<span class="nm">${esc(s.name)}<div class="small muted">${esc(s.roleLabel)}</div></span>${s.id === store.id ? '<span class="tag tag-accent">กำลังใช้งาน</span>' : `<span class="small">สลับ</span>${ic('right')}`}</button>`).join('')}</div>
          <form id="nf" class="stack" style="gap:10px;border-top:1px solid var(--color-divider);padding-top:14px" novalidate>
            <div class="field"><label for="n-nm">เพิ่มร้าน / สาขาใหม่ (คุณจะเป็นเจ้าของร้าน)</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="n-nm" name="name" maxlength="80" placeholder="เช่น Rose Beauty · สาขาอารีย์" style="flex:1 1 220px"><button type="submit" class="btn btn-secondary">${ic('plus')}สร้างร้าน</button></div></div>
            <div class="form-err" hidden></div>
          </form>
        </div>
        <button type="button" class="btn btn-secondary" data-act="logout" style="min-height:50px;color:var(--color-accent-700);border-color:var(--color-accent-300)">${ic('logout', 20)}ออกจากระบบ</button>
      </div>`,
      mount(root) {
        bindEyes(root);
        const sf = $('#sf', root);
        if (sf) onSubmit(sf, async (d) => { await PUT('/api/store', { name: d.name, expiryDays: Number(d.expiryDays) }); toast('บันทึกการตั้งค่าร้านแล้ว'); await refreshMe(); });
        onSubmit($('#af', root), async (d) => { S.me = await PUT('/api/me', { name: d.name }); updateShellBits(); toast('บันทึกชื่อแล้ว'); });
        onSubmit($('#pf', root), async (d, form) => {
          if (d.next !== d.next2) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
          await POST('/api/me/password', { current: d.current, next: d.next });
          form.reset();
          toast('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นจะถูกออกจากระบบ');
        });
        onSubmit($('#nf', root), async (d) => {
          S.me = await POST('/api/stores', { name: d.name });
          toast(`สร้างร้าน ${S.me.store.name} แล้ว`);
          go('/');
        });
        $$('[data-sw]', root).forEach((b) => b.addEventListener('click', async () => {
          const id = Number(b.dataset.sw);
          if (id === store.id) return;
          try { S.me = await POST('/api/me/store', { storeId: id }); toast('สลับไปที่ ' + S.me.store.name); go('/'); } catch (e) { toast(e.message, 'err'); }
        }));
      },
    };
  }

  async function viewMore() {
    const { user, store, stores } = S.me;
    const link = (href, icon, label, extra = '') => `<a href="${href}">${ic(icon, 20)}<span class="lbl">${label}</span>${extra}${ic('right')}</a>`;
    return {
      html: `<div class="page narrow">
        <div class="card blueprint" style="flex-direction:row;align-items:center;gap:12px;padding:14px">${CORNERS}
          <div class="avatar lg">${esc(initial(user.name))}</div>
          <div style="flex:1;min-width:0"><div class="card-title">${esc(user.name)}</div><div class="card-meta" style="overflow-wrap:anywhere">${esc(user.email)}</div></div>
          <span class="tag tag-accent">${esc(store.roleLabel)}</span></div>
        <div class="field"><label>ร้านที่กำลังจัดการ</label>
          <button type="button" class="btn btn-secondary store-btn" data-act="store" style="width:100%;min-height:52px">${ic('store', 20)}<span class="nm">${esc(store.name)}</span>${stores.length > 1 ? '<span class="small muted">สลับร้าน</span>' : ''}${ic('right')}</button></div>
        <div class="menu-sec"><div class="h">คลังสินค้า</div>
          ${can('stock.adjust') ? link('#/move/adj', 'adjust', 'ปรับยอดสต็อก') : ''}
          ${link('#/history', 'history', 'ประวัติการเคลื่อนไหว')}
          ${link('#/alerts', 'bell', 'การแจ้งเตือน', store.alertCount ? `<span class="tag tag-accent">${store.alertCount}</span>` : '')}
          ${can('report') ? link('#/reports', 'chart', 'รายงาน') : ''}
          <button type="button" class="mi" data-act="scan">${ic('scan', 20)}<span class="lbl">สแกน Barcode / QR</span>${ic('right')}</button>
        </div>
        <div class="menu-sec"><div class="h">บัญชีและร้าน</div>
          ${can('users') ? link('#/users', 'users', 'ผู้ใช้และสิทธิ์') : ''}
          ${link('#/settings', 'settings', can('settings') ? 'ตั้งค่าร้าน · แจ้งเตือนหมดอายุ · รหัสผ่าน' : 'ตั้งค่าบัญชี · รหัสผ่าน')}
        </div>
        <button type="button" class="btn btn-secondary" data-act="logout" style="min-height:50px;font-size:16px;color:var(--color-accent-700);border-color:var(--color-accent-300)">${ic('logout', 20)}ออกจากระบบ</button>
        <div class="small muted" style="text-align:center">CosmoStock v1.0</div>
      </div>`,
    };
  }

  // ───────────────────────── boot ─────────────────────────

  window.addEventListener('hashchange', render);
  render();
})();
