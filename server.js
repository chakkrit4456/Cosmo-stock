import './env.js';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { all, get, run, insert, tx, initSchema, dropAll, closeDb } from './db.js';
import {
  DAY, HttpError, nowIso, pall, localDate, daysUntil, text, intVal, numVal, dateVal,
  isoVal, emailVal, passwordVal, likeArg, hashPassword, verifyPassword, hashToken, parseLotCode, statusOf,
} from './lib.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@cosmostock.app').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CosmoAdmin@2569';
const DEMO_PASSWORD = 'Demo@2569';

const PERM_LIST = [
  ['product.edit', 'เพิ่ม / แก้ไขสินค้า'],
  ['product.delete', 'ลบสินค้า'],
  ['stock.move', 'รับเข้า / จ่ายออก'],
  ['stock.adjust', 'ปรับยอดสต็อก'],
  ['report', 'ดูรายงาน / ส่งออก'],
  ['users', 'จัดการผู้ใช้และสิทธิ์'],
  ['settings', 'ตั้งค่าร้าน'],
];
const PERM_KEYS = PERM_LIST.map(([k]) => k);
const DEFAULT_ROLES = [
  { key: 'owner', name: 'เจ้าของร้าน', scope: 'all', sort: 0, perms: PERM_KEYS },
  { key: 'manager', name: 'ผู้จัดการ', scope: 'multi', sort: 1, perms: ['product.edit', 'product.delete', 'stock.move', 'stock.adjust', 'report'] },
  { key: 'staff', name: 'พนักงานคลัง', scope: 'single', sort: 2, perms: ['stock.move'] },
  { key: 'viewer', name: 'ดูอย่างเดียว', scope: 'single', sort: 3, perms: ['report'] },
];
const ROLES = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.key, r.name]));
const SCOPE_LABEL = { all: 'ทุกสาขา', multi: 'สาขาที่ได้รับมอบหมาย', single: '1 สาขา' };
const DEFAULT_CATEGORIES = ['สกินแคร์', 'เมคอัพ', 'บำรุงผิว', 'กันแดด', 'คลีนซิ่ง'];

// ───────────────────────── database (PostgreSQL — ดู db.js) ─────────────────────────

// ───────────────────────── helpers (ดู lib.js) ─────────────────────────

// ───────────────────────── stock domain ─────────────────────────

async function nextDoc(storeId, type) {
  const prefix = { in: 'RCV', out: 'ISS', adj: 'ADJ' }[type];
  await run(`INSERT INTO counters(store_id, type, n) VALUES (?, ?, 1)
       ON CONFLICT(store_id, type) DO UPDATE SET n = counters.n + 1`, storeId, type);
  const { n } = await get('SELECT n FROM counters WHERE store_id = ? AND type = ?', storeId, type);
  return `${prefix}-${String(n).padStart(5, '0')}`;
}

const lotsQty = async (pid) => Number((await get('SELECT COALESCE(SUM(qty), 0) AS q FROM lots WHERE product_id = ?', pid)).q);

async function addToLot(pid, qty, lotNo, expiry, at) {
  const lot = await get('SELECT id FROM lots WHERE product_id = ? AND lot_no = ? AND expiry IS NOT DISTINCT FROM ?', pid, lotNo || '', expiry || null);
  if (lot) await run('UPDATE lots SET qty = qty + ? WHERE id = ?', qty, lot.id);
  else await run('INSERT INTO lots(product_id, lot_no, expiry, qty, received_at) VALUES (?, ?, ?, ?, ?)', pid, lotNo || '', expiry || null, qty, at);
}

// First-expiry-first-out: lots without an expiry date are used last.
async function takeFromLots(pid, qty) {
  const lots = await all('SELECT id, lot_no, qty FROM lots WHERE product_id = ? AND qty > 0 ORDER BY expiry IS NULL, expiry, id', pid);
  let left = qty;
  const used = [];
  for (const l of lots) {
    if (!left) break;
    const take = Math.min(left, l.qty);
    await run('UPDATE lots SET qty = qty - ? WHERE id = ?', take, l.id);
    if (l.lot_no) used.push(`${l.lot_no}×${take}`);
    left -= take;
  }
  if (left > 0) throw new HttpError(400, 'จำนวนคงเหลือไม่พอ');
  return used.join(', ') || null;
}

// Take stock from one specific lot (used when a lot QR was scanned).
async function takeFromLot(pid, lotId, qty) {
  const lot = await get('SELECT id, lot_no, qty FROM lots WHERE id = ? AND product_id = ?', Number(lotId) || 0, pid);
  if (!lot) throw new HttpError(400, 'ไม่พบล็อตนี้ของสินค้า');
  if (lot.qty < qty) throw new HttpError(400, `ล็อต ${lot.lot_no || '(ไม่ระบุ)'} มีคงเหลือไม่พอ (มีอยู่ ${lot.qty}, ต้องการ ${qty})`);
  await run('UPDATE lots SET qty = qty - ? WHERE id = ?', qty, lot.id);
  return lot.lot_no ? `${lot.lot_no}×${qty}` : null;
}

async function moveStock({ storeId, userId, userName }, input, at = nowIso()) {
  return await tx(async () => {
    const p = await get('SELECT * FROM products WHERE id = ? AND store_id = ? AND deleted_at IS NULL', Number(input.productId) || 0, storeId);
    if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
    const before = await lotsQty(p.id);
    const type = input.type;
    let delta, lotInfo = null, expiry = null;
    let pack = null, packCount = null;
    const baseQty = async () => {
      if (!input.packId) return intVal(input.qty, { label: 'จำนวน', min: 1, max: 1e6 });
      pack = await get('SELECT id, name, per_qty FROM product_packs WHERE id = ? AND product_id = ?', Number(input.packId) || 0, p.id);
      if (!pack) throw new HttpError(400, 'ไม่พบหน่วยบรรจุนี้ของสินค้า');
      packCount = intVal(input.qty, { label: `จำนวน${pack.name}`, min: 1, max: 1e5 });
      const q = packCount * pack.per_qty;
      if (q > 1e6) throw new HttpError(400, 'จำนวนมากเกินไป');
      return q;
    };
    const takeLotFields = () => {
      const lotNo = text(input.lotNo, { label: 'เลขล็อต', max: 40 });
      expiry = dateVal(input.expiry, 'วันหมดอายุ');
      return lotNo;
    };
    if (type === 'in') {
      delta = await baseQty();
      const lotNo = takeLotFields();
      await addToLot(p.id, delta, lotNo, expiry, at);
      lotInfo = lotNo || null;
    } else if (type === 'out') {
      const q = await baseQty();
      if (q > before) throw new HttpError(400, `จำนวนคงเหลือไม่พอ (มีอยู่ ${before} ${p.unit}, ต้องการ ${q} ${p.unit})`);
      lotInfo = input.lotId ? await takeFromLot(p.id, input.lotId, q) : await takeFromLots(p.id, q);
      delta = -q;
    } else if (type === 'adj') {
      const target = intVal(input.newQty, { label: 'จำนวนที่นับได้จริง', min: 0, max: 1e6 });
      delta = target - before;
      if (delta === 0) throw new HttpError(400, 'จำนวนที่นับได้เท่ากับยอดในระบบ ไม่ต้องปรับยอด');
      if (delta > 0) {
        const lotNo = takeLotFields();
        await addToLot(p.id, delta, lotNo, expiry, at);
        lotInfo = lotNo || null;
      } else {
        lotInfo = await takeFromLots(p.id, -delta);
      }
    } else {
      throw new HttpError(400, 'ประเภทรายการไม่ถูกต้อง');
    }
    const note = text(input.note, { label: type === 'adj' ? 'เหตุผลการปรับยอด' : 'หมายเหตุ', max: 200, required: type === 'adj' });
    const after = before + delta;
    await run('UPDATE products SET qty = ?, updated_at = ? WHERE id = ?', after, at, p.id);
    const docNo = await nextDoc(storeId, type);
    const movId = await insert(`INSERT INTO movements(store_id, product_id, type, doc_no, qty, before_qty, after_qty, lot_info, expiry, note, user_id, user_name, created_at, pack_name, pack_count)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      storeId, p.id, type, docNo, delta, before, after, lotInfo, expiry, note || null, userId, userName, at, pack?.name ?? null, packCount);
    return { id: movId, docNo, type, qty: delta, before, after, unit: p.unit, name: p.name, packName: pack?.name ?? null, packCount };
  });
}

async function storeRow(storeId) {
  return await get('SELECT id, name, expiry_days FROM stores WHERE id = ?', storeId);
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

async function listProducts(storeId, { q = '', category = '', status = '' } = {}) {
  const store = await storeRow(storeId);
  const where = ['p.store_id = ?', 'p.deleted_at IS NULL'];
  const args = [storeId];
  if (q) {
    where.push(`(p.name ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\' OR p.barcode ILIKE ? ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM product_packs k WHERE k.product_id = p.id AND k.barcode = ?))`);
    const l = likeArg(q);
    args.push(l, l, l, q);
  }
  if (category) { where.push('p.category = ?'); args.push(category); }
  let rows = (await all(`SELECT ${PRODUCT_COLS} FROM products p WHERE ${where.join(' AND ')} ORDER BY lower(p.name)`, ...args))
    .map((p) => productOut(p, store.expiry_days));
  if (status === 'alert') rows = rows.filter((p) => p.status !== 'ok');
  else if (status) rows = rows.filter((p) => p.status === status);
  return await attachPacks(storeId, rows);
}

async function buildAlerts(storeId) {
  const store = await storeRow(storeId);
  const low = (await all(`SELECT id, sku, name, unit, qty, reorder_point FROM products
                   WHERE store_id = ? AND deleted_at IS NULL AND qty <= reorder_point
                   ORDER BY qty, name`, storeId))
    .map((p) => ({ productId: p.id, sku: p.sku, name: p.name, unit: p.unit, qty: p.qty, reorderPoint: p.reorder_point, kind: p.qty <= 0 ? 'out' : 'low' }));
  const limit = localDate(new Date(Date.now() + store.expiry_days * DAY));
  const expiring = (await all(`SELECT l.id, l.lot_no, l.expiry, l.qty, p.id AS product_id, p.sku, p.name, p.unit
                        FROM lots l JOIN products p ON p.id = l.product_id
                        WHERE p.store_id = ? AND p.deleted_at IS NULL AND l.qty > 0 AND l.expiry IS NOT NULL AND l.expiry <= ?
                        ORDER BY l.expiry`, storeId, limit))
    .map((l) => ({ lotId: l.id, lotNo: l.lot_no, expiry: l.expiry, days: daysUntil(l.expiry), qty: l.qty, productId: l.product_id, sku: l.sku, name: l.name, unit: l.unit }));
  return { low, expiring, expiryDays: store.expiry_days };
}

async function listMovements(storeId, { q = '', type = '', from = null, to = null, productId = null, limit = 50, offset = 0 } = {}) {
  const where = ['m.store_id = ?'];
  const args = [storeId];
  if (type) { where.push('m.type = ?'); args.push(type); }
  if (from) { where.push('m.created_at >= ?'); args.push(from); }
  if (to) { where.push('m.created_at < ?'); args.push(to); }
  if (productId) { where.push('m.product_id = ?'); args.push(productId); }
  if (q) {
    where.push("(p.name ILIKE ? ESCAPE '\\' OR p.sku ILIKE ? ESCAPE '\\' OR m.doc_no ILIKE ? ESCAPE '\\' OR m.lot_info ILIKE ? ESCAPE '\\')");
    const l = likeArg(q);
    args.push(l, l, l, l);
  }
  const w = where.join(' AND ');
  const total = Number((await get(`SELECT COUNT(*) AS c FROM movements m JOIN products p ON p.id = m.product_id WHERE ${w}`, ...args)).c);
  const rows = (await all(`SELECT m.id, m.type, m.doc_no, m.qty, m.before_qty, m.after_qty, m.lot_info, m.expiry, m.note, m.user_name, m.created_at, m.pack_name, m.pack_count,
                           p.id AS product_id, p.name, p.sku, p.unit, p.deleted_at IS NOT NULL AS deleted
                    FROM movements m JOIN products p ON p.id = m.product_id
                    WHERE ${w} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset))
    .map((m) => ({
      id: m.id, type: m.type, docNo: m.doc_no, qty: m.qty, before: m.before_qty, after: m.after_qty,
      lotInfo: m.lot_info, expiry: m.expiry, note: m.note, by: m.user_name, at: m.created_at,
      productId: m.product_id, name: m.name, sku: m.sku, unit: m.unit, deleted: !!m.deleted,
      packName: m.pack_name, packCount: m.pack_count,
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

// impersonatorId: ผู้ดูแลระบบที่สวมสิทธิ์เป็นผู้ใช้นี้ (session นี้ไม่นับเป็นการเข้าใช้ของผู้ใช้ และหมดอายุใน 2 ชั่วโมง)
async function createSession(req, res, userId, storeId, remember, impersonatorId = null) {
  const token = crypto.randomBytes(32).toString('base64url');
  const ttl = impersonatorId ? 2 * 3600 * 1000 : remember ? 30 * DAY : 12 * 3600 * 1000;
  await run('INSERT INTO sessions(token, user_id, store_id, expires_at, impersonator_id) VALUES (?, ?, ?, ?, ?)', hashToken(token), userId, storeId, Date.now() + ttl, impersonatorId);
  if (!impersonatorId) await run('UPDATE users SET last_login = ? WHERE id = ?', nowIso(), userId);
  setSessionCookie(req, res, token, remember && !impersonatorId ? ttl / 1000 : null);
}

async function loadSession(req) {
  const token = parseCookies(req).cs_sid;
  if (!token || token.length > 100) return null;
  const s = await get(`SELECT s.token, s.store_id, s.expires_at, s.impersonator_id, u.id AS user_id, u.name, u.email, u.is_superadmin,
                        i.name AS impersonator_name, i.email AS impersonator_email
                 FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN users i ON i.id = s.impersonator_id
                 WHERE s.token = ?`, hashToken(token));
  if (!s || s.expires_at < Date.now()) return null;
  s.superadmin = !!s.is_superadmin;
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

const OWNER_ORGS = `SELECT os.org_id FROM members om JOIN stores os ON os.id = om.store_id WHERE om.user_id = ? AND om.role = 'owner'`;

async function memberships(userId) {
  return (await all(`SELECT * FROM (SELECT s.id, s.name, s.org_id, 'owner' AS role FROM stores s WHERE s.org_id IN (${OWNER_ORGS})
              UNION ALL
              SELECT s.id, s.name, s.org_id, m.role FROM members m JOIN stores s ON s.id = m.store_id
              WHERE m.user_id = ? AND s.org_id NOT IN (${OWNER_ORGS})) x
              ORDER BY lower(name)`, userId, userId, userId))
    .map((s) => ({ id: s.id, name: s.name, orgId: s.org_id, role: s.role }));
}

const isOrgOwner = async (userId, orgId) => !!await get(`SELECT 1 FROM members m JOIN stores s ON s.id = m.store_id
                                            WHERE m.user_id = ? AND m.role = 'owner' AND s.org_id = ? LIMIT 1`, userId, orgId);
const orgOf = async (storeId) => (await get('SELECT org_id FROM stores WHERE id = ?', storeId))?.org_id ?? null;

async function roleIn(userId, storeId) {
  const orgId = storeId ? await orgOf(storeId) : null;
  if (orgId == null) return null;
  if (await isOrgOwner(userId, orgId)) return 'owner';
  return (await get('SELECT role FROM members WHERE store_id = ? AND user_id = ?', storeId, userId))?.role || null;
}

const isSuperadmin = async (userId) => !!(await get('SELECT is_superadmin FROM users WHERE id = ?', userId))?.is_superadmin;

// The system administrator acts as owner of every store; everyone else is limited to their own business.
async function accessRole(userId, storeId) {
  if (storeId && await isSuperadmin(userId) && await orgOf(storeId) != null) return 'owner';
  return await roleIn(userId, storeId);
}

async function accessibleStores(userId) {
  if (!await isSuperadmin(userId)) return await memberships(userId);
  return (await all('SELECT id, name, org_id FROM stores ORDER BY lower(name)')).map((s) => ({ id: s.id, name: s.name, orgId: s.org_id, role: 'owner' }));
}

const DEFAULT_BRANCH = 'สาขาหลัก';
const branchVal = (v, label = 'ชื่อสาขา') => text(v, { label, max: 60, required: true });

// ชื่อสาขาห้ามซ้ำกันภายในร้านเดียวกัน (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
async function assertBranchFree(orgId, name, exceptId = 0) {
  if (await get('SELECT 1 FROM stores WHERE org_id = ? AND lower(name) = lower(?) AND id <> ?', orgId, name, exceptId)) {
    throw new HttpError(409, `ร้านนี้มีสาขาชื่อ "${name}" อยู่แล้ว`);
  }
}

// สาขาต้องอยู่ภายใต้ร้าน (org) เสมอ
async function createStore(orgId, name, at = nowIso()) {
  if (!orgId) throw new HttpError(400, 'ต้องระบุร้านของสาขา');
  await assertBranchFree(orgId, name);
  return await insert('INSERT INTO stores(name, org_id, created_at) VALUES (?, ?, ?)', name, orgId, at);
}

// ลบสาขาพร้อมข้อมูลทั้งหมดของสาขา (movements อ้าง products โดยไม่ cascade จึงต้องลบก่อน)
async function deleteStoreData(storeId) {
  await run('UPDATE sessions SET store_id = NULL WHERE store_id = ?', storeId);
  await run('DELETE FROM movements WHERE store_id = ?', storeId);
  await run('DELETE FROM products WHERE store_id = ?', storeId);
  await run('DELETE FROM counters WHERE store_id = ?', storeId);
  await run('DELETE FROM members WHERE store_id = ?', storeId);
  await run('DELETE FROM stores WHERE id = ?', storeId);
}

// เพิ่ม/ลบสาขา และเปลี่ยนชื่อร้าน — เจ้าของร้านขึ้นไป (เจ้าของร้านของร้านนั้น หรือผู้ดูแลระบบ)
const canManageBranches = async (userId, orgId) => await isSuperadmin(userId) || await isOrgOwner(userId, orgId);

async function seedOrgRoles(orgId) {
  if (await get('SELECT 1 FROM org_roles WHERE org_id = ?', orgId)) return;
  for (const r of DEFAULT_ROLES) {
    await run('INSERT INTO org_roles(org_id, key, name, scope, builtin, sort) VALUES (?, ?, ?, ?, 1, ?)', orgId, r.key, r.name, r.scope, r.sort);
    for (const p of r.perms) await run('INSERT INTO org_role_perms(org_id, role_key, perm) VALUES (?, ?, ?)', orgId, r.key, p);
  }
}

async function createOrg(name, at = nowIso()) {
  const id = await insert('INSERT INTO orgs(name, created_at) VALUES (?, ?)', name, at);
  await seedOrgRoles(id);
  return id;
}

async function orgRoles(orgId) {
  return pall(await all('SELECT key, name, scope, builtin, sort FROM org_roles WHERE org_id = ? ORDER BY sort, lower(name)', orgId), async (r) => ({
    key: r.key, name: r.name, scope: r.scope, builtin: !!r.builtin,
    perms: r.key === 'owner' ? PERM_KEYS : (await all('SELECT perm FROM org_role_perms WHERE org_id = ? AND role_key = ?', orgId, r.key)).map((p) => p.perm),
  }));
}

async function roleName(orgId, key) {
  return (await get('SELECT name FROM org_roles WHERE org_id = ? AND key = ?', orgId, key))?.name || ROLES[key] || key;
}

async function roleScope(orgId, key) {
  if (key === 'owner') return 'all';
  return (await get('SELECT scope FROM org_roles WHERE org_id = ? AND key = ?', orgId, key))?.scope || (key === 'manager' ? 'multi' : 'single');
}

async function can(role, perm, orgId) {
  if (!PERM_KEYS.includes(perm)) return false;
  if (role === 'owner') return true;
  if (orgId != null && await get('SELECT 1 FROM org_roles WHERE org_id = ? AND key = ?', orgId, role)) {
    return !!await get('SELECT 1 FROM org_role_perms WHERE org_id = ? AND role_key = ? AND perm = ?', orgId, role, perm);
  }
  return !!DEFAULT_ROLES.find((r) => r.key === role)?.perms.includes(perm);
}

async function mePayload(ctx) {
  const { session } = ctx;
  const orgNames = new Map((await all('SELECT id, name FROM orgs')).map((o) => [o.id, o.name]));
  const stores = await pall(await accessibleStores(session.user_id), async (s) => ({ ...s, orgName: orgNames.get(s.orgId) || '', roleLabel: await roleName(s.orgId, s.role) }));
  let current = stores.find((s) => s.id === session.store_id) || stores[0] || null;
  if ((current?.id ?? null) !== session.store_id) {
    await run('UPDATE sessions SET store_id = ? WHERE token = ?', current?.id ?? null, session.token);
  }
  let store = null;
  if (current) {
    const row = await storeRow(current.id);
    const alerts = await buildAlerts(current.id);
    store = {
      id: row.id, name: row.name, expiryDays: row.expiry_days, role: current.role, roleLabel: await roleName(current.orgId, current.role),
      perms: Object.fromEntries(await pall(PERM_KEYS, async (k) => [k, await can(current.role, k, current.orgId)])),
      alertCount: alerts.low.length + alerts.expiring.length,
    };
  }
  if (store) {
    store.orgId = current.orgId;
    store.orgName = orgNames.get(current.orgId) || '';
  }
  if (store) store.canManageBranches = await canManageBranches(session.user_id, current.orgId);
  const impersonatedBy = session.impersonator_id ? { name: session.impersonator_name, email: session.impersonator_email } : null;
  return { user: { id: session.user_id, name: session.name, email: session.email, superadmin: !!session.superadmin, impersonatedBy }, stores, store };
}

// — auth —

api('POST', '/api/auth/login', { auth: false, store: false }, async (ctx) => {
  const email = String(ctx.body.email || '').trim().toLowerCase();
  const key = `${ctx.req.socket.remoteAddress}|${email}`;
  checkLoginThrottle(key);
  const u = email && await get('SELECT id, pass FROM users WHERE email = ?', email);
  if (!u || !verifyPassword(ctx.body.password || '', u.pass)) {
    noteLoginFail(key);
    throw new HttpError(401, 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  loginFails.delete(key);
  const first = (await accessibleStores(u.id))[0];
  await createSession(ctx.req, ctx.res, u.id, first?.id ?? null, !!ctx.body.remember);
  return { ok: true };
});

api('POST', '/api/auth/logout', { auth: false, store: false }, async (ctx) => {
  const token = parseCookies(ctx.req).cs_sid;
  if (token) await run('DELETE FROM sessions WHERE token = ?', hashToken(token));
  setSessionCookie(ctx.req, ctx.res, '', 0);
  return { ok: true };
});

// — me —

api('GET', '/api/me', { store: false }, async (ctx) => await mePayload(ctx));

api('POST', '/api/me/store', { store: false }, async (ctx) => {
  const storeId = Number(ctx.body.storeId);
  if (!await accessRole(ctx.session.user_id, storeId)) {
    throw new HttpError(403, 'คุณไม่มีสิทธิ์เข้าถึงสาขานี้');
  }
  await run('UPDATE sessions SET store_id = ? WHERE token = ?', storeId, ctx.session.token);
  ctx.session.store_id = storeId;
  return await mePayload(ctx);
});

// เลิกสวมสิทธิ์ กลับเป็นบัญชีผู้ดูแลระบบเดิม (อยู่สาขาเดิมต่อ)
api('POST', '/api/auth/impersonate/stop', { store: false }, async (ctx) => {
  const adminId = ctx.session.impersonator_id;
  if (!adminId) throw new HttpError(400, 'ไม่ได้สวมสิทธิ์ผู้ใช้อยู่');
  await run('DELETE FROM sessions WHERE token = ?', ctx.session.token);
  if (!await isSuperadmin(adminId)) { setSessionCookie(ctx.req, ctx.res, '', 0); return { ok: true }; }
  await createSession(ctx.req, ctx.res, adminId, ctx.session.store_id, false);
  return { ok: true };
});

api('PUT', '/api/me', { store: false }, async (ctx) => {
  if (ctx.session.impersonator_id) throw new HttpError(403, 'แก้ไขบัญชีไม่ได้ระหว่างสวมสิทธิ์ผู้ใช้');
  const name = text(ctx.body.name, { label: 'ชื่อ', max: 80, required: true });
  await run('UPDATE users SET name = ? WHERE id = ?', name, ctx.session.user_id);
  ctx.session.name = name;
  return await mePayload(ctx);
});

api('POST', '/api/me/password', { store: false }, async (ctx) => {
  if (ctx.session.impersonator_id) throw new HttpError(403, 'เปลี่ยนรหัสผ่านไม่ได้ระหว่างสวมสิทธิ์ผู้ใช้');
  const u = await get('SELECT pass FROM users WHERE id = ?', ctx.session.user_id);
  if (!verifyPassword(ctx.body.current || '', u.pass)) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  const next = passwordVal(ctx.body.next, 'รหัสผ่านใหม่');
  await run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(next), ctx.session.user_id);
  await run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', ctx.session.user_id, ctx.session.token);
  return { ok: true };
});

api('POST', '/api/stores', { store: false }, async (ctx) => {
  const userId = ctx.session.user_id;
  const mine = await memberships(userId);
  const superadmin = await isSuperadmin(userId);
  const kind = ctx.body.kind === 'shop' || (!mine.length && !superadmin) ? 'shop' : 'branch';
  const name = kind === 'branch' ? branchVal(ctx.body.name) : text(ctx.body.name, { label: 'ชื่อสาขาแรก', max: 60 }) || DEFAULT_BRANCH;
  const storeId = await tx(async () => {
    const at = nowIso();
    if (kind === 'branch') {
      const orgId = Number(ctx.body.orgId) || await orgOf(ctx.session.store_id);
      if (!await get('SELECT 1 FROM orgs WHERE id = ?', orgId)) throw new HttpError(400, 'ไม่พบร้าน');
      if (!await canManageBranches(userId, orgId)) throw new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้นที่เพิ่มสาขาได้');
      return await createStore(orgId, name, at);
    }
    if (mine.length && !superadmin && !mine.some((s) => s.role === 'owner')) throw new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้นที่สร้างร้านใหม่ได้');
    const shopName = text(ctx.body.shopName, { label: 'ชื่อร้าน', max: 60, required: true });
    const id = await createStore(await createOrg(shopName, at), name, at);
    if (!superadmin) await run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', id, userId, 'owner', at);
    return id;
  });
  await run('UPDATE sessions SET store_id = ? WHERE token = ?', storeId, ctx.session.token);
  ctx.session.store_id = storeId;
  return await mePayload(ctx);
});

// — store settings —

api('GET', '/api/store', async (ctx) => {
  const s = await storeRow(ctx.storeId);
  return { id: s.id, name: s.name, expiryDays: s.expiry_days };
});

api('PUT', '/api/store', { perm: 'settings' }, async (ctx) => {
  const name = branchVal(ctx.body.name);
  const expiryDays = intVal(ctx.body.expiryDays, { label: 'จำนวนวันแจ้งเตือนหมดอายุ', min: 1, max: 730 });
  await assertBranchFree(ctx.orgId, name, ctx.storeId);
  await run('UPDATE stores SET name = ?, expiry_days = ? WHERE id = ?', name, expiryDays, ctx.storeId);
  return { ok: true };
});

// ชื่อร้าน (ใช้ร่วมกันทุกสาขา) — เฉพาะเจ้าของร้านขึ้นไป
api('PUT', '/api/org', async (ctx) => {
  if (!await canManageBranches(ctx.session.user_id, ctx.orgId)) throw new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้นที่เปลี่ยนชื่อร้านได้');
  await run('UPDATE orgs SET name = ? WHERE id = ?', text(ctx.body.name, { label: 'ชื่อร้าน', max: 60, required: true }), ctx.orgId);
  return await mePayload(ctx);
});

// ลบสาขา — เฉพาะเจ้าของร้านขึ้นไป ร้านต้องเหลืออย่างน้อย 1 สาขา (ลบทั้งร้านทำได้ที่หน้าผู้ดูแลระบบ)
api('DELETE', '/api/stores/:id', { store: false }, async (ctx) => {
  const s = await get('SELECT id, name, org_id FROM stores WHERE id = ?', Number(ctx.params.id) || 0);
  if (!s) throw new HttpError(404, 'ไม่พบสาขา');
  if (!await canManageBranches(ctx.session.user_id, s.org_id)) throw new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้นที่ลบสาขาได้');
  if (String(ctx.body.confirmName || '').trim() !== s.name) throw new HttpError(400, 'ชื่อสาขาที่พิมพ์ยืนยันไม่ตรงกัน');
  if (Number((await get('SELECT COUNT(*) AS c FROM stores WHERE org_id = ?', s.org_id)).c) <= 1) {
    throw new HttpError(400, 'ร้านต้องมีอย่างน้อย 1 สาขา จึงลบสาขาสุดท้ายไม่ได้');
  }
  await tx(() => deleteStoreData(s.id));
  if (ctx.session.store_id === s.id) ctx.session.store_id = null;
  return await mePayload(ctx);
});

// — dashboard —

api('GET', '/api/dashboard', async (ctx) => {
  const products = await listProducts(ctx.storeId);
  const alerts = await buildAlerts(ctx.storeId);
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
  for (const m of await all('SELECT type, qty, created_at FROM movements WHERE store_id = ? AND created_at >= ?', ctx.storeId, start.toISOString())) {
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
    recent: (await listMovements(ctx.storeId, { limit: 6 })).rows,
    categories: Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  };
});

// — products —

api('GET', '/api/categories', async (ctx) => {
  const used = (await all("SELECT DISTINCT category FROM products WHERE store_id = ? AND deleted_at IS NULL AND category <> ''", ctx.storeId)).map((r) => r.category);
  return { categories: [...new Set([...DEFAULT_CATEGORIES, ...used])] };
});

api('GET', '/api/products', async (ctx) => {
  const { q = '', category = '', status = '' } = ctx.query;
  return { products: await listProducts(ctx.storeId, { q: q.trim().slice(0, 80), category, status }) };
});

api('GET', '/api/lookup', async (ctx) => {
  const code = String(ctx.query.code || '').trim();
  if (!code) throw new HttpError(400, 'ไม่มีรหัสสินค้า');
  const store = await storeRow(ctx.storeId);
  const lotScan = parseLotCode(code);
  const skuKey = lotScan ? lotScan.sku : code;
  let p = await get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.store_id = ? AND p.deleted_at IS NULL AND (p.barcode = ? OR lower(p.sku) = lower(?)) LIMIT 1`, ctx.storeId, lotScan ? null : code, skuKey);
  let matchedPack = null;
  if (!p && !lotScan) {
    const k = await get(`SELECT k.id, k.product_id FROM product_packs k JOIN products p ON p.id = k.product_id
                   WHERE p.store_id = ? AND p.deleted_at IS NULL AND k.barcode = ? LIMIT 1`, ctx.storeId, code);
    if (k) {
      p = await get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ?`, k.product_id);
      matchedPack = k.id;
    }
  }
  if (!p) return { product: null };
  const packs = await packsOf(p.id);
  const product = { ...productOut(p, store.expiry_days), packs };
  const seesBranches = await roleScope(ctx.orgId, ctx.role) !== 'single';
  const branches = (await pall((seesBranches ? await accessibleStores(ctx.session.user_id) : [])
    .filter((s) => s.orgId === ctx.orgId && s.id !== ctx.storeId), async (s) => {
      const o = await get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.store_id = ? AND p.deleted_at IS NULL AND p.sku = ? LIMIT 1`, s.id, p.sku);
      if (!o) return null;
      const out = productOut(o, (await storeRow(s.id)).expiry_days);
      // ล็อตของสาขานั้น (ดูอย่างเดียว) และยอดของล็อตที่สแกน ถ้าสแกน QR ล็อต
      const scannedLotQty = lotScan
        ? Number((await get('SELECT qty FROM lots WHERE product_id = ? AND lot_no = ? AND expiry IS NOT DISTINCT FROM ?', o.id, lotScan.lotNo, lotScan.expiry))?.qty ?? 0)
        : null;
      return { storeId: s.id, storeName: s.name, qty: out.qty, unit: out.unit, status: out.status, nextExpiry: out.nextExpiry, lots: await lotsOut(o.id), scannedLotQty };
    })).filter(Boolean);
  let scannedLot = null;
  if (lotScan) {
    const row = await get('SELECT id, qty FROM lots WHERE product_id = ? AND lot_no = ? AND expiry IS NOT DISTINCT FROM ?', p.id, lotScan.lotNo, lotScan.expiry);
    scannedLot = {
      id: row?.id ?? null, lotNo: lotScan.lotNo, expiry: lotScan.expiry,
      days: lotScan.expiry ? daysUntil(lotScan.expiry) : null, qty: row?.qty ?? 0,
    };
  }
  return {
    product,
    packs,
    matchedPack: packs.find((k) => k.id === matchedPack) || null,
    scannedLot,
    lots: await lotsOut(p.id),
    recent: (await listMovements(ctx.storeId, { productId: p.id, limit: 5 })).rows,
    branches,
  };
});

async function lotsOut(productId) {
  return (await all('SELECT id, lot_no, expiry, qty, received_at FROM lots WHERE product_id = ? AND qty > 0 ORDER BY expiry IS NULL, expiry, id', productId))
    .map((l) => ({ id: l.id, lotNo: l.lot_no, expiry: l.expiry, days: l.expiry ? daysUntil(l.expiry) : null, qty: l.qty, receivedAt: l.received_at }));
}

async function productForStore(ctx, id) {
  const store = await storeRow(ctx.storeId);
  const p = await get(`SELECT ${PRODUCT_COLS} FROM products p WHERE p.id = ? AND p.store_id = ? AND p.deleted_at IS NULL`, Number(id) || 0, ctx.storeId);
  if (!p) throw new HttpError(404, 'ไม่พบสินค้า');
  return { ...productOut(p, store.expiry_days), packs: await packsOf(p.id) };
}

api('GET', '/api/products/:id', async (ctx) => {
  const product = await productForStore(ctx, ctx.params.id);
  const lots = await lotsOut(product.id);
  const history = await listMovements(ctx.storeId, { productId: product.id, limit: 20 });
  return { product, lots, history: history.rows, historyTotal: history.total };
});

api('GET', '/api/products/:id/image', async (ctx) => {
  const row = await get('SELECT image FROM products WHERE id = ? AND store_id = ?', Number(ctx.params.id) || 0, ctx.storeId);
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
  out.packs = b.packs === undefined && partialImage ? undefined : packsInput(b.packs, out);
  if (b.image === undefined && partialImage) out.image = undefined;
  else if (!b.image) out.image = null;
  else {
    if (typeof b.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.image)) throw new HttpError(400, 'ไฟล์รูปไม่ถูกต้อง');
    if (b.image.length > 1_500_000) throw new HttpError(400, 'รูปมีขนาดใหญ่เกินไป');
    out.image = b.image;
  }
  return out;
}

const MAX_PACKS = 5;

function packsInput(list, { unit, barcode }) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new HttpError(400, 'ข้อมูลขนาดบรรจุไม่ถูกต้อง');
  if (list.length > MAX_PACKS) throw new HttpError(400, `ขนาดบรรจุได้ไม่เกิน ${MAX_PACKS} แบบ`);
  const names = new Set([unit]);
  const pers = new Set();
  const codes = new Set(barcode ? [barcode] : []);
  return list.map((b, i) => {
    const n = i + 1;
    const pack = {
      name: text(b?.name, { label: `ชื่อหน่วยบรรจุแถวที่ ${n}`, max: 20, required: true }),
      perQty: intVal(b?.perQty, { label: `จำนวนต่อหน่วยแถวที่ ${n} `, min: 2, max: 100000 }),
      barcode: text(b?.barcode, { label: `บาร์โค้ดแถวที่ ${n}`, max: 64 }),
      price: b?.price === '' || b?.price == null ? null : numVal(b.price, { label: `ราคาขายแถวที่ ${n}` }),
    };
    if (names.has(pack.name)) throw new HttpError(400, `ชื่อหน่วย "${pack.name}" ซ้ำกัน`);
    if (pers.has(pack.perQty)) throw new HttpError(400, `มีขนาดบรรจุ ${pack.perQty} ${unit} ซ้ำกัน`);
    if (pack.barcode && codes.has(pack.barcode)) throw new HttpError(400, `บาร์โค้ด "${pack.barcode}" ซ้ำกันในสินค้านี้`);
    names.add(pack.name); pers.add(pack.perQty);
    if (pack.barcode) codes.add(pack.barcode);
    return pack;
  });
}

const packOut = (k) => ({ id: k.id, name: k.name, perQty: k.per_qty, barcode: k.barcode, price: k.price });

async function packsOf(productId) {
  return (await all('SELECT id, name, per_qty, barcode, price FROM product_packs WHERE product_id = ? ORDER BY per_qty DESC', productId)).map(packOut);
}

async function attachPacks(storeId, products) {
  if (!products.length) return products;
  const by = new Map();
  for (const k of await all(`SELECT k.id, k.product_id, k.name, k.per_qty, k.barcode, k.price FROM product_packs k
                       JOIN products p ON p.id = k.product_id WHERE p.store_id = ? AND p.deleted_at IS NULL ORDER BY k.per_qty DESC`, storeId)) {
    if (!by.has(k.product_id)) by.set(k.product_id, []);
    by.get(k.product_id).push(packOut(k));
  }
  for (const p of products) p.packs = by.get(p.id) || [];
  return products;
}

async function savePacks(productId, packs) {
  await run('DELETE FROM product_packs WHERE product_id = ?', productId);
  for (const [i, k] of packs.entries()) {
    await run('INSERT INTO product_packs(product_id, name, per_qty, barcode, price, sort) VALUES (?, ?, ?, ?, ?, ?)',
      productId, k.name, k.perQty, k.barcode, k.price, i);
  }
}

async function barcodeOwner(storeId, code, exceptId) {
  return await get(`SELECT p.name FROM products p WHERE p.store_id = ? AND p.deleted_at IS NULL AND p.id <> ? AND p.barcode = ?
              UNION ALL
              SELECT p.name FROM product_packs k JOIN products p ON p.id = k.product_id
              WHERE p.store_id = ? AND p.deleted_at IS NULL AND p.id <> ? AND k.barcode = ? LIMIT 1`,
    storeId, exceptId, code, storeId, exceptId, code);
}

async function assertUniqueProduct(storeId, { sku, barcode, packs }, exceptId = 0) {
  if (await get('SELECT 1 FROM products WHERE store_id = ? AND deleted_at IS NULL AND sku = ? AND id <> ?', storeId, sku, exceptId)) {
    throw new HttpError(409, `SKU "${sku}" มีอยู่แล้วในร้านนี้`);
  }
  for (const code of [barcode, ...(packs || []).map((k) => k.barcode)].filter(Boolean)) {
    const owner = await barcodeOwner(storeId, code, exceptId);
    if (owner) throw new HttpError(409, `บาร์โค้ด "${code}" ถูกใช้กับสินค้า "${owner.name}" แล้ว`);
  }
}

async function createProduct(storeId, data, at = nowIso()) {
  return await tx(async () => {
    await assertUniqueProduct(storeId, data);
    const id = await insert(`INSERT INTO products(store_id, sku, name, barcode, category, unit, cost, price, reorder_point, track_expiry, image, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      storeId, data.sku, data.name, data.barcode, data.category, data.unit, data.cost, data.price, data.reorderPoint, data.trackExpiry, data.image ?? null, at, at);
    if (data.packs?.length) await savePacks(id, data.packs);
    return id;
  });
}

api('POST', '/api/products', { perm: 'product.edit' }, async (ctx) => {
  const data = productInput(ctx.body, { partialImage: false });
  const id = await tx(async () => {
    const id = await createProduct(ctx.storeId, data);
    const initial = ctx.body.initialQty;
    if (initial !== undefined && initial !== null && initial !== '' && Number(initial) > 0) {
      await moveStock(ctx.actor, { type: 'in', productId: id, qty: Number(initial), lotNo: ctx.body.lotNo, expiry: ctx.body.expiry, note: 'ยอดยกมา (สร้างสินค้า)' });
    }
    return id;
  });
  return { id };
});

api('PUT', '/api/products/:id', { perm: 'product.edit' }, async (ctx) => {
  const current = await productForStore(ctx, ctx.params.id);
  const data = productInput(ctx.body, { partialImage: true });
  if (data.packs === undefined) data.packs = packsInput(await packsOf(current.id), data);
  await assertUniqueProduct(ctx.storeId, data, current.id);
  const sets = ['sku = ?', 'name = ?', 'barcode = ?', 'category = ?', 'unit = ?', 'cost = ?', 'price = ?', 'reorder_point = ?', 'track_expiry = ?', 'updated_at = ?'];
  const args = [data.sku, data.name, data.barcode, data.category, data.unit, data.cost, data.price, data.reorderPoint, data.trackExpiry, nowIso()];
  if (data.image !== undefined) { sets.push('image = ?'); args.push(data.image); }
  await tx(async () => {
    await run(`UPDATE products SET ${sets.join(', ')} WHERE id = ? AND store_id = ?`, ...args, current.id, ctx.storeId);
    if (ctx.body.packs !== undefined) await savePacks(current.id, data.packs);
  });
  return { id: current.id };
});

api('DELETE', '/api/products/:id', { perm: 'product.delete' }, async (ctx) => {
  const p = await productForStore(ctx, ctx.params.id);
  if (String(ctx.body.confirmSku || '').trim().toUpperCase() !== p.sku) throw new HttpError(400, 'SKU ที่พิมพ์ยืนยันไม่ตรงกัน');
  await run('UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), p.id);
  return { ok: true };
});

// — stock movements —

api('POST', '/api/movements', async (ctx) => {
  const type = ctx.body.type;
  if (!await can(ctx.role, type === 'adj' ? 'stock.adjust' : 'stock.move', ctx.orgId)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ทำรายการนี้');
  return await moveStock(ctx.actor, ctx.body);
});

api('GET', '/api/movements', async (ctx) => {
  const q = ctx.query;
  const type = ['in', 'out', 'adj'].includes(q.type) ? q.type : '';
  return await listMovements(ctx.storeId, {
    q: String(q.q || '').trim().slice(0, 80),
    type,
    from: isoVal(q.from, 'วันที่เริ่ม'),
    to: isoVal(q.to, 'วันที่สิ้นสุด'),
    productId: Number(q.productId) || null,
    limit: Math.min(Math.max(Number(q.limit) || 50, 1), 1000),
    offset: Math.max(Number(q.offset) || 0, 0),
  });
});

api('GET', '/api/alerts', async (ctx) => await buildAlerts(ctx.storeId));

// — reports —

api('GET', '/api/reports', { perm: 'report' }, async (ctx) => {
  const from = isoVal(ctx.query.from, 'วันที่เริ่ม') || new Date(Date.now() - 30 * DAY).toISOString();
  const to = isoVal(ctx.query.to, 'วันที่สิ้นสุด') || nowIso();
  const products = await listProducts(ctx.storeId);
  const moves = await all(`SELECT m.type, m.qty, m.product_id, p.category, p.name, p.sku, p.unit, p.deleted_at IS NOT NULL AS deleted
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
    expiring: (await buildAlerts(ctx.storeId)).expiring,
  };
});

// — members —

const orgStores = async (orgId) => await all('SELECT id, name FROM stores WHERE org_id = ? ORDER BY lower(name)', orgId);

async function orgOwners(orgId) {
  return await all(`SELECT u.id, u.name, u.email, u.last_login, MIN(m.created_at) AS created_at
              FROM members m JOIN stores s ON s.id = m.store_id JOIN users u ON u.id = m.user_id
              WHERE s.org_id = ? AND m.role = 'owner' GROUP BY u.id ORDER BY created_at`, orgId);
}

async function orgMemberRows(userId, orgId) {
  return await all(`SELECT m.store_id, m.role, s.name FROM members m JOIN stores s ON s.id = m.store_id
              WHERE m.user_id = ? AND s.org_id = ? ORDER BY lower(s.name)`, userId, orgId);
}

async function assertBranchRule(userId, orgId, role, storeId) {
  const others = (await orgMemberRows(userId, orgId)).filter((r) => r.store_id !== storeId);
  if (!others.length) return;
  const scope = await roleScope(orgId, role);
  if (scope === 'single') {
    throw new HttpError(400, `${await roleName(orgId, role)}เข้าถึงได้เพียง 1 สาขา — ผู้ใช้นี้อยู่ที่ "${others[0].name}" แล้ว (นำออกจากสาขานั้นก่อน หรือเปลี่ยนเป็นบทบาทที่ดูแลได้หลายสาขา)`);
  }
  let bad = null;
  for (const r of others) { if (await roleScope(orgId, r.role) !== 'multi') { bad = r; break; } }
  if (scope === 'multi' && bad) {
    throw new HttpError(400, `ผู้ใช้นี้เป็น${await roleName(orgId, bad.role)}ที่ "${bad.name}" — ผู้ที่ดูแลหลายสาขาต้องเป็นบทบาทแบบหลายสาขาทุกสาขา`);
  }
}

async function branchIds(ctx, list) {
  if (list === undefined) return [ctx.storeId];
  if (!Array.isArray(list)) throw new HttpError(400, 'รายการสาขาไม่ถูกต้อง');
  const allowed = new Set((await orgStores(ctx.orgId)).map((s) => s.id));
  const ids = [...new Set(list.map(Number))];
  if (!ids.length) throw new HttpError(400, 'กรุณาเลือกอย่างน้อย 1 สาขา');
  if (ids.some((id) => !allowed.has(id))) throw new HttpError(400, 'มีสาขาที่ไม่ได้อยู่ในธุรกิจนี้');
  return ids;
}

const upsertMember = async (storeId, userId, role) => await run(`INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
                                                     ON CONFLICT(store_id, user_id) DO UPDATE SET role = excluded.role`, storeId, userId, role, nowIso());

async function setOrgOwner(userId, orgId, storeId) {
  await run("DELETE FROM members WHERE user_id = ? AND role <> 'owner' AND store_id IN (SELECT id FROM stores WHERE org_id = ?)", userId, orgId);
  await upsertMember(storeId, userId, 'owner');
}

async function leaveStore(userId, storeId) {
  await run('DELETE FROM members WHERE store_id = ? AND user_id = ?', storeId, userId);
  await run('UPDATE sessions SET store_id = NULL WHERE user_id = ? AND store_id = ?', userId, storeId);
}

async function leaveOrg(userId, orgId) {
  for (const r of await orgMemberRows(userId, orgId)) await leaveStore(userId, r.store_id);
  await run('UPDATE sessions SET store_id = NULL WHERE user_id = ? AND store_id IN (SELECT id FROM stores WHERE org_id = ?)', userId, orgId);
}

api('GET', '/api/members', { perm: 'users' }, async (ctx) => {
  const me = ctx.session.user_id;
  const owners = await orgOwners(ctx.orgId);
  const ownerIds = new Set(owners.map((o) => o.id));
  const direct = (await all(`SELECT u.id, u.name, u.email, u.last_login, m.role, m.created_at
                      FROM members m JOIN users u ON u.id = m.user_id WHERE m.store_id = ? ORDER BY m.created_at`, ctx.storeId))
    .filter((m) => !ownerIds.has(m.id));
  const out = async (m, role) => ({
    id: m.id, name: m.name, email: m.email, role, roleLabel: await roleName(ctx.orgId, role), lastLogin: m.last_login, joinedAt: m.created_at, isMe: m.id === me,
    scope: await roleScope(ctx.orgId, role),
    allBranches: await roleScope(ctx.orgId, role) === 'all',
    branches: await roleScope(ctx.orgId, role) === 'all' ? [] : (await orgMemberRows(m.id, ctx.orgId)).map((r) => ({ id: r.store_id, name: r.name })),
  });
  // สมาชิกของร้านเดียวกันที่อยู่สาขาอื่น (ไม่ใช่เจ้าของ) — ให้เจ้าของดึงมาสาขานี้ได้โดยไม่ต้องสลับสาขา
  const here = new Set(direct.map((m) => m.id));
  const elsewhere = await pall((await all(`SELECT DISTINCT u.id, u.name, u.email, u.last_login, m.role, lower(u.name) AS sort_name FROM members m JOIN stores s ON s.id = m.store_id
                         JOIN users u ON u.id = m.user_id WHERE s.org_id = ? AND m.role <> 'owner' ORDER BY sort_name`, ctx.orgId))
    .filter((m) => !here.has(m.id) && !ownerIds.has(m.id)), (m) => out(m, m.role));
  return {
    members: [...await pall(owners, (o) => out(o, 'owner')), ...await pall(direct, (m) => out(m, m.role))],
    elsewhere,
    stores: await orgStores(ctx.orgId),
    roles: await orgRoles(ctx.orgId),
    permissions: PERM_LIST.map(([key, label]) => ({ key, label })),
    scopes: SCOPE_LABEL,
  };
});

const roleVal = async (orgId, r) => {
  if (!await get('SELECT 1 FROM org_roles WHERE org_id = ? AND key = ?', orgId, r)) throw new HttpError(400, 'บทบาทไม่ถูกต้อง');
  return r;
};

api('POST', '/api/members', { perm: 'users' }, async (ctx) => {
  const email = emailVal(ctx.body.email);
  const role = await roleVal(ctx.orgId, ctx.body.role);
  return await tx(async () => {
    let u = await get('SELECT id FROM users WHERE email = ?', email);
    let created = false;
    if (!u) {
      const name = text(ctx.body.name, { label: 'ชื่อผู้ใช้', max: 80, required: true });
      const pass = passwordVal(ctx.body.password, 'รหัสผ่านเริ่มต้น');
      u = { id: await insert('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), nowIso()) };
      created = true;
    }
    if (await isOrgOwner(u.id, ctx.orgId)) throw new HttpError(409, 'ผู้ใช้นี้เป็นเจ้าของร้านอยู่แล้ว (เห็นทุกสาขา)');
    if (await get('SELECT 1 FROM members WHERE store_id = ? AND user_id = ?', ctx.storeId, u.id)) throw new HttpError(409, 'ผู้ใช้นี้เป็นสมาชิกของสาขานี้อยู่แล้ว');
    if (role === 'owner') {
      await setOrgOwner(u.id, ctx.orgId, ctx.storeId);
      return { ok: true, created };
    }
    await assertBranchRule(u.id, ctx.orgId, role, ctx.storeId);
    const ids = await roleScope(ctx.orgId, role) === 'multi' ? await branchIds(ctx, ctx.body.storeIds) : [ctx.storeId];
    if (!ids.includes(ctx.storeId)) ids.push(ctx.storeId);
    for (const id of ids) {
      if (!await get('SELECT 1 FROM members WHERE store_id = ? AND user_id = ?', id, u.id)) await upsertMember(id, u.id, role);
    }
    return { ok: true, created };
  });
});

async function memberOf(ctx) {
  const userId = Number(ctx.params.userId) || 0;
  const role = await roleIn(userId, ctx.storeId);
  if (!role) throw new HttpError(404, 'ไม่พบสมาชิก');
  return { userId, role };
}

const assertNotLastOwner = async (ctx) => {
  if ((await orgOwners(ctx.orgId)).length <= 1) throw new HttpError(400, 'ร้านต้องมีเจ้าของร้านอย่างน้อย 1 คน');
};

api('PUT', '/api/members/:userId', { perm: 'users' }, async (ctx) => {
  const m = await memberOf(ctx);
  if (ctx.body.role !== undefined && ctx.body.role !== m.role) {
    const role = await roleVal(ctx.orgId, ctx.body.role);
    if (m.userId === ctx.session.user_id) throw new HttpError(400, 'เปลี่ยนบทบาทของตัวเองไม่ได้');
    await tx(async () => {
      if (role === 'owner') return await setOrgOwner(m.userId, ctx.orgId, ctx.storeId);
      if (m.role === 'owner') {
        await assertNotLastOwner(ctx);
        await leaveOrg(m.userId, ctx.orgId);
        await upsertMember(ctx.storeId, m.userId, role);
        return;
      }
      await assertBranchRule(m.userId, ctx.orgId, role, ctx.storeId);
      if (await roleScope(ctx.orgId, role) === 'multi') {
        for (const r of await orgMemberRows(m.userId, ctx.orgId)) await upsertMember(r.store_id, m.userId, role);
      }
      await upsertMember(ctx.storeId, m.userId, role);
    });
  }
  if (ctx.body.password !== undefined) {
    // Only reset a password when every business this person belongs to is owned by the caller,
    // otherwise an owner of one shop could take over an account used in another shop.
    const callerIsSys = await isSuperadmin(ctx.session.user_id);
    if (await isSuperadmin(m.userId) && !callerIsSys) throw new HttpError(403, 'ไม่สามารถเปลี่ยนรหัสผ่านของผู้ดูแลระบบได้');
    const foreign = !callerIsSys && await get(`SELECT 1 FROM members t JOIN stores s ON s.id = t.store_id
                         WHERE t.user_id = ? AND s.org_id NOT IN (${OWNER_ORGS}) LIMIT 1`, m.userId, ctx.session.user_id);
    if (foreign) throw new HttpError(403, 'ผู้ใช้นี้เป็นสมาชิกร้านอื่นด้วย ให้เจ้าตัวเปลี่ยนรหัสผ่านเองจากหน้าตั้งค่า');
    const pass = passwordVal(ctx.body.password, 'รหัสผ่านใหม่');
    await run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(pass), m.userId);
    await run('DELETE FROM sessions WHERE user_id = ?', m.userId);
  }
  return { ok: true };
});

api('DELETE', '/api/members/:userId', { perm: 'users' }, async (ctx) => {
  const m = await memberOf(ctx);
  if (m.userId === ctx.session.user_id) throw new HttpError(400, 'ไม่สามารถลบตัวเองออกจากร้านได้');
  await tx(async () => {
    if (m.role === 'owner') {
      await assertNotLastOwner(ctx);
      await leaveOrg(m.userId, ctx.orgId);
    } else await leaveStore(m.userId, ctx.storeId);
  });
  return { ok: true };
});

api('PUT', '/api/members/:userId/stores', { perm: 'users' }, async (ctx) => {
  // ใช้ได้กับทุกคนในร้านเดียวกัน แม้ตอนนี้อยู่สาขาอื่น (ดึงมาสาขานี้ / ย้ายสาขา)
  const userId = Number(ctx.params.userId) || 0;
  const rows = await orgMemberRows(userId, ctx.orgId);
  if (!rows.length) throw new HttpError(404, 'ไม่พบสมาชิก');
  const m = { userId, role: rows[0].role };
  const scope = await roleScope(ctx.orgId, m.role);
  if (m.role === 'owner' || scope === 'all') throw new HttpError(400, 'เจ้าของร้านเห็นทุกสาขาอยู่แล้ว ไม่ต้องกำหนดสาขา');
  const ids = await branchIds(ctx, ctx.body.storeIds);
  if (scope === 'single' && ids.length !== 1) {
    throw new HttpError(400, `${await roleName(ctx.orgId, m.role)}อยู่ได้เพียง 1 สาขา — เลือกสาขาเดียว (หรือเปลี่ยนเป็นบทบาทที่ดูแลได้หลายสาขา)`);
  }
  await tx(async () => {
    for (const r of await orgMemberRows(m.userId, ctx.orgId)) if (!ids.includes(r.store_id)) await leaveStore(m.userId, r.store_id);
    for (const id of ids) await upsertMember(id, m.userId, m.role);
  });
  return { ok: true, storeIds: ids };
});

// — roles of the current shop —

function permList(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'รายการสิทธิ์ไม่ถูกต้อง');
  if (list.some((p) => !PERM_KEYS.includes(p))) throw new HttpError(400, 'สิทธิ์ไม่ถูกต้อง');
  return [...new Set(list)];
}

const scopeVal = (s) => {
  if (s === 'multi' || s === 'single') return s;
  throw new HttpError(400, 'รูปแบบการเข้าถึงสาขาไม่ถูกต้อง');
};

async function roleOf(ctx) {
  const key = String(ctx.params.key || '');
  const role = await get('SELECT key, name, scope FROM org_roles WHERE org_id = ? AND key = ?', ctx.orgId, key);
  if (!role) throw new HttpError(404, 'ไม่พบบทบาท');
  return role;
}

api('POST', '/api/roles', { perm: 'users' }, async (ctx) => {
  const name = text(ctx.body.name, { label: 'ชื่อบทบาท', max: 40, required: true });
  const scope = scopeVal(ctx.body.scope || 'single');
  const perms = permList(ctx.body.perms || []);
  if (await get('SELECT 1 FROM org_roles WHERE org_id = ? AND lower(name) = lower(?)', ctx.orgId, name)) throw new HttpError(409, 'มีบทบาทชื่อนี้อยู่แล้ว');
  const key = `c${crypto.randomBytes(4).toString('hex')}`;
  const sort = ((await get('SELECT COALESCE(MAX(sort), 0) AS n FROM org_roles WHERE org_id = ?', ctx.orgId))?.n || 0) + 1;
  await tx(async () => {
    await run('INSERT INTO org_roles(org_id, key, name, scope, builtin, sort) VALUES (?, ?, ?, ?, 0, ?)', ctx.orgId, key, name, scope, sort);
    for (const p of perms) await run('INSERT INTO org_role_perms(org_id, role_key, perm) VALUES (?, ?, ?)', ctx.orgId, key, p);
  });
  return { ok: true, key };
});

api('PUT', '/api/roles/:key', { perm: 'users' }, async (ctx) => {
  const role = await roleOf(ctx);
  if (role.key === 'owner') throw new HttpError(400, 'แก้สิทธิ์ของเจ้าของร้านไม่ได้ เจ้าของร้านมีสิทธิ์ครบเสมอ');
  const name = ctx.body.name !== undefined ? text(ctx.body.name, { label: 'ชื่อบทบาท', max: 40, required: true }) : null;
  const scope = ctx.body.scope !== undefined ? scopeVal(ctx.body.scope) : null;
  const perms = ctx.body.perms !== undefined ? permList(ctx.body.perms) : null;
  if (name && await get('SELECT 1 FROM org_roles WHERE org_id = ? AND key <> ? AND lower(name) = lower(?)', ctx.orgId, role.key, name)) {
    throw new HttpError(409, 'มีบทบาทชื่อนี้อยู่แล้ว');
  }
  if (scope === 'single' && role.scope !== 'single') {
    const busy = await get(`SELECT 1 FROM members m JOIN stores s ON s.id = m.store_id
                      WHERE s.org_id = ? AND m.role = ? GROUP BY m.user_id HAVING COUNT(*) > 1 LIMIT 1`, ctx.orgId, role.key);
    if (busy) throw new HttpError(400, 'มีผู้ใช้บทบาทนี้ในหลายสาขา ย้ายให้เหลือสาขาเดียวก่อน');
  }
  await tx(async () => {
    if (name) await run('UPDATE org_roles SET name = ? WHERE org_id = ? AND key = ?', name, ctx.orgId, role.key);
    if (scope) await run('UPDATE org_roles SET scope = ? WHERE org_id = ? AND key = ?', scope, ctx.orgId, role.key);
    if (perms) {
      await run('DELETE FROM org_role_perms WHERE org_id = ? AND role_key = ?', ctx.orgId, role.key);
      for (const p of perms) await run('INSERT INTO org_role_perms(org_id, role_key, perm) VALUES (?, ?, ?)', ctx.orgId, role.key, p);
    }
  });
  return { ok: true };
});

api('DELETE', '/api/roles/:key', { perm: 'users' }, async (ctx) => {
  const role = await roleOf(ctx);
  if (role.key === 'owner') throw new HttpError(400, 'ลบบทบาทเจ้าของร้านไม่ได้');
  const used = await get('SELECT 1 FROM members m JOIN stores s ON s.id = m.store_id WHERE s.org_id = ? AND m.role = ? LIMIT 1', ctx.orgId, role.key);
  if (used) throw new HttpError(400, 'มีผู้ใช้บทบาทนี้อยู่ เปลี่ยนบทบาทของพวกเขาก่อนลบ');
  await run('DELETE FROM org_roles WHERE org_id = ? AND key = ?', ctx.orgId, role.key);
  return { ok: true };
});

// — system administration (superadmin only) —

const SYS = { store: false, sys: true };

async function sysUser(id) {
  const u = await get('SELECT id, name, email, is_superadmin FROM users WHERE id = ?', Number(id) || 0);
  if (!u) throw new HttpError(404, 'ไม่พบผู้ใช้');
  return u;
}

async function sysOrg(id) {
  const o = await get('SELECT id, name FROM orgs WHERE id = ?', Number(id) || 0);
  if (!o) throw new HttpError(404, 'ไม่พบร้าน');
  return o;
}

api('GET', '/api/sys/overview', SYS, async () => {
  const orgs = await pall(await all('SELECT id, name, created_at FROM orgs ORDER BY lower(name)'), async (o) => ({
    id: o.id, name: o.name, createdAt: o.created_at,
    stores: await all(`SELECT s.id, s.name,
                   (SELECT COUNT(*) FROM products p WHERE p.store_id = s.id AND p.deleted_at IS NULL) AS products,
                   (SELECT COALESCE(SUM(qty), 0) FROM products p WHERE p.store_id = s.id AND p.deleted_at IS NULL) AS qty,
                   (SELECT COUNT(*) FROM members m WHERE m.store_id = s.id AND m.role <> 'owner') AS staff
                 FROM stores s WHERE s.org_id = ? ORDER BY lower(s.name)`, o.id),
    owners: (await orgOwners(o.id)).map((u) => ({ id: u.id, name: u.name, email: u.email })),
  }));
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const users = await pall(await all('SELECT id, name, email, is_superadmin, last_login, created_at FROM users ORDER BY created_at'), async (u) => {
    const access = [];
    for (const r of await all(`SELECT s.org_id, s.name, m.role FROM members m JOIN stores s ON s.id = m.store_id WHERE m.user_id = ? ORDER BY lower(s.name)`, u.id)) {
      const shop = orgName.get(r.org_id) || '';
      if (r.role === 'owner') {
        if (!access.some((a) => a.orgId === r.org_id && a.role === 'owner')) access.push({ orgId: r.org_id, shop, store: 'ทุกสาขา', role: 'owner', roleLabel: await roleName(r.org_id, 'owner') });
      } else access.push({ orgId: r.org_id, shop, store: r.name, role: r.role, roleLabel: await roleName(r.org_id, r.role) });
    }
    return { id: u.id, name: u.name, email: u.email, superadmin: !!u.is_superadmin, lastLogin: u.last_login, createdAt: u.created_at, access };
  });
  return {
    orgs, users,
    totals: { orgs: orgs.length, stores: orgs.reduce((s, o) => s + o.stores.length, 0), users: users.length, products: Number((await get('SELECT COUNT(*) AS c FROM products WHERE deleted_at IS NULL')).c) },
  };
});

api('POST', '/api/sys/orgs', SYS, async (ctx) => {
  const b = ctx.body;
  const shopName = text(b.shopName, { label: 'ชื่อร้าน', max: 60, required: true });
  const branchName = text(b.branchName, { label: 'ชื่อสาขาแรก', max: 60 }) || DEFAULT_BRANCH;
  const email = emailVal(b.ownerEmail);
  return await tx(async () => {
    const at = nowIso();
    let u = await get('SELECT id FROM users WHERE email = ?', email);
    let created = false;
    if (!u) {
      const name = text(b.ownerName, { label: 'ชื่อเจ้าของร้าน', max: 80, required: true });
      const pass = passwordVal(b.ownerPassword, 'รหัสผ่านเริ่มต้น');
      u = { id: await insert('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), at) };
      created = true;
    }
    const orgId = await createOrg(shopName, at);
    const storeId = await createStore(orgId, branchName, at);
    await run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', storeId, u.id, 'owner', at);
    return { ok: true, orgId, storeId, created };
  });
});

api('PUT', '/api/sys/orgs/:id', SYS, async (ctx) => {
  const o = await sysOrg(ctx.params.id);
  await run('UPDATE orgs SET name = ? WHERE id = ?', text(ctx.body.name, { label: 'ชื่อร้าน', max: 60, required: true }), o.id);
  return { ok: true };
});

api('DELETE', '/api/sys/orgs/:id', SYS, async (ctx) => {
  const o = await sysOrg(ctx.params.id);
  if (String(ctx.body.confirmName || '').trim() !== o.name) throw new HttpError(400, 'ชื่อร้านที่พิมพ์ยืนยันไม่ตรงกัน');
  await tx(async () => {
    const ids = (await all('SELECT id FROM stores WHERE org_id = ?', o.id)).map((s) => s.id);
    for (const id of ids) await deleteStoreData(id);
    await run('DELETE FROM orgs WHERE id = ?', o.id);
  });
  return { ok: true };
});

api('PUT', '/api/sys/users/:id', SYS, async (ctx) => {
  const u = await sysUser(ctx.params.id);
  if (ctx.body.name !== undefined) await run('UPDATE users SET name = ? WHERE id = ?', text(ctx.body.name, { label: 'ชื่อ', max: 80, required: true }), u.id);
  if (ctx.body.superadmin !== undefined) {
    const on = !!ctx.body.superadmin;
    if (!on && u.id === ctx.session.user_id) throw new HttpError(400, 'ไม่สามารถยกเลิกสิทธิ์ผู้ดูแลระบบของตัวเองได้');
    await run('UPDATE users SET is_superadmin = ? WHERE id = ?', on ? 1 : 0, u.id);
  }
  return { ok: true };
});

api('POST', '/api/sys/users/:id/password', SYS, async (ctx) => {
  const u = await sysUser(ctx.params.id);
  await run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(passwordVal(ctx.body.password, 'รหัสผ่านใหม่')), u.id);
  if (u.id === ctx.session.user_id) await run('DELETE FROM sessions WHERE user_id = ? AND token <> ?', u.id, ctx.session.token);
  else await run('DELETE FROM sessions WHERE user_id = ?', u.id);
  return { ok: true };
});

// สวมสิทธิ์: ผู้ดูแลระบบเข้าใช้งานในฐานะผู้ใช้คนอื่น (เห็นและทำได้เท่าที่ผู้ใช้นั้นทำได้)
api('POST', '/api/sys/users/:id/impersonate', SYS, async (ctx) => {
  const u = await sysUser(ctx.params.id);
  if (u.id === ctx.session.user_id) throw new HttpError(400, 'สวมสิทธิ์ตัวเองไม่ได้');
  if (u.is_superadmin) throw new HttpError(400, 'สวมสิทธิ์ผู้ดูแลระบบคนอื่นไม่ได้');
  const first = (await accessibleStores(u.id))[0];
  await run('DELETE FROM sessions WHERE token = ?', ctx.session.token);
  await createSession(ctx.req, ctx.res, u.id, first?.id ?? null, false, ctx.session.user_id);
  console.log(`[impersonate] ${ctx.session.email} → ${u.email}`);
  return { ok: true };
});

api('DELETE', '/api/sys/users/:id', SYS, async (ctx) => {
  const u = await sysUser(ctx.params.id);
  if (u.id === ctx.session.user_id) throw new HttpError(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
  if (u.is_superadmin) throw new HttpError(400, 'ยกเลิกสิทธิ์ผู้ดูแลระบบของบัญชีนี้ก่อนลบ');
  const ownedOrgs = await all(`SELECT DISTINCT s.org_id FROM members m JOIN stores s ON s.id = m.store_id WHERE m.user_id = ? AND m.role = 'owner'`, u.id);
  for (const { org_id: orgId } of ownedOrgs) {
    if ((await orgOwners(orgId)).length <= 1) throw new HttpError(400, `ผู้ใช้นี้เป็นเจ้าของคนเดียวของร้าน "${(await sysOrg(orgId)).name}" — เพิ่มเจ้าของคนอื่นหรือลบร้านก่อน`);
  }
  await run('DELETE FROM users WHERE id = ?', u.id);
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
    ctx.session = await loadSession(req);
    if (!ctx.session) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  }
  if (route.opts.store) {
    const role = await accessRole(ctx.session.user_id, ctx.session.store_id);
    if (!role) throw new HttpError(403, 'กรุณาเลือกร้านก่อนใช้งาน');
    ctx.storeId = ctx.session.store_id;
    ctx.orgId = await orgOf(ctx.storeId);
    ctx.role = role;
    const by = ctx.session.impersonator_id ? ` (สวมสิทธิ์โดย ${ctx.session.impersonator_email})` : '';
    ctx.actor = { storeId: ctx.storeId, userId: ctx.session.user_id, userName: ctx.session.name + by };
    if (route.opts.perm && !await can(ctx.role, route.opts.perm, ctx.orgId)) throw new HttpError(403, 'คุณไม่มีสิทธิ์ทำรายการนี้');
  }
  if (route.opts.sys && !await isSuperadmin(ctx.session.user_id)) throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
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

async function seed() {
  if (Number((await get('SELECT COUNT(*) AS c FROM users')).c) > 0) return false;
  let rnd = 20251006;
  const rand = (a, b) => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return a + (rnd % (b - a + 1)); };
  const daysAgo = (d, h = 10) => { const t = new Date(Date.now() - d * DAY); t.setHours(h, rand(0, 59), 0, 0); return t.toISOString(); };
  const inDays = (d) => localDate(new Date(Date.now() + d * DAY));
  const lotFor = (iso) => { const d = new Date(iso); return `LOT-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String.fromCharCode(65 + rand(0, 3))}`; };

  await tx(async () => {
    const at = daysAgo(200);
    const addUser = async (email, name, pass) => await insert('INSERT INTO users(email, name, pass, created_at) VALUES (?, ?, ?, ?)', email, name, hashPassword(pass), at);
    const org = await createOrg('Rose Beauty', at);
    const addStore = async (name) => await createStore(org, name, at);
    const addMember = async (s, u, role) => await run('INSERT INTO members(store_id, user_id, role, created_at) VALUES (?, ?, ?, ?)', s, u, role, at);

    const admin = await addUser(ADMIN_EMAIL, 'มินตรา ทองสุข', ADMIN_PASSWORD);
    const somchai = await addUser('somchai@rosebeauty.co', 'สมชาย ใจดี', DEMO_PASSWORD);
    const pim = await addUser('pimchanok@rosebeauty.co', 'พิมพ์ชนก แก้วใส', DEMO_PASSWORD);
    const natt = await addUser('nattawut@rosebeauty.co', 'ณัฐวุฒิ ศรีสุข', DEMO_PASSWORD);
    const siam = await addStore('สาขาสยาม');
    const ari = await addStore('สาขาอารีย์');
    await addMember(siam, admin, 'owner'); await addMember(siam, somchai, 'staff'); await addMember(siam, pim, 'manager'); await addMember(siam, natt, 'viewer');
    await addMember(ari, admin, 'owner'); await addMember(ari, pim, 'manager');

    const people = [[admin, 'มินตรา ทองสุข'], [somchai, 'สมชาย ใจดี'], [pim, 'พิมพ์ชนก แก้วใส']];
    const ops = [];
    const PACKS = {
      'SK-VC30': [['กล่อง', 6], ['ลัง', 24]],
      'MU-LP01': [['แพ็ค', 12], ['ลัง', 48]],
      'SC-SS01': [['แพ็ค', 6], ['ลัง', 24]],
      'SK-TN03': [['แพ็ค', 6], ['ลัง', 36]],
      'SK-MK04': [['ลัง', 20]],
    };

    const plan = async (storeId, def) => {
      const [sku, name, category, cost, price, rp, track, barcode, target, finals = []] = def;
      const packs = (PACKS[sku] || []).map(([pname, perQty], i) => ({ name: pname, perQty, barcode: `${i + 1}${barcode}`, price: null }));
      const id = await createProduct(storeId, { sku, name, barcode, category, unit: 'ชิ้น', cost, price, reorderPoint: rp, trackExpiry: track, image: null, packs }, daysAgo(190));
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

    for (const d of [
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
    ]) await plan(siam, d);

    for (const d of [
      ['SK-VC30', 'เซรั่มวิตามินซี Brightening 30ml', 'สกินแคร์', 320, 590, 10, true, '8851234567890', 24],
      ['MU-LP01', 'ลิปสติก Velvet Rose', 'เมคอัพ', 180, 390, 10, false, '8851234567891', 30],
      ['SC-SS01', 'กันแดด SPF50+ PA++++', 'กันแดด', 290, 550, 10, true, '8851234567894', 6],
      ['SK-TN03', 'โทนเนอร์ Rose Water', 'สกินแคร์', 140, 290, 10, false, '8851234567897', 40],
    ]) await plan(ari, d);

    ops.sort((a, b) => a.at.localeCompare(b.at));
    for (const op of ops) {
      const [userId, userName] = op.storeId === ari ? people[op.input.type === 'out' ? 2 : 0] : people[rand(0, 2)];
      await moveStock({ storeId: op.storeId, userId, userName }, op.input, op.at);
    }
  });
  return true;
}

// Creates the system administrator once. The password is random unless SUPERADMIN_PASSWORD is set,
// and is only shown in the console when it is created or reset (`npm run superadmin`).
async function ensureSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@cosmostock.app').toLowerCase();
  const reset = process.argv.includes('--reset-superadmin');
  if (!reset && await get('SELECT 1 FROM users WHERE is_superadmin = 1')) return null;
  const password = process.env.SUPERADMIN_PASSWORD || `CS-${crypto.randomBytes(9).toString('base64url')}`;
  const u = await get('SELECT id FROM users WHERE email = ?', email);
  if (u) {
    await run('UPDATE users SET is_superadmin = 1, pass = ? WHERE id = ?', hashPassword(password), u.id);
    await run('DELETE FROM sessions WHERE user_id = ?', u.id);
  } else {
    await run('INSERT INTO users(email, name, pass, created_at, is_superadmin) VALUES (?, ?, ?, ?, 1)', email, 'ผู้ดูแลระบบ', hashPassword(password), nowIso());
  }
  return { email, password };
}
// ข้อมูลรุ่นเก่าเก็บชื่อสาขาเป็น "ร้าน · สาขา" และอาจมีสาขาที่ไม่มีร้าน — แยกชื่อ แล้วผูกทุกสาขาเข้ากับร้าน
async function migrateBranches() {
  await tx(async () => {
    for (const s of await all('SELECT id, name, created_at FROM stores WHERE org_id IS NULL')) {
      const [shop, ...rest] = s.name.split(' · ');
      const orgId = await createOrg(shop.trim() || s.name, s.created_at);
      await run('UPDATE stores SET org_id = ?, name = ? WHERE id = ?', orgId, rest.join(' · ').trim() || DEFAULT_BRANCH, s.id);
    }
    for (const s of await all(`SELECT s.id, s.name, s.org_id, o.name AS org_name FROM stores s JOIN orgs o ON o.id = s.org_id
                               WHERE strpos(s.name, o.name || ' · ') = 1`)) {
      const name = s.name.slice(s.org_name.length + 3).trim() || DEFAULT_BRANCH;
      if (await get('SELECT 1 FROM stores WHERE org_id = ? AND lower(name) = lower(?) AND id <> ?', s.org_id, name, s.id)) continue;
      await run('UPDATE stores SET name = ? WHERE id = ?', name, s.id);
    }
    await run('ALTER TABLE stores ALTER COLUMN org_id SET NOT NULL');
  });
}

async function main() {
  if (process.argv.includes('--reset')) {
    if (!process.argv.includes('--yes') && process.env.CONFIRM_RESET !== 'yes') {
      console.error('คำสั่ง --reset จะ "ลบข้อมูลทั้งหมด" ในฐานข้อมูล PostgreSQL\nถ้าแน่ใจ ให้รันซ้ำพร้อม --yes  (เช่น npm run reset -- --yes)');
      process.exit(1);
    }
    await dropAll();
    console.log('ลบข้อมูลเดิมทั้งหมดแล้ว จะสร้างข้อมูลตัวอย่างใหม่');
  }
  await initSchema();
  await migrateBranches();
  for (const o of await all('SELECT id FROM orgs')) await seedOrgRoles(o.id);
  const seeded = process.env.SEED_DEMO === '0' ? false : await seed();
  const superadmin = await ensureSuperadmin();
  const cleanSessions = () => run('DELETE FROM sessions WHERE expires_at < ?', Date.now()).catch((e) => console.error('ล้าง session ไม่สำเร็จ:', e.message));
  await cleanSessions();
  setInterval(cleanSessions, 3600 * 1000).unref();

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
    if (superadmin) {
      console.log('\n  บัญชีผู้ดูแลระบบ (Superadmin) — จดเก็บไว้ จะแสดงครั้งเดียว:');
      console.log(`    อีเมล:    ${superadmin.email}`);
      console.log(`    รหัสผ่าน: ${superadmin.password}`);
    }
    console.log('');
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(); closeDb().finally(() => process.exit(0)); });
}
main().catch((e) => {
  console.error(`\n  เชื่อมต่อ/เตรียมฐานข้อมูล PostgreSQL ไม่สำเร็จ: ${e.message}`);
  console.error('  ตรวจสอบว่า PostgreSQL ทำงานอยู่ และตั้งค่า DATABASE_URL ในไฟล์ .env ถูกต้อง\n');
  process.exit(1);
});
