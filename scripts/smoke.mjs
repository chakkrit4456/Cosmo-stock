// Smoke test — ตรวจเร็ว ๆ ว่าเว็บที่ deploy แล้ว "ยังทำงาน" (อ่านอย่างเดียว ไม่แก้ข้อมูลใด ๆ)
//
//   npm run smoke                                          → ทดสอบ http://localhost:3000
//   SMOKE_URL=https://cosmostock.onrender.com npm run smoke → ทดสอบเว็บจริง
//
// ถ้าตั้ง SMOKE_EMAIL และ SMOKE_PASSWORD จะล็อกอินแล้วเปิดหน้าหลักทุกหน้าผ่าน API ด้วย
// (แนะนำบัญชีบทบาท "ดูอย่างเดียว" เพราะไม่ต้องใช้สิทธิ์แก้ไขอะไร)
// ออกด้วยรหัส 1 ถ้ามีข้อใดไม่ผ่าน — ใช้ใน CI หรือหลัง deploy ได้

const BASE = (process.env.SMOKE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL || '';
const PASSWORD = process.env.SMOKE_PASSWORD || '';
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS) || 90_000; // Render แพ็กเกจฟรีอาจต้องปลุกเครื่องนานเกือบนาที

let cookie = '';
const results = [];

async function call(method, path, { body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  if (!raw) try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✔ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t, error: e.message });
    console.log(`  ✖ ${name} — ${e.message}`);
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
const expectStatus = (r, want) => expect(r.status === want, `ได้ HTTP ${r.status} แต่ควรเป็น ${want}${r.json?.error ? ` (${r.json.error})` : ''}`);

console.log(`\nCosmoStock smoke test → ${BASE}\n`);

await check('หน้าเว็บหลักเปิดได้ (GET /)', async () => {
  const r = await call('GET', '/', { raw: true });
  expectStatus(r, 200);
  expect(/text\/html/.test(r.headers.get('content-type') || ''), 'ไม่ใช่ HTML');
  expect(r.text.includes('CosmoStock'), 'ไม่พบคำว่า CosmoStock ในหน้า');
});

for (const file of ['/app.js', '/app.css', '/manifest.webmanifest', '/favicon.svg']) {
  await check(`ไฟล์ static ${file}`, async () => {
    const r = await call('GET', file, { raw: true });
    expectStatus(r, 200);
    expect(r.text.length > 0, 'ไฟล์ว่าง');
  });
}

await check('มี security headers (CSP, X-Frame-Options, nosniff)', async () => {
  const r = await call('GET', '/', { raw: true });
  expect(r.headers.get('content-security-policy'), 'ไม่มี Content-Security-Policy');
  expect(r.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options ไม่ใช่ DENY');
  expect(r.headers.get('x-content-type-options') === 'nosniff', 'ไม่มี nosniff');
});

await check('API ที่ต้องล็อกอิน ตอบ 401 เมื่อยังไม่ล็อกอิน', async () => {
  expectStatus(await call('GET', '/api/me'), 401);
  expectStatus(await call('GET', '/api/products'), 401);
});

await check('API ที่ไม่มีอยู่ ตอบ 404', async () => expectStatus(await call('GET', '/api/does-not-exist'), 404));

await check('POST ที่ไม่มี header X-CS ถูกปฏิเสธ (กัน CSRF)', async () => {
  expectStatus(await call('POST', '/api/auth/login', { body: { email: 'x@example.com', password: 'x' } }), 403);
});

await check('ไม่มี API สมัครร้านสาธารณะ (POST /api/auth/register → 404)', async () => {
  expectStatus(await call('POST', '/api/auth/register', { body: { shopName: 'x', name: 'x', email: 'x@example.invalid', password: 'xxxxxxxx' }, headers: { 'x-cs': '1' } }), 404);
});

await check('ล็อกอินด้วยรหัสผิด ตอบ 401 (ฐานข้อมูลเชื่อมต่อได้)', async () => {
  const r = await call('POST', '/api/auth/login', { body: { email: 'smoke-test@example.invalid', password: 'wrong-password' }, headers: { 'x-cs': '1' } });
  expectStatus(r, 401);
  cookie = '';
});

if (EMAIL && PASSWORD) {
  await check(`ล็อกอินด้วย ${EMAIL}`, async () => {
    const r = await call('POST', '/api/auth/login', { body: { email: EMAIL, password: PASSWORD }, headers: { 'x-cs': '1' } });
    expectStatus(r, 200);
    expect(cookie.startsWith('cs_sid='), 'ไม่ได้รับ cookie cs_sid');
  });
  await check('ข้อมูลผู้ใช้ (GET /api/me)', async () => {
    const r = await call('GET', '/api/me');
    expectStatus(r, 200);
    expect(r.json?.user?.email === EMAIL.toLowerCase(), 'อีเมลไม่ตรงกับที่ล็อกอิน');
    expect(Array.isArray(r.json?.stores) && r.json.stores.length > 0, 'ผู้ใช้ไม่มีร้านให้เลือก');
  });
  const pages = [
    ['แดชบอร์ด', '/api/dashboard'],
    ['รายการสินค้า', '/api/products'],
    ['หมวดหมู่', '/api/categories'],
    ['การแจ้งเตือน', '/api/alerts'],
    ['ประวัติเคลื่อนไหว', '/api/movements?limit=5'],
    ['ข้อมูลร้าน', '/api/store'],
  ];
  for (const [name, path] of pages) {
    await check(`${name} (GET ${path})`, async () => {
      const r = await call('GET', path);
      expectStatus(r, 200);
      expect(r.json && typeof r.json === 'object', 'ไม่ได้ JSON');
    });
  }
  await check('ออกจากระบบ', async () => {
    expectStatus(await call('POST', '/api/auth/logout', { headers: { 'x-cs': '1' } }), 200);
    cookie = '';
  });
} else {
  console.log('  – ข้ามการทดสอบหลังล็อกอิน (ตั้ง SMOKE_EMAIL และ SMOKE_PASSWORD เพื่อทดสอบเพิ่ม)');
}

const failed = results.filter((r) => !r.ok);
console.log(`\nผล: ผ่าน ${results.length - failed.length}/${results.length}${failed.length ? ` — ไม่ผ่าน ${failed.length} ข้อ` : ''}\n`);
process.exit(failed.length ? 1 : 0);
