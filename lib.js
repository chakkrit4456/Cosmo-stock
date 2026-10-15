// ฟังก์ชันล้วน (ไม่แตะฐานข้อมูล) แยกจาก server.js เพื่อให้ทดสอบแบบ unit test ได้
import crypto from 'node:crypto';

export const DAY = 86400000;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const nowIso = () => new Date().toISOString();
// map แบบ async (ลำดับถูกต้อง รอครบทุกตัว)
export const pall = (arr, fn) => Promise.all(arr.map(fn));

export function localDate(d = new Date()) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + 'T00:00:00') - today) / DAY);
}

export function text(v, { label, max = 200, required = false } = {}) {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) throw new HttpError(400, `กรุณากรอก${label}`);
  if (s.length > max) throw new HttpError(400, `${label}ยาวเกิน ${max} ตัวอักษร`);
  return s;
}

export function intVal(v, { label, min = 0, max = 1e7 }) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label}ต้องเป็นจำนวนเต็ม ${min} ขึ้นไป`);
  return n;
}

export function numVal(v, { label, min = 0, max = 1e9 }) {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return Math.round(n * 100) / 100;
}

export function dateVal(v, label) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) {
    throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  }
  return v;
}

export function isoVal(v, label) {
  if (v == null || v === '') return null;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new HttpError(400, `${label}ไม่ถูกต้อง`);
  return new Date(t).toISOString();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function emailVal(v) {
  const s = text(v, { label: 'อีเมล', max: 120, required: true }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw new HttpError(400, 'รูปแบบอีเมลไม่ถูกต้อง');
  return s;
}

export function passwordVal(v, label = 'รหัสผ่าน') {
  const s = v == null ? '' : String(v);
  if (s.length < 8) throw new HttpError(400, `${label}ต้องมีอย่างน้อย 8 ตัวอักษร`);
  if (s.length > 200) throw new HttpError(400, `${label}ยาวเกินไป`);
  return s;
}

export const likeArg = (q) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const k = crypto.scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(key, 'hex');
  return k.length === expected.length && crypto.timingSafeEqual(k, expected);
}

export const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Lot QR payload: CSL1|<sku>|<lotNo>|<expiry YYYY-MM-DD or empty>, each field URI-encoded.
export const LOT_CODE_PREFIX = 'CSL1|';
export function parseLotCode(code) {
  if (!code.startsWith(LOT_CODE_PREFIX)) return null;
  const parts = code.slice(LOT_CODE_PREFIX.length).split('|');
  if (parts.length !== 3) return null;
  let sku, lotNo, expiry;
  try { [sku, lotNo, expiry] = parts.map(decodeURIComponent); } catch { return null; }
  if (!sku || (!lotNo && !expiry) || (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry))) return null;
  return { sku, lotNo, expiry: expiry || null };
}

export function statusOf(p, expiryDays) {
  const d = p.next_expiry ? daysUntil(p.next_expiry) : null;
  if (p.qty <= 0) return 'out';
  if (d !== null && d < 0) return 'expired';
  if (p.qty <= p.reorder_point) return 'low';
  if (d !== null && d <= expiryDays) return 'exp';
  return 'ok';
}
