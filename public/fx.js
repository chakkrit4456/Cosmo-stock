// CosmoStock — เอฟเฟกต์เสริมหน้าเว็บ (ไม่กระทบตรรกะของแอป ถ้าไฟล์นี้โหลดไม่ได้เว็บยังใช้งานได้ปกติ)
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pathOf = () => (location.hash.slice(1).split('?')[0] || '/');
  let lastPath = null;
  let timer = 0;

  // ใส่ลำดับ --i ให้ลูกๆ เพื่อทำจังหวะทีละชิ้น (จำกัดไม่เกิน 12 ชิ้น)
  const stagger = (view) => {
    const groups = ['.page', '.list', '.table tbody', '.stack', '.catbar-wrap', '.actions-4', '.quick', '.chart', '.card'];
    for (const sel of groups) {
      const parents = sel === '.page' ? [view.querySelector('.page')] : view.querySelectorAll(sel);
      parents.forEach((p) => p && [...p.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 12))));
    }
    // แถบหมวดหมู่เรียงต่อกันในการ์ดเดียวกัน
    view.querySelectorAll('.catbar').forEach((c, i) => c.style.setProperty('--i', Math.min(i, 12)));
    view.querySelectorAll('.blueprint').forEach((b, i) => b.style.setProperty('--i', Math.min(i, 8)));
  };

  // นับเลขขึ้นสำหรับตัวเลขสรุป (KPI)
  const countUp = (view) => {
    if (reduce) return;
    view.querySelectorAll('.kpi .v, .pstats .balance').forEach((el) => {
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.nodeValue));
      if (!node) return;
      const m = /^(\s*[^\d\s-]*)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/.exec(node.nodeValue);
      if (!m) return;
      const target = Number(m[2].replace(/,/g, ''));
      if (!Number.isFinite(target) || target < 2) return;
      const dec = (m[2].split('.')[1] || '').length;
      const final = node.nodeValue;
      const t0 = performance.now();
      const dur = 750;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / dur);
        const v = target * (1 - Math.pow(1 - p, 3));
        node.nodeValue = m[1] + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + m[3];
        if (p < 1 && node.isConnected) requestAnimationFrame(tick); else node.nodeValue = final;
      };
      requestAnimationFrame(tick);
    });
  };

  const onView = (view) => {
    const path = pathOf();
    if (path === lastPath) return;       // เรนเดอร์ซ้ำในหน้าเดิม (กรอง/บันทึก) ไม่ต้องเล่นซ้ำ
    lastPath = path;
    if (reduce) return;
    stagger(view);
    view.classList.add('fx-enter');
    countUp(view);
    clearTimeout(timer);
    timer = setTimeout(() => view.classList.remove('fx-enter'), 1700);
  };

  // เฝ้าดูการเปลี่ยนเนื้อหาของ #view (ใช้ฐานเดียวกับที่แอปเรนเดอร์)
  const watch = () => {
    let seen = null;
    new MutationObserver(() => {
      const view = document.getElementById('view');
      if (!view) { lastPath = null; seen = null; return; }
      if (seen !== view) { seen = view; lastPath = null; }
      if (view.querySelector('.page') && !view.querySelector('.sk')) onView(view);
    }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  };

  // เงาใต้แถบบนของมือถือเมื่อเลื่อนลง
  addEventListener('scroll', () => document.querySelector('.top')?.classList.toggle('scrolled', scrollY > 6), { passive: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch); else watch();
})();
