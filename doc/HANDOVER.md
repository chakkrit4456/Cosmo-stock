# CosmoStock — เอกสารโปรเจกต์ฉบับส่งมอบ (Technical Handover)

> เอกสารนี้อธิบาย **ระบบที่สร้างเสร็จแล้วจริง** ทั้งหมด ได้แก่ การทำงาน หลักการ เครื่องมือ ฐานข้อมูล API ความปลอดภัย การดูแลระบบ และแนวทางขยายระบบ สำหรับผู้ที่รับช่วงต่อ
>
> - คู่มือผู้ใช้: [USER_GUIDE.md](USER_GUIDE.md) และ [user-guide/](user-guide/)
> - [PROJECT_SPEC.md](PROJECT_SPEC.md) คือ **เอกสารแผนตั้งต้น** ก่อนพัฒนา ซึ่งเสนอ Next.js + Prisma + PostgreSQL แต่ระบบจริงสร้างด้วย Node.js ล้วน + SQLite (ดูความต่างในหัวข้อ 2.2) ถ้าข้อมูลสองไฟล์ขัดกัน ให้ยึด **ไฟล์นี้และโค้ด** เป็นหลัก


> ## ⚠️ อัปเดต: ฐานข้อมูลเปลี่ยนจาก SQLite เป็น PostgreSQL แล้ว
> ระบบเวอร์ชันนี้เก็บข้อมูลใน **PostgreSQL** (ไม่ใช้ Docker — รันบนเซิร์ฟเวอร์ตรง ๆ) ข้อมูลอยู่ในฐานข้อมูลถาวร เปิด/ปิด/รีสตาร์ตระบบกี่ครั้งก็ไม่หาย
> รายละเอียดการติดตั้ง การสำรอง และการนำข้อมูลเดิมเข้า อยู่ที่ **หัวข้อ 20** ท้ายเอกสาร ส่วนข้อความในเอกสารที่ยังพูดถึง SQLite / `node:sqlite` (เช่น ผังสถาปัตยกรรมและตารางเทียบในระยะที่ 4) เป็นประวัติของเวอร์ชันก่อน ให้ยึดหัวข้อ 20 และไฟล์ `db.js` เป็นหลัก

---

## สารบัญ

1. [ภาพรวมระบบ](#1-ภาพรวมระบบ)
2. [สถานะปัจจุบัน](#2-สถานะปัจจุบัน)
3. [เครื่องมือและเทคโนโลยี](#3-เครื่องมือและเทคโนโลยี)
4. [โครงสร้างไฟล์](#4-โครงสร้างไฟล์)
5. [การติดตั้งและรัน](#5-การติดตั้งและรัน)
6. [สถาปัตยกรรม](#6-สถาปัตยกรรม)
7. [Multi-tenant: ธุรกิจ สาขา สมาชิก](#7-multi-tenant-ธุรกิจ-สาขา-สมาชิก)
8. [บทบาทและสิทธิ์](#8-บทบาทและสิทธิ์)
9. [ฐานข้อมูล](#9-ฐานข้อมูล)
10. [หลักการทำงานของสต็อก](#10-หลักการทำงานของสต็อก)
11. [Authentication และความปลอดภัย](#11-authentication-และความปลอดภัย)
12. [API Reference](#12-api-reference)
13. [Frontend](#13-frontend)
14. [ข้อมูลตัวอย่าง (Seed)](#14-ข้อมูลตัวอย่าง-seed)
15. [การดูแลระบบ (Operations)](#15-การดูแลระบบ-operations)
16. [การ Deploy](#16-การ-deploy)
17. [แนวทางพัฒนาต่อ (สูตรเพิ่มฟีเจอร์)](#17-แนวทางพัฒนาต่อ-สูตรเพิ่มฟีเจอร์)
18. [ข้อจำกัดและหนี้ทางเทคนิคที่รู้อยู่](#18-ข้อจำกัดและหนี้ทางเทคนิคที่รู้อยู่)
19. [แผนการ Scale](#19-แผนการ-scale)
20. [การทดสอบ](#20-การทดสอบ)
21. [Checklist สำหรับผู้รับช่วงต่อ](#21-checklist-สำหรับผู้รับช่วงต่อ)

---

## 1. ภาพรวมระบบ

**CosmoStock** เป็นเว็บแอประบบจัดการคลังสินค้าเครื่องสำอาง สำหรับร้านขนาดเล็กถึงกลางที่มีพนักงานหลายคนและอาจมีหลายสาขา

| หัวข้อ | รายละเอียด |
| --- | --- |
| ปัญหาที่แก้ | สินค้ามีหลายล็อตและมีวันหมดอายุ, ไม่รู้ล่วงหน้าว่าอะไรใกล้หมด, ไม่มีประวัติว่าใครทำอะไร, ต้องจำกัดสิทธิ์พนักงาน |
| ผู้ใช้ | เจ้าของร้าน, ผู้จัดการ, พนักงานคลัง, ผู้ดูอย่างเดียว |
| อุปกรณ์ | iPhone, Android, iPad, Android Tablet, Desktop (Responsive ตั้งแต่ 320px) |
| ภาษา UI | ภาษาไทยทั้งหมด, เงินบาท (฿), วันที่แบบไทย (พ.ศ.) |
| โทนดีไซน์ | Pastel pink / Lavender / White |

### ฟังก์ชันหลัก
| ฟังก์ชัน | สถานะ |
| --- | :-: |
| Login / Logout / สมัครร้าน / จดจำฉัน | ✅ |
| ผู้ใช้และสิทธิ์ 4 บทบาท, เชิญ, เปลี่ยนบทบาท, รีเซ็ตรหัสผ่าน, นำออก | ✅ |
| แยกข้อมูลแต่ละร้าน + หลายสาขาในธุรกิจเดียว | ✅ |
| Dashboard (KPI, กราฟ 6 เดือน, แจ้งเตือน, ล่าสุด, มูลค่าตามหมวด) | ✅ |
| เพิ่ม/แก้ไข/ลบสินค้า (soft delete), รูปสินค้า, หมวดหมู่ | ✅ |
| ขนาดบรรจุหลายระดับ (แพ็ค/กล่อง/ลัง) พร้อมบาร์โค้ดแยก | ✅ |
| รับเข้า / จ่ายออก (FEFO) / ปรับยอด พร้อมเลขเอกสาร | ✅ |
| ล็อตและวันหมดอายุ | ✅ |
| ประวัติการเคลื่อนไหว (แก้ไขไม่ได้) + ตัวกรอง + CSV | ✅ |
| แจ้งเตือนสต็อกต่ำ/หมด และใกล้หมดอายุ/หมดอายุ | ✅ |
| รายงาน 4 แบบ + CSV + พิมพ์/PDF | ✅ |
| ค้นหาสินค้า, สแกน Barcode/QR ด้วยกล้อง, รองรับเครื่องยิงบาร์โค้ด | ✅ |
| สร้าง QR และพิมพ์ฉลาก (สินค้า / หน่วยบรรจุ / ต่อล็อต) | ✅ |
| PWA manifest (เพิ่มลงหน้าจอโฮม) | ✅ (ยังไม่มี offline) |

---

## 2. สถานะปัจจุบัน

### 2.1 สรุป
- ระบบ **ใช้งานได้จริงครบทุกฟังก์ชันที่กำหนด** รันบนเซิร์ฟเวอร์เครื่องเดียว (Node.js process เดียว + PostgreSQL)
- dependency จาก npm มีตัวเดียวคือ **`pg`** (ไดรเวอร์ PostgreSQL) ที่เหลือใช้โมดูลในตัวของ Node.js
- ไลบรารีฝั่งเบราว์เซอร์ 2 ตัว (สแกน, สร้าง QR) และฟอนต์ โหลดจาก CDN ตอนใช้งาน
- **ยังไม่มี automated test**, ยังไม่มี CI/CD, ยังไม่มีไฟล์ config สำหรับ deploy
- Git มี commit เดียว (`first commit`) และ **ยังไม่มี `.gitignore`** ทำให้ไฟล์ฐานข้อมูล `data/*.db*` ถูก commit ไปด้วย (ดูหัวข้อ 18)

### 2.2 ความต่างจากแผนใน PROJECT_SPEC.md
| เรื่อง | แผน (PROJECT_SPEC) | ระบบจริง |
| --- | --- | --- |
| Framework | Next.js + TypeScript | Node.js `http` ล้วน + Vanilla JS (SPA) |
| Database | PostgreSQL + Prisma | SQLite (`node:sqlite`) + SQL ตรง |
| Password hash | bcrypt | `scrypt` (ในตัว Node.js) |
| Validation | Zod | ฟังก์ชัน validate เขียนเอง (`text`, `intVal`, `numVal`, …) |
| Tenant | `shopId` ในทุกตาราง | `orgs` → `stores` (สาขา) → `members`; ตารางลูกอ้างผ่าน `store_id` / `product_id` |
| หมวดหมู่ | ตาราง Category | ข้อความอิสระในคอลัมน์ `products.category` + ค่าเริ่มต้น 5 หมวด |
| สถานะผู้ใช้ | ACTIVE / INVITED / DISABLED | ไม่มี (มีสมาชิก = ใช้ได้, นำออก = ใช้ไม่ได้) |
| ลบสินค้า | ลบจริงถ้าไม่มีประวัติ, ไม่งั้น archive | soft delete เสมอ (`deleted_at`) |
| เลขเอกสาร | `RCV-0001` | `RCV-00001` (5 หลัก) |
| Deploy | Vercel / Render | ต้องใช้เซิร์ฟเวอร์ที่มี disk ถาวร (Vercel ใช้ไม่ได้, ดูหัวข้อ 16) |
| ฟีเจอร์เพิ่ม | — | หลายสาขา, ขนาดบรรจุ, ดูยอดข้ามสาขาตอนสแกน, พิมพ์ฉลาก |

---

## 3. เครื่องมือและเทคโนโลยี

| ชั้น | เทคโนโลยี | ใช้ทำอะไร / เหตุผล |
| --- | --- | --- |
| Runtime | **Node.js ≥ 22.13** (ทดสอบบน v22/v24) | รันเซิร์ฟเวอร์ |
| HTTP server | `node:http` | Router เขียนเอง (regex) ไม่ต้องใช้ Express |
| Database | **PostgreSQL** ผ่านไดรเวอร์ `pg` (ดู `db.js`) | ข้อมูลถาวรบนเซิร์ฟเวอร์, รองรับ transaction และใช้งานพร้อมกันหลายคน |
| Crypto | `node:crypto` (`scrypt`, `randomBytes`, `sha256`, `timingSafeEqual`) | hash รหัสผ่านและ session token |
| Frontend | **Vanilla JavaScript SPA** (`public/app.js`), hash routing | ไม่ต้อง build, แก้แล้ว refresh ได้ทันที |
| CSS | Design System “Industry” (`_ds/.../styles.css`) + `public/app.css` | design tokens สีชมพู/ลาเวนเดอร์, responsive |
| Icons | Custom element `<cs-i>` จาก `icons.js` (ชุด Lucide) | ไอคอน SVG |
| Fonts | Google Fonts: Noto Sans Thai | ฟอนต์ไทย |
| Barcode scan | [`html5-qrcode@2.3.8`](https://github.com/mebjas/html5-qrcode) (unpkg CDN, lazy load) | สแกนผ่านกล้อง ใช้ `BarcodeDetector` เมื่อเบราว์เซอร์รองรับ |
| QR generate | [`qrcode-generator@1.4.4`](https://github.com/kazuhikoarase/qrcode-generator) (unpkg CDN, lazy load) | QR ในหน้าสินค้าและฉลาก |
| CSV | เขียนเอง (UTF-8 BOM) | Excel แสดงภาษาไทยถูก |
| Print | `@media print` + `window.print()` | รายงาน PDF และฉลาก |
| Design mockup | `CosmoStock UI.dc.html` | ชุดหน้าจอต้นแบบ (ไม่ใช่ส่วนของแอป) |

**เครื่องมือที่ผู้พัฒนาต้องมี**: Node.js 22.13+, Git, editor ใดก็ได้ และ (ไม่บังคับ) [DB Browser for SQLite](https://sqlitebrowser.org/) หรือ `sqlite3` CLI สำหรับเปิดดูฐานข้อมูล

---

## 4. โครงสร้างไฟล์

```text
CosmoStock/
├─ server.js                 ทั้ง backend: schema, migration, domain logic, API, static server, seed (~1,400 บรรทัด)
├─ package.json              scripts: start, reset (ไม่มี dependencies)
├─ icons.js                  <cs-i> icon web component (เสิร์ฟที่ /icons.js)
├─ public/                   ไฟล์ที่เสิร์ฟให้เบราว์เซอร์
│  ├─ index.html             HTML shell เดียวของ SPA
│  ├─ app.js                 ทั้ง frontend: routing, views, API client (~1,800 บรรทัด)
│  ├─ app.css                สไตล์ของแอป + responsive + print
│  ├─ manifest.webmanifest   PWA manifest
│  ├─ logo.png, logo-192.png, favicon.png   โลโก้
│  └─ favicon.svg            ไอคอนเก่า (ไม่ถูกใช้แล้ว)
├─ _ds/industry-…/styles.css Design system (เสิร์ฟที่ /ds.css)
├─ db.js / env.js            ชั้นเชื่อม PostgreSQL + สร้างตารางอัตโนมัติ / โหลดไฟล์ .env
├─ deploy/                   install.sh (ติดตั้งบนเซิร์ฟเวอร์ ไม่ใช้ Docker), backup.sh (สำรองข้อมูล)
├─ scripts/import-sqlite.mjs นำข้อมูล SQLite เดิมเข้า PostgreSQL ครั้งเดียว
├─ data/                     (เลิกใช้แล้ว — เป็นที่เก็บไฟล์ SQLite เดิม ใช้เป็นต้นทางตอนนำเข้า)
├─ doc/                      เอกสาร (ไฟล์นี้, คู่มือผู้ใช้, PROJECT_SPEC)
├─ uploads/                  ภาพอ้างอิงดีไซน์ (ไม่ใช่ไฟล์ที่ผู้ใช้อัปโหลด)
├─ CosmoStock UI.dc.html     Mockup ดีไซน์
├─ README.md                 วิธีรันแบบย่อ
└─ รายละเอียดโปรเจก.txt       requirement ตั้งต้นจากผู้สั่งงาน
```

**ลำดับโค้ดใน `server.js`** (อ่านจากบนลงล่างได้เลย)

| ส่วน | เนื้อหา |
| --- | --- |
| config | path, env vars, `ROLES`, `PERMS`, `can()` |
| database | `CREATE TABLE IF NOT EXISTS …`, migration แบบเพิ่มคอลัมน์, migration สร้าง `orgs` |
| helpers | `prep/all/get/run` (cache prepared statement), `tx()` transaction, validator, password hash |
| stock domain | `nextDoc`, `addToLot`, `takeFromLots` (FEFO), `moveStock`, `statusOf`, `listProducts`, `buildAlerts`, `listMovements` |
| sessions | cookie, `createSession`, `loadSession`, login throttle |
| routing | `api(method, pattern, opts, handler)`, `memberships`, `roleIn` |
| endpoints | auth, me, stores, dashboard, products, packs, movements, alerts, reports, members |
| http server | `handleApi` (auth → store → perm), `serveStatic`, security headers |
| seed | ข้อมูลตัวอย่าง (สร้างเมื่อยังไม่มีผู้ใช้เลย) |

**ลำดับโค้ดใน `public/app.js`**: formatting → API client → UI primitives (toast, modal, scanner, QR, label printing) → routing → shell (เมนู) → auth views → dashboard → products → product form → stock movements → history → alerts → reports → users → settings/more → boot

---

## 5. การติดตั้งและรัน

```bash
# ต้องมี Node.js 22.13 ขึ้นไป (ตรวจด้วย node --version) ไม่ต้อง npm install
npm start          # เปิดเซิร์ฟเวอร์ที่ http://localhost:3000
npm run reset      # ลบฐานข้อมูลแล้วสร้างข้อมูลตัวอย่างใหม่ (ข้อมูลจริงหายหมด!)
```

ตอนเริ่ม เซิร์ฟเวอร์จะพิมพ์ URL สำหรับเครื่องนี้และสำหรับมือถือในวง LAN และถ้าเพิ่งสร้างข้อมูลตัวอย่าง จะพิมพ์บัญชีแอดมินให้ด้วย

### Environment variables
| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
| --- | --- | --- |
| `PORT` | `3000` | พอร์ต HTTP |
| `HOST` | `0.0.0.0` | interface ที่ listen (`127.0.0.1` = เข้าได้เฉพาะเครื่องนี้) |
| `DATA_DIR` | `./data` | โฟลเดอร์เก็บไฟล์ฐานข้อมูล (บน cloud ต้องชี้ไป disk ถาวร) |
| `ADMIN_EMAIL` | `admin@cosmostock.app` | อีเมลแอดมินของข้อมูลตัวอย่าง (มีผลเฉพาะตอน seed ครั้งแรก) |
| `ADMIN_PASSWORD` | `CosmoAdmin@2569` | รหัสผ่านแอดมินของข้อมูลตัวอย่าง (มีผลเฉพาะตอน seed ครั้งแรก) |
| `TZ` | เวลาของเครื่อง | **ควรตั้งเป็น `Asia/Bangkok`** บนเซิร์ฟเวอร์ เพราะการคำนวณ “อีกกี่วันหมดอายุ” ใช้วันที่ตามเวลาเครื่องเซิร์ฟเวอร์ |

ตัวอย่าง (PowerShell): `$env:PORT=8080; $env:TZ='Asia/Bangkok'; npm start`
ตัวอย่าง (bash): `PORT=8080 TZ=Asia/Bangkok npm start`

> Seed จะทำงานเฉพาะเมื่อฐานข้อมูล **ยังไม่มีผู้ใช้เลย** ถ้าใช้งานจริงและไม่ต้องการข้อมูลตัวอย่าง ให้แก้ `seed()` ใน `server.js` ให้สร้างแค่บัญชีแอดมิน หรือเริ่มด้วยการสมัครร้านใหม่แล้วลบร้านตัวอย่างทิ้ง (ดูหัวข้อ 15.6)

### เปิดกล้องสแกนบนมือถือ (ต้องใช้ HTTPS)
เบราว์เซอร์อนุญาตกล้องเฉพาะ `https://` หรือ `localhost` ถ้าทดสอบในวง LAN ด้วย `http://192.168.x.x` กล้องจะใช้ไม่ได้ ทางเลือก:
1. **Tunnel** (ง่ายที่สุด): `cloudflared tunnel --url http://localhost:3000` หรือ `ngrok http 3000` แล้วใช้ URL `https://…` ที่ได้
2. **Reverse proxy ในเครื่อง**: Caddy + mkcert ทำ HTTPS ให้ IP/ชื่อเครื่องในวง LAN
3. **Deploy ขึ้น cloud** ที่มี HTTPS ให้อัตโนมัติ (หัวข้อ 16)

Cookie จะใส่ `Secure` ให้อัตโนมัติเมื่อ request มาทาง HTTPS (ดูจาก `req.socket.encrypted` หรือ header `X-Forwarded-Proto: https`)

---

## 6. สถาปัตยกรรม

```text
┌────────────── Browser (มือถือ / แท็บเล็ต / เดสก์ท็อป) ──────────────┐
│ index.html + app.js (SPA, hash routing #/...)                       │
│   fetch('/api/...', { credentials, headers: { 'X-CS': '1' } })       │
│   lazy-load: html5-qrcode, qrcode-generator (unpkg)                 │
└───────────────────────────────┬────────────────────────────────────┘
                                │ HTTP(S)  cookie: cs_sid
┌───────────────────────────────▼────────────────────────────────────┐
│ server.js  (Node.js process เดียว)                                   │
│  ├─ security headers (CSP, X-Frame-Options, nosniff, ...)           │
│  ├─ /api/*  → handleApi                                             │
│  │     1. หา route (method + regex)                                  │
│  │     2. ถ้าไม่ใช่ GET ต้องมี header X-CS: 1  (กัน CSRF)             │
│  │     3. อ่าน JSON body (≤ 3 MB)                                    │
│  │     4. auth: loadSession(cookie) → 401                           │
│  │     5. store: roleIn(user, session.store_id) → 403               │
│  │     6. perm: can(role, perm) → 403                                │
│  │     7. handler(ctx) → JSON                                       │
│  └─ อื่นๆ → serveStatic (public/, /icons.js, /ds.css; path อื่น → index.html) │
└───────────────────────────────┬────────────────────────────────────┘
                                │ pg (async, connection pool)
┌───────────────────────────────▼────────────────────────────────────┐
│ PostgreSQL  (DATABASE_URL, foreign keys, advisory lock ต่อธุรกรรม)  │
└────────────────────────────────────────────────────────────────────┘
```

**หลักการออกแบบ**
1. **Server เป็นแหล่งความจริงเดียว**: ตรวจสิทธิ์ ตรวจ input และคำนวณยอดฝั่ง server ทั้งหมด UI แค่ซ่อนปุ่มตามสิทธิ์
2. **Tenant มาจาก session เท่านั้น**: `store_id` อยู่ในตาราง `sessions` ไม่รับจาก query/body (ยกเว้นตอนขอสลับร้าน ซึ่งตรวจสิทธิ์ก่อน)
3. **ทุกการเปลี่ยนยอดผ่าน `moveStock()` ใน transaction เดียว** และสร้างแถวใน `movements` เสมอ
4. **ธุรกรรมเขียนทีละรายการ**: `tx()` ใน `db.js` ขอ `pg_advisory_xact_lock` ก่อนเขียน จึงไม่มีสองคำขอตัดสต็อกพร้อมกันจนยอดเพี้ยน (เหมือน `BEGIN IMMEDIATE` ของ SQLite เดิม) ส่วนการอ่านทำงานขนานกันได้
5. **ไม่มี build step**: แก้ไฟล์แล้ว restart server (กรณีแก้ `server.js`) หรือ refresh เบราว์เซอร์ (กรณีแก้ `public/`) ได้เลย เพราะ static ส่ง `Cache-Control: no-cache`

---

## 7. Multi-tenant: ธุรกิจ สาขา สมาชิก

```text
orgs (ธุรกิจ) 1 ── * stores (ร้าน/สาขา) 1 ── * members * ── 1 users
                          │
                          ├── * products 1 ── * lots
                          │              1 ── * product_packs
                          ├── * movements
                          └── * counters
```

- **ข้อมูลธุรกิจทั้งหมดผูกกับ `store_id`** (สาขา) ส่วน `lots` และ `product_packs` ผูกผ่าน `product_id`
- **การหา role ของผู้ใช้ในสาขา** (`roleIn(userId, storeId)`):
  1. ถ้าผู้ใช้เป็น `owner` ในสาขาใดก็ได้ของ org เดียวกัน → ได้ `owner` ในทุกสาขาของ org นั้น
  2. ไม่งั้นใช้ `members.role` ของสาขานั้น
  3. ไม่มีแถว → ไม่มีสิทธิ์ (403)
- **รายการสาขาที่เห็น** (`memberships`): ทุกสาขาใน org ที่ตนเป็น owner + สาขาที่เป็นสมาชิกโดยตรง
- **ร้านที่เลือกอยู่** เก็บใน `sessions.store_id` เปลี่ยนด้วย `POST /api/me/store`
- **สมัครร้าน** สร้าง `org` ใหม่ + `store` + `member(owner)`
- **เพิ่มสาขา** (`POST /api/stores`): owner สร้างสาขาใหม่ใน org เดิม หรือถ้าผู้ใช้ไม่มีร้านเลย จะสร้าง org ใหม่ให้
- **ชื่อ org** ได้จากชื่อร้านส่วนก่อน `" · "` เช่น `Rose Beauty · สาขาสยาม` จะได้ org ชื่อ `Rose Beauty`
- **SKU/บาร์โค้ด unique ต่อสาขา** ร้านอื่นหรือสาขาอื่นใช้ซ้ำได้ และการแสดงยอดข้ามสาขาตอนสแกนก็ match กันด้วย SKU
- **Migration เก่า**: ถ้าฐานข้อมูลเดิมยังไม่มี `orgs` ระบบจะจัดกลุ่มร้านที่มี owner คนเดียวกันเป็น org เดียว (union-find ใน `server.js`) ให้อัตโนมัติตอนเริ่ม

---

## 8. บทบาทและสิทธิ์

กำหนดไว้ที่เดียวใน `server.js`:

```js
const ROLES = { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', staff: 'พนักงานคลัง', viewer: 'ดูอย่างเดียว' };
const PERMS = {
  'product.edit':   ['owner', 'manager'],
  'product.delete': ['owner', 'manager'],
  'stock.move':     ['owner', 'manager', 'staff'],
  'stock.adjust':   ['owner', 'manager'],
  'report':         ['owner', 'manager', 'viewer'],
  'users':          ['owner'],
  'settings':       ['owner'],
};
```

- Server ส่ง `store.perms` (object `{perm: boolean}`) กลับไปใน `/api/me` แล้ว frontend ใช้ `can(perm)` ซ่อนเมนู/ปุ่ม และ route ที่มี `perm` จะแสดงหน้า “ไม่มีสิทธิ์”
- Endpoint ที่ต้องการสิทธิ์ประกาศด้วย `api('POST', '/api/...', { perm: 'product.edit' }, handler)`
- `POST /api/movements` ตรวจสิทธิ์ตามชนิด: `adj` ต้องมี `stock.adjust` ส่วน `in`/`out` ต้องมี `stock.move`
- ตาราง permission matrix ในหน้า “ผู้ใช้และสิทธิ์” สร้างจาก `PERMS` อัตโนมัติ (`GET /api/members` → `matrix`)

**กฎเพิ่มเติม**
- เปลี่ยนบทบาทตัวเองไม่ได้ (UI ปิดไว้) และนำตัวเองออกไม่ได้ (server ตรวจ)
- สาขาต้องมี owner ในตาราง `members` อย่างน้อย 1 คน
- Owner รีเซ็ตรหัสผ่านให้ใครได้ ก็ต่อเมื่อ **ทุกสาขาที่คนนั้นเป็นสมาชิก มี caller เป็น owner** (กันการยึดบัญชีข้ามร้าน)
- ตั้งรหัสผ่านใหม่แล้ว session ทั้งหมดของผู้ใช้นั้นจะถูกลบ

---

## 9. ฐานข้อมูล

### 9.1 ข้อมูลทั่วไป
- ไฟล์: `${DATA_DIR}/cosmostock.db` (+ `-wal`, `-shm` ระหว่างทำงาน)
- `PRAGMA journal_mode = WAL` (อ่านพร้อมเขียนได้), `PRAGMA foreign_keys = ON`
- วันเวลาเก็บเป็น **ISO 8601 UTC** (`2026-10-06T07:30:00.000Z`) ใน `TEXT`
- วันหมดอายุเก็บเป็น **วันที่ท้องถิ่น** `YYYY-MM-DD` ใน `TEXT`
- เงินเก็บเป็น `REAL` ปัด 2 ตำแหน่งตอน validate
- จำนวนสินค้าเป็น `INTEGER` ในหน่วยย่อยเสมอ (ขนาดบรรจุแปลงเป็นหน่วยย่อยก่อนบันทึก)

### 9.2 ตาราง

**`orgs`** — ธุรกิจ (กลุ่มของสาขา)
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT | |
| created_at | TEXT | ISO |

**`stores`** — ร้าน/สาขา
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| name | TEXT | |
| expiry_days | INTEGER | แจ้งเตือนใกล้หมดอายุล่วงหน้า (ค่าเริ่มต้น 60) |
| org_id | INTEGER → orgs.id | index `ix_stores_org` |
| created_at | TEXT | |

**`users`** — บัญชีผู้ใช้ (ระดับระบบ ไม่ผูกกับร้าน)
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| email | TEXT UNIQUE | เก็บตัวพิมพ์เล็ก |
| name | TEXT | |
| pass | TEXT | `scrypt$<salt hex>$<key hex>` |
| created_at, last_login | TEXT | |

**`members`** — ผู้ใช้ในสาขา + บทบาท
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| store_id | → stores.id (CASCADE) | PK (store_id, user_id) |
| user_id | → users.id (CASCADE) | |
| role | TEXT | `owner` / `manager` / `staff` / `viewer` |
| created_at | TEXT | |

**`sessions`**
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| token | TEXT PK | **SHA-256 ของ token** (token จริงอยู่ใน cookie เท่านั้น) |
| user_id | → users.id (CASCADE) | |
| store_id | INTEGER | ร้านที่เลือกอยู่ |
| expires_at | INTEGER | epoch ms; ลบแถวที่หมดอายุตอนเริ่มเซิร์ฟเวอร์และทุก 1 ชั่วโมง |

**`products`**
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| store_id | → stores.id (CASCADE) | |
| sku | TEXT | unique ต่อสาขาเฉพาะแถวที่ยังไม่ลบ (`ux_products_sku` partial index) |
| name, barcode, category, unit | TEXT | barcode มี index `ix_products_barcode` |
| cost, price | REAL | |
| reorder_point | INTEGER | จุดสั่งซื้อ |
| track_expiry | INTEGER 0/1 | ติดตามล็อต/วันหมดอายุ |
| image | TEXT | **data URL base64** ของรูป (≤ 1.5 MB) |
| qty | INTEGER | **ยอดคงเหลือแบบ cache** = Σ `lots.qty` (อัปเดตใน `moveStock`) |
| deleted_at | TEXT | soft delete |
| created_at, updated_at | TEXT | |

**`lots`** — ล็อตสินค้า
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| product_id | → products.id (CASCADE) | index `ix_lots_product` |
| lot_no | TEXT | `''` = ไม่ระบุล็อต |
| expiry | TEXT NULL | `YYYY-MM-DD` |
| qty | INTEGER | คงเหลือในล็อต (ล็อตที่เหลือ 0 ยังเก็บไว้) |
| received_at | TEXT | |

**`movements`** — ประวัติ (append-only)
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| store_id | → stores.id | index `(store_id, created_at)` |
| product_id | → products.id | index `ix_movements_product` |
| type | TEXT | `in` / `out` / `adj` (CHECK) |
| doc_no | TEXT | `RCV-00001` / `ISS-00001` / `ADJ-00001` |
| qty | INTEGER | **มีเครื่องหมาย** (+ เพิ่ม, − ลด) ในหน่วยย่อย |
| before_qty, after_qty | INTEGER | ยอดก่อน/หลัง |
| lot_info | TEXT | in: เลขล็อต; out: `LOT-A×5, LOT-B×3` |
| expiry | TEXT | วันหมดอายุของล็อตที่รับเข้า |
| note | TEXT | หมายเหตุ/เหตุผล |
| user_id | → users.id (SET NULL) | |
| user_name | TEXT | **snapshot ชื่อ ณ ตอนทำรายการ** |
| pack_name, pack_count | TEXT, INTEGER | ถ้าทำรายการเป็นหน่วยบรรจุ เช่น `ลัง`, `2` |
| created_at | TEXT | |

**`counters`** — ตัวนับเลขเอกสาร: PK `(store_id, type)`, `n`

**`product_packs`** — ขนาดบรรจุ
| คอลัมน์ | ชนิด | หมายเหตุ |
| --- | --- | --- |
| id | INTEGER PK | |
| product_id | → products.id (CASCADE) | |
| name | TEXT | เช่น กล่อง, ลัง |
| per_qty | INTEGER ≥ 2 | จำนวนหน่วยย่อยต่อ 1 หน่วยนี้ |
| barcode | TEXT | index `ix_packs_barcode` |
| price | REAL NULL | |
| sort | INTEGER | |

### 9.3 Invariant ที่ต้องรักษา
1. `products.qty == SUM(lots.qty WHERE product_id = products.id)`
2. สำหรับสินค้าหนึ่ง เมื่อเรียง movements ตามเวลา `after_qty` ของรายการก่อนหน้า = `before_qty` ของรายการถัดไป และ `after_qty = before_qty + qty`
3. `products.qty == after_qty` ของ movement ล่าสุด (หรือ 0 ถ้าไม่มีรายการ)
4. ห้าม `UPDATE`/`DELETE` ตาราง `movements`

SQL ตรวจสอบ invariant 1:
```sql
SELECT p.id, p.sku, p.qty, COALESCE(SUM(l.qty), 0) AS lots_qty
FROM products p LEFT JOIN lots l ON l.product_id = p.id
GROUP BY p.id HAVING p.qty <> lots_qty;   -- ต้องได้ 0 แถว
```

### 9.4 การเปลี่ยน schema (migration)
ตอนนี้ไม่มีระบบ migration แยก ใช้วิธีนี้ใน `server.js`:
- ตารางใหม่: `CREATE TABLE IF NOT EXISTS …`
- คอลัมน์ใหม่: อ่าน `PRAGMA table_info(<table>)` ถ้ายังไม่มีคอลัมน์ให้ `ALTER TABLE … ADD COLUMN …` (ดูตัวอย่าง `pack_name`, `org_id`)
- เปลี่ยนข้อมูลเดิม: ทำใน `BEGIN … COMMIT` แบบรันซ้ำได้ (idempotent)

**ข้อควรระวัง**: SQLite แก้ชนิดคอลัมน์หรือลบ constraint ตรงๆ ไม่ได้ ต้องสร้างตารางใหม่แล้วคัดลอกข้อมูล และ **ต้องสำรองฐานข้อมูลก่อนเสมอ** ถ้าจะทำ migration หลายครั้ง แนะนำให้เพิ่มตาราง `schema_version` (หัวข้อ 19)

---

## 10. หลักการทำงานของสต็อก

### 10.1 `moveStock(actor, input, at)`
ฟังก์ชันเดียวที่เปลี่ยนยอดสต็อกได้ ทำงานใน `tx()` (`BEGIN IMMEDIATE … COMMIT`) ดังนี้
1. โหลดสินค้า (`id` + `store_id` ของ session + ยังไม่ถูกลบ) ถ้าไม่เจอให้ตอบ 404
2. `before = SUM(lots.qty)`
3. คำนวณจำนวนในหน่วยย่อย: ถ้ามี `packId` ใช้ `qty × per_qty` ไม่งั้นใช้ `qty` (ตรวจขอบเขต 1…1,000,000)
4. แยกตามชนิด:
   - **in**: `addToLot()` บวกเข้าล็อตที่ `lot_no` และ `expiry` ตรงกัน หรือสร้างล็อตใหม่
   - **out**: ตรวจว่า `qty ≤ before` แล้วเรียก `takeFromLots()` (FEFO)
   - **adj**: รับ `newQty` (ยอดนับจริง) คำนวณ `delta = newQty − before` ถ้าบวกให้ `addToLot` ถ้าลบให้ `takeFromLots` ถ้า 0 ให้ error และต้องมี `note`
5. `UPDATE products SET qty = after`
6. `nextDoc()` ออกเลขเอกสาร (`INSERT … ON CONFLICT DO UPDATE SET n = n + 1`)
7. `INSERT INTO movements …` พร้อม snapshot ชื่อผู้ทำรายการ
8. ถ้ามี error ตรงไหนจะ `ROLLBACK` ทั้งหมด

### 10.2 FEFO (First-Expiry-First-Out)
```sql
SELECT id, lot_no, qty FROM lots WHERE product_id = ? AND qty > 0
ORDER BY expiry IS NULL, expiry, id   -- มีวันหมดอายุก่อน → หมดอายุเร็วก่อน → ล็อตเก่าก่อน
```
ตัดทีละล็อตจนครบ แล้วบันทึกว่าตัดล็อตไหนกี่ชิ้นใน `movements.lot_info`

### 10.3 สถานะสินค้า (`statusOf`)
ลำดับความสำคัญ: `out` (qty ≤ 0) → `expired` (ล็อตใกล้สุด < วันนี้) → `low` (qty ≤ reorder_point) → `exp` (ล็อตใกล้สุด ≤ expiry_days) → `ok`
โดย “ล็อตใกล้สุด” คือ `MIN(lots.expiry)` ของล็อตที่ `qty > 0`

### 10.4 แจ้งเตือน (`buildAlerts`)
- `low`: สินค้าที่ `qty <= reorder_point` (รวมสินค้าหมด) แยก `kind = out | low`
- `expiring`: ล็อตที่ `qty > 0` และ `expiry <= วันนี้ + expiry_days` (รวมล็อตที่หมดอายุแล้ว)
- คำนวณสดทุก request ไม่มี cron/queue
- ตัวเลขบนกระดิ่ง = `low.length + expiring.length` (ส่งมากับ `/api/me`)

### 10.5 Dashboard และรายงาน
- **KPI**: นับจาก `listProducts()` ใน JavaScript
- **กราฟ 6 เดือน**: อ่าน movements ตั้งแต่ต้นเดือนเมื่อ 5 เดือนก่อน แล้วรวมเป็นรายเดือนใน JavaScript
- **รายงาน** (`/api/reports?from&to`): อ่านทุก movement ในช่วงเวลา แล้วรวมต่อสินค้าและต่อหมวดใน JavaScript โดยหมวดใช้ **หมวดปัจจุบันของสินค้า**
- **มูลค่า** = `qty × cost` ปัจจุบัน (ไม่ใช่ต้นทุนจริงรายล็อต)

### 10.6 ขนาดบรรจุ
- ไม่เกิน 5 แบบต่อสินค้า, `per_qty ≥ 2`, ชื่อ/จำนวน/บาร์โค้ดห้ามซ้ำกันในสินค้า และบาร์โค้ดห้ามซ้ำกับสินค้าอื่นในสาขา (`assertUniqueProduct` ตรวจทั้ง `products.barcode` และ `product_packs.barcode`)
- บันทึกแบบ “ลบทั้งหมดแล้ว insert ใหม่” (`savePacks`) ทุกครั้งที่แก้สินค้า ดังนั้น `pack.id` จะเปลี่ยน (movements เก็บ `pack_name` เป็นข้อความ ไม่ได้อ้าง id จึงไม่กระทบ)
- `GET /api/lookup?code=` ค้นตามลำดับ: `products.barcode` หรือ `sku` (ไม่สนตัวพิมพ์) แล้วค่อยหา `product_packs.barcode`
- **QR ต่อล็อต**: รูปแบบ `CSL1|<sku>|<เลขล็อต>|<YYYY-MM-DD>` (แต่ละช่อง URI-encode) ถ้า `code` ขึ้นต้น `CSL1|` เซิร์ฟเวอร์จะแยกด้วย `parseLotCode()` หาสินค้าจาก SKU แล้วคืน `scannedLot { id, lotNo, expiry, days, qty }` (`id = null` ถ้ายังไม่เคยรับเข้าล็อตนั้น) — ใช้ได้ข้ามสาขาในร้านเดียวกันเพราะ SKU เดียวกัน
- หน้า รับเข้า: สแกน QR ล็อตแล้วช่องเลขล็อต/วันหมดอายุถูกกรอกให้ · หน้า จ่ายออก: ตัดจากล็อตที่สแกนโดยตรง (ส่ง `lotId`) แทน FEFO

---

## 11. Authentication และความปลอดภัย

| เรื่อง | การทำงาน |
| --- | --- |
| Password hash | `scrypt` (N เริ่มต้นของ Node), salt 16 bytes, key 64 bytes, เทียบด้วย `timingSafeEqual` |
| รหัสผ่าน | อย่างน้อย 8 ตัวอักษร ไม่เกิน 200 |
| Session | token สุ่ม 32 bytes (base64url) อยู่ใน cookie `cs_sid` ส่วน DB เก็บแค่ SHA-256 ของ token |
| อายุ session | “จดจำฉัน”: 30 วัน (cookie มี `Max-Age`); ไม่จดจำ: 12 ชั่วโมงฝั่ง server + cookie แบบ session |
| Cookie flags | `HttpOnly; SameSite=Lax; Path=/` และ `Secure` เมื่อมาทาง HTTPS |
| CSRF | request ที่ไม่ใช่ GET ต้องมี header `X-CS: 1` (ฟอร์มข้ามโดเมนส่ง custom header ไม่ได้) + SameSite=Lax |
| Brute force | ผิด 8 ครั้งใน 10 นาทีต่อ `IP|email` จะตอบ 429 (เก็บใน memory หาย เมื่อ restart) |
| เปลี่ยนรหัสผ่าน | ลบ session อื่นของผู้ใช้ทั้งหมด (คงไว้แค่เครื่องปัจจุบัน) |
| IDOR | ทุก query ใส่ `store_id = ctx.storeId` ที่มาจาก session; ของร้านอื่นจะตอบ 404 |
| SQL injection | prepared statement ทั้งหมด, `LIKE` escape `% _ \` |
| XSS | frontend escape ทุกค่าด้วย `esc()` ก่อนใส่ HTML + CSP |
| Headers | `Content-Security-Policy` (self + unpkg + Google Fonts), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(self)` |
| Static files | กัน path traversal (ต้องอยู่ใต้ `public/`) |
| Body limit | JSON ≤ 3 MB, รูป ≤ 1.5 MB (data URL jpeg/png/webp เท่านั้น) |
| Error | 500 ตอบข้อความกลาง ส่วนรายละเอียด log ที่ console |

---

## 12. API Reference

ทุก endpoint ตอบ JSON ส่วน error ตอบเป็น `{ "error": "ข้อความภาษาไทย" }` พร้อม status 400/401/403/404/409/413/429/500
Request ที่ไม่ใช่ GET ต้องส่ง header `X-CS: 1` และ `Content-Type: application/json`

**คอลัมน์ “ต้อง”**: `—` = ไม่ต้องล็อกอิน, `login` = ล็อกอินแล้ว (ไม่จำเป็นต้องเลือกร้าน), `store` = ต้องเป็นสมาชิกร้านที่เลือก, หรือชื่อสิทธิ์

| Method | Path | ต้อง | Body / Query | คำอธิบาย |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | — | `email, password, remember` | เข้าสู่ระบบ |
| POST | `/api/auth/register` | — | `storeName, name, email, password` | สร้าง org + ร้าน + owner แล้วล็อกอินให้ |
| POST | `/api/auth/logout` | — | | ลบ session + cookie |
| GET | `/api/me` | login | | ผู้ใช้, รายการร้าน, ร้านปัจจุบัน (role, perms, alertCount, expiryDays) |
| PUT | `/api/me` | login | `name` | แก้ชื่อตัวเอง |
| POST | `/api/me/store` | login | `storeId` | สลับร้าน |
| POST | `/api/me/password` | login | `current, next` | เปลี่ยนรหัสผ่านตัวเอง |
| POST | `/api/stores` | login (owner) | `name` | เพิ่มสาขาใน org เดิม (หรือสร้าง org ใหม่ถ้ายังไม่มีร้าน) |
| GET | `/api/store` | store | | ข้อมูลร้านปัจจุบัน |
| PUT | `/api/store` | `settings` | `name, expiryDays` | ตั้งค่าร้าน |
| GET | `/api/dashboard` | store | | kpi, months, alerts, recent, categories |
| GET | `/api/categories` | store | | หมวดเริ่มต้น + หมวดที่ใช้อยู่ |
| GET | `/api/products` | store | `q, category, status` | รายการสินค้า (ทั้งหมด ไม่แบ่งหน้า) พร้อม packs |
| GET | `/api/lookup` | store | `code` | หาสินค้าจากบาร์โค้ด/SKU/บาร์โค้ด pack + lots + recent + ยอดสาขาอื่น |
| GET | `/api/products/:id` | store | | product, lots, history (20), historyTotal |
| GET | `/api/products/:id/image` | store | | รูปภาพ (binary) |
| POST | `/api/products` | `product.edit` | ฟิลด์สินค้า + `packs[]`, `image`, `initialQty, lotNo, expiry` | สร้างสินค้า (+ ยอดยกมา) |
| PUT | `/api/products/:id` | `product.edit` | ฟิลด์สินค้า (`image` ไม่ส่ง = ไม่เปลี่ยน, `null` = ลบรูป) | แก้ไขสินค้า |
| DELETE | `/api/products/:id` | `product.delete` | `confirmSku` | soft delete |
| POST | `/api/movements` | `stock.move` / `stock.adjust` | `type, productId, qty \| newQty, packId?, lotNo?, expiry?, lotId? (เฉพาะ out — ตัดจากล็อตนั้น), note` | ทำรายการสต็อก |
| GET | `/api/movements` | store | `q, type, from, to (ISO), productId, limit ≤ 1000, offset` | ประวัติ + total |
| GET | `/api/alerts` | store | | low, expiring, expiryDays |
| GET | `/api/reports` | `report` | `from, to` (ISO) | summary, categories, movement, stock, expiring |
| GET | `/api/members` | store | | สมาชิก, roles, permission matrix |
| POST | `/api/members` | `users` | `email, role, name?, password?` | เชิญ (สร้างบัญชีถ้ายังไม่มี) |
| PUT | `/api/members/:userId` | `users` | `role?`, `password?` | เปลี่ยนบทบาท / ตั้งรหัสผ่านใหม่ |
| DELETE | `/api/members/:userId` | `users` | | นำออกจากร้าน |
| PUT | `/api/members/:userId/stores` | `users` | `storeIds[]` | กำหนด/ย้ายสาขาของสมาชิก — บทบาทแบบ 1 สาขา ต้องส่ง 1 สาขา (ย้าย), แบบหลายสาขาส่งได้หลายสาขา · ใช้กับคนที่อยู่สาขาอื่นของร้านเดียวกันได้ (`GET /api/members` คืน `elsewhere[]`) · เจ้าของร้านกำหนดไม่ได้ (เห็นทุกสาขา) |

ตัวอย่างการเรียกด้วย curl:
```bash
curl -c c.txt -H "X-CS: 1" -H "Content-Type: application/json" \
  -d '{"email":"admin@cosmostock.app","password":"CosmoAdmin@2569"}' http://localhost:3000/api/auth/login
curl -b c.txt http://localhost:3000/api/alerts
```

---

## 13. Frontend

### 13.1 โครงสร้าง
- **SPA ไฟล์เดียว** `public/app.js` ห่อใน IIFE, state กลางอยู่ที่ `S` (`S.me` = ผลจาก `/api/me`)
- **Routing**: hash-based (`#/products/12`) ตาราง `ROUTES` แมป pattern เข้ากับ view function และ `opts` (`public`, `nav`, `perm`)
- **View contract**: `async function viewX({ params, query })` คืนค่า `{ html, mount(root) }` โดย `render()` ใส่ `html` ลง `#view` แล้วเรียก `mount` เพื่อผูก event
- **Shell** (เมนูซ้าย, แถบบน, แถบล่าง) สร้างครั้งเดียวต่อ `user|store|role` ใน `ensureShell()`
- **API client**: `GET/POST/PUT/DEL` ใส่ `X-CS: 1` ให้อัตโนมัติ ถ้าได้ 401 จะเด้งไปหน้า login
- **UI primitives**: `toast()`, `modal()` (คืน Promise), `confirmBox()`, `scanCode()`, `qrSvg()`, `printLabels()`, `downloadCSV()`, `resizeImage()` (ย่อรูปฝั่ง client ให้ไม่เกิน 480px)
- **ข้อความทั้งหมดเป็นภาษาไทยฝังในโค้ด** (ไม่มีระบบ i18n)
- **ความปลอดภัย**: ต้องใช้ `esc()` กับทุกค่าที่มาจากผู้ใช้ก่อนนำไปใส่ใน template string

### 13.2 Routes
| Hash | View | สิทธิ์ |
| --- | --- | --- |
| `#/login`, `#/register` | viewLogin, viewRegister | public |
| `#/` | viewDashboard | |
| `#/products` (`?q&cat&status`) | viewProducts | |
| `#/products/new` (`?barcode`) | viewProductForm | product.edit |
| `#/products/:id` | viewProduct | |
| `#/products/:id/edit` | viewProductForm | product.edit |
| `#/move/:type` (`in`/`out`/`adj`, `?product&pack`) | viewMove | stock.move / stock.adjust |
| `#/history` (`?q&type&range&from&to&productId`) | viewHistory | |
| `#/alerts` (`?tab=exp`) | viewAlerts | |
| `#/reports` (`?tab&from&to`) | viewReports | report |
| `#/users` | viewUsers | users |
| `#/settings` | viewSettings | |
| `#/more` | viewMore | |

### 13.3 Responsive
| Breakpoint (`app.css`) | Layout |
| --- | --- |
| ≥ 1100px | Sidebar เต็ม 248px |
| 768–1099px | Sidebar ไอคอน 72px + top bar, input สูง ≥ 44px และ font 16px (กัน iOS zoom) |
| < 768px | ซ่อน sidebar, ใช้ bottom tab bar 5 ปุ่ม (รองรับ safe-area), ตารางกลายเป็นการ์ด (`.hide-mobile` / `.only-mobile`, `.rtable` ใช้ `data-label`) |
| ≤ 380px / ≤ 480px | ฟอร์มเรียงเป็นคอลัมน์เดียว |
| `@media print` | ซ่อนเมนู/ปุ่ม (`.no-print`), โหมดฉลาก `body.print-label` |

### 13.4 Design system
- `/ds.css` คือ `_ds/industry-…/styles.css` (tokens: `--color-accent`, `--color-accent-2`, ramp 100–900, `--font-heading`, `--font-body`)
- ส่วน `app.css` ใช้ token เหล่านี้ ถ้าจะเปลี่ยนโทนสีให้แก้ที่ token
- คลาสหลัก: `.card`, `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.tag`, `.chip`, `.seg`, `.kpis`, `.table`, `.list .li`, `.blueprint` (มุมตกแต่ง)

---

## 14. ข้อมูลตัวอย่าง (Seed)

`seed()` ทำงานเมื่อตาราง `users` ว่าง และสร้าง:
- ผู้ใช้ 4 คน: มินตรา (owner, ใช้ `ADMIN_EMAIL`/`ADMIN_PASSWORD`), พิมพ์ชนก (manager), สมชาย (staff), ณัฐวุฒิ (viewer) โดยคนอื่นใช้รหัส `Demo@2569`
- 2 สาขา: `Rose Beauty · สาขาสยาม` (สินค้า 10 รายการ) และ `Rose Beauty · สาขาอารีย์` (4 รายการ)
- ประวัติย้อนหลังประมาณ 6 เดือน **สร้างผ่าน `moveStock()` จริงทุกรายการ** ยอดจึงตรงกับประวัติ 100% ใช้ random แบบ seed คงที่ ข้อมูลจึงเหมือนเดิมทุกครั้ง (เทียบกับวันที่รัน)
- มีกรณีทดสอบครบ: สินค้าหมด (MU-FD02), ใกล้หมด (MU-BL03, SC-SS01), ล็อตใกล้หมดอายุ (SK-VC30, CL-BM01), สินค้ามีขนาดบรรจุ

---

## 15. การดูแลระบบ (Operations)

### 15.1 สำรองข้อมูล (สำคัญที่สุด)
ข้อมูลทั้งหมดอยู่ในฐานข้อมูล PostgreSQL

- สำรอง: `bash deploy/backup.sh` (หรือ `npm run backup`) ได้ไฟล์ `/var/backups/cosmostock/cosmostock-วันที่-เวลา.sql.gz` ตัวติดตั้ง `deploy/install.sh` ตั้ง cron ให้สำรองอัตโนมัติทุกคืน 02:30 เก็บย้อนหลัง 14 วัน
- กู้คืน: หยุดระบบ (`systemctl stop cosmostock`) → `gunzip -c ไฟล์.sql.gz | psql "$DATABASE_URL"` → เปิดระบบ (`systemctl start cosmostock`)
- ควรคัดลอกไฟล์สำรองออกไปเก็บนอกเซิร์ฟเวอร์ด้วยเป็นระยะ

### 15.2 รีเซ็ตรหัสผ่าน (กรณีเจ้าของร้านลืม)
สร้างไฟล์ `tools/reset-password.mjs`:
```js
import '../env.js';
import crypto from 'node:crypto';
import { run, closeDb } from '../db.js';
const [email, pw] = process.argv.slice(2);
if (!email || !pw || pw.length < 8) { console.log('ใช้: node tools/reset-password.mjs <email> <รหัสใหม่ ≥ 8 ตัว>'); process.exit(1); }
const salt = crypto.randomBytes(16);
const hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const r = await run('UPDATE users SET pass = ? WHERE email = ?', hash, email.toLowerCase());
await run('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)', email.toLowerCase());
console.log(r.changes ? 'เปลี่ยนรหัสผ่านแล้ว' : 'ไม่พบอีเมลนี้');
await closeDb();
```
รัน: `node tools/reset-password.mjs owner@shop.com NewPass@2569`

### 15.3 เปิดดู/แก้ฐานข้อมูล
- เปิดดูด้วย `psql "$DATABASE_URL"` หรือโปรแกรม DBeaver / pgAdmin (สำรองข้อมูลก่อนแก้เสมอ)
- **ห้ามแก้ `products.qty`, `lots.qty`, `movements` ตรงๆ** ถ้ายอดผิดให้ทำรายการปรับยอดผ่านแอป
- คำสั่ง SQL ที่ใช้บ่อย:
```sql
-- ผู้ใช้และบทบาทในแต่ละสาขา
SELECT s.name AS store, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id JOIN stores s ON s.id = m.store_id ORDER BY s.id;
-- ทำให้ผู้ใช้เป็น owner ของสาขา (กรณีไม่มี owner เหลือ)
INSERT OR REPLACE INTO members(store_id, user_id, role, created_at) VALUES (1, 1, 'owner', datetime('now'));
-- กู้สินค้าที่ลบไป
UPDATE products SET deleted_at = NULL WHERE store_id = 1 AND sku = 'MU-LP01';
```
> การกู้สินค้าที่ลบไปจะไม่สำเร็จ ถ้ามีสินค้าใหม่ใช้ SKU เดียวกันอยู่แล้ว (เพราะติด unique index)

### 15.4 Log และการ restart
- Log ออก stdout/stderr (`console.error` เฉพาะ error 500)
- ใช้งานจริงควรรันด้วย process manager ที่ restart ให้อัตโนมัติ เช่น `pm2 start server.js --name cosmostock --node-args="--disable-warning=ExperimentalWarning"` หรือ systemd หรือ NSSM บน Windows

### 15.5 อัปเดตโค้ด
1. สำรองฐานข้อมูล
2. `git pull`
3. Restart เซิร์ฟเวอร์ (migration แบบ `IF NOT EXISTS` / `ADD COLUMN` จะรันเองตอนเริ่ม)
4. ทดสอบ smoke test (หัวข้อ 20)

### 15.6 เริ่มใช้งานจริงโดยไม่ใช้ข้อมูลตัวอย่าง
ทางเลือกที่ 1: ลบโฟลเดอร์ `data/` → แก้ `seed()` ให้สร้างแค่บัญชีแอดมิน (หรือ `return false` แล้วให้ผู้ใช้สมัครร้านเอง) → เริ่มเซิร์ฟเวอร์
ทางเลือกที่ 2: สมัครร้านใหม่จากหน้าเว็บ แล้วลบร้านตัวอย่างด้วย SQL (cascade จะลบ products, lots, members ให้ แต่ movements อ้าง products ด้วย FK ไม่มี cascade จึงต้องลบเองก่อน):
```sql
DELETE FROM movements WHERE store_id IN (SELECT id FROM stores WHERE name LIKE 'Rose Beauty%');
DELETE FROM counters  WHERE store_id IN (SELECT id FROM stores WHERE name LIKE 'Rose Beauty%');
DELETE FROM stores WHERE name LIKE 'Rose Beauty%';
DELETE FROM users WHERE email LIKE '%@rosebeauty.co' OR email = 'admin@cosmostock.app';
```

### 15.7 ปัญหาที่พบบ่อย (ฝั่งผู้ดูแล)
| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| `Cannot find module 'node:sqlite'` / `DatabaseSync is not a constructor` | Node เก่ากว่า 22.13 ให้อัปเกรด |
| `EADDRINUSE` | พอร์ต 3000 ถูกใช้อยู่ ให้ปิดโปรแกรมนั้นหรือตั้ง `PORT` |
| `database is locked` | มีโปรแกรมอื่นเปิดไฟล์ DB ค้างไว้ (เช่น DB Browser ที่ยังไม่ save) |
| มือถือเข้าไม่ได้ | Firewall บล็อกพอร์ต, อยู่คนละวง Wi-Fi, หรือตั้ง `HOST=127.0.0.1` ไว้ |
| สแกนไม่ได้แม้เป็น HTTPS | เครือข่ายบล็อก `unpkg.com` หรือ CSP ถูกแก้ |
| ฟอนต์ไม่ใช่ฟอนต์ไทยที่ออกแบบไว้ | เข้าถึง Google Fonts ไม่ได้ (ระบบยังใช้งานได้ปกติ) |
| “อีกกี่วันหมดอายุ” คลาดไป 1 วัน | timezone ของเซิร์ฟเวอร์ไม่ใช่ `Asia/Bangkok` |

---

## 16. การ Deploy

### 16.1 ข้อกำหนดของแพลตฟอร์ม
ระบบนี้ต้องการ **(1) process ที่รันค้างตลอดเวลา, (2) PostgreSQL ที่ข้อมูลถาวร, (3) instance เดียว (ฐานข้อมูลรองรับหลาย instance ได้ แต่ login throttle เก็บในหน่วยความจำของแต่ละ process)**
- ❌ **Vercel / Netlify Functions / serverless**: ใช้ไม่ได้ เพราะ filesystem ไม่ถาวรและไม่มี process รันค้าง
- ✅ **VPS** (DigitalOcean, Linode, Lightsail, เครื่องในร้าน) + Caddy/Nginx ทำ HTTPS
- ✅ **Render** Web Service + **Persistent Disk** (แพ็กเกจเสียเงิน), **Railway** + Volume, **Fly.io** + Volume

### 16.2 ตัวอย่าง: Render
1. Push ขึ้น GitHub (เพิ่ม `.gitignore` ที่มี `data/` ก่อน)
2. New → Web Service → เลือก repo
   - Runtime: Node, Build command: เว้นว่าง (หรือ `echo ok`), Start command: `npm start`
3. Disks → Add disk: mount path `/var/data`
4. Environment: `DATA_DIR=/var/data`, `TZ=Asia/Bangkok`, `ADMIN_EMAIL=…`, `ADMIN_PASSWORD=…`, `NODE_VERSION=22.13.0` (หรือใหม่กว่า)
5. Deploy แล้วเปิด URL `https://…onrender.com`

### 16.3 ตัวอย่าง: VPS (Ubuntu)
```bash
# ติดตั้ง Node 22+ (เช่น ผ่าน nvm) และ Caddy
git clone <repo> /opt/cosmostock && cd /opt/cosmostock
sudo mkdir -p /var/lib/cosmostock && sudo chown $USER /var/lib/cosmostock
DATA_DIR=/var/lib/cosmostock TZ=Asia/Bangkok HOST=127.0.0.1 pm2 start server.js --name cosmostock \
  --node-args="--disable-warning=ExperimentalWarning"
pm2 save && pm2 startup
# /etc/caddy/Caddyfile
#   stock.example.com {
#     reverse_proxy 127.0.0.1:3000
#   }
```
Caddy ออกใบรับรอง HTTPS ให้อัตโนมัติ และส่ง `X-Forwarded-Proto` ทำให้ cookie เป็น `Secure`

### 16.4 Checklist หลัง deploy
- [ ] เปิดผ่าน HTTPS ได้ และสแกนด้วยกล้องมือถือได้
- [ ] เปลี่ยนรหัสผ่านแอดมิน และลบบัญชี/ร้านตัวอย่าง (ถ้าเป็นระบบจริง)
- [ ] ตั้ง backup อัตโนมัติ และทดลองกู้คืน 1 ครั้ง
- [ ] Restart เซิร์ฟเวอร์แล้วข้อมูลยังอยู่ (ยืนยันว่า disk ถาวรจริง)

---

## 17. แนวทางพัฒนาต่อ (สูตรเพิ่มฟีเจอร์)

### 17.1 เพิ่ม API endpoint
```js
// server.js — วางไว้ในกลุ่ม endpoints
api('GET', '/api/suppliers', { perm: 'product.edit' }, (ctx) => {
  return { suppliers: all('SELECT id, name FROM suppliers WHERE store_id = ? ORDER BY name', ctx.storeId) };
});
```
- `opts`: `{ auth: false }` = ไม่ต้องล็อกอิน, `{ store: false }` = ไม่ต้องเลือกร้าน, `{ perm: '...' }` = ต้องมีสิทธิ์
- `ctx` มี `req, res, url, params, body, query, session, storeId, orgId, role, actor`
- โยน `new HttpError(status, 'ข้อความไทย')` เพื่อตอบ error
- **ทุก query ต้องมี `store_id = ctx.storeId`** (หรือ join ผ่าน products ที่กรอง store แล้ว)
- งานที่เขียนหลายตาราง ให้ครอบด้วย `tx(() => { … })`

### 17.2 เพิ่มสิทธิ์ใหม่
1. เพิ่ม key ใน `PERMS` เช่น `'supplier.edit': ['owner', 'manager']`
2. ใช้ใน `api(..., { perm: 'supplier.edit' }, ...)`
3. Frontend ใช้ `can('supplier.edit')` ได้ทันที (มากับ `/api/me`)
4. (ถ้าต้องการ) เพิ่มแถวใน `matrix` ของ `GET /api/members`

### 17.3 เพิ่มหน้าใหม่
1. เขียน `async function viewSuppliers({ params, query }) { return { html: \`...\`, mount(root) { ... } }; }`
2. เพิ่มใน `ROUTES`: `['/suppliers', viewSuppliers, { nav: 'suppliers', perm: 'supplier.edit' }]`
3. เพิ่มเมนูใน `navItems()` (desktop/tablet) และ/หรือ `viewMore()` (มือถือ)
4. ใช้ `esc()` กับทุกค่า และใช้คลาสจาก design system
5. ทดสอบที่ 3 ขนาดจอ (≥1100, 768–1099, <768) และจอ 320px

### 17.4 เพิ่มตาราง/คอลัมน์
```js
db.exec(`CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL)`);
{
  const cols = new Set(db.prepare('PRAGMA table_info(products)').all().map((c) => c.name));
  if (!cols.has('supplier_id')) db.exec('ALTER TABLE products ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)');
}
```

### 17.5 เพิ่มประเภทรายการสต็อกใหม่ (เช่น โอนระหว่างสาขา)
- ต้องขยาย `CHECK (type IN (...))` ของ `movements` ซึ่งใน SQLite ต้องสร้างตารางใหม่แล้วคัดลอกข้อมูล หรือใช้ `out`/`in` คู่กันแล้วเพิ่มคอลัมน์ `ref_movement_id`
- ทำทั้งสองฝั่งใน `tx()` เดียว และตรวจว่าผู้ใช้มีสิทธิ์ทั้งสาขาต้นทางและปลายทาง
- เพิ่ม prefix ใน `nextDoc()`, `TYPE` และ `MOVE` ใน `app.js`

### 17.6 Roadmap ที่แนะนำ (ตามความคุ้มค่า)
1. `.gitignore`, script backup, automated tests (หัวข้อ 20)
2. โอนสินค้าระหว่างสาขาแบบขั้นตอนเดียว
3. ผู้จำหน่าย + ใบสั่งซื้อ (PO) และรับเข้าตาม PO
4. แจ้งเตือนผ่าน LINE Messaging API / อีเมล (cron รายวัน)
5. รีเซ็ตรหัสผ่านทางอีเมล, ระงับผู้ใช้ชั่วคราว
6. ต้นทุนรายล็อต (FIFO/ถัวเฉลี่ย) สำหรับมูลค่าคลังที่แม่นขึ้น
7. นับสต็อกแบบเป็นรอบ (stock count session) แทนการปรับยอดทีละรายการ
8. PWA offline + sync

---

## 18. ข้อจำกัดและหนี้ทางเทคนิคที่รู้อยู่

| # | เรื่อง | ผลกระทบ | แนวทางแก้ |
| --- | --- | --- | --- |
| 1 | **ไม่มี `.gitignore`**, ไฟล์ `data/*.db*` อยู่ใน git | ข้อมูลและ hash รหัสผ่านหลุดไปกับ repo, เกิด conflict | เพิ่ม `.gitignore` (`data/`, `backup/`, `node_modules/`) แล้ว `git rm --cached data/*` |
| 2 | ไม่มี automated test | refactor เสี่ยง | เพิ่ม `node:test` (หัวข้อ 20) |
| 3 | `server.js` / `app.js` เป็นไฟล์ใหญ่ไฟล์เดียว | ทำงานพร้อมกันหลายคนยาก | แยกโมดูล (หัวข้อ 19 ระยะที่ 2) |
| 4 | รูปสินค้าเก็บเป็น base64 ใน DB | DB โตเร็ว, `SELECT *` หนัก | ย้ายไป object storage (S3/R2) หรือโฟลเดอร์ไฟล์ |
| 5 | `GET /api/products` ไม่แบ่งหน้า และ `PRODUCT_COLS` มี subquery ต่อแถว | ช้าเมื่อมีสินค้าหลายพัน SKU | pagination + เก็บ `next_expiry` เป็นคอลัมน์ |
| 6 | Dashboard/รายงานรวมผลใน JavaScript | ช้าเมื่อ movements มีหลายแสนแถว | ใช้ `GROUP BY` ใน SQL + index |
| 7 | Login throttle เก็บใน memory | หายเมื่อ restart, ใช้หลาย instance ไม่ได้ | เก็บใน DB/Redis |
| 8 | Timezone อิงเครื่องเซิร์ฟเวอร์ | วันหมดอายุคลาดถ้า TZ ผิด | ตั้ง `TZ=Asia/Bangkok` หรือคำนวณด้วย `Intl` ตาม timezone ของร้าน |
| 9 | CSV ประวัติจำกัด 1,000 แถว | ส่งออกช่วงยาวไม่ครบ | endpoint export แบบ stream |
| 10 | มูลค่าคลังใช้ราคาทุนปัจจุบัน | ไม่ตรงหลักบัญชี | เก็บ `unit_cost` ต่อ lot/movement |
| 11 | รายงานใช้หมวดปัจจุบันของสินค้า | เปลี่ยนหมวดแล้วรายงานย้อนหลังเปลี่ยนตาม | snapshot หมวดใน movement |
| 12 | `GET /api/members` ไม่ตรวจสิทธิ์ `users` | staff/viewer เรียก API ดูรายชื่อ+อีเมลสมาชิกได้ (UI ไม่แสดง) | ใส่ `{ perm: 'users' }` |
| 13 | ตั้ง `owner` ให้สาขาเดียว = owner ทั้ง org | อาจให้สิทธิ์เกินตั้งใจ | แยก role `org_owner` กับ `branch_owner` |
| 14 | ไม่มีสถานะระงับผู้ใช้ / ลืมรหัสผ่านต้องให้ owner ตั้งให้ | | เพิ่ม `users.disabled_at`, reset ทางอีเมล |
| 15 | พึ่ง CDN (unpkg, Google Fonts) | ใช้ในวงปิดไม่มีอินเทอร์เน็ตแล้วสแกน/QR ไม่ได้ | self-host ไฟล์ใน `public/vendor/` แล้วแก้ CSP |
| 16 | ~~`node:sqlite` เป็น experimental~~ | แก้แล้ว — ย้ายไป PostgreSQL | — |
| 17 | ลบสินค้าแล้วล็อตยังค้างอยู่ใน DB | ไม่กระทบการแสดงผล | ไม่จำเป็นต้องแก้ |
| 18 | ไม่มี rate limit ทั่วไป / audit log ของการแก้สินค้า/ผู้ใช้ | | เพิ่มตาราง `audit_log` |

---

## 19. แผนการ Scale

### ขนาดที่ระบบปัจจุบันรับได้ (ประมาณการ)
SQLite + Node process เดียวรองรับได้สบายที่ **หลายสิบร้าน, ผู้ใช้พร้อมกันหลักสิบถึงร้อย, สินค้าหลักพัน SKU ต่อสาขา, movements หลักแสนแถว** คอขวดแรกที่จะเจอคือ endpoint ที่โหลดข้อมูลทั้งหมดมารวมใน JavaScript (`/api/products`, `/api/dashboard`, `/api/reports`) ไม่ใช่ตัว SQLite

### ระยะที่ 1 — พร้อมใช้งานจริง (ร้านเดียว/ไม่กี่สาขา)
- [ ] `.gitignore` + เอา DB ออกจาก git
- [ ] Deploy บนเครื่องที่มี disk ถาวร + HTTPS + `TZ=Asia/Bangkok`
- [ ] Backup อัตโนมัติทุกวัน + เก็บนอกเครื่อง + ทดสอบกู้คืน
- [ ] Process manager (pm2/systemd) + health check (เพิ่ม `GET /api/health` คืน `{ok:true}`)
- [ ] แก้ข้อ 12 ในหัวข้อ 18 (`/api/members` perm)
- [ ] Self-host ไลบรารี CDN

### ระยะที่ 2 — โค้ดดูแลง่าย ทีมหลายคน
- [ ] แยก `server.js` เป็นโมดูล:
  ```text
  src/server/
  ├─ index.js            สร้าง http server, middleware chain
  ├─ db/connection.js    เปิด DB, prep/all/get/run, tx
  ├─ db/migrations/      001_init.sql, 002_packs.sql, ... + ตาราง schema_version
  ├─ domain/stock.js     moveStock, FEFO, nextDoc
  ├─ domain/products.js, alerts.js, reports.js
  ├─ auth/sessions.js, auth/passwords.js, auth/permissions.js
  └─ routes/*.js         แยกตามกลุ่ม endpoint
  ```
- [ ] แยก `app.js` เป็น ES modules (`<script type="module">`) ตาม view หรือย้ายไป framework (Preact/Svelte/Vue + Vite) ถ้าทีมถนัด
- [ ] ระบบ migration แบบมีเวอร์ชัน (`schema_version`) แทน `IF NOT EXISTS`
- [ ] Automated tests + CI (GitHub Actions รัน `node --test`)
- [ ] (ไม่บังคับ) TypeScript ผ่าน JSDoc หรือ `tsc --checkJs`
- [ ] Structured logging (JSON) + request id + เวลาตอบสนอง

### ระยะที่ 3 — ข้อมูลเยอะขึ้น (หลายร้อยร้าน / หลายหมื่น SKU)
- [ ] Pagination ฝั่ง server ให้ `/api/products` (cursor หรือ limit/offset) + ค้นหาด้วย FTS5
- [ ] ย้ายการรวมผล dashboard/report ไปเป็น SQL `GROUP BY`, เพิ่ม index เช่น `movements(store_id, type, created_at)`, `lots(product_id, expiry) WHERE qty > 0`
- [ ] เก็บ `next_expiry` เป็นคอลัมน์ของ products (อัปเดตใน `moveStock`) แทน subquery
- [ ] ย้ายรูปไป object storage + CDN, DB เก็บแค่ URL
- [ ] Cache ตัวเลข alert count ต่อร้าน (invalidate ตอนทำรายการ)
- [ ] Export CSV แบบ streaming

### ระยะที่ 4 — หลาย instance / SaaS เต็มรูปแบบ
เมื่อต้องการ high availability หรือรันหลาย instance ต้อง **ย้ายจาก SQLite ไป PostgreSQL**

| SQLite (ปัจจุบัน) | PostgreSQL |
| --- | --- |
| `INTEGER PRIMARY KEY` | `BIGINT GENERATED ALWAYS AS IDENTITY` |
| `REAL` (เงิน) | `NUMERIC(12,2)` |
| `TEXT` ISO datetime | `TIMESTAMPTZ` |
| `TEXT` `YYYY-MM-DD` | `DATE` |
| `INTEGER` 0/1 | `BOOLEAN` |
| `BEGIN IMMEDIATE` (lock ทั้ง DB) | `BEGIN` + `SELECT … FROM products WHERE id = $1 FOR UPDATE` |
| `INSERT … ON CONFLICT DO UPDATE` แล้ว `SELECT n` | `INSERT … ON CONFLICT … DO UPDATE SET n = counters.n + 1 RETURNING n` |
| `COLLATE NOCASE` | `citext` หรือ `lower()` + index |
| partial unique index | ใช้ได้เหมือนเดิม |
| Synchronous calls | `pg` (async) และต้องแก้ทุก handler ให้เป็น `async/await` |

ขั้นตอนย้าย:
1. ทำ data access layer ให้ทุก query ผ่านฟังก์ชันกลาง (ระยะที่ 2)
2. เขียน schema Postgres + script คัดลอกข้อมูล (อ่าน SQLite → insert Postgres โดยคง id เดิม แล้ว `setval` sequence)
3. ตรวจ invariant (หัวข้อ 9.3) หลังย้าย
4. Session และ login throttle ย้ายไป Postgres/Redis
5. รันหลาย instance หลัง load balancer (stateless แล้ว) และใช้ managed DB ที่มี backup/PITR
6. Multi-tenant ระดับสูง: พิจารณา Row-Level Security ของ Postgres (`store_id = current_setting('app.store_id')`) เป็นชั้นป้องกันที่สอง

ส่วนเสริมที่ควรมีเมื่อเป็น SaaS: งาน background (คิว) สำหรับแจ้งเตือนรายวัน/ส่งออกไฟล์ใหญ่, monitoring (uptime, error tracking เช่น Sentry), แผนราคา/จำกัดจำนวนสาขา, audit log, PDPA (นโยบายข้อมูลส่วนบุคคล และการลบบัญชี)

---

## 20. การทดสอบ

### 20.1 Smoke test ด้วยมือ (ทำทุกครั้งก่อน deploy)
| # | ขั้นตอน | ผลที่คาดหวัง |
| --- | --- | --- |
| 1 | `npm run reset` แล้ว `npm start` | เซิร์ฟเวอร์ขึ้น, พิมพ์บัญชีแอดมิน |
| 2 | ล็อกอินด้วยรหัสผิด | “อีเมลหรือรหัสผ่านไม่ถูกต้อง” |
| 3 | ล็อกอินแอดมิน | เห็น Dashboard สาขาสยาม, กระดิ่งมีตัวเลข |
| 4 | รับเข้า SK-VC30 จำนวน 1 ลัง | +24, เลข RCV ใหม่, ยอดก่อน→หลังถูก |
| 5 | จ่ายออกเกินยอดคงเหลือ | ถูกปฏิเสธ “จำนวนคงเหลือไม่พอ” |
| 6 | จ่ายออก SK-VC30 | ตัดล็อต LOT-2604C (หมดอายุก่อน) ก่อน |
| 7 | ปรับยอดโดยไม่ใส่เหตุผล | ถูกปฏิเสธ |
| 8 | สร้างสินค้า SKU ซ้ำ | 409 “SKU … มีอยู่แล้ว” |
| 9 | ล็อกอิน staff แล้วเปิด `#/reports` | “ไม่มีสิทธิ์” |
| 10 | ล็อกอิน viewer | ไม่มีเมนูรับเข้า/จ่ายออก |
| 11 | สลับไปสาขาอารีย์ | เห็นเฉพาะสินค้า 4 รายการของอารีย์ |
| 12 | ส่งออก CSV แล้วเปิดใน Excel | ภาษาไทยถูกต้อง |
| 13 | เปิดบนมือถือจริง (HTTPS) แล้วสแกนบาร์โค้ด | เจอสินค้า |
| 14 | ทดสอบจอ 320px, 768px, 1024px, 1440px | ไม่มี scroll แนวนอน, ทุกปุ่มกดได้ |
| 15 | Logout แล้วกด Back | กลับเข้าไม่ได้ เด้งไปหน้า login |

### 20.2 เริ่มทำ automated test (แนะนำ)
ใช้ `node:test` ในตัว ไม่ต้องติดตั้งอะไร โดยรันเซิร์ฟเวอร์ด้วย `DATA_DIR` ชั่วคราวแล้วยิง HTTP:
```js
// test/api.test.mjs  — รันจากโฟลเดอร์โปรเจกต์: node --test test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-'));
const PORT = 3999, base = `http://127.0.0.1:${PORT}`;
let srv, cookie = '';
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'X-CS': '1', 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json() };
};

before(async () => {
  srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT, HOST: '127.0.0.1', DATA_DIR: dir }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + '/'); return; } catch { await new Promise((ok) => setTimeout(ok, 100)); }
  }
  throw new Error('server did not start');
});
after(async () => {
  const exited = new Promise((ok) => srv.once('exit', ok));
  srv.kill();
  await exited;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('out more than stock is rejected', async () => {
  await call('POST', '/api/auth/login', { email: 'admin@cosmostock.app', password: 'CosmoAdmin@2569' });
  const { data } = await call('GET', '/api/lookup?code=MU-FD02');
  const r = await call('POST', '/api/movements', { type: 'out', productId: data.product.id, qty: 1 });
  assert.equal(r.status, 400);
});
```
เคสที่ควรมี: FEFO, ยอดหลัง = ก่อน + qty, เลขเอกสารไม่ซ้ำ, IDOR ข้ามร้านต้องได้ 404, สิทธิ์ทุก endpoint × ทุกบทบาท, invariant 9.3 หลัง seed

---

## 21. Checklist สำหรับผู้รับช่วงต่อ

**วันแรก**
- [ ] ติดตั้ง Node 22.13+ แล้ว `npm start` ได้
- [ ] ล็อกอินครบ 4 บทบาท และลองทุกเมนูตาม [USER_GUIDE.md](USER_GUIDE.md)
- [ ] อ่าน `server.js` ส่วน `moveStock`, `roleIn`, `handleApi`
- [ ] อ่าน `app.js` ส่วน `ROUTES`, `render`, `viewMove`
- [ ] เปิด `data/cosmostock.db` ด้วย DB Browser แล้วดูตารางตามหัวข้อ 9

**ก่อนแก้โค้ดครั้งแรก**
- [ ] เพิ่ม `.gitignore` และเอาไฟล์ DB ออกจาก git
- [ ] สำรองฐานข้อมูลจริง (ถ้ามี)
- [ ] ทำ smoke test (หัวข้อ 20.1) ให้ผ่านก่อน เพื่อรู้ว่าระบบดีอยู่แล้ว

**หลักที่ต้องรักษา**
- [ ] ยอดสต็อกเปลี่ยนผ่าน `moveStock()` เท่านั้น
- [ ] ทุก query กรองด้วย `store_id` จาก session
- [ ] ตรวจสิทธิ์ฝั่ง server เสมอ (UI ซ่อนปุ่มอย่างเดียวไม่พอ)
- [ ] `esc()` ทุกค่าที่แสดงใน HTML
- [ ] ข้อความผู้ใช้เป็นภาษาไทย ทดสอบทั้งมือถือ/แท็บเล็ต/เดสก์ท็อป
- [ ] อัปเดตเอกสารนี้และคู่มือผู้ใช้เมื่อเพิ่ม/เปลี่ยนฟีเจอร์

---

## 20. PostgreSQL บนเซิร์ฟเวอร์ (ไม่ใช้ Docker)

### 20.1 ภาพรวม
- ข้อมูลทุกอย่าง (ผู้ใช้ ร้าน สินค้า ล็อต การเคลื่อนไหว session) อยู่ใน PostgreSQL → **ปิดเครื่อง/รีสตาร์ตระบบแล้วข้อมูลไม่หาย** และล็อกอินค้างอยู่ได้
- ตารางถูกสร้างให้อัตโนมัติเมื่อเปิดระบบครั้งแรก (`CREATE TABLE IF NOT EXISTS` ใน `db.js`) เปิดซ้ำกี่ครั้งก็ไม่แตะข้อมูลเดิม
- ตั้งค่าผ่านไฟล์ `.env` (ตัวอย่างอยู่ที่ `.env.example`) ค่าหลักคือ `DATABASE_URL=postgresql://ผู้ใช้:รหัส@127.0.0.1:5432/cosmostock`
- ข้อมูลตัวอย่าง (Rose Beauty) จะถูกสร้างเฉพาะเมื่อฐานข้อมูล **ว่าง** เท่านั้น ถ้าจะขึ้นระบบจริงไม่ต้องการข้อมูลตัวอย่าง ให้ตั้ง `SEED_DEMO=0`
- `npm run reset` ลบข้อมูลทั้งหมด จึงต้องยืนยันด้วย `npm run reset -- --yes` (กันกดพลาด)

### 20.2 ติดตั้งบนเซิร์ฟเวอร์ Debian/Ubuntu
```bash
git clone https://github.com/chakkrit4456/Cosmo-stock.git && cd Cosmo-stock
sudo bash deploy/install.sh
```
สคริปต์จะ: ตรวจ/ติดตั้ง Node.js 22 → ติดตั้ง PostgreSQL ผ่าน apt → สร้างผู้ใช้และฐานข้อมูลพร้อมรหัสผ่านสุ่มลง `.env` → `npm install` → นำข้อมูล SQLite เดิมเข้า (ถ้ามี `data/cosmostock.db`) → ตั้ง systemd service `cosmostock` ให้เปิดเองตอนบูตและเปิดใหม่เองถ้าล้ม → ตั้ง cron สำรองข้อมูลทุกคืน รันซ้ำได้ปลอดภัย (ไม่ลบข้อมูล ไม่เปลี่ยนรหัสผ่าน DB)

คำสั่งที่ใช้บ่อย: `systemctl status|restart cosmostock`, `journalctl -u cosmostock -f`, `bash deploy/backup.sh`
รหัสแอดมิน/Superadmin ที่สร้างครั้งแรกดูได้จาก `journalctl -u cosmostock | grep -A3 รหัสผ่าน`
ใช้ HTTPS ผ่าน Caddy/Nginx หรือ Cloudflare Tunnel ครอบหน้าเว็บ (พอร์ต 3000) ตามปกติ — การสแกนด้วยกล้องต้องใช้ HTTPS

### 20.3 นำข้อมูล SQLite เดิมเข้า
วางไฟล์ `data/cosmostock.db` (พร้อม `-wal`, `-shm` ถ้ามี) ในโฟลเดอร์โปรเจกต์ แล้วรัน `npm run import-sqlite` (หรือระบุ path: `npm run import-sqlite -- /path/cosmostock.db`)
- นำเข้าเฉพาะเมื่อ PostgreSQL ยังไม่มีผู้ใช้ (กันซ้ำ) และทำใน transaction เดียว — ล้มกลางทางไม่เหลือข้อมูลครึ่ง ๆ กลาง ๆ
- คง id เดิมทุกแถว แล้วเลื่อน sequence ให้ต่อจากเลขสูงสุด และเทียบจำนวนแถวกับต้นฉบับให้
- ผู้ใช้ทุกคนต้องล็อกอินใหม่หนึ่งครั้ง (ไม่ย้าย session)

### 20.4 ความต่างจากเวอร์ชัน SQLite ที่นักพัฒนาควรรู้
- ทุกฟังก์ชันที่แตะฐานข้อมูลเป็น `async` (`all/get/run/insert/tx` ใน `db.js` คืน Promise) ต้อง `await` เสมอ
- `tx(fn)` ใช้ connection เดียวตลอด callback (ผ่าน AsyncLocalStorage) และล็อกเขียนทีละธุรกรรมด้วย advisory lock
- INSERT ที่ต้องการ id ใช้ `insert(sql, ...)` (ต่อ `RETURNING id` ให้)
- เปรียบเทียบข้อความไม่สนตัวพิมพ์ใหญ่เล็กใช้ `lower(col) = lower(?)` / `ILIKE`; `IS ?` ของ SQLite ใช้ `IS NOT DISTINCT FROM ?`
- วันเวลายังเก็บเป็น `TEXT` ISO และจำนวนเงินเป็น `DOUBLE PRECISION` เหมือนเดิม เพื่อไม่ให้พฤติกรรมของระบบเปลี่ยน
