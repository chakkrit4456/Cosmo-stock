// Unit tests ของฟังก์ชันล้วนใน lib.js — ไม่ต้องมีฐานข้อมูล
// รัน: npm test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY, HttpError, localDate, daysUntil, text, intVal, numVal, dateVal, isoVal, emailVal, passwordVal,
  likeArg, hashPassword, verifyPassword, hashToken, parseLotCode, statusOf, pall,
} from '../lib.js';

const httpError = (status, msg) => (e) => e instanceof HttpError && e.status === status && (!msg || msg.test(e.message));
const isoDay = (offsetDays) => localDate(new Date(Date.now() + offsetDays * DAY));

describe('text()', () => {
  test('ตัดช่องว่างหัวท้าย และแปลง null/undefined เป็นค่าว่าง', () => {
    assert.equal(text('  ลิปสติก  ', { label: 'ชื่อ' }), 'ลิปสติก');
    assert.equal(text(null, { label: 'ชื่อ' }), '');
    assert.equal(text(undefined, { label: 'ชื่อ' }), '');
    assert.equal(text(123, { label: 'ชื่อ' }), '123');
  });
  test('required ว่าง → 400', () => {
    assert.throws(() => text('   ', { label: 'ชื่อสินค้า', required: true }), httpError(400, /กรุณากรอกชื่อสินค้า/));
  });
  test('ยาวเกิน max → 400 แต่พอดี max ผ่าน', () => {
    assert.equal(text('a'.repeat(5), { label: 'SKU', max: 5 }), 'aaaaa');
    assert.throws(() => text('a'.repeat(6), { label: 'SKU', max: 5 }), httpError(400, /ยาวเกิน 5/));
  });
});

describe('intVal()', () => {
  test('รับตัวเลขและสตริงตัวเลข', () => {
    assert.equal(intVal(5, { label: 'จำนวน' }), 5);
    assert.equal(intVal('12', { label: 'จำนวน' }), 12);
    assert.equal(intVal(' 7 ', { label: 'จำนวน' }), 7);
  });
  test('ปฏิเสธทศนิยม ค่าว่าง ข้อความ และนอกช่วง', () => {
    for (const v of [1.5, '', '  ', 'abc', null, undefined, NaN, Infinity]) {
      assert.throws(() => intVal(v, { label: 'จำนวน', min: 1 }), httpError(400), `ค่า ${String(v)} ควรถูกปฏิเสธ`);
    }
    assert.throws(() => intVal(0, { label: 'จำนวน', min: 1 }), httpError(400));
    assert.throws(() => intVal(11, { label: 'จำนวน', min: 1, max: 10 }), httpError(400));
    assert.equal(intVal(10, { label: 'จำนวน', min: 1, max: 10 }), 10);
  });
});

describe('numVal()', () => {
  test('ค่าว่างเป็น 0 และปัดทศนิยม 2 ตำแหน่ง', () => {
    assert.equal(numVal('', { label: 'ราคา' }), 0);
    assert.equal(numVal(null, { label: 'ราคา' }), 0);
    assert.equal(numVal('199.999', { label: 'ราคา' }), 200);
    assert.equal(numVal(12.345, { label: 'ราคา' }), 12.35);
  });
  test('ติดลบหรือไม่ใช่ตัวเลข → 400', () => {
    assert.throws(() => numVal(-1, { label: 'ราคา' }), httpError(400, /ราคาไม่ถูกต้อง/));
    assert.throws(() => numVal('abc', { label: 'ราคา' }), httpError(400));
  });
});

describe('dateVal() / isoVal()', () => {
  test('dateVal รับเฉพาะ YYYY-MM-DD', () => {
    assert.equal(dateVal('2027-01-31', 'วันหมดอายุ'), '2027-01-31');
    assert.equal(dateVal('', 'วันหมดอายุ'), null);
    assert.equal(dateVal(null, 'วันหมดอายุ'), null);
    for (const v of ['31/01/2027', '2027-1-31', '2027-13-01', 'tomorrow', 20270131]) {
      assert.throws(() => dateVal(v, 'วันหมดอายุ'), httpError(400), `ค่า ${v} ควรถูกปฏิเสธ`);
    }
  });
  test('isoVal แปลงเป็น ISO และปฏิเสธค่าที่อ่านไม่ได้', () => {
    assert.equal(isoVal('2026-10-15T00:00:00Z', 'ตั้งแต่'), '2026-10-15T00:00:00.000Z');
    assert.equal(isoVal('', 'ตั้งแต่'), null);
    assert.throws(() => isoVal('not-a-date', 'ตั้งแต่'), httpError(400));
  });
});

describe('emailVal() / passwordVal()', () => {
  test('อีเมลถูกแปลงเป็นตัวพิมพ์เล็กและตรวจรูปแบบ', () => {
    assert.equal(emailVal('  Admin@CosmoStock.App '), 'admin@cosmostock.app');
    for (const v of ['', 'admin', 'admin@', 'a b@x.co', 'admin@host']) {
      assert.throws(() => emailVal(v), httpError(400), `อีเมล "${v}" ควรถูกปฏิเสธ`);
    }
  });
  test('รหัสผ่านต้องยาว 8–200 ตัว', () => {
    assert.equal(passwordVal('12345678'), '12345678');
    assert.throws(() => passwordVal('1234567'), httpError(400, /อย่างน้อย 8/));
    assert.throws(() => passwordVal(null), httpError(400));
    assert.throws(() => passwordVal('x'.repeat(201)), httpError(400, /ยาวเกินไป/));
  });
});

describe('hashPassword() / verifyPassword() / hashToken()', () => {
  test('ตรวจรหัสที่ถูกผ่าน และรหัสผิดไม่ผ่าน', () => {
    const h = hashPassword('Demo@2569');
    assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    assert.equal(verifyPassword('Demo@2569', h), true);
    assert.equal(verifyPassword('demo@2569', h), false);
    assert.equal(verifyPassword('', h), false);
  });
  test('salt สุ่มทุกครั้ง — hash ของรหัสเดียวกันไม่ซ้ำกัน', () => {
    assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
  });
  test('ค่า hash ที่เสียหรือผิดรูปแบบ → false (ไม่ throw)', () => {
    for (const bad of ['', 'plain', 'md5$aa$bb', 'scrypt$$', null, undefined]) assert.equal(verifyPassword('x', bad), false);
  });
  test('hashToken เป็น sha256 hex และคงที่', () => {
    assert.equal(hashToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('likeArg()', () => {
  test('ครอบด้วย % และ escape อักขระพิเศษของ LIKE', () => {
    assert.equal(likeArg('ลิป'), '%ลิป%');
    assert.equal(likeArg('50%_off\\'), '%50\\%\\_off\\\\%');
  });
});

describe('parseLotCode()', () => {
  test('อ่าน QR ล็อตที่ถูกต้อง (รวมอักขระที่ encode)', () => {
    assert.deepEqual(parseLotCode('CSL1|SK-VC30|L2401|2027-03-31'), { sku: 'SK-VC30', lotNo: 'L2401', expiry: '2027-03-31' });
    assert.deepEqual(parseLotCode('CSL1|SK%7CA|L%201|'), { sku: 'SK|A', lotNo: 'L 1', expiry: null });
    assert.deepEqual(parseLotCode('CSL1|MU-LP01||2027-01-01'), { sku: 'MU-LP01', lotNo: '', expiry: '2027-01-01' });
  });
  test('ไม่ใช่ QR ล็อต หรือข้อมูลไม่ครบ → null', () => {
    for (const code of ['8851234567890', 'CSL2|A|B|', 'CSL1|A|B', 'CSL1||L1|', 'CSL1|A||', 'CSL1|A|L1|31-12-2027', 'CSL1|A|%E0%A4|']) {
      assert.equal(parseLotCode(code), null, `"${code}" ควรได้ null`);
    }
  });
});

describe('statusOf()', () => {
  const p = (qty, reorder_point, next_expiry = null) => ({ qty, reorder_point, next_expiry });
  test('หมดสต็อกสำคัญที่สุด', () => {
    assert.equal(statusOf(p(0, 5, isoDay(-3)), 30), 'out');
    assert.equal(statusOf(p(-1, 0), 30), 'out');
  });
  test('หมดอายุแล้ว มาก่อนใกล้หมด', () => assert.equal(statusOf(p(2, 5, isoDay(-1)), 30), 'expired'));
  test('ถึงจุดสั่งซื้อ (เท่ากับก็นับ)', () => {
    assert.equal(statusOf(p(5, 5), 30), 'low');
    assert.equal(statusOf(p(5, 5, isoDay(10)), 30), 'low');
  });
  test('ใกล้หมดอายุภายในจำนวนวันที่ตั้งไว้', () => {
    assert.equal(statusOf(p(50, 5, isoDay(30)), 30), 'exp');
    assert.equal(statusOf(p(50, 5, isoDay(0)), 30), 'exp');
    assert.equal(statusOf(p(50, 5, isoDay(31)), 30), 'ok');
  });
  test('ปกติ', () => assert.equal(statusOf(p(50, 5), 30), 'ok'));
});

describe('วันที่', () => {
  test('localDate ใช้เวลาท้องถิ่นและเติม 0', () => assert.equal(localDate(new Date(2027, 0, 5, 23, 59)), '2027-01-05'));
  test('daysUntil นับจากวันนี้', () => {
    assert.equal(daysUntil(isoDay(0)), 0);
    assert.equal(daysUntil(isoDay(7)), 7);
    assert.equal(daysUntil(isoDay(-2)), -2);
  });
});

test('pall คงลำดับผลลัพธ์', async () => {
  const out = await pall([30, 10, 20], (ms) => new Promise((r) => setTimeout(() => r(ms), ms)));
  assert.deepEqual(out, [30, 10, 20]);
});
