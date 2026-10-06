import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'cosmostock.db');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@cosmostock.app').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CosmoAdmin@2569';
const DEMO_PASSWORD = 'Demo@2569';
const DAY = 86400000;

const ROLES = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', staff: 'พนักงานคลัง', viewer: 'ดูอย่างเดียว' };
const PERMS = {
  'product.edit': ['owner', 'manager'],
  'product.delete': ['owner'],
  'stock.move': ['owner', 'manager', 'staff'],
  'stock.adjust': ['owner', 'manager'],
  'report': ['owner', 'manager', 'viewer'],
  'users': ['owner'],
  'settings': ['owner'],
};
const can = (role, perm) => !!PERMS[perm]?.includes(role);
const DEFAULT_CATEGORIES = ['สกินแคร์', 'เมคอัพ', 'บำรุงผิว', 'กันแดด', 'คลีนซิ่ง'];

// ───────────────────────── database ─────────────────────────

if (process.argv.includes('--reset')) {
  for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) fs.rmSync(f, { force: true });
  console.log('ลบฐานข้อมูลเดิมแล้ว จะสร้างข้อมูลตัวอย่างใหม่');
}
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  expiry_days INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_id, user_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  cost REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  track_expiry INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_sku ON products(store_id, sku) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_products_barcode ON products(store_id, barcode);
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_no TEXT NOT NULL DEFAULT '',
  expiry TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lots_product ON lots(product_id);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adj')),
  doc_no TEXT NOT NULL,
  qty INTEGER NOT NULL,
  before_qty INTEGER NOT NULL,
  after_qty INTEGER NOT NULL,
  lot_info TEXT,
  expiry TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_movements_store_time ON movements(store_id, created_at);
CREATE INDEX IF NOT EXISTS ix_movements_product ON movements(product_id);
CREATE TABLE IF NOT EXISTS counters (
  store_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (store_id, type)
);
`);

const stmts = new Map();
const prep = (sql) => {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
};
const bind = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const all = (sql, ...p) => prep(sql).all(...bind(p));
const get = (sql, ...p) => prep(sql).get(...bind(p));
const run = (sql, ...p) => prep(sql).run(...bind(p));

let txDepth = 0;
function tx(fn) {
  if (txDepth) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

// ───────────────────────── helpers ─────────────────────────

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const nowIso = () => new Date().toISOString();

function localDate(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / DAY);
}

function text(v, { label, max = 200, required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `กรุณากรอก${label}`);
  if (s.length > max) throw new HttpError(400, `${label}ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

function intVal(v, { label, min = 0, max = 1e7 }) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label}ต้องเป็นจำนวนเต็ม ${min} ขึ้นไป`);
  return n;
}

function numVal(v, { label, min = 0, max = 1e9 }) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return Math.round(n * 100) / 100;
}

function dateVal(v, label) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  }
  return v;
}

function isoVal(v, label) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return new Date(t).toISOString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailVal(v) {
  const s = text(v, { label: 'อีเมล', max: 120, required: true }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  return s;
}

function passwordVal(v, label = 'รหัสผ่าน') {
  const s = v == null ? '' : String(v);
  if (s.length < 8) throw new HttpError(400, `${label}ต้องมีอย่างน้อย 8 ตัวอักษร`);
  if (s.length > 200) throw new HttpError(400, `${label}ยาวเกินไป`);
  return s;
}

const likeArg = (q) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const k = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(key, 'hex');
  return k.length === expected.length && crypto.timingSafeEqual(k, expected);
}

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// ───────────────────────── stock domain ─────────────────────────

function nextDoc(storeId, type) {
  const prefix = { in: 'RCV', out: 'ISS', adj: 'ADJ' }[type];
  run(`INSERT INTO counters(store_id, type, n) VALUES (?, ?, 1)
       ON CONFLICT(store_id, type) DO UPDATE SET n = n + 1`, storeId, type);
  const { n } = get('SELECT n FROM counters WHERE store_id = ? AND type = ?', storeId, type);
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

const lotsQty = (pid) => Number(get('SELECT COALESCE(SUM(qty), 0) AS q FROM lots WHERE product_id = ?', pid).q);

function addToLot(pid, qty, lotNo, expiry, at) {
  const lot = get('SELECT id FROM lots WHERE product_id = ? AND lot_no = ? AND expiry IS ?', pid, lotNo || '', expiry || null);
  if (lot) run('UPDATE lots SET qty = qty + ? WHERE id = ?', qty, lot.id);
  else run('INSERT INTO lots(product_id, lot_no, expiry, qty, received_at) VALUES (?, ?, ?, ?, ?)', pid, lotNo || '', expiry || null, qty, at);
}

// First-expiry-first-out: lots without an expiry date are used last.
function takeFromLots(pid, qty) {
  const lots = all('SELECT id, lot_no, qty FROM lots WHERE product_id = ? AND qty > 0 ORDER BY expiry IS NULL, expiry, id', pid);
  let left = qty;
  const used = [];
  for (const l of lots) {
    if (!left) break;
    const take = Math.min(left, l.qty);
    run('UPDATE lots SET qty = qty - ? WHERE id = ?', take, l.id);
    if (l.lot_no) used.push(`${l.lot_no}×${take}`);
    left -= take;
  }
  if (left > 0) throw new HttpError(400, 'จำนวนคงเหลือไม่พอ');
  return used.join(', ') || null;
}

function moveStock({ storeId, userId, userName }, input, at = nowIso()) {
  return tx(() => {
    const p = get('SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL', Number(input.productId) || 0, storeId);
    if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
    const before = lotsQty(p.id);
    const type = input.type;
    let delta, lotInfo = null, expiry = null;
    const takeLotFields = () => {
      const lotNo = text(input.lotNo, { label: 'เลขล็อต', max: 40 });
      expiry = dateVal(input.expiry, 'วันหมดอายุ');
      return lotNo;
    };
    if (type === 'in') {
      delta = intVal(input.qty, { label: 'จำนวน', min: 1, max: 1e6 });
      const lotNo = takeLotFields();
      addToLot(p.id, delta, lotNo, expiry, at);
      lotInfo = lotNo || null;
    } else if (type === 'out') {
      const q = intVal(input.qty, { label: 'จำนวน', min: 1, max: 1e6 });
      if (q > before) throw new HttpError(400, `จำนวนคงเหลือไม่พอ (มีอยู่ ${before} ${p.unit})`);
      lotInfo = takeFromLots(p.id, q);
      delta = -q;
    } else if (type === 'adj') {
      const target = intVal(input.newQty, { label: 'จำนวนที่นับได้จริง', min: 0, max: 1e6 });
      delta = target - before;
      if (delta === 0) throw new HttpError(400, 'จำนวนที่นับได้เท่ากับยอดในระบบ ไม่ต้องปรับยอด');
      if (delta > 0) {
        const lotNo = takeLotFields();
        addToLot(p.id, delta, lotNo, expiry, at);
        lotInfo = lotNo || null;
      } else {
        lotInfo = takeFromLots(p.id, -delta);
      }
    } else {
      throw new HttpError(400, 'ประเภทรายการไม่ถูกต้อง');
    }
    const note = text(input.note, { label: type === 'adj' ? 'เหตุผลการปรับยอด' : 'หมายเหตุ', max: 200, required: type === 'adj' });
    const after = before + delta;
    run('UPDATE products SET qty = ?, updated_at = ? WHERE id = ?', after, at, p.id);
    const docNo = nextDoc(storeId, type);
    const r = run(`INSERT INTO movements(store_id, product_id, type, doc_no, qty, before_qty, after_qty, lot_info, expiry, note, user_id, user_name, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      storeId, p.id, type, docNo, delta, before, after, lotInfo, expiry, note || null, userId, userName, at);
    return { id: Number(r.lastInsertRowid), docNo, type, qty: delta, before, after, unit: p.unit, name: p.name };
  });
}

function storeRow(storeId) {
  return get('SELECT id, name, expiry_days FROM stores WHERE id = ?', storeId);
}

function statusOf(p, expiryDays) {
  const d = p.next_expiry ? daysUntil(p.next_expiry) : null;
  if (p.qty <= 0) return 'out';
  if (d !== null && d < 0) return 'expired';
  if (p.qty <= p.reorder_point) return 'low';
  if (d !== null && d <= expiryDays) return 'exp';
  return 'ok';
}

function productOut(p, expiryDays) {
  return {
    id: p.id, sku: p.sku, name: p.name, barcode: p.barcode, category: p.category, unit: p.unit,
    cost: p.cost, price: p.price, reorderPoint: p.reorder_point, trackExpiry: !!p.track_expiry,
    qty: p.qty, hasImage: !!p.has_image, nextExpiry: p.next_expiry || null,
    daysToExpiry: p.next_expiry ? daysUntil(p.next_expiry) : null,
    status: statusOf(p, expiryDays), updatedAt: p.updated_at,
  };
}

const PRODUCT_COLS = `p.id, p.sku, p.name, p.barcode, p.category, p.unit, p.cost, p.price, p.reorder_point, p.track_expiry,
  p.qty, p.updated_at, p.image IS NOT NULL AS has_image,
  (SELECT MIN(l.expiry) FROM lots l WHERE l.product_id = p.id AND l.qty > 0 AND l.expiry IS NOT NULL) AS next_expiry`;

function listProducts(storeId, { q = '', category = '', status = '' } = {}) {
  const store = storeRow(storeId);
  const where = ['p.store_id = ?', 'p.deleted_at IS NULL'];
  const args = [storeId];
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode LIKE ? ESCAPE '\\')");
    const l = likeArg(q);
    args.push(l, l, l);
  }
  if (category) { where.push('p.category = ?'); args.push(category); }
  let rows = all(`SELECT ${PRODUCT_COLS} FROM products p WHERE ${where.join(' AND ')} ORDER BY p.name COLLATE NOCASE`, ...args)
    .map((p) => productOut(p, store.expiry_days));
  if (status === 'alert') rows = rows.filter((p) => p.status !== 'ok');
  else if (status) rows = rows.filter((p) => p.status === status);
  return rows;
}

function buildAlerts(storeId) {
  const store = storeRow(storeId);
  const low = all(`SELECT id, sku, name, unit, qty, reorder_point FROM products
                   WHERE store_id = ? AND deleted_at IS NULL AND qty <= reorder_point
                   ORDER BY qty, name`, storeId)
    .map((p) => ({ productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: p.qty, reorderPoint: p.reorder_point, kind: p.qty <= 0 ? 'out' : 'low' }));
  const limit = localDate(new Date(Date.now() + store.expiry_days * DAY));
  const expiring = all(`SELECT l.id, l.lot_no, l.expiry, l.qty, p.id AS product_id, p.sku, p.name, p.unit
                        FROM lots l JOIN products p ON p.id = l.product_id
                        WHERE p.store_id = ? AND p.deleted_at IS NULL AND l.qty > 0 AND l.expiry IS NOT NULL AND l.expiry <= ?
                        ORDER BY l.expiry`, storeId, limit)
    .map((l) => ({ lotId: l.id, lotNo: l.lot_no, expiry: l.expiry, days: daysUntil(l.expiry), qty: l.qty, productId: l.product_id, sku: l.sku, name: l.name, unit: l.unit }));
  return { low, expiring, expiryDays: store.expiry_days };
}

function listMovements(storeId, { q = '', type = '', from = null, to = null, productId = null, limit = 50, offset = 0 } = {}) {
  const where = ['m.store_id = ?'];
  const args = [storeId];
  if (type) { where.push('m.type = ?'); args.push(type); }
  if (from) { where.push('m.created_at >= ?'); args.push(from); }
  if (to) { where.push('m.created_at < ?'); args.push(to); }
  if (productId) { where.push('m.product_id = ?'); args.push(productId); }
  if (q) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR m.doc_no LIKE ? ESCAPE '\\' OR m.lot_info LIKE ? ESCAPE '\\')");
    const l = likeArg(q);
    args.push(l, l, l, l);
  }
  const w = where.join(' AND ');
  const total = Number(get(`SELECT COUNT(*) AS c FROM movements m JOIN products p ON p.id = m.product_id WHERE ${w}`, ...args).c);
  const rows = all(`SELECT m.id, m.type, m.doc_no, m.qty, m.before_qty, m.after_qty, m.lot_info, m.expiry, m.note, m.user_name, m.created_at,
                           p.id AS product_id, p.name, p.sku, p.unit, p.deleted_at IS NOT NULL AS deleted
                    FROM movements m JOIN products p ON p.id = m.product_id
                    WHERE ${w} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset)
    .map((m) => ({
      id: m.id, type: m.type, docNo: m.doc_no, qty: m.qty, before: m.before_qty, after: m.after_qty,
      lotInfo: m.lot_info, expiry: m.expiry, note: m.note, by: m.user_name, at: m.created_at,
      productId: m.product_id, name: m.name, sku: m.sku, unit: m.unit, deleted: !!m.deleted,
    }));
  return { rows, total };
}

// ───────────────────────── sessions ─────────────────────────

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';

function setSessionCookie(req, res, token, maxAgeSec) {
  const parts = [`cs_sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeSec != null) parts.push(`Max-Age=${maxAgeSec}`);
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function createSession(req, res, userId, storeId, remember) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = remember ? 30 * DAY : 12 * 3600 * 1000;
  run('INSERT INTO sessions(token, user_id, store_id, expires_at) VALUES (?, ?, ?, ?)', hashToken(token), userId, storeId, Date.now() + ttl);
  run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), userId);
  setSessionCookie(req, res, token, remember ? ttl / 1000 : null);
}

function loadSession(req) {
  const token = parseCookies(req).cs_sid;
  if (!token || token.length > 100) return null;
  const s = get(`SELECT s.token, s.store_id, s.expires_at, u.id AS user_id, u.name, u.email
                 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`, hashToken(token));
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

const loginFails = new Map();
function checkLoginThrottle(key) {
  const f = loginFails.get(key);
  if (f && f.count >= 8 && Date.now() - f.first < 10 * 60 * 1000) {
    throw new HttpError(429, 'พยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอ 10 นาทีแล้วลองใหม่');
  }
  if (f && Date.now() - f.first >= 10 * 60 * 1000) loginFails.delete(key);
}
function noteLoginFail(key) {
  const f = loginFails.get(key) || { count: 0, first: Date.now() };
  f.count++;
  loginFails.set(key, f);
}

// ───────────────────────── routing ─────────────────────────

const routes = [];
function api(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts: { auth: true, store: true, ...opts }, handler });
}

function memberships(userId) {
  return all(`SELECT s.id, s.name, m.role FROM members m JOIN stores s ON s.id = m.store_id
              WHERE m.user_id = ? ORDER BY s.name COLLATE NOCASE`, userId);
}

function mePayload(ctx) {
  const { session } = ctx;
  const stores = memberships(session.user_id).map((s) => ({ ...s, roleLabel: ROLES[s.role] }));
  let current = stores.find((s) => s.id === session.store_id) || stores[0] || null;
  if ((current?.id ?? null) !== session.store_id) {
    run('UPDATE sessions SET store_id = ? WHERE token = ?', current?.id ?? null, session.token);
  }
  let store = null;
  if (current) {
    const row = storeRow(current.id);
    const alerts = buildAlerts(current.id);
    store = {
      id: row.id, name: row.name, expiryDays: row.expiry_days, role: current.role, roleLabel: ROLES[current.role],
      perms: Object.fromEntries(Object.keys(PERMS).map((k) => [k, can(current.role, k)])),
      alertCount: alerts.low.length + alerts.expiring.length,
    };
  }
  return { user: { id: session.user_id, name: session.name, email: session.email }, stores, store, roles: ROLES };
}

// — auth —

api('POST', '/api/auth/login', { auth: false, store: false }, (ctx) => {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const key = `${ctx.req.socket.remoteAddress}|${email}`;
  checkLoginThrottle(key);
  const u = email && get('SELECT id, pass FROM users WHERE email = ?', email);
  if (!u || !verifyPassword(ctx.body.password || '', u.pass)) {
    noteLoginFail(key);
    throw new HttpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  loginFails.delete(key);
  const first = memberships(u.id)[0];
  createSession(ctx.req, ctx.res, u.id, first?.id ?? null, !!ctx.body.remember);
  return { ok: true };
});

api('POST', '/api/auth/register', { auth: false, store: false }, (ctx) => {
  const b = ctx.body;
  const storeName = text(b.storeName, { label: 'ชื่อร้าน', max: 80, required: true });
  const name = text(b.name, { label: 'ชื่อผู้ใช้', max: 80, required: true });
  const email = emailVal(b.email);
  const pass = passwordVal(b.password);
  if (get('SELECT 1 FROM users WHERE email = ?', email)) {
    throw new HttpError(409, 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเข้าสู่ระบบ แล้วเพิ่มร้านใหม่จากหน้า "ตั้งค่า"');
  }
  const { userId, storeId } = tx(() => {
    const at = nowIso();
    const userId = Number(run('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), at).lastInsertRowid);
    const storeId = Number(run('INSERT INTO stores(name, created_at) VALUES (?, ?)', storeName, at).lastInsertRowid);
    run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', storeId, userId, 'owner', at);
    return { userId, storeId };
  });
  createSession(ctx.req, ctx.res, userId, storeId, true);
  return { ok: true };
});

api('POST', '/api/auth/logout', { auth: false, store: false }, (ctx) => {
  const token = parseCookies(ctx.req).cs_sid;
  if (token) run('DELETE FROM sessions WHERE token = ?', hashToken(token));
  setSessionCookie(ctx.req, ctx.res, '', 0);
  return { ok: true };
});

// — me —

api('GET', '/api/me', { store: false }, (ctx) => mePayload(ctx));

api('POST', '/api/me/store', { store: false }, (ctx) => {
  const storeId = Number(ctx.body.storeId);
  if (!get('SELECT 1 FROM members WHERE store_id = ? AND user_id = ?', storeId, ctx.session.user_id)) {
    throw new HttpError(403, 'คุณไม่ได้เป็นสมาชิกของร้านนี้');
  }
  run('UPDATE sessions SET store_id = ? WHERE token = ?', storeId, ctx.session.token);
  ctx.session.store_id = storeId;
  return mePayload(ctx);
});

api('PUT', '/api/me', { store: false }, (ctx) => {
  const name = text(ctx.body.name, { label: 'ชื่อ', max: 80, required: true });
  run('UPDATE users SET name = ? WHERE id = ?', name, ctx.session.user_id);
  ctx.session.name = name;
  return mePayload(ctx);
});

api('POST', '/api/me/password', { store: false }, (ctx) => {
  const u = get('SELECT pass FROM users WHERE id = ?', ctx.session.user_id);
  if (!verifyPassword(ctx.body.current || '', u.pass)) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const next = passwordVal(ctx.body.next, 'รหัสผ่านใหม่');
  run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(next), ctx.session.user_id);
  run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', ctx.session.user_id, ctx.session.token);
  return { ok: true };
});

api('POST', '/api/stores', { store: false }, (ctx) => {
  const name = text(ctx.body.name, { label: 'ชื่อร้าน', max: 80, required: true });
  const storeId = tx(() => {
    const at = nowIso();
    const id = Number(run('INSERT INTO stores(name, created_at) VALUES (?, ?)', name, at).lastInsertRowid);
    run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', id, ctx.session.user_id, 'owner', at);
    return id;
  });
  run('UPDATE sessions SET store_id = ? WHERE token = ?', storeId, ctx.session.token);
  ctx.session.store_id = storeId;
  return mePayload(ctx);
});

// — store settings —

api('GET', '/api/store', (ctx) => {
  const s = storeRow(ctx.storeId);
  return { id: s.id, name: s.name, expiryDays: s.expiry_days };
});

api('PUT', '/api/store', { perm: 'settings' }, (ctx) => {
  const name = text(ctx.body.name, { label: 'ชื่อร้าน', max: 80, required: true });
  const expiryDays = intVal(ctx.body.expiryDays, { label: 'จำนวนวันแจ้งเตือนหมดอายุ', min: 1, max: 730 });
  run('UPDATE stores SET name = ?, expiry_days = ? WHERE id = ?', name, expiryDays, ctx.storeId);
  return { ok: true };
});

// — dashboard —

api('GET', '/api/dashboard', (ctx) => {
  const products = listProducts(ctx.storeId);
  const alerts = buildAlerts(ctx.storeId);
  const kpi = {
    sku: products.length,
    qty: products.reduce((s, p) => s + p.qty, 0),
    value: products.reduce((s, p) => s + p.qty * p.cost, 0),
    low: products.filter((p) => p.qty > 0 && p.qty <= p.reorderPoint).length,
    out: products.filter((p) => p.qty <= 0).length,
    expiring: new Set(alerts.expiring.map((e) => e.productId)).size,
  };
  const months = [];
  const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); start.setMonth(start.getMonth() - 5);
  for (let i = 0; i < 6; i++) {
    const d = new Date(start); d.setMonth(start.getMonth() + i);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, month: d.getMonth(), year: d.getFullYear(), in: 0, out: 0 });
  }
  for (const m of all('SELECT type, qty, created_at FROM movements WHERE store_id = ? AND created_at >= ?', ctx.storeId, start.toISOString())) {
    const d = new Date(m.created_at);
    const b = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
    if (!b) continue;
    if (m.type === 'in') b.in += m.qty;
    else if (m.type === 'out') b.out += -m.qty;
  }
  const cats = {};
  for (const p of products) {
    const c = p.category || 'ไม่ระบุหมวด';
    cats[c] = (cats[c] || 0) + p.qty * p.cost;
  }
  return {
    kpi,
    months,
    alerts: { low: alerts.low.slice(0, 5), expiring: alerts.expiring.slice(0, 5), lowTotal: alerts.low.length, expiringTotal: alerts.expiring.length, expiryDays: alerts.expiryDays },
    recent: listMovements(ctx.storeId, { limit: 6 }).rows,
    categories: Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
});

// — products —

api('GET', '/api/categories', (ctx) => {
  const used = all("SELECT DISTINCT category FROM products WHERE store_id = ? AND deleted_at IS NULL AND category <> ''", ctx.storeId).map((r) => r.category);
  return { categories: [...new Set([...DEFAULT_CATEGORIES, ...used])] };
});

api('GET', '/api/products', (ctx) => {
  const { q = '', category = '', status = '' } = ctx.query;
  return { products: listProducts(ctx.storeId, { q: q.trim().slice(0, 80), category, status }) };
});

api('GET', '/api/lookup', (ctx) => {
  const code = String(ctx.query.code || '').trim();
  if (!code) throw new HttpError(400, 'ไม่มีรหัสสินค้า');
  const store = storeRow(ctx.storeId);
  const p = get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.store_id = ? AND p.deleted_at IS NULL AND (p.barcode = ? OR p.sku = ? COLLATE NOCASE) LIMIT 1`, ctx.storeId, code, code);
  return { product: p ? productOut(p, store.expiry_days) : null };
});

function productForStore(ctx, id) {
  const store = storeRow(ctx.storeId);
  const p = get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ? AND p.store_id = ? AND p.deleted_at IS NULL`, Number(id) || 0, ctx.storeId);
  if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
  return productOut(p, store.expiry_days);
}

api('GET', '/api/products/:id', (ctx) => {
  const product = productForStore(ctx, ctx.params.id);
  const lots = all('SELECT id, lot_no, expiry, qty, received_at FROM lots WHERE product_id = ? AND qty > 0 ORDER BY expiry IS NULL, expiry, id', product.id)
    .map((l) => ({ id: l.id, lotNo: l.lot_no, expiry: l.expiry, days: l.expiry ? daysUntil(l.expiry) : null, qty: l.qty, receivedAt: l.received_at }));
  const history = listMovements(ctx.storeId, { productId: product.id, limit: 20 });
  return { product, lots, history: history.rows, historyTotal: history.total };
});

api('GET', '/api/products/:id/image', (ctx) => {
  const row = get('SELECT image FROM products WHERE id = ? AND store_id = ?', Number(ctx.params.id) || 0, ctx.storeId);
  const m = row?.image && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(row.image);
  if (!m) throw new HttpError(404, 'ไม่มีรูปสินค้า');
  ctx.res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400' });
  ctx.res.end(Buffer.from(m[2], 'base64'));
});

function productInput(b, { partialImage }) {
  const out = {
    name: text(b.name, { label: 'ชื่อสินค้า', max: 120, required: true }),
    sku: text(b.sku, { label: 'SKU', max: 40, required: true }).toUpperCase(),
    barcode: text(b.barcode, { label: 'บาร์โค้ด', max: 64 }),
    category: text(b.category, { label: 'หมวดหมู่', max: 40 }),
    unit: text(b.unit, { label: 'หน่วย', max: 20 }) || 'ชิ้น',
    cost: numVal(b.cost, { label: 'ราคาทุน' }),
    price: numVal(b.price, { label: 'ราคาขาย' }),
    reorderPoint: intVal(b.reorderPoint ?? 0, { label: 'จุดสั่งซื้อ', min: 0, max: 1e6 }),
    trackExpiry: !!b.trackExpiry,
  };
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(out.sku)) throw new HttpError(400, 'SKU ใช้ได้เฉพาะ A-Z, 0-9 และ - _ .');
  if (b.image === undefined && partialImage) out.image = undefined;
  else if (!b.image) out.image = null;
  else {
    if (typeof b.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image)) throw new HttpError(400, 'ไฟล์รูปไม่ถูกต้อง');
    if (b.image.length > 1_500_000) throw new HttpError(400, 'รูปมีขนาดใหญ่เกินไป');
    out.image = b.image;
  }
  return out;
}

function assertUniqueProduct(storeId, { sku, barcode }, exceptId = 0) {
  if (get('SELECT 1 FROM products WHERE store_id = ? AND deleted_at IS NULL AND sku = ? AND id <> ?', storeId, sku, exceptId)) {
    throw new HttpError(409, `SKU "${sku}" มีอยู่แล้วในร้านนี้`);
  }
  if (barcode && get('SELECT 1 FROM products WHERE store_id = ? AND deleted_at IS NULL AND barcode = ? AND id <> ?', storeId, barcode, exceptId)) {
    throw new HttpError(409, `บาร์โค้ด "${barcode}" ถูกใช้กับสินค้าอื่นแล้ว`);
  }
}

function createProduct(storeId, data, at = nowIso()) {
  assertUniqueProduct(storeId, data);
  return Number(run(`INSERT INTO products(store_id, sku, name, barcode, category, unit, cost, price, reorder_point, track_expiry, image, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    storeId, data.sku, data.name, data.barcode, data.category, data.unit, data.cost, data.price, data.reorderPoint, data.trackExpiry, data.image ?? null, at, at).lastInsertRowid);
}

api('POST', '/api/products', { perm: 'product.edit' }, (ctx) => {
  const data = productInput(ctx.body, { partialImage: false });
  const id = tx(() => {
    const id = createProduct(ctx.storeId, data);
    const initial = ctx.body.initialQty;
    if (initial !== undefined && initial !== null && initial !== '' && Number(initial) > 0) {
      moveStock(ctx.actor, { type: 'in', productId: id, qty: Number(initial), lotNo: ctx.body.lotNo, expiry: ctx.body.expiry, note: 'ยอดยกมา (สร้างสินค้า)' });
    }
    return id;
  });
  return { id };
});

api('PUT', '/api/products/:id', { perm: 'product.edit' }, (ctx) => {
  const current = productForStore(ctx, ctx.params.id);
  const data = productInput(ctx.body, { partialImage: true });
  assertUniqueProduct(ctx.storeId, data, current.id);
  const sets = ['sku = ?', 'name = ?', 'barcode = ?', 'category = ?', 'unit = ?', 'cost = ?', 'price = ?', 'reorder_point = ?', 'track_expiry = ?', 'updated_at = ?'];
  const args = [data.sku, data.name, data.barcode, data.category, data.unit, data.cost, data.price, data.reorderPoint, data.trackExpiry, nowIso()];
  if (data.image !== undefined) { sets.push('image = ?'); args.push(data.image); }
  run(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND store_id = ?`, ...args, current.id, ctx.storeId);
  return { id: current.id };
});

api('DELETE', '/api/products/:id', { perm: 'product.delete' }, (ctx) => {
  const p = productForStore(ctx, ctx.params.id);
  if (String(ctx.body.confirmSku || '').trim().toUpperCase() !== p.sku) throw new HttpError(400, 'SKU ที่พิมพ์ยืนยันไม่ตรงกัน');
  run('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), p.id);
  return { ok: true };
});

// — stock movements —

api('POST', '/api/movements', (ctx) => {
  const type = ctx.body.type;
  if (!can(ctx.role, type === 'adj' ? 'stock.adjust' : 'stock.move')) throw new HttpError(403, 'คุณไม่มีสิทธิ์ทำรายการนี้');
  return moveStock(ctx.actor, ctx.body);
});

api('GET', '/api/movements', (ctx) => {
  const q = ctx.query;
  const type = ['in', 'out', 'adj'].includes(q.type) ? q.type : '';
  return listMovements(ctx.storeId, {
    q: String(q.q || '').trim().slice(0, 80),
    type,
    from: isoVal(q.from, 'วันที่เริ่ม'),
    to: isoVal(q.to, 'วันที่สิ้นสุด'),
    productId: Number(q.productId) || null,
    limit: Math.min(Math.max(Number(q.limit) || 50, 1), 1000),
    offset: Math.max(Number(q.offset) || 0, 0),
  });
});

api('GET', '/api/alerts', (ctx) => buildAlerts(ctx.storeId));

// — reports —

api('GET', '/api/reports', { perm: 'report' }, (ctx) => {
  const from = isoVal(ctx.query.from, 'วันที่เริ่ม') || new Date(Date.now() - 30 * DAY).toISOString();
  const to = isoVal(ctx.query.to, 'วันที่สิ้นสุด') || nowIso();
  const products = listProducts(ctx.storeId);
  const moves = all(`SELECT m.type, m.qty, m.product_id, p.category, p.name, p.sku, p.unit, p.deleted_at IS NOT NULL AS deleted
                     FROM movements m JOIN products p ON p.id = m.product_id
                     WHERE m.store_id = ? AND m.created_at >= ? AND m.created_at < ?`, ctx.storeId, from, to);
  const summary = { in: 0, out: 0, adj: 0, docs: moves.length, value: products.reduce((s, p) => s + p.qty * p.cost, 0) };
  const perProduct = new Map();
  const perCat = new Map();
  const cat = (c) => {
    const k = c || 'ไม่ระบุหมวด';
    if (!perCat.has(k)) perCat.set(k, { category: k, sku: 0, qty: 0, in: 0, out: 0, adj: 0, value: 0 });
    return perCat.get(k);
  };
  for (const p of products) {
    const c = cat(p.category);
    c.sku++; c.qty += p.qty; c.value += p.qty * p.cost;
  }
  for (const m of moves) {
    const field = m.type === 'out' ? 'out' : m.type;
    const v = m.type === 'out' ? -m.qty : m.qty;
    summary[field] += v;
    cat(m.category)[field] += v;
    if (!perProduct.has(m.product_id)) {
      const cur = products.find((p) => p.id === m.product_id);
      perProduct.set(m.product_id, { productId: m.product_id, name: m.name, sku: m.sku, unit: m.unit, category: m.category, deleted: !!m.deleted, in: 0, out: 0, adj: 0, qty: cur ? cur.qty : 0 });
    }
    perProduct.get(m.product_id)[field] += v;
  }
  return {
    from, to, summary,
    categories: [...perCat.values()].sort((a, b) => b.value - a.value),
    movement: [...perProduct.values()].sort((a, b) => (b.in + b.out) - (a.in + a.out)),
    stock: products,
    expiring: buildAlerts(ctx.storeId).expiring,
  };
});

// — members —

api('GET', '/api/members', (ctx) => {
  const members = all(`SELECT u.id, u.name, u.email, u.last_login, m.role, m.created_at
                       FROM members m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.created_at`, ctx.storeId)
    .map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, roleLabel: ROLES[m.role], lastLogin: m.last_login, joinedAt: m.created_at, isMe: m.id === ctx.session.user_id }));
  return {
    members,
    roles: ROLES,
    matrix: [
      ['ดู Dashboard / สินค้า / แจ้งเตือน', null],
      ['เพิ่ม / แก้ไขสินค้า', 'product.edit'],
      ['ลบสินค้า', 'product.delete'],
      ['รับเข้า / จ่ายออก', 'stock.move'],
      ['ปรับยอดสต็อก', 'stock.adjust'],
      ['ดูรายงาน / ส่งออก', 'report'],
      ['จัดการผู้ใช้และสิทธิ์', 'users'],
      ['ตั้งค่าร้าน', 'settings'],
    ].map(([label, perm]) => ({ label, cells: Object.keys(ROLES).map((r) => (perm ? can(r, perm) : true)) })),
  };
});

const roleVal = (r) => {
  if (!ROLES[r]) throw new HttpError(400, 'บทบาทไม่ถูกต้อง');
  return r;
};

const ownerCount = (storeId) => Number(get("SELECT COUNT(*) AS c FROM members WHERE store_id = ? AND role = 'owner'", storeId).c);

api('POST', '/api/members', { perm: 'users' }, (ctx) => {
  const email = emailVal(ctx.body.email);
  const role = roleVal(ctx.body.role);
  return tx(() => {
    let u = get('SELECT id FROM users WHERE email = ?', email);
    let created = false;
    if (!u) {
      const name = text(ctx.body.name, { label: 'ชื่อผู้ใช้', max: 80, required: true });
      const pass = passwordVal(ctx.body.password, 'รหัสผ่านเริ่มต้น');
      u = { id: Number(run('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), nowIso()).lastInsertRowid) };
      created = true;
    }
    if (get('SELECT 1 FROM members WHERE store_id = ? AND user_id = ?', ctx.storeId, u.id)) throw new HttpError(409, 'ผู้ใช้นี้เป็นสมาชิกของร้านอยู่แล้ว');
    run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', ctx.storeId, u.id, role, nowIso());
    return { ok: true, created };
  });
});

function memberOf(ctx) {
  const userId = Number(ctx.params.userId) || 0;
  const m = get('SELECT role FROM members WHERE store_id = ? AND user_id = ?', ctx.storeId, userId);
  if (!m) throw new HttpError(404, 'ไม่พบสมาชิก');
  return { userId, role: m.role };
}

api('PUT', '/api/members/:userId', { perm: 'users' }, (ctx) => {
  const m = memberOf(ctx);
  if (ctx.body.role !== undefined) {
    const role = roleVal(ctx.body.role);
    if (m.role === 'owner' && role !== 'owner' && ownerCount(ctx.storeId) <= 1) throw new HttpError(400, 'ร้านต้องมีเจ้าของร้านอย่างน้อย 1 คน');
    run('UPDATE members SET role = ? WHERE store_id = ? AND user_id = ?', role, ctx.storeId, m.userId);
  }
  if (ctx.body.password !== undefined) {
    // Only reset a password when every store this person belongs to is owned by the caller,
    // otherwise an owner of one shop could take over an account used in another shop.
    const foreign = get(`SELECT 1 FROM members t WHERE t.user_id = ? AND NOT EXISTS (
                           SELECT 1 FROM members o WHERE o.store_id = t.store_id AND o.user_id = ? AND o.role = 'owner')`, m.userId, ctx.session.user_id);
    if (foreign) throw new HttpError(403, 'ผู้ใช้นี้เป็นสมาชิกร้านอื่นด้วย ให้เจ้าตัวเปลี่ยนรหัสผ่านเองจากหน้าตั้งค่า');
    const pass = passwordVal(ctx.body.password, 'รหัสผ่านใหม่');
    run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(pass), m.userId);
    run('DELETE FROM sessions WHERE user_id = ?', m.userId);
  }
  return { ok: true };
});

api('DELETE', '/api/members/:userId', { perm: 'users' }, (ctx) => {
  const m = memberOf(ctx);
  if (m.userId === ctx.session.user_id) throw new HttpError(400, 'ไม่สามารถลบตัวเองออกจากร้านได้');
  if (m.role === 'owner' && ownerCount(ctx.storeId) <= 1) throw new HttpError(400, 'ร้านต้องมีเจ้าของร้านอย่างน้อย 1 คน');
  run('DELETE FROM members WHERE store_id = ? AND user_id = ?', ctx.storeId, m.userId);
  run('UPDATE sessions SET store_id = NULL WHERE user_id = ? AND store_id = ?', m.userId, ctx.storeId);
  return { ok: true };
});

// ───────────────────────── http server ─────────────────────────

function readJson(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'ข้อมูลมีขนาดใหญ่เกินไป')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleApi(req, res, url) {
  const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!route) throw new HttpError(404, 'ไม่พบ API');
  if (req.method !== 'GET' && req.headers['x-cs'] !== '1') throw new HttpError(403, 'คำขอไม่ถูกต้อง');
  const match = route.re.exec(url.pathname);
  const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
  const body = req.method === 'GET' ? {} : await readJson(req);
  const ctx = { req, res, url, params, body, query: Object.fromEntries(url.searchParams) };
  if (route.opts.auth) {
    ctx.session = loadSession(req);
    if (!ctx.session) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }
  if (route.opts.store) {
    const m = ctx.session.store_id && get('SELECT role FROM members WHERE store_id = ? AND user_id = ?', ctx.session.store_id, ctx.session.user_id);
    if (!m) throw new HttpError(403, 'กรุณาเลือกร้านก่อนใช้งาน');
    ctx.storeId = ctx.session.store_id;
    ctx.role = m.role;
    ctx.actor = { storeId: ctx.storeId, userId: ctx.session.user_id, userName: ctx.session.name };
    if (route.opts.perm && !can(ctx.role, route.opts.perm)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ทำรายการนี้');
  }
  const result = await route.handler(ctx);
  if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};
const ALIASES = {
  '/icons.js': path.join(ROOT, 'icons.js'),
  '/ds.css': path.join(ROOT, '_ds', 'industry-ac968ea4-010d-4eb5-baf1-f6a14a860d06', 'styles.css'),
};

function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { p = '/'; }
  let file = ALIASES[p];
  if (!file) {
    if (p === '/' || !path.extname(p)) p = '/index.html';
    file = path.join(PUBLIC_DIR, path.normalize(p));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(404); res.end(); return; }
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', CSP);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
    else throw new HttpError(405, 'Method not allowed');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่' : e.message });
    else res.end();
  }
});

// ───────────────────────── demo data ─────────────────────────

function seed() {
  if (Number(get('SELECT COUNT(*) AS c FROM users').c) > 0) return false;
  let rnd = 20251006;
  const rand = (a, b) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return a + (rnd % (b - a + 1)); };
  const daysAgo = (d, h = 10) => { const t = new Date(Date.now() - d * DAY); t.setHours(h, rand(0, 59), 0, 0); return t.toISOString(); };
  const inDays = (d) => localDate(new Date(Date.now() + d * DAY));
  const lotFor = (iso) => { const d = new Date(iso); return `LOT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String.fromCharCode(65 + rand(0, 3))}`; };

  tx(() => {
    const at = daysAgo(200);
    const addUser = (email, name, pass) => Number(run('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), at).lastInsertRowid);
    const addStore = (name) => Number(run('INSERT INTO stores(name, expiry_days, created_at) VALUES (?, 60, ?)', name, at).lastInsertRowid);
    const addMember = (s, u, role) => run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', s, u, role, at);

    const admin = addUser(ADMIN_EMAIL, 'มินตรา ทองสุข', ADMIN_PASSWORD);
    const somchai = addUser('somchai@rosebeauty.co', 'สมชาย ใจดี', DEMO_PASSWORD);
    const pim = addUser('pimchanok@rosebeauty.co', 'พิมพ์ชนก แก้วใส', DEMO_PASSWORD);
    const natt = addUser('nattawut@rosebeauty.co', 'ณัฐวุฒิ ศรีสุข', DEMO_PASSWORD);
    const siam = addStore('Rose Beauty · สาขาสยาม');
    const ari = addStore('Rose Beauty · สาขาอารีย์');
    addMember(siam, admin, 'owner'); addMember(siam, somchai, 'staff'); addMember(siam, pim, 'manager'); addMember(siam, natt, 'viewer');
    addMember(ari, admin, 'owner'); addMember(ari, pim, 'manager');

    const people = [[admin, 'มินตรา ทองสุข'], [somchai, 'สมชาย ใจดี'], [pim, 'พิมพ์ชนก แก้วใส']];
    const ops = [];

    const plan = (storeId, def) => {
      const [sku, name, category, cost, price, rp, track, barcode, target, finals = []] = def;
      const id = createProduct(storeId, { sku, name, barcode, category, unit: 'ชิ้น', cost, price, reorderPoint: rp, trackExpiry: track, image: null }, daysAgo(190));
      const finalDelta = finals.reduce((s, f) => s + (f.type === 'in' ? f.qty : f.type === 'out' ? -f.qty : 0), 0)
        + finals.filter((f) => f.type === 'adj').reduce((s, f) => s + f.delta, 0);
      const base = target - finalDelta;
      let cur = 0;
      for (let m = 6; m >= 2; m--) {
        const d = m * 30 + rand(0, 8);
        const r = rand(20, 60);
        const when = daysAgo(d, rand(9, 12));
        ops.push({ storeId, at: when, input: { type: 'in', productId: id, qty: r, lotNo: track ? lotFor(when) : '', expiry: track ? inDays(rand(300, 540)) : null, note: 'บจก. บิวตี้ซัพพลาย' } });
        cur += r;
        const o = Math.min(cur, rand(10, 45));
        if (o > 0) { ops.push({ storeId, at: daysAgo(d - rand(3, 20), rand(13, 18)), input: { type: 'out', productId: id, qty: o, note: 'ขายหน้าร้าน' } }); cur -= o; }
      }
      const when = daysAgo(28, 11);
      if (cur < base) ops.push({ storeId, at: when, input: { type: 'in', productId: id, qty: base - cur, lotNo: track ? lotFor(when) : '', expiry: track ? inDays(rand(300, 540)) : null, note: 'บจก. บิวตี้ซัพพลาย' } });
      else if (cur > base) ops.push({ storeId, at: when, input: { type: 'out', productId: id, qty: cur - base, note: 'ขายหน้าร้าน' } });
      let running = base;
      for (const f of finals) {
        const input = { productId: id, type: f.type, lotNo: f.lotNo || '', expiry: f.expiry || null, note: f.note };
        if (f.type === 'adj') { running += f.delta; input.newQty = running; } else { input.qty = f.qty; running += f.type === 'in' ? f.qty : -f.qty; }
        ops.push({ storeId, at: daysAgo(f.day, f.hour ?? 14), input });
      }
    };

    [
      ['SK-VC30', 'เซรั่มวิตามินซี Brightening 30ml', 'สกินแคร์', 320, 590, 20, true, '8851234567890', 145, [
        { type: 'in', qty: 107, lotNo: 'LOT-2604C', expiry: inDays(37), day: 24, note: 'ล็อตโปรโมชั่น' },
        { type: 'out', qty: 12, day: 9, note: 'ขายหน้าร้าน' },
        { type: 'in', qty: 50, lotNo: 'LOT-2610A', expiry: inDays(371), day: 3, note: 'บจก. บิวตี้ซัพพลาย' }]],
      ['MU-LP01', 'ลิปสติก Velvet Rose', 'เมคอัพ', 180, 390, 15, false, '8851234567891', 45, [{ type: 'out', qty: 30, day: 4, hour: 10, note: 'เบิกไปสาขาอารีย์' }]],
      ['MU-FD02', 'รองพื้น Soft Matte', 'เมคอัพ', 350, 690, 10, false, '8851234567892', 0, [{ type: 'out', qty: 15, day: 5, hour: 9, note: 'ขายหน้าร้าน' }]],
      ['MU-BL03', 'บลัชออน Peach Glow', 'เมคอัพ', 150, 350, 15, false, '8851234567893', 8, [{ type: 'out', qty: 7, day: 9, note: 'ขายหน้าร้าน' }]],
      ['SC-SS01', 'กันแดด SPF50+ PA++++', 'กันแดด', 290, 550, 20, true, '8851234567894', 10, [{ type: 'adj', delta: 5, day: 8, note: 'นับสต็อกประจำเดือน พบของเกิน' }]],
      ['SK-MS02', 'มอยเจอร์ไรเซอร์ Hydra Boost', 'บำรุงผิว', 260, 520, 15, true, '8851234567895', 56, [{ type: 'in', qty: 30, lotNo: 'LOT-2609B', expiry: inDays(420), day: 6, note: 'บจก. บิวตี้ซัพพลาย' }]],
      ['CL-BM01', 'คลีนซิ่งบาล์ม Gentle', 'คลีนซิ่ง', 310, 590, 10, true, '8851234567896', 38, [
        { type: 'in', qty: 20, lotNo: 'LOT-2603B', expiry: inDays(52), day: 22, note: 'ล็อตโปรโมชั่น' },
        { type: 'out', qty: 2, day: 10, note: 'ทดลองให้ลูกค้า' },
        { type: 'in', qty: 20, lotNo: 'LOT-2610B', expiry: inDays(400), day: 4, note: 'บจก. บิวตี้ซัพพลาย' }]],
      ['SK-TN03', 'โทนเนอร์ Rose Water', 'สกินแคร์', 140, 290, 20, false, '8851234567897', 72, [{ type: 'adj', delta: -2, day: 11, note: 'ขวดแตกระหว่างจัดเรียง' }]],
      ['SK-MK04', 'มาสก์ชีท Hydrating (กล่อง 10 แผ่น)', 'สกินแคร์', 120, 250, 10, true, '8851234567898', 30],
      ['MU-EL05', 'อายไลเนอร์ Ink Black', 'เมคอัพ', 95, 220, 12, false, '8851234567899', 25],
    ].forEach((d) => plan(siam, d));

    [
      ['SK-VC30', 'เซรั่มวิตามินซี Brightening 30ml', 'สกินแคร์', 320, 590, 10, true, '8851234567890', 24],
      ['MU-LP01', 'ลิปสติก Velvet Rose', 'เมคอัพ', 180, 390, 10, false, '8851234567891', 30],
      ['SC-SS01', 'กันแดด SPF50+ PA++++', 'กันแดด', 290, 550, 10, true, '8851234567894', 6],
      ['SK-TN03', 'โทนเนอร์ Rose Water', 'สกินแคร์', 140, 290, 10, false, '8851234567897', 40],
    ].forEach((d) => plan(ari, d));

    ops.sort((a, b) => a.at.localeCompare(b.at));
    for (const op of ops) {
      const [userId, userName] = op.storeId === ari ? people[op.input.type === 'out' ? 2 : 0] : people[rand(0, 2)];
      moveStock({ storeId: op.storeId, userId, userName }, op.input, op.at);
    }
  });
  return true;
}

const seeded = seed();
run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
setInterval(() => run('DELETE FROM sessions WHERE expires_at < ?', Date.now()), 3600 * 1000).unref();

server.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\n  CosmoStock พร้อมใช้งาน');
  console.log(`  • บนเครื่องนี้:     http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  • มือถือ/แท็บเล็ต:  http://${ip}:${PORT}  (เชื่อม Wi-Fi เดียวกัน)`);
  if (seeded) {
    console.log('\n  สร้างข้อมูลตัวอย่างแล้ว — บัญชีแอดมิน (เจ้าของร้าน):');
    console.log(`    อีเมล:    ${ADMIN_EMAIL}`);
    console.log(`    รหัสผ่าน: ${ADMIN_PASSWORD}`);
  }
  console.log('');
});
