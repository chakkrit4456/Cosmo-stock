// ชั้นเชื่อมฐานข้อมูล PostgreSQL ของ CosmoStock
// - ใช้ไดรเวอร์ `pg` (ไลบรารีเดียวของโปรเจกต์) ต่อผ่าน DATABASE_URL
// - สร้างตาราง/ดัชนีให้เองเมื่อเปิดระบบครั้งแรก (idempotent: เปิดซ้ำกี่ครั้งข้อมูลก็ไม่หาย)
import './env.js';
import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

// bigint / numeric ให้คืนเป็นตัวเลข JS (ค่าในระบบนี้ไม่เกิน 2^53)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

export const DATABASE_URL = process.env.DATABASE_URL
  || `postgresql://${process.env.PGUSER || 'cosmostock'}:${process.env.PGPASSWORD || 'cosmostock'}@${process.env.PGHOST || '127.0.0.1'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'cosmostock'}`;

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: /^(1|true|require)$/i.test(process.env.PGSSL || '') ? { rejectUnauthorized: false } : undefined,
});
// การเชื่อมต่อที่ว่างอยู่หลุด (เช่น postgres รีสตาร์ต) ต้องไม่ทำให้ทั้งโปรแกรมล้ม — pool จะต่อใหม่เอง
pool.on('error', (e) => console.error('[postgres] การเชื่อมต่อหลุด:', e.message));

const txStore = new AsyncLocalStorage();

const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
const bind = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const exec = (sql, p) => (txStore.getStore() || pool).query(toPg(sql), bind(p));

export const all = async (sql, ...p) => (await exec(sql, p)).rows;
export const get = async (sql, ...p) => (await exec(sql, p)).rows[0];
export const run = async (sql, ...p) => ({ changes: (await exec(sql, p)).rowCount });
// INSERT แล้วคืนค่า id ของแถวใหม่
export const insert = async (sql, ...p) => Number((await exec(`${sql} RETURNING id`, p)).rows[0].id);

// ธุรกรรม: เขียนทีละรายการ (advisory lock) เหมือนที่ SQLite เคยทำด้วย BEGIN IMMEDIATE
// จึงไม่มีสองคำขอตัดสต็อกพร้อมกันจนยอดเพี้ยน; query ภายใน callback ใช้ connection เดียวกันอัตโนมัติ
export async function tx(fn) {
  if (txStore.getStore()) return fn();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7301)');
    const r = await txStore.run(c, fn);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function closeDb() { await pool.end(); }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login TEXT,
  is_superadmin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS orgs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  expiry_days INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  org_id INTEGER REFERENCES orgs(id)
);
CREATE INDEX IF NOT EXISTS ix_stores_org ON stores(org_id);
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
  expires_at BIGINT NOT NULL
);
-- ผู้ดูแลระบบที่กำลังสวมสิทธิ์ผู้ใช้ของ session นี้ (NULL = เข้าใช้เองตามปกติ)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS impersonator_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  lot_no TEXT NOT NULL DEFAULT '',
  expiry TEXT,
  qty INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_lots_product ON lots(product_id);
CREATE TABLE IF NOT EXISTS movements (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL,
  pack_name TEXT,
  pack_count INTEGER
);
CREATE INDEX IF NOT EXISTS ix_movements_store_time ON movements(store_id, created_at);
CREATE INDEX IF NOT EXISTS ix_movements_product ON movements(product_id);
CREATE TABLE IF NOT EXISTS counters (
  store_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (store_id, type)
);
CREATE TABLE IF NOT EXISTS product_packs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  per_qty INTEGER NOT NULL CHECK (per_qty >= 2),
  barcode TEXT NOT NULL DEFAULT '',
  price DOUBLE PRECISION,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_packs_product ON product_packs(product_id);
CREATE INDEX IF NOT EXISTS ix_packs_barcode ON product_packs(barcode);
CREATE TABLE IF NOT EXISTS org_roles (
  org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('all', 'multi', 'single')),
  builtin INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, key)
);
CREATE TABLE IF NOT EXISTS org_role_perms (
  org_id INTEGER NOT NULL,
  role_key TEXT NOT NULL,
  perm TEXT NOT NULL,
  PRIMARY KEY (org_id, role_key, perm),
  FOREIGN KEY (org_id, role_key) REFERENCES org_roles(org_id, key) ON DELETE CASCADE
);
`;

// สร้างตาราง (ถ้ายังไม่มี) — ล็อกด้วย advisory lock กันหลายโปรเซสสร้างพร้อมกัน
export async function initSchema() {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(7302)');
    await c.query(SCHEMA);
    await c.query('SELECT pg_advisory_unlock(7302)');
  } finally {
    c.release();
  }
}

// ล้างข้อมูลทั้งหมด (ใช้กับ --reset เท่านั้น)
export async function dropAll() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

// หลังนำเข้าข้อมูลที่มี id กำกับมา ต้องเลื่อน sequence ให้ต่อจาก id สูงสุด
export async function syncSequences() {
  for (const t of ['users', 'orgs', 'stores', 'products', 'lots', 'movements', 'product_packs']) {
    await pool.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${t}), 0), 1), (SELECT COUNT(*) FROM ${t}) > 0)`);
  }
}
