# Higgs TTS di Cloudflare

Versi aplikasi TTS untuk di-deploy ke **Cloudflare Workers** (frontend statis + endpoint proxy dalam satu deployment). API key kamu disimpan sebagai **secret** di Cloudflare, tidak pernah dikirim ke browser.

```
Browser  →  Cloudflare Worker (menyimpan secret)  →  api.boson.ai
 index.html      src/index.js                          Higgs TTS
```

---

## Ada dua cara pakai Cloudflare — pilih yang sesuai

### Cara 1 — Host penuh di Cloudflare Workers  ← isi folder ini
Seluruh web (halaman + proxy key) jalan di jaringan Cloudflare. Tidak perlu VPS. Gratis untuk pemakaian wajar. **Ini yang direkomendasikan Cloudflare untuk proyek baru.** Ikuti langkah di bawah.

### Cara 2 — Cloudflare hanya di depan server yang sudah ada
Kalau kamu sudah menjalankan versi Node/Express (`server.js`) di VPS/Render, kamu **tidak perlu** memindahkannya. Cukup:
1. Tambahkan domain kamu ke Cloudflare (ganti nameserver di tempat beli domain ke nameserver Cloudflare).
2. Buat DNS record (A ke IP VPS, atau CNAME ke URL Render) dengan status **Proxied** (awan oranye).
3. Di tab **SSL/TLS**, pilih mode **Full**.

Selesai — kamu dapat CDN, DDoS protection, dan HTTPS gratis di depan server lama. Tidak perlu file di folder ini.

---

## Langkah untuk Cara 1 (Workers)

### Langkah 1 — Pasang Node.js
Butuh Node.js 18+ dari https://nodejs.org. Cek: `node -v`.

### Langkah 2 — Login ke Cloudflare
```bash
npm install
npx wrangler login
```
Browser akan terbuka untuk otorisasi akun Cloudflare kamu.

### Langkah 3 — Coba dulu di lokal
Salin file contoh menjadi `.dev.vars` lalu isi key kamu:
```bash
cp .dev.vars.example .dev.vars
```
Isi `.dev.vars`:
```
BOSON_API_KEY=bai-xxxxxxxxxxxx
```
Jalankan:
```bash
npm run dev
```
Buka URL lokal yang ditampilkan (mis. http://localhost:8787), coba hasilkan suara.
> Dapat key di https://boson.ai/workspace

### Langkah 4 — Simpan API key sebagai secret di Cloudflare
Ini yang membuat key aman di server (bukan di kode):
```bash
npx wrangler secret put BOSON_API_KEY
```
Tempel key `bai-...` saat diminta. Secret ini terenkripsi dan hanya dibaca oleh Worker — tidak ikut ke Git dan tidak terlihat di browser.

### Langkah 5 — Deploy
```bash
npm run deploy
```
Kamu akan dapat URL seperti `https://higgs-tts.<akun>.workers.dev`. Buka — sudah live.

### Langkah 6 — Pasang domain kamu
Syarat: domain kamu harus dikelola di Cloudflare (nameserver-nya menunjuk ke Cloudflare).
- **Lewat dashboard:** buka Workers &amp; Pages → pilih Worker `higgs-tts` → **Settings → Domains & Routes → Add → Custom Domain** → ketik `tts.domainkamu.com` (atau `domainkamu.com`). Cloudflare otomatis membuat DNS + SSL-nya.

Setelah itu web bisa diakses di domain kamu dengan HTTPS otomatis.

---

## Struktur file
```
higgs-tts-cf/
├─ src/index.js          # Worker: proxy rahasia + serve static
├─ public/index.html     # halaman web (static asset)
├─ wrangler.jsonc        # konfigurasi (assets binding di sini)
├─ package.json
├─ .dev.vars.example     # contoh key untuk dev lokal; salin jadi .dev.vars
└─ .gitignore            # menjaga .dev.vars & node_modules tidak ke Git
```

## Perintah yang sering dipakai
| Aksi | Perintah |
|---|---|
| Dev lokal | `npm run dev` |
| Simpan/ganti key | `npx wrangler secret put BOSON_API_KEY` |
| Deploy | `npm run deploy` |
| Lihat log langsung | `npx wrangler tail` |

## Catatan
- API Boson AI masih **public preview gratis + rate-limited**. Error HTTP 429 = kena batas, tunggu lalu ulangi.
- Untuk penggunaan komersial, cek dulu lisensi Boson AI. Jangan mengkloning suara orang tanpa izin.
- Dokumentasi API: https://docs.boson.ai/models/higgs-audio-tts/overview
