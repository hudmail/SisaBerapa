# SisaBerapa?

Dashboard web untuk mencatat pemasukan dan pengeluaran bulanan, dibuat khusus untuk kebutuhan mahasiswa. Backend Node.js + Express, data tersimpan permanen di database SQLite lokal. Frontend memakai Tailwind CSS (via CDN) dan Chart.js untuk grafik.

## Fitur

- **Multi-User**: Sistem registrasi & login — setiap pengguna memiliki data keuangan yang terisolasi.
- **Dashboard Ringkasan**: Saldo saat ini, total pemasukan & pengeluaran bulan ini, selisih bersih.
- **Kategori Dinamis**: Bebas tambah/hapus kategori transaksi kustom lengkap dengan pilihan ikon dan warna.
- **Budgeting**: Atur limit pengeluaran per kategori tiap bulan. Terdapat *progress bar* visual (Hijau, Kuning, Merah).
- **Laporan Komprehensif**: *Bar chart* untuk tren bulanan, dan *Doughnut chart* untuk persentase pengeluaran tiap kategori.
- **Tujuan Keuangan (Tabungan)**: Pantau progres tabungan untuk target jangka pendek/panjang (seperti beli laptop, liburan). Dana yang ditambahkan otomatis tercatat sebagai pengeluaran supaya saldo tetap akurat.
- **Pengingat Tagihan**: Catat tagihan yang belum jatuh tempo. Klik "Tandai Lunas" untuk mencatat otomatis sebagai pengeluaran!
- **Manajemen Transaksi**: Tambah, cari, hapus transaksi (dengan otomatisasi titik ribuan `1.500.000` saat mengetik).
- **Export Data**: Unduh riwayat transaksi per bulan dalam format `.csv`.
- **Database Portabel**: Menggunakan *Pure JS SQLite* (`sql.js`), data disimpan permanen di file lokal (tidak hilang direstart) tanpa drama kompilasi *native module*.

> **Catatan koneksi**: frontend memuat Tailwind CSS, font, Chart.js, dan ikon Phosphor dari CDN publik. Server (backend) tidak butuh internet untuk berjalan, tapi **browser yang mengakses aplikasi** butuh koneksi internet supaya tampilan termuat sempurna.

## Struktur Proyek

```
buku-kas-app/
├── server.js              # Backend Express + SQLite + Auth Multi-User (REST API)
├── package.json
├── Dockerfile              # Image build (Node 20)
├── docker-compose.yml      # Konfigurasi container
├── .env.example            # Template environment variable (SESSION_SECRET)
├── .dockerignore
├── scripts/
│   └── hash-password.js   # Generator hash bcrypt (utilitas)
├── views/
│   └── index.html          # Halaman utama (dilindungi login)
└── public/                 # Aset publik
    ├── login.html          # Halaman login & registrasi
    ├── app.js
    ├── style.css
    └── favicon.svg
```

## Login & Keamanan

Aplikasi ini menggunakan sistem **multi-user** — setiap pengguna mendaftar akun sendiri dan memiliki ruang data terisolasi (transaksi, kategori, budget, tujuan, pengingat).

### Cara memulai

1. Jalankan aplikasi (lihat bagian [Menjalankan Aplikasi](#menjalankan-aplikasi-lokal)).
2. Buka halaman login di browser.
3. Klik tab **"Daftar Akun"** untuk membuat akun baru.
4. Setelah mendaftar, Anda otomatis masuk ke dashboard.

### Aturan akun

| Aturan | Ketentuan |
|--------|-----------|
| Username | Huruf, angka, dan underscore saja (`a-z`, `0-9`, `_`). Min 3, maks 30 karakter. |
| Password | Minimal 8 karakter. Wajib mengandung huruf **dan** angka. |

### Keamanan yang diterapkan

- **Rate Limiting**: Endpoint login & register dibatasi maks 10 percobaan per 15 menit per IP (mencegah brute-force).
- **Password Hashing**: Menggunakan `bcryptjs` (cost factor 10).
- **Session Cookie**: `httpOnly`, `sameSite: lax`, `secure` (otomatis aktif di production/HTTPS).
- **Security Headers**: `helmet` middleware (X-Content-Type-Options, X-Frame-Options, dll.).
- **XSS Protection**: Output user data di-escape sebelum dirender ke DOM.
- **Data Isolation**: Setiap query database memfilter berdasarkan `user_id` dari session.
- **Anti-Enumeration**: Respons pendaftaran dibuat timing-consistent agar username yang sudah ada tidak bisa dideteksi via timing attack.

### Catatan teknis

- Session disimpan di memori server, jadi **semua orang otomatis ter-logout setiap kali server di-restart**.
- Session bertahan 7 hari di browser jika server tidak di-restart.
- `SESSION_SECRET` digunakan untuk menandatangani cookie sesi. Di mode development, secret acak dibuat otomatis. **Di production, wajib diatur sebagai environment variable** (lihat bagian [Environment Variable](#environment-variable)).

---

## Menjalankan Aplikasi (Lokal)

### Prasyarat
- **Node.js** versi 18+ (direkomendasikan LTS)

### Langkah

```bash
cd buku-kas-app
npm install
npm start
```

Buka browser: `http://localhost:3000`

> Di Windows, jika `node` tidak dikenali di PowerShell, gunakan path lengkap:
> ```powershell
> & "C:\Program Files\nodejs\node.exe" server.js
> ```

---

## Environment Variable

| Variable | Wajib | Keterangan |
|----------|-------|------------|
| `SESSION_SECRET` | ✅ (production) | String acak panjang untuk menandatangani cookie session. Di dev, otomatis di-generate. |
| `NODE_ENV` | ❌ | Set ke `production` saat deploy. Server akan **menolak start** tanpa `SESSION_SECRET`. |
| `PORT` | ❌ | Port server (default: `3000`). |
| `DATA_DIR` | ❌ | Lokasi folder database (default: `./data`). |

### Cara generate SESSION_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin hasilnya ke file `.env`:
```bash
cp .env.example .env
# Lalu edit isi .env dengan secret yang baru di-generate
```

---

## Deploy dengan Docker

### 1. Siapkan environment

```bash
cp .env.example .env
# Edit .env, ganti SESSION_SECRET dengan string acak yang panjang
```

### 2. Build & jalankan

```bash
docker compose up -d --build
```

### 3. Akses

```
http://localhost:3300
```

---

## Deploy ke VPS (Ubuntu/Debian)

### 1. Install Docker (kalau belum ada)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker
```

### 2. Upload project ke VPS

Dari komputer kamu:
```bash
scp buku-kas-mahasiswa.zip user@ip-vps:~/
```

### 3. SSH masuk, extract, dan jalankan

```bash
ssh user@ip-vps
unzip buku-kas-mahasiswa.zip
cd buku-kas-app
cp .env.example .env
# Edit .env, isi SESSION_SECRET dengan string acak
docker compose up -d --build
```

### 4. Buka firewall (kalau pakai ufw)

```bash
sudo ufw allow 3300/tcp
```

### 5. Akses

```
http://ip-vps:3300
```

Kalau mau pakai domain + HTTPS, pasang reverse proxy (Nginx/Caddy/Traefik) di depan container ini, arahkan ke port 3300.

---

## Deploy ke CasaOS

CasaOS pada dasarnya adalah Debian dengan Docker di baliknya — Docker biasanya sudah terpasang otomatis.

### 1. Upload project ke server CasaOS

```bash
scp buku-kas-mahasiswa.zip user@ip-casaos:/DATA/AppData/
```

Atau upload lewat File Manager bawaan CasaOS ke folder `/DATA/AppData/`.

### 2. SSH masuk dan extract

```bash
ssh user@ip-casaos
cd /DATA/AppData/
unzip buku-kas-mahasiswa.zip
cd buku-kas-app
cp .env.example .env
# Edit .env, isi SESSION_SECRET
```

### 3. Build & jalankan

```bash
docker compose up -d --build
```

### 4. Verifikasi

```bash
docker ps
```

Pastikan container `buku-kas-mahasiswa` berstatus `Up`. Lalu buka browser:

```
http://ip-casaos:3300
```

### 5. (Opsional) Tambahkan sebagai Custom App di UI CasaOS

Kalau versi CasaOS kamu mendukung import compose lewat UI (App Store → Custom Install → paste isi `docker-compose.yml`), bisa ditambahkan supaya muncul sebagai ikon di dashboard.

---

## Update Aplikasi (VPS maupun CasaOS)

Setelah mengganti file project (misalnya upload zip versi baru):

```bash
cd buku-kas-app
docker compose down
docker compose up -d --build
```

---

## Troubleshooting

**"Terlalu banyak percobaan. Coba lagi dalam 15 menit."**
Rate limiter aktif. Tunggu 15 menit atau restart server.

**Selalu ke-redirect ke halaman login walau baru saja login**
Kemungkinan `SESSION_SECRET` berubah saat restart (di mode dev, secret acak di-generate ulang setiap kali). Ini normal di development. Di production, set `SESSION_SECRET` secara permanen di file `.env`.

**Server menolak start dengan pesan "FATAL: SESSION_SECRET wajib diatur"**
Anda menjalankan di mode production (`NODE_ENV=production`) tanpa mengatur `SESSION_SECRET`. Buat file `.env` dari template: `cp .env.example .env`, lalu isi nilainya.

**`Error: Cannot find module 'express'`**
Jalankan `npm install` terlebih dahulu, atau gunakan Docker.

**Port tidak bisa diakses**
Port mapping di `docker-compose.yml`: `"3300:3000"`. Pastikan port 3300 belum dipakai. Cek dengan:
```bash
sudo ss -tlnp | grep LISTEN
```

**Container tidak muncul di `docker ps` atau restart terus**
Cek log:
```bash
docker compose logs buku-kas
```

**Firewall memblokir akses dari luar**
```bash
sudo ufw status
sudo ufw allow 3300/tcp
```

---

## Catatan Operasional

- **Persistensi data**: volume `./data:/app/data` di `docker-compose.yml` memetakan database SQLite ke luar container. Jangan hapus folder ini.
- **Backup**: cukup salin file `data/kas.db` secara berkala.
- **Reverse proxy / HTTPS**: untuk akses dari luar jaringan lokal, daftarkan container ini (port 3300) ke reverse proxy (Nginx Proxy Manager, Traefik, Caddy, dll).

## API Endpoint (referensi)

| Method | Endpoint                     | Auth | Keterangan                         |
|--------|------------------------------|------|-------------------------------------|
| POST   | `/api/register`              | ❌   | Daftar akun baru                    |
| POST   | `/api/login`                 | ❌   | Login                               |
| POST   | `/api/logout`                | ❌   | Logout                              |
| GET    | `/api/me`                    | ❌   | Cek status login & username         |
| GET    | `/api/transactions`          | ✅   | Ambil semua transaksi user          |
| POST   | `/api/transactions`          | ✅   | Tambah transaksi baru               |
| DELETE | `/api/transactions/:id`      | ✅   | Hapus transaksi                     |
| GET    | `/api/summary?month=YYYY-MM` | ✅   | Ringkasan bulanan + grafik          |
| GET    | `/api/categories`            | ✅   | Ambil semua kategori user           |
| POST   | `/api/categories`            | ✅   | Tambah/update kategori              |
| DELETE | `/api/categories/:name`      | ✅   | Hapus kategori                      |
| GET    | `/api/goals`                 | ✅   | Ambil semua tujuan tabungan         |
| POST   | `/api/goals`                 | ✅   | Tambah tujuan baru                  |
| POST   | `/api/goals/:id/add-funds`   | ✅   | Tambah dana ke tujuan               |
| DELETE | `/api/goals/:id`             | ✅   | Hapus tujuan                        |
| GET    | `/api/reminders`             | ✅   | Ambil semua pengingat               |
| POST   | `/api/reminders`             | ✅   | Tambah pengingat baru               |
| POST   | `/api/reminders/:id/pay`     | ✅   | Tandai pengingat lunas              |
| DELETE | `/api/reminders/:id`         | ✅   | Hapus pengingat                     |
| GET    | `/api/health`                | ❌   | Cek status server                   |

## Kategori Default (per user baru)

**Pengeluaran**: Makan, Transport, Kos/Sewa, Pulsa/Internet, Hiburan, Belanja, Kesehatan, Lainnya

**Pemasukan**: Uang Saku, Beasiswa, Kerja Part-time, Hadiah

Kategori default otomatis dimasukkan saat pengguna baru mendaftar. Setiap user bebas menambah/menghapus kategori sendiri melalui menu Kategori di dashboard.
