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
  const CORNERS = ''; // เดิมเป็นเครื่องหมาย + ที่มุมกรอบ ตอนนี้ไม่ใช้แล้ว
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
  function fmtPacks(qty, packs, unit) {
    if (!packs?.length || qty <= 0) return '';
    let left = qty;
    const parts = [];
    for (const k of packs) {
      const n = Math.floor(left / k.perQty);
      if (n) { parts.push(`${fmtN(n)} ${k.name}`); left -= n * k.perQty; }
    }
    if (!parts.length) return '';
    if (left) parts.push(`${fmtN(left)} ${unit}`);
    return parts.join(' ');
  }
  const packNote = (m) => (m.packName ? `${fmtN(m.packCount)} ${m.packName}` : '');
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

  // QR ต่อล็อต: CSL1|<sku>|<เลขล็อต>|<วันหมดอายุ> (แต่ละช่อง URI-encode) — เซิร์ฟเวอร์แยกกลับด้วย parseLotCode
  const lotCode = (p, l) => `CSL1|${encodeURIComponent(p.sku)}|${encodeURIComponent(l.lotNo || '')}|${l.expiry || ''}`;
  const lotPrintable = (l) => !!(l.lotNo || l.expiry);

  async function printLabels(p, lots = [], pickLotId = null) {
    const units = [
      { key: '', name: p.unit, per: 1, code: p.barcode || p.sku, barcode: p.barcode, price: p.price },
      ...[...(p.packs || [])].reverse().filter((k) => k.barcode).map((k) => ({ key: String(k.id), name: k.name, per: k.perQty, code: k.barcode, barcode: k.barcode, price: k.price })),
      ...lots.filter(lotPrintable).map((l) => ({ key: `lot:${l.id}`, name: `ล็อต ${l.lotNo || fmtD(l.expiry)}`, per: 1, code: lotCode(p, l), barcode: '', price: p.price, lot: l })),
    ];
    try {
      const svgs = await Promise.all(units.map((u) => qrSvg(u.code)));
      units.forEach((u, i) => { u.svg = svgs[i]; });
    } catch (e) { toast(e.message, 'err'); return; }
    const MAX = 60;
    const clampN = (v) => Math.min(MAX, Math.max(1, Math.floor(Number(v)) || 1));
    const unitOf = (key) => units.find((u) => u.key === key) || units[0];
    let sel = units.some((u) => u.key === `lot:${pickLotId}`) ? `lot:${pickLotId}` : '';
    const labelHtml = (u, price) => `<div class="label">${u.svg}<div><b>${esc(p.name)}</b>${u.lot ? `<br><b>ล็อต ${esc(u.lot.lotNo || '-')}</b>${u.lot.expiry ? `<br>หมดอายุ ${fmtD(u.lot.expiry)}` : ''}` : ''}${u.per > 1 ? `<br><b>${esc(u.name)} · ${fmtN(u.per)} ${esc(p.unit)}</b>` : ''}<br>${esc(p.sku)}${u.barcode ? '<br>' + esc(u.barcode) : ''}${price && u.price != null ? '<br>' + fmtB(u.price) : ''}</div></div>`;
    const opts = await modal({
      title: 'พิมพ์ฉลาก QR',
      wide: true,
      body: `<div class="dialog-body">${esc(p.name)} · ${esc(p.sku)}</div>
        ${units.length > 1 ? `<div class="field"><label>ฉลากสำหรับหน่วย</label><div class="seg unit-seg" id="lbl-unit">${units.map((u, i) => `<button type="button" class="btn btn-secondary seg-opt ${u.key === sel ? 'on' : ''}" data-unit="${u.key}">${esc(u.name)}${u.per > 1 ? ` <span class="small">×${fmtN(u.per)}</span>` : ''}</button>`).join('')}</div></div>` : ''}
        ${(p.packs || []).some((k) => !k.barcode) ? '<div class="small muted">หน่วยบรรจุที่ยังไม่มีบาร์โค้ดจะพิมพ์ฉลากไม่ได้ เพิ่มบาร์โค้ดได้ที่หน้าแก้ไขสินค้า</div>' : ''}
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
        { label: ic('printer') + 'พิมพ์', cls: 'btn-primary', onClick: (dlg) => ({ n: clampN($('#lbl-n', dlg).value), price: $('#lbl-price', dlg).checked, unit: unitOf(sel) }) },
      ],
      onMount(dlg) {
        const input = $('#lbl-n', dlg);
        const price = $('#lbl-price', dlg);
        const draw = () => {
          const n = clampN(input.value);
          $('#lbl-sheet', dlg).innerHTML = labelHtml(unitOf(sel), price.checked).repeat(n);
          $('#lbl-count', dlg).textContent = `${fmtN(n)} ฉลาก`;
        };
        $('#lbl-unit', dlg)?.addEventListener('click', (e) => {
          const b = e.target.closest('[data-unit]');
          if (!b) return;
          sel = b.dataset.unit;
          $$('[data-unit]', dlg).forEach((x) => x.classList.toggle('on', x === b));
          draw();
        });
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
    $('#print-area').innerHTML = labelHtml(opts.unit, opts.price).repeat(opts.n);
    document.body.classList.add('print-label');
    const done = () => { document.body.classList.remove('print-label'); $('#print-area').innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  // ───────────────────────── routing ─────────────────────────

  const ROUTES = [
    ['/login', viewLogin, { public: true }],
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
    ['/system', viewSystem, { nav: 'system', sys: true }],
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
    if ((route.opts.perm && !can(route.opts.perm)) || (route.opts.sys && !S.me.user.superadmin)) { view.innerHTML = forbidden(); return; }
    const loader = setTimeout(() => { if (seq === renderSeq) view.innerHTML = '<div class="page" aria-busy="true" aria-label="กำลังโหลด"><div class="sk sk-h"></div><div class="sk sk-kpis"></div><div class="sk sk-card"></div><div class="sk sk-card short"></div></div>'; }, 180);
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

  // ชื่อเต็มของสาขา: "ร้าน · สาขา" (สาขาอยู่ภายใต้ร้านเสมอ)
  const storeLabel = (s) => (s ? (s.orgName ? `${s.orgName} · ${s.name}` : s.name) : '');

  function impBar() {
    const by = S.me?.user.impersonatedBy;
    return by ? `<div class="imp-bar" role="status">${ic('eye', 18)}<span>กำลังสวมสิทธิ์เป็น <b>${esc(S.me.user.name)}</b> (${esc(S.me.user.email)}) — ทุกรายการที่บันทึกจะระบุว่าทำโดยผู้ดูแลระบบ (${esc(by.email)})</span>
      <button type="button" class="btn btn-secondary" data-act="unimp">กลับเป็นผู้ดูแลระบบ</button></div>` : '';
  }

  async function stopImpersonating() {
    try {
      await POST('/api/auth/impersonate/stop');
      S.shellKey = '';
      await loadMe();
      toast('กลับเป็นผู้ดูแลระบบแล้ว');
      go(S.me?.user.superadmin ? '/system' : '/');
    } catch (e) { toast(e.message, 'err'); }
  }

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
        <a class="brand" href="#/"><img class="brand-mark" src="/logo-192.png" alt=""><div><div class="brand-name">CosmoStock</div><div class="brand-tag">จัดการคลังง่าย สต็อกแม่น ธุรกิจเติบโต</div></div></a>
        <button type="button" class="btn btn-secondary store-btn" data-act="store">${ic('store')}<span class="nm" data-bind="store"></span>${ic('down', 16)}</button>
        <nav class="nav">${navItems().map(navLink).join('')}</nav>
        <div class="nav-sec">บัญชีและร้าน</div>
        <nav class="nav">
          ${S.me.user.superadmin ? navLink({ nav: 'system', href: '#/system', icon: 'key', label: 'ผู้ดูแลระบบ' }) : ''}
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
        ${impBar()}
        <header class="top">
          <img class="brand-mark" src="/logo-192.png" alt="" style="width:32px;height:32px">
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
    $$('[data-bind=store]').forEach((e) => { e.textContent = storeLabel(store); });
    $$('[data-bind=user]').forEach((e) => { e.textContent = user.name; });
    $$('[data-bind=role]').forEach((e) => { e.textContent = user.superadmin ? 'ผู้ดูแลระบบ' : store.roleLabel; });
    $$('[data-bind=initial]').forEach((e) => { e.textContent = initial(user.name); });
    $$('[data-bind=badge], [data-bind=badge-tag]').forEach((e) => { e.textContent = count > 99 ? '99+' : String(count); e.hidden = !count; });
  }

  function storeOptions(stores, current, attr, tail) {
    const groups = new Map();
    for (const s of stores) {
      if (!groups.has(s.orgId)) groups.set(s.orgId, { name: s.orgName, list: [] });
      groups.get(s.orgId).list.push(s);
    }
    const head = groups.size > 1;
    return [...groups.values()].map((g) => `${head ? `<div class="small muted" style="margin-top:4px;font-weight:600">${esc(g.name || 'ร้าน')}</div>` : ''}
      ${g.list.map((s) => `<button type="button" class="store-opt ${s.id === current ? 'on' : ''}" ${attr}="${s.id}">${ic('store', 20)}<span class="nm">${esc(s.name)}<div class="small muted">${esc(head ? s.roleLabel : `${s.orgName || ''} · ${s.roleLabel}`)}</div></span>${tail(s)}</button>`).join('')}`).join('');
  }

  // เพิ่มสาขาภายใต้ร้านเดิม (เจ้าของร้านขึ้นไป)
  async function addBranchDialog(orgId, orgName) {
    const me = await modal({
      title: `เพิ่มสาขาในร้าน ${orgName}`,
      body: `<div class="dialog-body">สาขาใหม่จะอยู่ภายใต้ร้าน <b>${esc(orgName)}</b> ใช้ชื่อร้านเดิม แต่สินค้าและสต็อกแยกจากสาขาอื่น</div>
        <div class="field"><label for="ab-nm">ชื่อสาขา *</label><input class="input" id="ab-nm" maxlength="60" placeholder="เช่น สาขาอารีย์" autocomplete="off"></div>
        <div class="form-err" hidden></div>`,
      onMount(dlg) { setTimeout(() => $('#ab-nm', dlg)?.focus(), 50); },
      actions: [{ label: 'ยกเลิก' }, { label: ic('plus') + 'เพิ่มสาขา', cls: 'btn-primary', onClick: (dlg) => POST('/api/stores', { kind: 'branch', name: $('#ab-nm', dlg).value, orgId }) }],
    });
    if (!me) return;
    S.me = me;
    S.shellKey = '';
    toast(`เพิ่มสาขา ${storeLabel(S.me.store)} แล้ว`);
    go('/');
  }

  // สร้างร้านใหม่ทั้งร้าน (ธุรกิจใหม่ ข้อมูลแยกจากร้านเดิมทั้งหมด)
  async function newShopDialog() {
    const me = await modal({
      title: 'สร้างร้านใหม่',
      body: `<div class="dialog-body">ร้านใหม่คือ<b>ธุรกิจใหม่</b> ข้อมูลทั้งหมดแยกจากร้านเดิม คุณจะเป็นเจ้าของร้าน — ถ้าต้องการเพิ่มที่ตั้งใหม่ของร้านเดิม ให้ใช้ <b>เพิ่มสาขา</b> แทน</div>
        <div class="field"><label for="ns-nm">ชื่อร้าน *</label><input class="input" id="ns-nm" maxlength="60" placeholder="เช่น Lily Cosmetics" autocomplete="off"></div>
        <div class="field"><label for="ns-br">ชื่อสาขาแรก</label><input class="input" id="ns-br" maxlength="60" placeholder="เว้นว่าง = สาขาหลัก" autocomplete="off"></div>
        <div class="form-err" hidden></div>`,
      onMount(dlg) { setTimeout(() => $('#ns-nm', dlg)?.focus(), 50); },
      actions: [{ label: 'ยกเลิก' }, { label: ic('store') + 'สร้างร้านใหม่', cls: 'btn-secondary', onClick: (dlg) => POST('/api/stores', { kind: 'shop', shopName: $('#ns-nm', dlg).value, name: $('#ns-br', dlg).value }) }],
    });
    if (!me) return;
    S.me = me;
    S.shellKey = '';
    toast(`สร้างร้าน ${S.me.store.orgName} แล้ว`);
    go('/');
  }

  const canNewShop = () => !S.me.user.superadmin && S.me.stores.some((s) => s.role === 'owner');

  async function switchStore() {
    const { stores, store } = S.me;
    const id = await modal({
      title: 'เลือกร้านที่ต้องการจัดการ',
      body: `<div class="stack" style="gap:8px">${storeOptions(stores, store.id, 'data-id', (s) => (s.id === store.id ? ic('check') : ''))}</div>
        ${store.canManageBranches || canNewShop() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid var(--color-divider);padding-top:12px">
          ${store.canManageBranches ? `<button type="button" class="btn btn-primary" data-addbr style="flex:1 1 160px">${ic('plus')}เพิ่มสาขาใน ${esc(store.orgName)}</button>` : ''}
          ${canNewShop() ? `<button type="button" class="btn btn-secondary" data-newshop style="flex:1 1 160px">${ic('store')}สร้างร้านใหม่</button>` : ''}</div>` : ''}`,
      onMount(dlg, close) {
        $$('[data-id]', dlg).forEach((b) => b.addEventListener('click', () => close(Number(b.dataset.id))));
        $('[data-addbr]', dlg)?.addEventListener('click', () => close('addbr'));
        $('[data-newshop]', dlg)?.addEventListener('click', () => close('newshop'));
      },
    });
    if (id === 'addbr') return addBranchDialog(store.orgId, store.orgName);
    if (id === 'newshop') return newShopDialog();
    if (!id || id === store.id) return;
    try {
      S.me = await POST('/api/me/store', { storeId: id });
      toast('สลับไปที่ ' + storeLabel(S.me.store));
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
    if (code) lookupCode(code);
  }

  async function lookupCode(code) {
    let d;
    try { d = await GET('/api/lookup' + qs({ code })); } catch (e) { toast(e.message, 'err'); return; }
    if (d.product) return showScanResult(d);
    if (can('product.edit') && await confirmBox('ไม่พบสินค้า', `ไม่พบสินค้าที่มีรหัส <b>${esc(code)}</b> ต้องการเพิ่มสินค้าใหม่ด้วยรหัสนี้หรือไม่?`, 'เพิ่มสินค้าใหม่')) {
      go('/products/new' + qs({ barcode: code }));
    } else if (!can('product.edit')) toast(`ไม่พบสินค้ารหัส ${code}`, 'err');
  }

  async function showScanResult({ product: p, matchedPack: mp, scannedLot: sl, lots, recent, branches }) {
    const days = S.me.store.expiryDays;
    const breakdown = fmtPacks(p.qty, p.packs, p.unit);
    const lotTag = (l) => (l.expiry ? (l.days <= days ? `<span class="tag ${l.days < 0 ? 'st-expired' : 'st-exp'}">${fmtD(l.expiry)} · ${daysLabel(l.days)}</span>` : `<span class="small muted">${fmtD(l.expiry)}</span>`) : '<span class="small muted">ไม่มีวันหมดอายุ</span>');
    const multi = S.me.stores.length > 1;
    const actions = [{ label: 'ดูรายละเอียด', value: 'detail' }];
    if (can('stock.move')) {
      if (!sl || sl.qty > 0) actions.push({ label: ic('out') + (sl ? 'จ่ายออกจากล็อตนี้' : 'จ่ายออก'), value: 'out' });
      actions.push({ label: ic('in') + (sl ? 'รับเข้าล็อตนี้' : 'รับเข้า'), cls: 'btn-primary', value: 'in' });
    }
    const r = await modal({
      title: 'ผลการสแกน',
      wide: true,
      body: `<div class="scan-res">
        <div class="sr-head">${thumb(p, 'lg')}<div class="mid">
          <div class="card-kicker" style="color:var(--color-accent-700)">${esc(p.category || 'ไม่ระบุหมวด')} · ${esc(p.sku)}</div>
          <div class="card-title">${esc(p.name)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${sl ? `<span class="tag tag-accent">${ic('scan', 14)} สแกนได้: ล็อต ${esc(sl.lotNo || '-')}${sl.expiry ? ` · หมดอายุ ${fmtD(sl.expiry)}` : ''}</span>` : mp ? `<span class="tag tag-accent">${ic('scan', 14)} สแกนได้: ${esc(mp.name)} (${fmtN(mp.perQty)} ${esc(p.unit)})</span>` : `<span class="tag">${ic('scan', 14)} สแกนได้: ${esc(p.unit)}</span>`}${stTag(p.status)}</div>
        </div></div>
        <div class="sr-stock blueprint">${CORNERS}
          <div class="small muted">คงเหลือที่ ${esc(storeLabel(S.me.store))}</div>
          <div class="balance" style="font-size:40px">${fmtN(p.qty)} <small style="font-size:16px">${esc(p.unit)}</small></div>
          ${breakdown ? `<div><b>${esc(breakdown)}</b></div>` : ''}
          ${sl ? `<div class="small"><b>ล็อตนี้คงเหลือ ${fmtN(sl.qty)} ${esc(p.unit)}</b>${sl.days != null && sl.days < 0 ? ' · <span style="color:var(--color-accent-700)">หมดอายุแล้ว</span>' : ''}${!sl.id ? ' · ยังไม่เคยรับเข้าล็อตนี้' : ''}</div>` : ''}
          ${mp && p.qty > 0 ? `<div class="small muted">คิดเป็น ${fmtN(Math.floor(p.qty / mp.perQty))} ${esc(mp.name)} เต็ม${p.qty % mp.perQty ? ` + ${fmtN(p.qty % mp.perQty)} ${esc(p.unit)}` : ''}</div>` : ''}
          <div class="small muted">ราคาขาย ${mp?.price != null ? `${fmtB(mp.price)}/${esc(mp.name)} · ` : ''}${fmtB(p.price)}/${esc(p.unit)} · จุดสั่งซื้อ ${fmtN(p.reorderPoint)} ${esc(p.unit)}</div>
        </div>
        ${p.packs.length ? `<div class="chips" style="flex-wrap:wrap">${[...p.packs].reverse().map((k) => `<span class="chip ${mp?.id === k.id ? 'on' : ''}" style="pointer-events:none">1 ${esc(k.name)} = ${fmtN(k.perQty)} ${esc(p.unit)}</span>`).join('')}</div>` : ''}
        ${lots.length ? `<div><div class="sr-h">ล็อต / วันหมดอายุ</div><div class="sr-rows">${[...lots].sort((a, b) => (b.id === sl?.id) - (a.id === sl?.id)).slice(0, 3).map((l) => `<div class="sr-row" ${l.id === sl?.id ? 'style="font-weight:700"' : ''}><span>${esc(l.lotNo || 'ไม่ระบุล็อต')}</span>${lotTag(l)}<b class="num">${fmtN(l.qty)}</b></div>`).join('')}
          ${lots.length > 3 ? `<div class="small muted">และอีก ${lots.length - 3} ล็อต</div>` : ''}</div></div>` : ''}
        ${multi ? `<div><div class="sr-h">สาขาอื่นในร้าน ${esc(S.me.store.orgName)}</div>${branches.length
          ? `<div class="sr-rows">${branches.map((b) => `<div class="sr-row"><span>${ic('store', 16)} ${esc(b.storeName)}</span>${stTag(b.status)}<b class="num">${fmtN(b.qty)} ${esc(b.unit)}</b></div>
            ${sl ? `<div class="sr-row sr-sub sr-hit"><span>ล็อต ${esc(sl.lotNo || '-')}${sl.expiry ? ` · ${fmtD(sl.expiry)}` : ''}</span><span></span><b class="num">${b.scannedLotQty ? `เหลือ ${fmtN(b.scannedLotQty)}` : 'ไม่มีล็อตนี้'}</b></div>` : ''}
            ${(b.lots || []).slice(0, 3).map((l) => `<div class="sr-row sr-sub"><span>${esc(l.lotNo || 'ไม่ระบุล็อต')}</span>${lotTag(l)}<b class="num">${fmtN(l.qty)}</b></div>`).join('')}
            ${(b.lots || []).length > 3 ? `<div class="sr-row sr-sub"><span class="muted">และอีก ${b.lots.length - 3} ล็อต</span></div>` : ''}`).join('')}</div>`
          : '<div class="small muted">สาขาอื่นยังไม่มีสินค้า SKU นี้</div>'}</div>` : ''}
        ${recent.length ? `<div><div class="sr-h">ความเคลื่อนไหวล่าสุด</div><div class="list">${recent.slice(0, 3).map(mvLi).join('')}</div></div>` : ''}
      </div>`,
      actions,
    });
    if (r === 'detail') go(`/products/${p.id}`);
    else if (r === 'in' || r === 'out') go(`/move/${r}` + qs({ product: p.id, pack: mp?.id, lotNo: sl?.lotNo, exp: sl?.expiry, lotId: r === 'out' ? sl?.id : '' }));
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'store') { e.preventDefault(); switchStore(); }
    else if (act === 'logout') { e.preventDefault(); logout(); }
    else if (act === 'unimp') { e.preventDefault(); stopImpersonating(); }
    else if (act === 'scan') { e.preventDefault(); globalScan(); }
  });

  function renderNoStore() {
    S.shellKey = '';
    app.innerHTML = authLayout(`<form class="card blueprint auth-card" id="f" novalidate>${CORNERS}
      <div class="card-kicker">ยังไม่มีร้าน</div>
      <div class="card-title">สวัสดี ${esc(S.me.user.name)}</div>
      <div class="dialog-body">บัญชีของคุณยังไม่ได้อยู่ในร้านใด ขอให้เจ้าของร้านเชิญคุณเข้าร้าน หรือสร้างร้านใหม่ของคุณเอง</div>
      <div class="field"><label for="sn">ชื่อร้านใหม่</label><input class="input" id="sn" name="shopName" required maxlength="60" placeholder="เช่น Rose Beauty"></div>
      <div class="field"><label for="sb">ชื่อสาขาแรก</label><input class="input" id="sb" name="name" maxlength="60" placeholder="เว้นว่าง = สาขาหลัก"></div>
      <div class="form-err" hidden></div>
      <button class="btn btn-primary blueprint" type="submit" style="min-height:48px">${CORNERS}สร้างร้าน</button>
      <button class="btn btn-secondary" type="button" data-act="logout">${ic('logout')}ออกจากระบบ</button>
      ${S.me.user.impersonatedBy ? `<button class="btn btn-secondary" type="button" data-act="unimp">${ic('eye')}กลับเป็นผู้ดูแลระบบ</button>` : ''}
    </form>`);
    onSubmit($('#f'), async (d) => {
      S.me = await POST('/api/stores', { kind: 'shop', shopName: d.shopName, name: d.name });
      go('/');
    });
  }

  // ───────────────────────── auth views ─────────────────────────

  function authLayout(inner) {
    return `<div class="auth">
      <div class="auth-hero">
        <div class="brand"><img class="brand-mark" src="/logo-192.png" alt=""><span class="brand-name">CosmoStock</span></div>
        <div><h1>จัดการคลังง่าย<br>สต็อกแม่น<br>ธุรกิจเติบโต</h1>
        <p>ระบบจัดการคลังสินค้าเครื่องสำอาง ใช้ได้ทั้งมือถือ แท็บเล็ต และคอมพิวเตอร์</p></div>
        <div class="small" style="color:var(--color-accent-300)">© ${new Date().getFullYear() + 543} CosmoStock</div>
      </div>
      <div class="auth-side">
        <div class="auth-mhead">
          <img class="brand-mark" src="/logo-192.png" alt="" style="width:48px;height:48px">
          <div><h1>CosmoStock</h1><p>จัดการคลังง่าย สต็อกแม่น ธุรกิจเติบโต</p></div>
        </div>
        ${inner}
        <div class="small muted" style="margin-top:20px;text-align:center">v1.0 · ระบบจัดการคลังสินค้าเครื่องสำอาง</div>
      </div>
    </div>`;
  }


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
        <div class="card-title" style="font-size:22px">เข้าสู่ระบบ</div>
        <div class="field"><label for="em">อีเมล</label><input class="input" id="em" name="email" type="email" inputmode="email" autocomplete="username" required autocapitalize="none" spellcheck="false"></div>
        ${pwField('pw', 'password', 'รหัสผ่าน', 'current-password')}
        <div class="pw-row"><label class="check"><input type="checkbox" name="remember" checked>จดจำฉัน</label></div>
        <div class="form-err" hidden></div>
        <button class="btn btn-primary blueprint" type="submit" style="min-height:50px;font-size:17px;width:100%">${CORNERS}เข้าสู่ระบบ</button>
        <div class="small muted">ถ้าบัญชีอยู่หลายร้าน เลือกร้านได้จากเมนูด้านบนหลังเข้าสู่ระบบ<br>ต้องการเปิดร้านใหม่ ติดต่อผู้ดูแลระบบเพื่อสร้างร้านและบัญชีเจ้าของร้าน</div>
      </form>`),
      mount(root) {
        bindEyes(root);
        onSubmit($('#f', root), async (d) => {
          await POST('/api/auth/login', { email: d.email, password: d.password, remember: !!d.remember });
          await loadMe();
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
        <div class="s">${fmtDT(m.at)} · ${esc(m.by || '—')} · ${esc(m.docNo)}</div>${m.note || m.lotInfo || m.packName ? `<div class="s">${esc([packNote(m), m.lotInfo, m.note].filter(Boolean).join(' · '))}</div>` : ''}</div>
      <div class="end"><div class="q ${m.qty > 0 ? 'pos' : 'neg'}">${signed(m.qty)}</div><div class="small muted">${fmtN(m.before)} → ${fmtN(m.after)}</div></div>
    </${tag}>`;
  }

  function mvTable(rows, { product = true } = {}) {
    return `<div class="table-wrap"><table class="table"><thead><tr><th>วันที่</th>${product ? '<th>สินค้า</th>' : ''}<th>ประเภท</th><th>เลขที่</th><th>ผู้ทำรายการ</th><th class="right">จำนวน</th><th class="right">คงเหลือ</th><th>ล็อต / หมายเหตุ</th></tr></thead><tbody>
      ${rows.map((m) => `<tr><td class="nowrap">${fmtDT(m.at)}</td>
        ${product ? `<td>${m.deleted ? esc(m.name) + ' <span class="small muted">(ลบแล้ว)</span>' : `<a href="#/products/${m.productId}" style="color:inherit">${esc(m.name)}</a>`}</td>` : ''}
        <td>${tyTag(m.type)}</td><td class="nowrap">${esc(m.docNo)}</td><td>${esc(m.by || '—')}</td>
        <td class="right num ${m.qty > 0 ? 'pos' : 'neg'}" style="font-weight:600">${signed(m.qty)}${m.packName ? `<div class="small muted" style="font-weight:400">${esc(packNote(m))}</div>` : ''}</td><td class="right num">${fmtN(m.after)}</td>
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
            <td class="right num" style="font-weight:600">${fmtN(p.qty)} <span class="small muted">${esc(p.unit)}</span>${fmtPacks(p.qty, p.packs, p.unit) ? `<div class="small muted" style="font-weight:400">${esc(fmtPacks(p.qty, p.packs, p.unit))}</div>` : ''}</td><td>${stTag(p.status)}</td>
            <td class="acts">
              ${can('stock.move') ? `<a class="btn btn-ghost btn-ico plain" href="#/move/in?product=${p.id}" title="รับเข้า">${ic('in')}</a>` : ''}
              ${editable ? `<a class="btn btn-ghost btn-ico plain" href="#/products/${p.id}/edit" title="แก้ไข">${ic('edit')}</a>` : ''}
              ${can('product.delete') ? `<button type="button" class="btn btn-ghost btn-ico plain" data-del="${p.id}" title="ลบ">${ic('trash')}</button>` : ''}
            </td></tr>`).join('')}</tbody></table></div></div>
        <div class="list only-mobile">${products.map((p) => `<a class="li" href="#/products/${p.id}">${thumb(p, '')}
          <div class="mid"><div class="t">${esc(p.name)}</div><div class="s">${esc(p.sku)} · ${esc(p.category || '—')}</div>${fmtPacks(p.qty, p.packs, p.unit) ? `<div class="s">${esc(fmtPacks(p.qty, p.packs, p.unit))}</div>` : ''}</div>
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
          const d = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (d.product) showScanResult(d);
        });
        $('#scan', root).addEventListener('click', async () => {
          const code = await scanCode();
          if (!code) return;
          const d = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (d.product) return showScanResult(d);
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
          ['SKU', 'ชื่อสินค้า', 'หมวดหมู่', 'บาร์โค้ด', 'หน่วย', 'ขนาดบรรจุ', 'ราคาทุน', 'ราคาขาย', 'จุดสั่งซื้อ', 'คงเหลือ', 'ยอดแตกหน่วย', 'มูลค่าคงคลัง', 'สถานะ', 'หมดอายุใกล้สุด'],
          ...products.map((p) => [p.sku, p.name, p.category, p.barcode, p.unit,
            (p.packs || []).map((k) => `${k.name}=${k.perQty}${p.unit}${k.barcode ? ' [' + k.barcode + ']' : ''}`).join('; '),
            p.cost, p.price, p.reorderPoint, p.qty, fmtPacks(p.qty, p.packs, p.unit), p.qty * p.cost, STATUS[p.status], p.nextExpiry || '']),
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
          <div><div class="small muted">คงเหลือ</div><div class="balance" style="font-size:30px">${fmtN(p.qty)} <small style="font-size:15px">${esc(p.unit)}</small></div>${fmtPacks(p.qty, p.packs, p.unit) ? `<div class="small muted">${esc(fmtPacks(p.qty, p.packs, p.unit))}</div>` : ''}</div>
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
        ${p.packs.length ? `<div class="card blueprint">${CORNERS}
          <div class="card-title">ขนาดบรรจุ</div>
          <table class="table rtable"><thead><tr><th>หน่วย</th><th class="right">บรรจุ</th><th>บาร์โค้ด</th><th class="right">ราคาขาย</th></tr></thead><tbody>
            <tr><td class="lead" data-label="">${esc(p.unit)} <span class="small muted">(หน่วยย่อย)</span></td><td class="right num" data-label="บรรจุ">1 ${esc(p.unit)}</td>
              <td data-label="บาร์โค้ด" class="mono">${esc(p.barcode || '—')}</td><td class="right num" data-label="ราคาขาย">${fmtB(p.price)}</td></tr>
            ${p.packs.map((k) => `<tr><td class="lead" data-label="">${esc(k.name)}</td><td class="right num" data-label="บรรจุ">${fmtN(k.perQty)} ${esc(p.unit)}</td>
              <td data-label="บาร์โค้ด" class="mono">${esc(k.barcode || '—')}</td><td class="right num" data-label="ราคาขาย">${k.price != null ? fmtB(k.price) : '—'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
        <div class="grid-2e">
          <div class="card blueprint">${CORNERS}
            <div class="card-head"><div class="card-title">ประวัติการเคลื่อนไหว</div>${historyTotal > history.length ? `<a class="small" href="#/history?productId=${p.id}">ดูทั้งหมด (${fmtN(historyTotal)})</a>` : ''}</div>
            ${mvBoth(history, { product: false })}
          </div>
          <div class="card blueprint">${CORNERS}
            <div class="card-title">ล็อตสินค้า</div>
            ${lots.length ? `<table class="table rtable"><thead><tr><th>ล็อต</th><th>รับเข้า</th><th>หมดอายุ</th><th class="right">คงเหลือ</th><th class="right">QR</th></tr></thead><tbody>
              ${lots.map((l) => `<tr><td class="lead" data-label="">${esc(l.lotNo || 'ไม่ระบุล็อต')}</td><td data-label="รับเข้า">${fmtD(ymd(new Date(l.receivedAt)))}</td>
                <td data-label="หมดอายุ">${l.expiry ? (l.days <= S.me.store.expiryDays ? `<span class="tag ${l.days < 0 ? 'st-expired' : 'st-exp'}">${fmtD(l.expiry)} · ${daysLabel(l.days)}</span>` : fmtD(l.expiry)) : '—'}</td>
                <td class="right num" data-label="คงเหลือ">${fmtN(l.qty)}</td>
                <td class="right" data-label="QR">${lotPrintable(l) ? `<button type="button" class="btn btn-secondary btn-ico" data-lotqr="${l.id}" title="พิมพ์ฉลาก QR ล็อตนี้" aria-label="พิมพ์ฉลาก QR ล็อต ${esc(l.lotNo || fmtD(l.expiry))}">${ic('printer', 18)}</button>` : '<span class="small muted">—</span>'}</td></tr>`).join('')}</tbody></table>`
              : empty('package', 'ยังไม่มีสินค้าในคลัง')}
            <div class="small muted">จ่ายออกจะตัดจากล็อตที่หมดอายุก่อนเสมอ (FEFO)</div>
          </div>
        </div>
      </div>`,
      mount(root) {
        qrSvg(p.barcode || p.sku).then((svg) => { const el = $('#qr', root); if (el) el.innerHTML = svg; }).catch(() => {});
        $('#print', root).addEventListener('click', () => printLabels(p, lots));
        $$('[data-lotqr]', root).forEach((b) => b.addEventListener('click', () => printLabels(p, lots, Number(b.dataset.lotqr))));
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
          <div class="stack" style="gap:10px;border-top:1px solid var(--color-divider);padding-top:14px">
            <div class="card-kicker" style="color:var(--color-accent-700)">ขนาดบรรจุ (ไม่บังคับ)</div>
            <div class="small muted">เช่น แพ็ค = 6 <span class="u">${esc(p.unit)}</span>, ลัง = 24 <span class="u">${esc(p.unit)}</span> — แต่ละขนาดมีบาร์โค้ดของตัวเองได้ สแกนบาร์โค้ดลังตอนรับเข้า ระบบจะบวกตามจำนวนที่บรรจุให้อัตโนมัติ</div>
            <div id="packs" class="stack" style="gap:10px"></div>
            <button type="button" class="btn btn-secondary" id="addpack" style="align-self:flex-start">${ic('plus')}เพิ่มขนาดบรรจุ</button>
          </div>
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

        const MAX_PACKS = 5;
        const packBox = $('#packs', root);
        const unitInput = $('#f-unit', root);
        const unitName = () => unitInput.value.trim() || 'ชิ้น';
        let packSeq = 0;
        const syncPacks = () => {
          $('#addpack', root).hidden = packBox.children.length >= MAX_PACKS;
          $$('.u', root).forEach((e) => { e.textContent = unitName(); });
        };
        const addPack = (k = {}) => {
          const id = `pk${++packSeq}`;
          const row = document.createElement('div');
          row.className = 'pack-row';
          row.innerHTML = `
            <div class="field"><label for="${id}-n">ชื่อหน่วย</label><input class="input" id="${id}-n" data-k="name" maxlength="20" placeholder="เช่น แพ็ค, ลัง" value="${esc(k.name || '')}"></div>
            <div class="field"><label for="${id}-q">บรรจุกี่ <span class="u">${esc(unitName())}</span></label><input class="input" id="${id}-q" data-k="perQty" type="number" inputmode="numeric" min="2" step="1" placeholder="เช่น 24" value="${esc(k.perQty || '')}"></div>
            <div class="field pk-bc"><label for="${id}-b">บาร์โค้ดหน่วยนี้</label><div style="display:flex;gap:8px">
              <input class="input" id="${id}-b" data-k="barcode" maxlength="64" inputmode="numeric" placeholder="สแกนหรือพิมพ์" value="${esc(k.barcode || '')}" style="flex:1;min-width:0">
              <button type="button" class="btn btn-secondary btn-ico" data-scan aria-label="สแกนบาร์โค้ดหน่วยนี้">${ic('scan', 20)}</button></div></div>
            <div class="field"><label for="${id}-p">ราคาขาย (฿)</label><input class="input" id="${id}-p" data-k="price" type="number" inputmode="decimal" min="0" step="0.01" placeholder="ไม่บังคับ" value="${esc(k.price ?? '')}"></div>
            <button type="button" class="btn btn-ghost btn-ico plain pk-rm" data-rm aria-label="ลบขนาดบรรจุนี้">${ic('trash')}</button>`;
          packBox.appendChild(row);
          syncPacks();
          return row;
        };
        (p.packs || []).slice().reverse().forEach(addPack);
        syncPacks();
        $('#addpack', root).addEventListener('click', () => $('[data-k=name]', addPack()).focus());
        unitInput.addEventListener('input', syncPacks);
        packBox.addEventListener('click', async (e) => {
          const row = e.target.closest('.pack-row');
          if (!row) return;
          if (e.target.closest('[data-rm]')) { row.remove(); syncPacks(); return; }
          if (e.target.closest('[data-scan]')) {
            const code = await scanCode('สแกนบาร์โค้ดของหน่วยบรรจุ');
            if (code) $('[data-k=barcode]', row).value = code;
          }
        });
        packBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) e.preventDefault(); });
        const readPacks = () => $$('.pack-row', packBox).map((row) => {
          const v = (k) => $(`[data-k=${k}]`, row).value.trim();
          return { name: v('name'), perQty: v('perQty') === '' ? '' : Number(v('perQty')), barcode: v('barcode'), price: v('price') };
        }).filter((k) => k.name || k.perQty || k.barcode || k.price);

        onSubmit(form, async (d) => {
          const body = {
            name: d.name, sku: d.sku, barcode: d.barcode, category: d.category, unit: d.unit,
            cost: d.cost, price: d.price, reorderPoint: d.reorderPoint === '' ? 0 : Number(d.reorderPoint), trackExpiry: !!d.trackExpiry,
            packs: readPacks(),
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
    const st = { product: null, lots: [], lot: null, packId: type !== 'adj' && Number(query.pack) || null };
    if (query.product) {
      try { const d = await GET(`/api/products/${query.product}`); st.product = d.product; st.lots = d.lots; } catch { /* product gone */ }
    }
    // มาจากการสแกน QR ล็อต: out = ตัดจากล็อตนั้นโดยตรง, in = กรอกเลขล็อต/วันหมดอายุให้
    if (st.product && type !== 'adj' && (query.lotNo || query.exp || query.lotId)) {
      if (type === 'out') {
        const row = st.lots.find((l) => l.id === Number(query.lotId));
        if (row) st.lot = { id: row.id, lotNo: row.lotNo, expiry: row.expiry, qty: row.qty };
      } else st.lot = { id: null, lotNo: query.lotNo || '', expiry: query.exp || '' };
    }
    return {
      html: `<div class="page narrow">
        <div class="page-head"><div class="ttl"><h2>${T.title}</h2><div class="sub">บันทึกการเคลื่อนไหวสต็อก · ${esc(storeLabel(S.me.store))}</div></div></div>
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
        const curPack = () => (type === 'adj' ? null : st.product?.packs.find((k) => k.id === st.packId) || null);
        const lotFromScan = (sl) => {
          if (!sl || type === 'adj') return null;
          if (type === 'out') {
            if (!sl.id || sl.qty <= 0) { toast('ล็อตนี้ไม่มีของคงเหลือ ระบบจะตัดตามลำดับหมดอายุก่อน (FEFO) แทน', 'err'); return null; }
            return { id: sl.id, lotNo: sl.lotNo, expiry: sl.expiry, qty: sl.qty };
          }
          return { id: null, lotNo: sl.lotNo, expiry: sl.expiry || '' };
        };
        const pick = async (id, packId = null, lot = null) => {
          try {
            const d = await GET(`/api/products/${id}`);
            st.product = d.product; st.lots = d.lots; st.lot = lot;
            st.packId = type !== 'adj' && packId || null;
            replaceQuery(`/move/${type}`, { product: id, pack: st.packId });
            renderAll();
          } catch (e) { toast(e.message, 'err'); }
        };
        const lookupAndPick = async (code) => {
          const { product, matchedPack, scannedLot } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
          if (product) {
            if (scannedLot && type !== 'adj') toast(`สแกนได้ล็อต ${scannedLot.lotNo || fmtD(scannedLot.expiry)}`);
            else if (matchedPack && type !== 'adj') toast(`สแกนได้ ${matchedPack.name} (${fmtN(matchedPack.perQty)} ${product.unit})`);
            pick(product.id, matchedPack?.id, lotFromScan(scannedLot));
            return true;
          }
          toast(`ไม่พบสินค้ารหัส ${code}`, 'err');
          return false;
        };
        const renderPick = () => {
          const box = $('#pick', root);
          const p = st.product;
          if (p) {
            box.innerHTML = `<div class="card blueprint picked">${CORNERS}${thumb(p)}
              <div class="mid"><div class="card-title">${esc(p.name)}</div><div class="card-meta">SKU ${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</div></div>
              <div class="right"><div class="small muted">คงเหลือ</div><div class="balance">${fmtN(p.qty)}</div>${fmtPacks(p.qty, p.packs, p.unit) ? `<div class="small muted">${esc(fmtPacks(p.qty, p.packs, p.unit))}</div>` : ''}</div>
              <button type="button" class="btn btn-ghost btn-ico plain" id="unpick" aria-label="เปลี่ยนสินค้า">${ic('x', 20)}</button></div>`;
            $('#unpick', box).addEventListener('click', () => { st.product = null; st.packId = null; st.lot = null; replaceQuery(`/move/${type}`, {}); renderAll(); $('#ps', root)?.focus(); });
            return;
          }
          box.innerHTML = `<div class="picker"><div style="display:flex;gap:8px">
              <div class="input-icon">${ic('search')}<input class="input" id="ps" type="search" placeholder="พิมพ์ชื่อ / SKU หรือยิงบาร์โค้ด" autocomplete="off"></div>
              <button type="button" class="btn btn-primary btn-ico" id="pscan" aria-label="สแกน">${ic('scan', 20)}</button></div>
            <div class="picker-list" id="pl" hidden></div></div>
            <div class="small muted" style="margin-top:6px">แตะช่องค้นหาเพื่อเลือกจากรายการ หรือพิมพ์ชื่อ / SKU · ${ic('camera', 14)} สแกนบาร์โค้ด/QR เป็นทางเลือก ไม่บังคับ</div>`;
          const input = $('#ps', box);
          const list = $('#pl', box);
          let results = [];
          const search = debounce(async () => {
            const q = input.value.trim();
            results = (await GET('/api/products' + qs({ q })).catch(() => ({ products: [] }))).products.slice(0, q ? 12 : 40);
            list.innerHTML = results.length
              ? results.map((r) => {
                // ปุ่มด่วน: รับเข้า/จ่ายออกได้ทันทีจากรายการ (รับเข้าสินค้าที่ต้องระบุล็อต/วันหมดอายุ และปรับยอด ใช้ฟอร์มเต็ม)
                const quick = type !== 'adj' && !(type === 'in' && r.trackExpiry) && !(type === 'out' && r.qty <= 0);
                return `<div class="prow"><button type="button" class="pmain" data-id="${r.id}">${thumb(r, 'sm')}<span style="flex:1;min-width:0"><div>${esc(r.name)}</div><div class="small muted">${esc(r.sku)} · คงเหลือ ${fmtN(r.qty)} ${esc(r.unit)}</div></span>${stTag(r.status)}</button>
                  ${quick ? `<div class="pquick"><input class="input num" type="number" inputmode="numeric" min="1" step="1" value="1" data-q="${r.id}" aria-label="จำนวน (${esc(r.unit)})"><button type="button" class="btn btn-primary" data-go="${r.id}">${ic(type, 18)}${type === 'in' ? 'รับเข้า' : 'จ่ายออก'}</button></div>` : ''}</div>`;
              }).join('')
              : '<div class="empty" style="padding:16px">ไม่พบสินค้า</div>';
            list.hidden = false;
          }, 200);
          input.addEventListener('input', search);
          input.addEventListener('focus', search);
          input.addEventListener('keydown', async (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const code = input.value.trim();
            if (!code) return;
            const { product, matchedPack, scannedLot } = await GET('/api/lookup' + qs({ code })).catch(() => ({}));
            if (product) pick(product.id, matchedPack?.id, lotFromScan(scannedLot));
            else if (results[0]) pick(results[0].id);
          });
          const quickMove = async (id, btn) => {
            const qIn = $(`[data-q="${id}"]`, list);
            const qty = Number(qIn?.value);
            if (!Number.isInteger(qty) || qty < 1) { toast('กรุณากรอกจำนวนเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป', 'err'); qIn?.focus(); return; }
            btn.disabled = true;
            try {
              const r = await POST('/api/movements', { type, productId: id, qty, note: '' });
              toast(`บันทึก ${r.docNo} แล้ว · ${r.name} ${type === 'in' ? '+' : '−'}${fmtN(Math.abs(r.qty))} ${r.unit} · คงเหลือ ${fmtN(r.after)} ${r.unit}`);
              refreshMe();
              await search();
            } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
          };
          list.addEventListener('click', (e) => {
            const g = e.target.closest('[data-go]');
            if (g) return quickMove(Number(g.dataset.go), g);
            const b = e.target.closest('[data-id]'); if (b) pick(Number(b.dataset.id));
          });
          list.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !e.target.matches('[data-q]')) return;
            e.preventDefault();
            quickMove(Number(e.target.dataset.q), $(`[data-go="${e.target.dataset.q}"]`, list));
          });
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
            box.innerHTML = `<div class="card blueprint">${CORNERS}${empty('search', 'เลือกสินค้าจากช่องค้นหาด้านบนก่อน (สแกนบาร์โค้ดก็ได้ แต่ไม่จำเป็น)')}</div>`;
            $('#go', root).disabled = true;
            $('#bal', root).textContent = '—';
            return;
          }
          $('#go', root).disabled = false;
          const startQty = type === 'adj' ? p.qty : 1;
          const pk = curPack();
          const units = type !== 'adj' && p.packs.length
            ? `<div class="field"><label>หน่วยที่ทำรายการ</label><div class="seg unit-seg" id="units">
                <button type="button" class="btn btn-secondary seg-opt ${pk ? '' : 'on'}" data-pack="">${esc(p.unit)}</button>
                ${[...p.packs].reverse().map((k) => `<button type="button" class="btn btn-secondary seg-opt ${pk?.id === k.id ? 'on' : ''}" data-pack="${k.id}">${esc(k.name)} <span class="small">×${fmtN(k.perQty)}</span></button>`).join('')}
              </div></div>` : '';
          box.innerHTML = `
            ${type === 'adj' ? `<div class="small muted">ยอดในระบบตอนนี้ <b style="color:var(--color-text)">${fmtN(p.qty)} ${esc(p.unit)}</b> — กรอกจำนวนที่นับได้จริง (เป็น${esc(p.unit)}) ระบบจะคำนวณส่วนต่างให้</div>` : ''}
            ${units}
            <div class="field"><label for="m-qty">${T.qty} (${esc(pk ? pk.name : p.unit)})</label>
              <div class="stepper"><button type="button" class="btn" data-step="-1" aria-label="ลด">${ic('minus', 20)}</button>
              <input class="input num" id="m-qty" name="${type === 'adj' ? 'newQty' : 'qty'}" type="number" inputmode="numeric" min="${type === 'adj' ? 0 : 1}" step="1" value="${startQty}">
              <button type="button" class="btn" data-step="1" aria-label="เพิ่ม">${ic('plus', 20)}</button></div>
              ${pk ? '<div class="small muted" id="m-eq"></div>' : ''}</div>
            ${type === 'in' ? lotFields(p.trackExpiry || !!st.lot) : ''}
            ${type === 'adj' ? lotFields(false) : ''}
            ${type === 'out' && st.lots.some((l) => l.qty > 0 && (l.lotNo || l.expiry)) ? `<div class="field"><label for="m-lotsel">ตัดจากล็อต</label>
              <select class="input" id="m-lotsel"><option value="">อัตโนมัติ — ล็อตที่หมดอายุก่อน (FEFO)</option>${st.lots.filter((l) => l.qty > 0).map((l) => `<option value="${l.id}" ${st.lot?.id === l.id ? 'selected' : ''}>${esc(l.lotNo || 'ไม่ระบุล็อต')} · คงเหลือ ${fmtN(l.qty)}${l.expiry ? ' · หมดอายุ ' + fmtD(l.expiry) : ''}</option>`).join('')}</select></div>` : ''}
            ${type === 'out' && st.lots.some((l) => l.lotNo || l.expiry) ? `<div class="small muted" id="fefo-note" ${st.lot ? 'hidden' : ''}>ถ้าไม่เลือกล็อต ระบบจะตัดจากล็อตที่หมดอายุก่อน: ${st.lots.slice(0, 3).map((l) => `${esc(l.lotNo || 'ไม่ระบุล็อต')} (${fmtN(l.qty)}${l.expiry ? ', ' + fmtD(l.expiry) : ''})`).join(' → ')}</div>` : ''}
            <div class="field"><label for="m-note">${T.note}</label>
              <div class="reason-chips" style="margin-bottom:8px">${T.reasons.map((r) => `<button type="button" class="chip" data-reason="${esc(r)}">${esc(r)}</button>`).join('')}</div>
              <input class="input" id="m-note" name="note" maxlength="200" ${type === 'adj' ? 'required' : ''}></div>`;
          if (type === 'in' && st.lot) { $('#m-lot', box).value = st.lot.lotNo; $('#m-exp', box).value = st.lot.expiry; }
          $('#m-lotsel', box)?.addEventListener('change', (e) => {
            const l = st.lots.find((x) => x.id === Number(e.target.value));
            st.lot = l ? { id: l.id, lotNo: l.lotNo, expiry: l.expiry, qty: l.qty } : null;
            $('#fefo-note', box)?.toggleAttribute('hidden', !!st.lot);
          });
          $('#m-lot', box)?.addEventListener('input', (e) => {
            const l = st.lots.find((x) => x.lotNo && x.lotNo === e.target.value.trim() && x.expiry);
            if (l && !$('#m-exp', box).value) $('#m-exp', box).value = l.expiry;
          });
          const qty = $('#m-qty', box);
          $('#units', box)?.addEventListener('click', (e) => {
            const b = e.target.closest('[data-pack]');
            if (!b) return;
            st.packId = Number(b.dataset.pack) || null;
            replaceQuery(`/move/${type}`, { product: p.id, pack: st.packId });
            renderFields();
          });
          const update = () => {
            const n = Math.max(0, Math.floor(Number(qty.value) || 0)) * (pk ? pk.perQty : 1);
            if (pk) $('#m-eq', box).textContent = `= ${fmtN(n)} ${p.unit}`;
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
          } else {
            body.qty = Number(d.qty);
            if (curPack()) body.packId = curPack().id;
            if (type === 'out' && st.lot?.id) body.lotId = st.lot.id;
          }
          const r = await POST('/api/movements', body);
          toast(`บันทึก ${r.docNo} แล้ว · ${r.packName ? `${fmtN(r.packCount)} ${r.packName} = ` : ''}${fmtN(Math.abs(r.qty))} ${r.unit} · คงเหลือ ${fmtN(r.after)} ${r.unit}`);
          await pick(st.product.id, st.packId);
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
              ['วันเวลา', 'เลขที่', 'ประเภท', 'SKU', 'สินค้า', 'จำนวน', 'หน่วยบรรจุที่ใช้', 'ก่อน', 'หลัง', 'ล็อต', 'วันหมดอายุ', 'หมายเหตุ', 'ผู้ทำรายการ'],
              ...d.rows.map((m) => [fmtDTY(m.at), m.docNo, TYPE[m.type].label, m.sku, m.name, m.qty, packNote(m), m.before, m.after, m.lotInfo || '', m.expiry || '', m.note || '', m.by || '']),
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
          <div class="ttl"><h2>รายงาน</h2><div class="sub">${esc(storeLabel(S.me.store))} · <span id="rng"></span></div></div>
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
    const roleBy = (k) => d.roles.find((r) => r.key === k);
    const roleOpts = (sel) => d.roles.map((r) => `<option value="${esc(r.key)}" ${r.key === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
    const multi = d.stores.length > 1;
    const branchCell = (m) => {
      if (m.allBranches) return `<span class="tag tag-accent">ทุกสาขา (${d.stores.length})</span>`;
      const names = m.branches.map((b) => esc(b.name)).join(', ');
      const single = roleBy(m.role)?.scope === 'single';
      return `<span class="small">${names}</span>${multi ? `<button type="button" class="btn btn-ghost plain small" data-branches="${m.id}" style="min-height:32px;padding:0 6px">${ic('store', 16)}${single ? 'ย้ายสาขา' : 'กำหนดสาขา'}</button>` : ''}`;
    };
    const pickBranches = (title, selected, hint, single = false) => modal({
      title,
      body: `<div class="small muted">${hint}</div>
        <div class="stack" style="gap:4px">${d.stores.map((s) => `<label class="check"><input type="${single ? 'radio' : 'checkbox'}" name="pb" value="${s.id}" ${selected.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div>
        <div class="form-err" hidden></div>`,
      actions: [{ label: 'ยกเลิก' }, { label: 'บันทึกสาขา', cls: 'btn-primary', onClick: (dlg) => {
        const ids = $$('input[name=pb]:checked', dlg).map((c) => Number(c.value));
        if (!ids.length) throw new Error('กรุณาเลือกอย่างน้อย 1 สาขา');
        return ids;
      } }],
    });
    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>ผู้ใช้และสิทธิ์</h2><div class="sub">${esc(S.me.store.orgName || S.me.store.name)} — กำหนดบทบาทและสิทธิ์ของร้านนี้ได้เอง เจ้าของร้านเห็นทุกสาขาเสมอ</div></div>
          <div class="acts"><button type="button" class="btn btn-primary blueprint" id="invite">${CORNERS}${ic('userplus')}เชิญผู้ใช้</button></div>
        </div>
          <div class="card blueprint">${CORNERS}<div class="card-title">ผู้ที่เข้าถึงสาขานี้ (${d.members.length})</div>
            <table class="table rtable"><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สาขาที่เข้าถึง</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
            ${d.members.map((m) => `<tr>
              <td class="lead" data-label=""><div class="pn"><div class="avatar">${esc(initial(m.name))}</div><div style="min-width:0"><div>${esc(m.name)}${m.isMe ? ' <span class="tag tag-accent">คุณ</span>' : ''}</div><div class="small muted" style="overflow-wrap:anywhere">${esc(m.email)}</div></div></div></td>
              <td data-label="บทบาท"><select class="input" data-role="${m.id}" ${m.isMe ? 'disabled title="เปลี่ยนบทบาทของตัวเองไม่ได้"' : ''} style="min-width:140px">${roleOpts(m.role)}</select></td>
              <td data-label="สาขา"><div class="branch-cell">${branchCell(m)}</div></td>
              <td data-label="เข้าใช้ล่าสุด" class="small">${m.lastLogin ? fmtDTY(m.lastLogin) : 'ยังไม่เคยเข้าใช้'}</td>
              <td class="acts" data-label="">${m.isMe ? '' : `<button type="button" class="btn btn-ghost btn-ico plain" data-reset="${m.id}" title="ตั้งรหัสผ่านใหม่">${ic('key')}</button><button type="button" class="btn btn-ghost btn-ico plain" data-remove="${m.id}" title="${m.allBranches ? 'นำออกจากทุกสาขา' : 'นำออกจากสาขานี้'}">${ic('trash')}</button>`}</td>
            </tr>`).join('')}</tbody></table></div>
          ${d.elsewhere?.length ? `<div class="card blueprint">${CORNERS}<div class="card-title">พนักงานสาขาอื่น (${d.elsewhere.length})</div>
            <div class="small muted">คนที่ทำงานอยู่สาขาอื่นของร้านนี้ — กด "ดึงมาสาขานี้" หรือ "ย้ายสาขา" เพื่อกำหนดสาขาให้ใหม่</div>
            <table class="table rtable"><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สาขาปัจจุบัน</th><th></th></tr></thead><tbody>
            ${d.elsewhere.map((m) => `<tr>
              <td class="lead" data-label=""><div class="pn"><div class="avatar">${esc(initial(m.name))}</div><div style="min-width:0"><div>${esc(m.name)}</div><div class="small muted" style="overflow-wrap:anywhere">${esc(m.email)}</div></div></div></td>
              <td data-label="บทบาท">${esc(m.roleLabel)}</td>
              <td data-label="สาขา" class="small">${m.branches.map((b) => esc(b.name)).join(', ')}</td>
              <td class="acts" data-label=""><button type="button" class="btn btn-secondary" data-pull="${m.id}">${ic('store', 16)}${roleBy(m.role)?.scope === 'single' ? 'ย้ายมาสาขานี้' : 'เพิ่มสาขานี้'}</button><button type="button" class="btn btn-ghost plain small" data-branches="${m.id}">กำหนดสาขา</button></td>
            </tr>`).join('')}</tbody></table></div>` : ''}
          <div class="card blueprint">${CORNERS}
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div class="card-title" style="flex:1">บทบาทและสิทธิ์</div><button type="button" class="btn btn-secondary" id="add-role">${ic('plus')}เพิ่มบทบาท</button></div>
            <div class="small muted">ติ๊กเพื่อกำหนดว่าบทบาทนั้นทำอะไรได้ เจ้าของร้านมีสิทธิ์ครบและลบไม่ได้</div>
            <div class="table-wrap"><table class="table perm"><thead><tr><th>การใช้งาน</th>${d.roles.map((r) => `<th>${esc(r.name)}${r.key === 'owner' ? '' : `<div class="role-tools"><button type="button" class="btn btn-ghost btn-ico plain" data-rename="${esc(r.key)}" title="แก้ชื่อ">${ic('edit', 16)}</button><button type="button" class="btn btn-ghost btn-ico plain" data-delrole="${esc(r.key)}" title="ลบบทบาท">${ic('trash', 16)}</button></div>`}</th>`).join('')}</tr></thead><tbody>
            <tr><td>ดู Dashboard / สินค้า / แจ้งเตือน</td>${d.roles.map(() => `<td class="perm-yes">${ic('check')}</td>`).join('')}</tr>
            <tr><td>สาขาที่เข้าถึงได้</td>${d.roles.map((r) => `<td>${r.key === 'owner' ? esc(d.scopes.all) : `<select class="input" data-scope="${esc(r.key)}" style="min-width:140px"><option value="multi" ${r.scope === 'multi' ? 'selected' : ''}>${esc(d.scopes.multi)}</option><option value="single" ${r.scope === 'single' ? 'selected' : ''}>${esc(d.scopes.single)}</option></select>`}</td>`).join('')}</tr>
            ${d.permissions.map((p) => `<tr><td>${esc(p.label)}</td>${d.roles.map((r) => `<td><input type="checkbox" data-perm="${esc(p.key)}" data-rk="${esc(r.key)}" ${r.perms.includes(p.key) ? 'checked' : ''} ${r.key === 'owner' ? 'disabled' : ''}></td>`).join('')}</tr>`).join('')}
            </tbody></table></div></div>
      </div>`,
      mount(root) {
        const byId = (id) => d.members.find((m) => m.id === Number(id)) || d.elsewhere?.find((m) => m.id === Number(id));
        $$('[data-role]', root).forEach((s) => s.addEventListener('change', async () => {
          const m = byId(s.dataset.role);
          const warn = s.value === 'owner'
            ? `<b>${esc(m.name)}</b> จะเป็นเจ้าของร้าน เห็นและจัดการได้<b>ทุกสาขา</b> รวมถึงผู้ใช้และการตั้งค่า`
            : m.role === 'owner' ? `<b>${esc(m.name)}</b> จะไม่เห็นสาขาอื่นอีก เหลือเพียงสาขานี้ในบทบาท${esc(roleBy(s.value)?.name || '')}` : '';
          if (warn && !await confirmBox('เปลี่ยนบทบาท?', warn, 'เปลี่ยนบทบาท')) { s.value = m.role; return; }
          try {
            await PUT(`/api/members/${m.id}`, { role: s.value });
            toast(`เปลี่ยนบทบาท ${m.name} เป็น ${roleBy(s.value)?.name || ''} แล้ว`);
            m.role = s.value;
          } catch (e) { toast(e.message, 'err'); s.value = m.role; return; }
          render();
        }));
        $$('[data-branches]', root).forEach((b) => b.addEventListener('click', async () => {
          const m = byId(b.dataset.branches);
          const single = roleBy(m.role)?.scope === 'single';
          const ids = await pickBranches(single ? `ย้าย ${m.name} ไปสาขา` : `สาขาที่ ${m.name} ดูแล`, m.branches.map((x) => x.id),
            single ? `${roleBy(m.role)?.name || 'บทบาทนี้'}อยู่ได้ 1 สาขา เลือกสาขาที่ต้องการให้ทำงาน` : `${roleBy(m.role)?.name || 'บทบาทนี้'}จะเห็นและจัดการได้เฉพาะสาขาที่เลือก`, single);
          if (!ids) return;
          try {
            await PUT(`/api/members/${m.id}/stores`, { storeIds: ids });
            const here = ids.includes(S.me.store.id);
            toast(single ? `ย้าย ${m.name} ไปสาขา ${d.stores.find((x) => x.id === ids[0])?.name || ''} แล้ว${here ? '' : ' (จะไม่แสดงในรายการของสาขานี้อีก)'}` : 'บันทึกสาขาที่ดูแลแล้ว');
            render();
          } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-pull]', root).forEach((b) => b.addEventListener('click', async () => {
          const m = byId(b.dataset.pull);
          const single = roleBy(m.role)?.scope === 'single';
          const ids = single ? [S.me.store.id] : [...new Set([...m.branches.map((x) => x.id), S.me.store.id])];
          try {
            await PUT(`/api/members/${m.id}/stores`, { storeIds: ids });
            toast(single ? `ย้าย ${m.name} มาสาขา ${S.me.store.name} แล้ว` : `เพิ่ม ${m.name} ในสาขา ${S.me.store.name} แล้ว`);
            render();
          } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-remove]', root).forEach((b) => b.addEventListener('click', async () => {
          const m = byId(b.dataset.remove);
          const text = m.allBranches
            ? `<b>${esc(m.name)}</b> เป็นเจ้าของร้าน จะถูกนำออกจาก<b>ทุกสาขา</b> (บัญชีและประวัติที่เคยบันทึกยังอยู่)`
            : `<b>${esc(m.name)}</b> จะไม่สามารถเข้าดูข้อมูลของสาขานี้ได้อีก (บัญชีและประวัติที่เคยบันทึกยังอยู่)`;
          if (!await confirmBox('นำผู้ใช้ออก?', text, 'นำออก', true)) return;
          try { await DEL(`/api/members/${m.id}`); toast('นำผู้ใช้ออกแล้ว'); render(); } catch (e) { toast(e.message, 'err'); }
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
          // ร้าน/สาขาที่เชิญได้ (dropdown) — ค่าเริ่มต้นคือสาขาที่ใช้งานอยู่
          let shops;
          try { shops = (await GET('/api/invite-targets')).shops; } catch (e) { toast(e.message, 'err'); return; }
          if (!shops.length) { toast('คุณไม่มีสิทธิ์เชิญผู้ใช้', 'err'); return; }
          const cur = S.me.store;
          const shopOf = (orgId) => shops.find((x) => x.orgId === Number(orgId)) || shops[0];
          const startShop = shops.find((x) => x.orgId === cur.orgId) || shops[0];
          const res = await modal({
            title: 'เชิญผู้ใช้เข้าร้าน',
            wide: true,
            body: `<div style="display:flex;gap:10px;flex-wrap:wrap">
                <div class="field" style="flex:1 1 200px"><label for="iv-shop">ร้าน *</label><select class="input" id="iv-shop">${shops.map((x) => `<option value="${x.orgId}" ${x.orgId === startShop.orgId ? 'selected' : ''}>${esc(x.orgName)}</option>`).join('')}</select></div>
                <div class="field" style="flex:1 1 200px"><label for="iv-store">สาขา *</label><select class="input" id="iv-store"></select></div></div>
              <div class="field"><label for="iv-em">อีเมล *</label><input class="input" id="iv-em" type="email" inputmode="email" autocapitalize="none" spellcheck="false"></div>
              <div class="field"><label for="iv-nm">ชื่อ-นามสกุล</label><input class="input" id="iv-nm" maxlength="80"></div>
              <div class="field"><label for="iv-rl">บทบาท</label><select class="input" id="iv-rl"></select>
                <div class="hint" id="iv-hint"></div></div>
              <div class="field" id="iv-br" hidden><label>สาขาที่ให้ดูแล</label><div class="stack" style="gap:4px" id="iv-br-list"></div></div>
              <div class="field"><label for="iv-pw">รหัสผ่านเริ่มต้น</label><div style="display:flex;gap:8px"><input class="input" id="iv-pw" value="${genPassword()}" style="font-family:ui-monospace,monospace"><button type="button" class="btn btn-secondary" id="gen">สุ่มใหม่</button></div>
                <div class="hint">ถ้าอีเมลนี้มีบัญชี CosmoStock อยู่แล้ว ระบบจะเพิ่มเข้าร้านโดยใช้รหัสผ่านเดิมของเขา</div></div>
              <div class="form-err" hidden></div>`,
            onMount(dlg) {
              $('#gen', dlg).addEventListener('click', () => { $('#iv-pw', dlg).value = genPassword(); });
              const shopSel = $('#iv-shop', dlg), storeSel = $('#iv-store', dlg), roleSel = $('#iv-rl', dlg);
              const roleOf = () => shopOf(shopSel.value).roles.find((r) => r.key === roleSel.value);
              const fillShop = (keepRole) => {
                const shop = shopOf(shopSel.value);
                storeSel.innerHTML = shop.stores.map((st) => `<option value="${st.id}" ${st.id === cur.id ? 'selected' : ''}>${esc(st.name)}</option>`).join('');
                const want = keepRole && shop.roles.some((r) => r.key === keepRole) ? keepRole : (shop.roles.some((r) => r.key === 'staff') ? 'staff' : shop.roles[0]?.key);
                roleSel.innerHTML = shop.roles.map((r) => `<option value="${esc(r.key)}" ${r.key === want ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
                fillBranches();
              };
              const fillBranches = () => {
                const shop = shopOf(shopSel.value);
                $('#iv-br-list', dlg).innerHTML = shop.stores.map((st) => `<label class="check"><input type="checkbox" value="${st.id}" ${String(st.id) === storeSel.value ? 'checked' : ''}>${esc(st.name)}</label>`).join('');
                sync();
              };
              const sync = () => {
                const r = roleOf();
                const shop = shopOf(shopSel.value);
                const branch = storeSel.selectedOptions[0]?.textContent || '';
                $('#iv-hint', dlg).textContent = !r ? '' : r.scope === 'all' ? `เห็นได้ทุกสาขาของร้าน ${shop.orgName}`
                  : r.scope === 'multi' ? 'เห็นและจัดการได้เฉพาะสาขาที่เลือกด้านล่าง'
                    : `เข้าถึงได้เฉพาะ ${shop.orgName} · ${branch} เท่านั้น`;
                $('#iv-br', dlg).hidden = r?.scope !== 'multi' || shop.stores.length < 2;
              };
              shopSel.addEventListener('change', () => fillShop(roleSel.value));
              storeSel.addEventListener('change', fillBranches);
              roleSel.addEventListener('change', sync);
              fillShop('staff');
            },
            actions: [{ label: 'ยกเลิก' }, {
              label: ic('userplus') + 'เพิ่มเข้าร้าน', cls: 'btn-primary',
              onClick: async (dlg) => {
                const shop = shopOf($('#iv-shop', dlg).value);
                const storeId = Number($('#iv-store', dlg).value);
                const body = { storeId, email: $('#iv-em', dlg).value, name: $('#iv-nm', dlg).value, role: $('#iv-rl', dlg).value, password: $('#iv-pw', dlg).value };
                if (shop.roles.find((r) => r.key === body.role)?.scope === 'multi' && !$('#iv-br', dlg).hidden) {
                  body.storeIds = $$('#iv-br-list input:checked', dlg).map((c) => Number(c.value));
                  if (!body.storeIds.length) throw new Error('กรุณาเลือกอย่างน้อย 1 สาขา');
                }
                const r = await POST('/api/members', body);
                return { ...body, created: r.created, where: `${shop.orgName} · ${shop.stores.find((st) => st.id === storeId)?.name || ''}` };
              },
            }],
          });
          if (!res) return;
          toast(`เพิ่มผู้ใช้เข้า ${res.where} แล้ว`);
          if (res.created) await showCredentials('สร้างบัญชีผู้ใช้แล้ว', res.email.trim().toLowerCase(), res.password);
          render();
        });
        const permBoxes = (dlg) => d.permissions.map((p) => `<label class="check"><input type="checkbox" value="${esc(p.key)}">${esc(p.label)}</label>`).join('');
        $('#add-role', root).addEventListener('click', async () => {
          const ok = await modal({
            title: 'เพิ่มบทบาท',
            body: `<div class="field"><label for="rl-nm">ชื่อบทบาท *</label><input class="input" id="rl-nm" maxlength="40" placeholder="เช่น แคชเชียร์"></div>
              <div class="field"><label for="rl-sc">สาขาที่เข้าถึงได้</label><select class="input" id="rl-sc"><option value="single">${esc(d.scopes.single)}</option><option value="multi">${esc(d.scopes.multi)}</option></select></div>
              <div class="field"><label>สิทธิ์</label><div class="stack" style="gap:4px">${permBoxes()}</div></div>
              <div class="form-err" hidden></div>`,
            actions: [{ label: 'ยกเลิก' }, { label: 'เพิ่มบทบาท', cls: 'btn-primary', onClick: (dlg) => POST('/api/roles', {
              name: $('#rl-nm', dlg).value,
              scope: $('#rl-sc', dlg).value,
              perms: $$('input[type=checkbox]:checked', dlg).map((c) => c.value),
            }) }],
          });
          if (ok) { toast('เพิ่มบทบาทแล้ว'); render(); }
        });
        $$('[data-rename]', root).forEach((b) => b.addEventListener('click', async () => {
          const r = roleBy(b.dataset.rename);
          const ok = await modal({
            title: 'แก้ชื่อบทบาท',
            body: `<div class="field"><label for="rn">ชื่อบทบาท</label><input class="input" id="rn" maxlength="40" value="${esc(r.name)}"></div><div class="form-err" hidden></div>`,
            actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'btn-primary', onClick: (dlg) => PUT(`/api/roles/${r.key}`, { name: $('#rn', dlg).value }) }],
          });
          if (ok) { toast('แก้ชื่อบทบาทแล้ว'); render(); }
        }));
        $$('[data-delrole]', root).forEach((b) => b.addEventListener('click', async () => {
          const r = roleBy(b.dataset.delrole);
          if (!await confirmBox('ลบบทบาท?', `ลบบทบาท <b>${esc(r.name)}</b> ออกจากร้านนี้`, 'ลบบทบาท', true)) return;
          try { await DEL(`/api/roles/${r.key}`); toast('ลบบทบาทแล้ว'); render(); } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-scope]', root).forEach((s) => s.addEventListener('change', async () => {
          try { await PUT(`/api/roles/${s.dataset.scope}`, { scope: s.value }); toast('บันทึกการเข้าถึงสาขาแล้ว'); render(); }
          catch (e) { toast(e.message, 'err'); render(); }
        }));
        $$('[data-perm]', root).forEach((c) => c.addEventListener('change', async () => {
          const key = c.dataset.rk;
          const perms = $$(`[data-perm][data-rk="${key}"]:checked`, root).map((x) => x.dataset.perm);
          try { await PUT(`/api/roles/${key}`, { perms }); toast('บันทึกสิทธิ์แล้ว'); }
          catch (e) { c.checked = !c.checked; toast(e.message, 'err'); }
        }));
      },
    };
  }

  // ───────────────────────── system administration ─────────────────────────

  async function viewSystem() {
    const d = await GET('/api/sys/overview');
    const me = S.me.user.id;
    const pwInput = (id) => `<div style="display:flex;gap:8px"><input class="input" id="${id}" value="${genPassword()}" style="font-family:ui-monospace,monospace"><button type="button" class="btn btn-secondary" data-gen="${id}">สุ่มใหม่</button></div>`;
    const bindGen = (dlg) => $$('[data-gen]', dlg).forEach((b) => b.addEventListener('click', () => { $('#' + b.dataset.gen, dlg).value = genPassword(); }));
    const switchTo = async (storeId) => {
      try { S.me = await POST('/api/me/store', { storeId }); toast('สลับไปที่ ' + storeLabel(S.me.store)); go('/'); } catch (e) { toast(e.message, 'err'); }
    };
    const accessCell = (u) => u.superadmin ? '<span class="tag tag-accent">ทุกร้าน ทุกสาขา</span>' : u.access.length
      ? u.access.map((a) => `<div class="small"><b>${esc(a.shop)}</b> · ${esc(a.store)} <span class="muted">(${esc(a.roleLabel)})</span></div>`).join('')
      : '<span class="small muted">ยังไม่ได้อยู่ในร้านใด</span>';
    return {
      html: `<div class="page">
        <div class="page-head">
          <div class="ttl"><h2>ผู้ดูแลระบบ</h2><div class="sub">จัดการร้าน สาขา และผู้ใช้ทั้งหมดในระบบ — เจ้าของร้านแต่ละรายเห็นเฉพาะข้อมูลร้านของตัวเอง</div></div>
          <div class="acts"><button type="button" class="btn btn-primary blueprint" id="new-org">${CORNERS}${ic('plus')}สร้างร้านใหม่</button></div>
        </div>
        <div class="kpis k4 blueprint">${CORNERS}
          <div class="kpi"><div class="k">ร้านทั้งหมด</div><div class="v">${fmtN(d.totals.orgs)}</div></div>
          <div class="kpi"><div class="k">สาขาทั้งหมด</div><div class="v">${fmtN(d.totals.stores)}</div></div>
          <div class="kpi"><div class="k">ผู้ใช้ทั้งหมด</div><div class="v">${fmtN(d.totals.users)}</div></div>
          <div class="kpi"><div class="k">สินค้าทั้งระบบ</div><div class="v">${fmtN(d.totals.products)} <small>SKU</small></div></div>
        </div>
        <div class="grid-2e">
          ${d.orgs.map((o) => `<div class="card blueprint">${CORNERS}
            <div style="display:flex;align-items:center;gap:8px"><div class="card-title" style="flex:1;min-width:0">${ic('store', 20)} ${esc(o.name)}</div>
              <button type="button" class="btn btn-secondary" data-addbr="${o.id}" title="เพิ่มสาขาในร้านนี้">${ic('plus')}เพิ่มสาขา</button>
              <button type="button" class="btn btn-ghost btn-ico plain" data-rename="${o.id}" title="เปลี่ยนชื่อร้าน">${ic('edit')}</button>
              <button type="button" class="btn btn-ghost btn-ico plain" data-delorg="${o.id}" title="ลบร้าน">${ic('trash')}</button></div>
            <div class="small muted">เจ้าของร้าน: ${o.owners.length ? o.owners.map((u) => esc(`${u.name} (${u.email})`)).join(', ') : '<b>ยังไม่มีเจ้าของ</b>'}</div>
            <div class="stack" style="gap:6px">${o.stores.map((s) => `<button type="button" class="store-opt ${s.id === S.me.store?.id ? 'on' : ''}" data-sw="${s.id}">${ic('package', 20)}<span class="nm">${esc(s.name)}<div class="small muted">${fmtN(s.products)} SKU · คงเหลือ ${fmtN(s.qty)} ชิ้น · พนักงาน ${fmtN(s.staff)} คน</div></span>${s.id === S.me.store?.id ? '<span class="tag tag-accent">กำลังดู</span>' : `<span class="small">เข้าดู</span>${ic('right')}`}</button>`).join('') || '<div class="small muted">ไม่มีสาขา</div>'}</div>
          </div>`).join('') || `<div class="card blueprint">${CORNERS}${empty('store', 'ยังไม่มีร้านในระบบ')}</div>`}
        </div>
        <div class="card blueprint">${CORNERS}<div class="card-title">ผู้ใช้ทั้งหมด (${d.users.length})</div>
          <table class="table rtable"><thead><tr><th>ผู้ใช้</th><th>ร้าน / สาขา / บทบาท</th><th>เข้าใช้ล่าสุด</th><th></th></tr></thead><tbody>
          ${d.users.map((u) => `<tr>
            <td class="lead" data-label=""><div class="pn"><div class="avatar">${esc(initial(u.name))}</div><div style="min-width:0"><div>${esc(u.name)}${u.id === me ? ' <span class="tag tag-accent">คุณ</span>' : ''}${u.superadmin ? ' <span class="tag tag-accent">ผู้ดูแลระบบ</span>' : ''}</div><div class="small muted" style="overflow-wrap:anywhere">${esc(u.email)}</div></div></div></td>
            <td data-label="สิทธิ์">${accessCell(u)}</td>
            <td data-label="เข้าใช้ล่าสุด" class="small">${u.lastLogin ? fmtDTY(u.lastLogin) : 'ยังไม่เคยเข้าใช้'}</td>
            <td class="acts" data-label="">
              ${u.id === me || u.superadmin ? '' : `<button type="button" class="btn btn-ghost btn-ico plain" data-imp="${u.id}" title="สวมสิทธิ์ — เข้าใช้งานในฐานะผู้ใช้นี้" aria-label="สวมสิทธิ์ ${esc(u.name)}">${ic('eye')}</button>`}
              <button type="button" class="btn btn-ghost btn-ico plain" data-edituser="${u.id}" title="แก้ไขข้อมูลบัญชี (ชื่อ อีเมล รหัสผ่าน)" aria-label="แก้ไขบัญชี ${esc(u.name)}">${ic('edit')}</button>
              <button type="button" class="btn btn-ghost btn-ico plain" data-pw="${u.id}" title="ตั้งรหัสผ่านใหม่">${ic('key')}</button>
              ${u.id === me ? '' : `<button type="button" class="btn btn-ghost btn-ico plain" data-sa="${u.id}" title="${u.superadmin ? 'ยกเลิกสิทธิ์ผู้ดูแลระบบ' : 'ตั้งเป็นผู้ดูแลระบบ'}">${ic(u.superadmin ? 'x' : 'settings')}</button>
              <button type="button" class="btn btn-ghost btn-ico plain" data-deluser="${u.id}" title="ลบบัญชี">${ic('trash')}</button>`}
            </td></tr>`).join('')}</tbody></table></div>
      </div>`,
      mount(root) {
        const org = (id) => d.orgs.find((o) => o.id === Number(id));
        const user = (id) => d.users.find((u) => u.id === Number(id));
        $$('[data-sw]', root).forEach((b) => b.addEventListener('click', () => { const id = Number(b.dataset.sw); if (id !== S.me.store?.id) switchTo(id); }));
        $$('[data-addbr]', root).forEach((b) => b.addEventListener('click', () => { const o = org(b.dataset.addbr); addBranchDialog(o.id, o.name); }));
        $('#new-org', root).addEventListener('click', async () => {
          const res = await modal({
            title: 'สร้างร้านใหม่',
            wide: true,
            body: `<div class="field"><label for="o-nm">ชื่อร้าน *</label><input class="input" id="o-nm" maxlength="60" placeholder="เช่น Lily Cosmetics"></div>
              <div class="field"><label for="o-br">ชื่อสาขาแรก</label><input class="input" id="o-br" maxlength="80" placeholder="เว้นว่าง = สาขาหลัก"></div>
              <div class="field"><label for="o-em">อีเมลเจ้าของร้าน *</label><input class="input" id="o-em" type="email" inputmode="email" autocapitalize="none" spellcheck="false">
                <div class="hint">ถ้าอีเมลนี้มีบัญชีอยู่แล้ว จะตั้งเป็นเจ้าของร้านใหม่โดยใช้รหัสผ่านเดิม</div></div>
              <div class="field"><label for="o-on">ชื่อเจ้าของร้าน (กรณีบัญชีใหม่)</label><input class="input" id="o-on" maxlength="80"></div>
              <div class="field"><label for="o-pw">รหัสผ่านเริ่มต้น (กรณีบัญชีใหม่)</label>${pwInput('o-pw')}</div>
              <div class="form-err" hidden></div>`,
            onMount: bindGen,
            actions: [{ label: 'ยกเลิก' }, { label: ic('plus') + 'สร้างร้าน', cls: 'btn-primary', onClick: async (dlg) => {
              const body = { shopName: $('#o-nm', dlg).value, branchName: $('#o-br', dlg).value, ownerEmail: $('#o-em', dlg).value, ownerName: $('#o-on', dlg).value, ownerPassword: $('#o-pw', dlg).value };
              const r = await POST('/api/sys/orgs', body);
              return { ...body, created: r.created };
            } }],
          });
          if (!res) return;
          toast(`สร้างร้าน ${res.shopName} แล้ว`);
          if (res.created) await showCredentials('สร้างบัญชีเจ้าของร้านแล้ว', res.ownerEmail.trim().toLowerCase(), res.ownerPassword);
          await refreshMe();
          render();
        });
        $$('[data-rename]', root).forEach((b) => b.addEventListener('click', async () => {
          const o = org(b.dataset.rename);
          const ok = await modal({
            title: 'เปลี่ยนชื่อร้าน',
            body: `<div class="field"><label for="rn">ชื่อร้าน</label><input class="input" id="rn" maxlength="60" value="${esc(o.name)}"></div><div class="form-err" hidden></div>`,
            actions: [{ label: 'ยกเลิก' }, { label: 'บันทึก', cls: 'btn-primary', onClick: (dlg) => PUT(`/api/sys/orgs/${o.id}`, { name: $('#rn', dlg).value }) }],
          });
          if (ok) { toast('เปลี่ยนชื่อร้านแล้ว'); await refreshMe(); render(); }
        }));
        $$('[data-delorg]', root).forEach((b) => b.addEventListener('click', async () => {
          const o = org(b.dataset.delorg);
          const ok = await modal({
            title: `ลบร้าน ${o.name}?`,
            body: `<div class="dialog-body">สาขาทั้งหมด ${o.stores.length} สาขา พร้อมสินค้า ล็อต และประวัติการเคลื่อนไหวจะถูก<b>ลบถาวร</b> กู้คืนไม่ได้ (บัญชีผู้ใช้ยังอยู่)</div>
              <div class="field"><label for="cf">พิมพ์ชื่อร้าน <b>${esc(o.name)}</b> เพื่อยืนยัน</label><input class="input" id="cf" autocomplete="off"></div><div class="form-err" hidden></div>`,
            actions: [{ label: 'ยกเลิก' }, { label: ic('trash') + 'ลบร้านถาวร', cls: 'btn-danger', onClick: (dlg) => DEL(`/api/sys/orgs/${o.id}`, { confirmName: $('#cf', dlg).value }) }],
          });
          if (!ok) return;
          toast(`ลบร้าน ${o.name} แล้ว`);
          await refreshMe();
          render();
        }));
        $$('[data-imp]', root).forEach((b) => b.addEventListener('click', async () => {
          const u = user(b.dataset.imp);
          if (!await confirmBox(`สวมสิทธิ์เป็น ${u.name}?`, `คุณจะเห็นและทำได้<b>เท่าที่ ${esc(u.name)} ทำได้</b>เท่านั้น รายการที่บันทึกจะระบุว่าทำโดยผู้ดูแลระบบ<br>กด <b>กลับเป็นผู้ดูแลระบบ</b> ที่แถบด้านบนเมื่อเสร็จ (หมดอายุเองใน 2 ชั่วโมง)`, 'สวมสิทธิ์')) return;
          try {
            await POST(`/api/sys/users/${u.id}/impersonate`);
            S.shellKey = '';
            await loadMe();
            toast(`กำลังใช้งานในฐานะ ${u.name}`);
            go('/');
          } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-edituser]', root).forEach((b) => b.addEventListener('click', async () => {
          const u = user(b.dataset.edituser);
          const sp = u.name.trim().indexOf(' ');
          const [first, last] = sp > 0 ? [u.name.slice(0, sp), u.name.slice(sp + 1).trim()] : [u.name, ''];
          const res = await modal({
            title: `แก้ไขบัญชี ${u.name}`,
            body: `<div style="display:flex;gap:10px;flex-wrap:wrap">
                <div class="field" style="flex:1 1 160px"><label for="eu-fn">ชื่อ *</label><input class="input" id="eu-fn" maxlength="40" value="${esc(first)}"></div>
                <div class="field" style="flex:1 1 160px"><label for="eu-ln">นามสกุล</label><input class="input" id="eu-ln" maxlength="40" value="${esc(last)}"></div></div>
              <div class="field"><label for="eu-em">อีเมล (ใช้เข้าสู่ระบบ) *</label><input class="input" id="eu-em" type="email" inputmode="email" autocapitalize="none" spellcheck="false" value="${esc(u.email)}"></div>
              <div class="field"><label for="eu-pw">รหัสผ่านใหม่</label><div style="display:flex;gap:8px"><input class="input" id="eu-pw" autocomplete="new-password" placeholder="เว้นว่าง = ไม่เปลี่ยนรหัสผ่าน" style="font-family:ui-monospace,monospace"><button type="button" class="btn btn-secondary" data-genpw>สุ่ม</button></div>
                <div class="hint">อย่างน้อย 8 ตัวอักษร — ถ้าเปลี่ยน ${u.id === me ? 'อุปกรณ์อื่นของคุณ' : 'ผู้ใช้'}จะถูกออกจากระบบทุกอุปกรณ์</div></div>
              <div class="form-err" hidden></div>`,
            onMount(dlg) { $('[data-genpw]', dlg).addEventListener('click', () => { $('#eu-pw', dlg).value = genPassword(); }); },
            actions: [{ label: 'ยกเลิก' }, {
              label: 'บันทึก', cls: 'btn-primary', onClick: async (dlg) => {
                const body = { firstName: $('#eu-fn', dlg).value, lastName: $('#eu-ln', dlg).value, email: $('#eu-em', dlg).value, password: $('#eu-pw', dlg).value };
                await PUT(`/api/sys/users/${u.id}`, body);
                return body;
              },
            }],
          });
          if (!res) return;
          if (u.id === me) await refreshMe();
          if (res.password) await showCredentials('บันทึกข้อมูลบัญชีแล้ว', res.email.trim().toLowerCase(), res.password);
          else toast('บันทึกข้อมูลบัญชีแล้ว');
          render();
        }));
        $$('[data-pw]', root).forEach((b) => b.addEventListener('click', async () => {
          const u = user(b.dataset.pw);
          const pw = await modal({
            title: `ตั้งรหัสผ่านใหม่ให้ ${u.name}`,
            body: `<div class="field"><label for="sp">รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</label>${pwInput('sp')}</div>
              <div class="small muted">${u.id === me ? 'อุปกรณ์อื่นของคุณจะถูกออกจากระบบ' : 'ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์'}</div><div class="form-err" hidden></div>`,
            onMount: bindGen,
            actions: [{ label: 'ยกเลิก' }, { label: 'บันทึกรหัสผ่าน', cls: 'btn-primary', onClick: async (dlg) => { const v = $('#sp', dlg).value; await POST(`/api/sys/users/${u.id}/password`, { password: v }); return v; } }],
          });
          if (pw) showCredentials('ตั้งรหัสผ่านใหม่แล้ว', u.email, pw);
        }));
        $$('[data-sa]', root).forEach((b) => b.addEventListener('click', async () => {
          const u = user(b.dataset.sa);
          const text = u.superadmin
            ? `<b>${esc(u.name)}</b> จะไม่ใช่ผู้ดูแลระบบอีกต่อไป และเห็นเฉพาะร้านที่ตัวเองเป็นสมาชิก`
            : `<b>${esc(u.name)}</b> จะเห็นและจัดการได้<b>ทุกร้าน ทุกสาขา และผู้ใช้ทั้งหมด</b>ในระบบ`;
          if (!await confirmBox(u.superadmin ? 'ยกเลิกสิทธิ์ผู้ดูแลระบบ?' : 'ตั้งเป็นผู้ดูแลระบบ?', text, 'ยืนยัน', !u.superadmin)) return;
          try { await PUT(`/api/sys/users/${u.id}`, { superadmin: !u.superadmin }); toast('บันทึกสิทธิ์แล้ว'); render(); } catch (e) { toast(e.message, 'err'); }
        }));
        $$('[data-deluser]', root).forEach((b) => b.addEventListener('click', async () => {
          const u = user(b.dataset.deluser);
          if (!await confirmBox('ลบบัญชีผู้ใช้?', `บัญชี <b>${esc(u.name)}</b> (${esc(u.email)}) จะถูกลบถาวรและออกจากทุกร้าน — ประวัติการเคลื่อนไหวที่เคยบันทึกยังอยู่`, 'ลบบัญชี', true)) return;
          try { await DEL(`/api/sys/users/${u.id}`); toast('ลบบัญชีแล้ว'); render(); } catch (e) { toast(e.message, 'err'); }
        }));
      },
    };
  }

  // ───────────────────────── settings & more ─────────────────────────

  async function viewSettings() {
    const { user, store, stores } = S.me;
    const canNewShop = !user.superadmin && stores.some((s) => s.role === 'owner');
    const owner = !!store.canManageBranches;
    const branches = stores.filter((s) => s.orgId === store.orgId);
    const imp = !!user.impersonatedBy;
    return {
      html: `<div class="page narrow">
        <div class="page-head"><div class="ttl"><h2>ตั้งค่า</h2><div class="sub">${esc(user.email)}</div></div></div>
        ${can('settings') ? `<form class="card blueprint form-card" id="sf" novalidate>${CORNERS}
          <div class="card-title">ตั้งค่าสาขา · ${esc(storeLabel(store))}</div>
          <div class="field"><label for="s-nm">ชื่อสาขา</label><input class="input" id="s-nm" name="name" value="${esc(store.name)}" maxlength="60" required>
            <div class="hint">สาขานี้อยู่ภายใต้ร้าน <b>${esc(store.orgName)}</b>${owner ? ' — เปลี่ยนชื่อร้านได้ที่การ์ดร้านด้านล่าง' : ''}</div></div>
          <div class="field"><label for="s-ed">แจ้งเตือนสินค้าใกล้หมดอายุล่วงหน้า (วัน)</label><input class="input" id="s-ed" name="expiryDays" type="number" inputmode="numeric" min="1" max="730" value="${store.expiryDays}">
            <div class="hint">จุดสั่งซื้อ (แจ้งเตือนสต็อกต่ำ) ตั้งแยกได้ในหน้าแก้ไขสินค้าแต่ละตัว</div></div>
          <div class="form-err" hidden></div>
          <div class="form-foot"><button type="submit" class="btn btn-primary">บันทึกการตั้งค่าสาขา</button></div>
        </form>` : ''}
        ${owner ? `<div class="card blueprint form-card">${CORNERS}
          <div class="card-title">${ic('store', 20)} ร้าน ${esc(store.orgName)}</div>
          <form id="rf" class="stack" style="gap:10px" novalidate>
            <div class="field"><label for="r-nm">ชื่อร้าน (ใช้ร่วมกันทุกสาขา)</label><div style="display:flex;gap:8px;flex-wrap:wrap"><input class="input" id="r-nm" name="name" value="${esc(store.orgName)}" maxlength="60" required style="flex:1 1 220px"><button type="submit" class="btn btn-secondary">บันทึกชื่อร้าน</button></div></div>
            <div class="form-err" hidden></div>
          </form>
          <div class="field" style="border-top:1px solid var(--color-divider);padding-top:14px"><label>สาขาในร้านนี้ (${branches.length})</label>
            <div class="stack" style="gap:6px">${branches.map((b) => `<div class="store-opt ${b.id === store.id ? 'on' : ''}" style="cursor:default">${ic('store', 20)}<span class="nm">${esc(b.name)}</span>
              ${b.id === store.id ? '<span class="tag tag-accent">กำลังใช้งาน</span>' : ''}
              <button type="button" class="btn btn-ghost btn-ico plain" data-delbr="${b.id}" title="ลบสาขา ${esc(b.name)}" aria-label="ลบสาขา ${esc(b.name)}" ${branches.length <= 1 ? 'disabled' : ''}>${ic('trash')}</button></div>`).join('')}</div>
            <div class="hint">เพิ่มหรือลบสาขาได้เฉพาะเจ้าของร้านขึ้นไป ร้านต้องมีอย่างน้อย 1 สาขา</div></div>
          <div><button type="button" class="btn btn-primary" data-addbr>${ic('plus')}เพิ่มสาขา</button>
            <div class="hint">สาขาใหม่อยู่ภายใต้ร้าน ${esc(store.orgName)} เจ้าของร้านทุกคนของร้านนี้จะเห็นอัตโนมัติ</div></div>
        </div>` : ''}
        ${imp ? '' : `<form class="card blueprint form-card" id="af" novalidate>${CORNERS}
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
        </form>`}
        <div class="card blueprint form-card">${CORNERS}
          <div class="card-title">ร้านและสาขาของฉัน (${stores.length})</div>
          <div class="stack" style="gap:8px">${storeOptions(stores, store.id, 'data-sw', (s) => (s.id === store.id ? '<span class="tag tag-accent">กำลังใช้งาน</span>' : `<span class="small">สลับ</span>${ic('right')}`))}</div>
          ${owner ? '' : '<div class="small muted">สาขาที่คุณเข้าถึงได้กำหนดโดยเจ้าของร้าน</div>'}
          ${canNewShop ? `<div style="border-top:1px solid var(--color-divider);padding-top:14px"><button type="button" class="btn btn-secondary" data-newshop>${ic('store')}สร้างร้านใหม่</button>
            <div class="hint">ร้านใหม่ = ธุรกิจใหม่ ข้อมูลแยกจากร้านเดิมทั้งหมด (ถ้าเป็นที่ตั้งใหม่ของร้านเดิม ให้ใช้ เพิ่มสาขา)</div></div>` : ''}
        </div>
        <button type="button" class="btn btn-secondary" data-act="logout" style="min-height:50px;color:var(--color-accent-700);border-color:var(--color-accent-300)">${ic('logout', 20)}ออกจากระบบ</button>
      </div>`,
      mount(root) {
        bindEyes(root);
        const sf = $('#sf', root);
        if (sf) onSubmit(sf, async (d) => { await PUT('/api/store', { name: d.name, expiryDays: Number(d.expiryDays) }); toast('บันทึกการตั้งค่าร้านแล้ว'); await refreshMe(); });
        const af = $('#af', root);
        if (af) onSubmit(af, async (d) => { S.me = await PUT('/api/me', { name: d.name }); updateShellBits(); toast('บันทึกชื่อแล้ว'); });
        const pf = $('#pf', root);
        if (pf) onSubmit(pf, async (d, form) => {
          if (d.next !== d.next2) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
          await POST('/api/me/password', { current: d.current, next: d.next });
          form.reset();
          toast('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นจะถูกออกจากระบบ');
        });
        const rf = $('#rf', root);
        if (rf) onSubmit(rf, async (d) => { S.me = await PUT('/api/org', { name: d.name }); updateShellBits(); toast('บันทึกชื่อร้านแล้ว'); render(); });
        $('[data-addbr]', root)?.addEventListener('click', () => addBranchDialog(store.orgId, store.orgName));
        $('[data-newshop]', root)?.addEventListener('click', () => newShopDialog());
        $$('[data-delbr]', root).forEach((b) => b.addEventListener('click', async () => {
          const br = branches.find((x) => x.id === Number(b.dataset.delbr));
          const res = await modal({
            title: `ลบสาขา ${br.name}?`,
            body: `<div class="dialog-body">สินค้า ล็อต และประวัติการเคลื่อนไหวทั้งหมดของ <b>${esc(storeLabel(br))}</b> จะถูก<b>ลบถาวร</b> กู้คืนไม่ได้ พนักงานที่อยู่เฉพาะสาขานี้จะเข้าไม่ได้อีก (บัญชีผู้ใช้ยังอยู่)</div>
              <div class="field"><label for="cf">พิมพ์ชื่อสาขา <b>${esc(br.name)}</b> เพื่อยืนยัน</label><input class="input" id="cf" autocomplete="off"></div><div class="form-err" hidden></div>`,
            actions: [{ label: 'ยกเลิก' }, { label: ic('trash') + 'ลบสาขาถาวร', cls: 'btn-danger', onClick: (dlg) => DEL(`/api/stores/${br.id}`, { confirmName: $('#cf', dlg).value }) }],
          });
          if (!res) return;
          S.me = res;
          S.shellKey = '';
          toast(`ลบสาขา ${br.name} แล้ว`);
          render();
        }));
        $$('[data-sw]', root).forEach((b) => b.addEventListener('click', async () => {
          const id = Number(b.dataset.sw);
          if (id === store.id) return;
          try { S.me = await POST('/api/me/store', { storeId: id }); toast('สลับไปที่ ' + storeLabel(S.me.store)); go('/'); } catch (e) { toast(e.message, 'err'); }
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
          <span class="tag tag-accent">${esc(user.superadmin ? 'ผู้ดูแลระบบ' : store.roleLabel)}</span></div>
        <div class="field"><label>ร้านที่กำลังจัดการ</label>
          <button type="button" class="btn btn-secondary store-btn" data-act="store" style="width:100%;min-height:52px">${ic('store', 20)}<span class="nm">${esc(storeLabel(store))}</span>${stores.length > 1 ? '<span class="small muted">สลับร้าน / สาขา</span>' : ''}${ic('right')}</button></div>
        <div class="menu-sec"><div class="h">คลังสินค้า</div>
          ${can('stock.adjust') ? link('#/move/adj', 'adjust', 'ปรับยอดสต็อก') : ''}
          ${link('#/history', 'history', 'ประวัติการเคลื่อนไหว')}
          ${link('#/alerts', 'bell', 'การแจ้งเตือน', store.alertCount ? `<span class="tag tag-accent">${store.alertCount}</span>` : '')}
          ${can('report') ? link('#/reports', 'chart', 'รายงาน') : ''}
          <button type="button" class="mi" data-act="scan">${ic('scan', 20)}<span class="lbl">สแกน Barcode / QR</span>${ic('right')}</button>
        </div>
        <div class="menu-sec"><div class="h">บัญชีและร้าน</div>
          ${user.superadmin ? link('#/system', 'key', 'ผู้ดูแลระบบ · ทุกร้าน ทุกสาขา') : ''}
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
