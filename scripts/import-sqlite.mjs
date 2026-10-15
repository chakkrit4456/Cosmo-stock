// นำข้อมูลเดิมจาก SQLite (data/cosmostock.db ของเวอร์ชันก่อน) เข้า PostgreSQL ครั้งเดียว
//   วิธีใช้:  npm run import-sqlite                      (ใช้ไฟล์ data/cosmostock.db)
//            npm run import-sqlite -- /path/to/cosmostock.db
// ปลอดภัย: ถ้า PostgreSQL มีผู้ใช้อยู่แล้วจะไม่นำเข้า (กันข้อมูลซ้ำ/ทับ) และไฟล์ SQLite ไม่ถูกแก้ไข
import '../env.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { pool, tx, run, get, initSchema, syncSequences, closeDb } from '../db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(ROOT, 'data', 'cosmostock.db'));
if (!fs.existsSync(file)) { console.error(`ไม่พบไฟล์ SQLite: ${file}`); process.exit(1); }

const src = new DatabaseSync(file, { readOnly: true });
const hasTable = (t) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const cols = (t) => new Set(src.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
const rows = (t) => (hasTable(t) ? src.prepare(`SELECT * FROM ${t}`).all() : []);

async function copy(table, list, columns, defaults = {}) {
  const have = hasTable(table) ? cols(table) : new Set();
  const use = columns.filter((c) => have.has(c) || c in defaults);
  if (!list.length) return 0;
  const sql = `INSERT INTO ${table}(${use.join(', ')}) VALUES (${use.map(() => '?').join(', ')})`;
  for (const r of list) await run(sql, ...use.map((c) => (have.has(c) && r[c] !== undefined ? r[c] : defaults[c] ?? null)));
  return list.length;
}

try {
  await initSchema();
  if (Number((await get('SELECT COUNT(*) AS c FROM users')).c) > 0) {
    console.error('PostgreSQL มีข้อมูลผู้ใช้อยู่แล้ว — ยกเลิกการนำเข้าเพื่อไม่ให้ข้อมูลซ้ำ\n(ถ้าต้องการนำเข้าใหม่จริง ๆ ให้ล้างฐานข้อมูลก่อนด้วย npm run reset -- --yes แล้วตั้ง SEED_DEMO=0)');
    process.exit(1);
  }

  const users = rows('users'), stores = rows('stores');
  let orgs = rows('orgs');
  // ฐานข้อมูลรุ่นเก่ามากที่ยังไม่มี org: สาขาที่มีเจ้าของคนเดียวกันถือเป็นร้านเดียวกัน
  const orphan = stores.filter((s) => s.org_id == null);
  if (orphan.length) {
    const parent = new Map(orphan.map((s) => [s.id, s.id]));
    const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
    const ownerRows = rows('members').filter((m) => m.role === 'owner');
    const byUser = new Map();
    for (const m of ownerRows) { if (parent.has(m.store_id)) { if (!byUser.has(m.user_id)) byUser.set(m.user_id, []); byUser.get(m.user_id).push(m.store_id); } }
    for (const ids of byUser.values()) for (const id of ids.slice(1)) parent.set(find(id), find(ids[0]));
    let nextOrg = Math.max(0, ...orgs.map((o) => o.id)) + 1;
    const orgOfRoot = new Map();
    for (const s of orphan) {
      const root = find(s.id);
      if (!orgOfRoot.has(root)) {
        const first = orphan.find((x) => x.id === root);
        orgOfRoot.set(root, nextOrg);
        orgs.push({ id: nextOrg++, name: String(first.name).split(' · ')[0], created_at: first.created_at });
      }
      s.org_id = orgOfRoot.get(root);
    }
  }

  const counts = {};
  await tx(async () => {
    counts.users = await copy('users', users, ['id', 'email', 'name', 'pass', 'created_at', 'last_login', 'is_superadmin'], { is_superadmin: 0 });
    counts.orgs = await copy('orgs', orgs, ['id', 'name', 'created_at']);
    counts.stores = await copy('stores', stores, ['id', 'name', 'expiry_days', 'created_at', 'org_id'], { expiry_days: 60 });
    counts.members = await copy('members', rows('members'), ['store_id', 'user_id', 'role', 'created_at']);
    counts.products = await copy('products', rows('products'), ['id', 'store_id', 'sku', 'name', 'barcode', 'category', 'unit', 'cost', 'price', 'reorder_point', 'track_expiry', 'image', 'qty', 'deleted_at', 'created_at', 'updated_at']);
    counts.lots = await copy('lots', rows('lots'), ['id', 'product_id', 'lot_no', 'expiry', 'qty', 'received_at']);
    counts.movements = await copy('movements', rows('movements'), ['id', 'store_id', 'product_id', 'type', 'doc_no', 'qty', 'before_qty', 'after_qty', 'lot_info', 'expiry', 'note', 'user_id', 'user_name', 'created_at', 'pack_name', 'pack_count']);
    counts.counters = await copy('counters', rows('counters'), ['store_id', 'type', 'n']);
    counts.packs = await copy('product_packs', rows('product_packs'), ['id', 'product_id', 'name', 'per_qty', 'barcode', 'price', 'sort'], { sort: 0 });
    counts.roles = await copy('org_roles', rows('org_roles'), ['org_id', 'key', 'name', 'scope', 'builtin', 'sort'], { builtin: 0, sort: 0 });
    counts.perms = await copy('org_role_perms', rows('org_role_perms'), ['org_id', 'role_key', 'perm']);
    // session เดิมไม่นำมา — ทุกคนล็อกอินใหม่หนึ่งครั้ง
  });
  await syncSequences();

  // ตรวจนับเทียบกับต้นฉบับ
  let bad = 0;
  for (const [pgT, sqT] of [['users', 'users'], ['stores', 'stores'], ['products', 'products'], ['lots', 'lots'], ['movements', 'movements'], ['product_packs', 'product_packs']]) {
    const a = hasTable(sqT) ? src.prepare(`SELECT COUNT(*) AS c FROM ${sqT}`).get().c : 0;
    const b = Number((await get(`SELECT COUNT(*) AS c FROM ${pgT}`)).c);
    const ok = a === b;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${pgT}: SQLite ${a} → PostgreSQL ${b}`);
  }
  if (bad) { console.error('จำนวนแถวไม่ตรงกัน!'); process.exitCode = 1; }
  else console.log('\nนำเข้าข้อมูลเสร็จเรียบร้อย — เปิดระบบด้วย npm start ได้เลย (ผู้ใช้ทุกคนต้องล็อกอินใหม่หนึ่งครั้ง)');
} catch (e) {
  console.error('นำเข้าไม่สำเร็จ (ไม่มีข้อมูลใดถูกบันทึกครึ่งทาง):', e.message);
  process.exitCode = 1;
} finally {
  src.close();
  await closeDb();
}
