# CosmoStock — ระบบจัดการคลังเครื่องสำอาง

จัดการคลังง่าย สต็อกแม่น ธุรกิจเติบโต

## วิธีรัน

ต้องมี Node.js 22.13 ขึ้นไป และฐานข้อมูล **PostgreSQL** (ไม่ต้องใช้ Docker)

### บนเซิร์ฟเวอร์ (Debian/Ubuntu) — แนะนำ
```bash
git clone https://github.com/chakkrit4456/Cosmo-stock.git && cd Cosmo-stock
sudo bash deploy/install.sh
```
สคริปต์ติดตั้ง Node.js + PostgreSQL สร้างฐานข้อมูลและไฟล์ `.env` ให้เอง ตั้งให้ระบบเปิดเองทุกครั้งที่เซิร์ฟเวอร์บูต และสำรองข้อมูลทุกคืน — **ข้อมูลเก็บใน PostgreSQL ถาวร ไม่หายเมื่อปิด/เปิดระบบ**

### บนเครื่องที่มี PostgreSQL อยู่แล้ว
```bash
cp .env.example .env     # แล้วแก้ DATABASE_URL ให้ตรงกับฐานข้อมูลของคุณ
npm install              # ติดตั้งไลบรารี pg (ตัวเดียว)
npm start                # เปิดเซิร์ฟเวอร์ที่ http://localhost:3000 (สร้างตารางให้เองครั้งแรก)
```

```bash
npm run reset -- --yes   # ลบข้อมูลทั้งหมดแล้วสร้างข้อมูลตัวอย่างใหม่ (ระวัง!)
npm run import-sqlite    # นำข้อมูลเดิมจาก SQLite (data/cosmostock.db) เข้า PostgreSQL
npm run backup           # สำรองฐานข้อมูลเป็นไฟล์ .sql.gz
```

- เปิดจากมือถือ/แท็บเล็ตที่ต่อ Wi-Fi เดียวกันได้ที่ `http://<IP เครื่อง>:3000` (เซิร์ฟเวอร์จะพิมพ์ URL ให้ตอนเริ่ม)
- การสแกนบาร์โค้ดด้วยกล้องต้องเปิดผ่าน HTTPS หรือ localhost ถ้าไม่ได้จะพิมพ์รหัสเองได้
- ข้อมูลเก็บใน PostgreSQL ตาม `DATABASE_URL` (ในไฟล์ `.env`) ตั้ง `SEED_DEMO=0` ถ้าขึ้นระบบจริงและไม่ต้องการข้อมูลตัวอย่าง
- เปลี่ยนบัญชีแอดมินเริ่มต้นได้ด้วย env `ADMIN_EMAIL`, `ADMIN_PASSWORD` (มีผลตอนสร้างข้อมูลครั้งแรก)

## บัญชีเริ่มต้น

| บทบาท | อีเมล | รหัสผ่าน |
|---|---|---|
| ผู้ดูแลระบบ (Superadmin) | superadmin@cosmostock.app | SuperAdmin@2569 |
| เจ้าของ (แอดมิน) | admin@cosmostock.app | CosmoAdmin@2569 |
| ผู้จัดการ | pimchanok@rosebeauty.co | Demo@2569 |
| พนักงาน | somchai@rosebeauty.co | Demo@2569 |
| ดูอย่างเดียว | nattawut@rosebeauty.co | Demo@2569 |

ควรเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก (เมนู ตั้งค่า)

### ผู้ดูแลระบบ (Superadmin)

- สร้างอัตโนมัติครั้งแรกที่รันเซิร์ฟเวอร์: อีเมล `superadmin@cosmostock.app` รหัสผ่านสุ่ม แสดงในหน้าจอคอนโซลครั้งเดียว (รหัสของเครื่องนี้ระบุในตารางด้านบน — ถ้าเปลี่ยนรหัสหรือรัน `npm run superadmin` ต้องแก้ตารางตามด้วย)
- กำหนดเองได้ด้วย env `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`
- ลืมรหัส: หยุดเซิร์ฟเวอร์แล้วรัน `npm run superadmin` จะออกรหัสใหม่ให้ (แล้วกด Ctrl+C และ `npm start` ตามปกติ)
- เห็นและจัดการได้ทุกร้าน ทุกสาขา ผู้ใช้ทั้งหมด ผ่านเมนู "ผู้ดูแลระบบ"

### ขอบเขตการเข้าถึง

- เจ้าของร้าน (แอดมิน): เห็นเฉพาะร้านของตัวเองแต่ครบทุกสาขา เพิ่มสาขาและสร้างร้านใหม่ได้
- ผู้จัดการ: เฉพาะสาขาที่เจ้าของร้านกำหนด
- พนักงาน / ดูอย่างเดียว: สาขาเดียว

## เอกสาร

| เอกสาร | สำหรับ |
| --- | --- |
| [doc/USER_GUIDE.md](doc/USER_GUIDE.md) | คู่มือการใช้งานฉบับรวมทุกบทบาท |
| [doc/user-guide/owner.md](doc/user-guide/owner.md) | คู่มือเจ้าของร้าน |
| [doc/user-guide/manager.md](doc/user-guide/manager.md) | คู่มือผู้จัดการ |
| [doc/user-guide/staff.md](doc/user-guide/staff.md) | คู่มือพนักงานคลัง |
| [doc/user-guide/viewer.md](doc/user-guide/viewer.md) | คู่มือผู้ดูอย่างเดียว |
| [doc/HANDOVER.md](doc/HANDOVER.md) | รายละเอียดระบบ ฐานข้อมูล API การดูแล และแผน scale สำหรับผู้รับช่วงต่อ |
| [doc/PROJECT_SPEC.md](doc/PROJECT_SPEC.md) | เอกสารแผนตั้งต้นก่อนพัฒนา |
