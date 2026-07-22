# Voice Pro Max — versi Vercel

Versi ini sudah diubah agar berjalan benar di **Vercel**. Backend dipecah jadi *serverless function* di folder `api/`, dan login dibuat *stateless* (token bertanda tangan) supaya tidak putus saat Vercel berpindah instance.

```
public/index.html      → tampilan (statis)
api/speech.js          → menghasilkan suara (proxy ke Boson)
api/login.js           → login user
api/voices.js          → daftar preset suara
api/config.js          → status
api/_lib.js            → kode bersama (bukan endpoint)
voices/  users.txt      → aset yang dibawa ke fungsi (lihat vercel.json)
```

## Langkah deploy

1. **Ganti API key dulu.** Key lamamu sudah bocor di chat — buat key baru di https://boson.ai/workspace
2. Unggah folder ini ke repository **GitHub** (pakai GitHub Desktop kalau belum terbiasa).
   `.env` tidak ikut (sudah di `.gitignore`) — itu memang benar; key diisi di Vercel, bukan di kode.
3. Buka https://vercel.com → **Add New → Project** → pilih repo GitHub tadi → **Import**.
   Framework Preset: **Other** (biarkan default). Klik **Deploy**.
4. Setelah selesai, buka **Project → Settings → Environment Variables**, tambahkan:
   - `BOSON_API_KEY` = key baru kamu (`bai-...`)
   - `AUTH_SECRET` = teks acak panjang bebas (untuk mengunci token login)
   - (opsional) `BOSON_MODEL` = `higgs-tts-3`
5. Buka tab **Deployments → ⋯ → Redeploy** sekali lagi, supaya key yang baru ditambahkan ikut terbaca.

Selesai — buka alamat `namaproyek.vercel.app`. Untuk domain sendiri: **Settings → Domains → Add**.

## Login (users.txt)
- Format `username:password`, satu per baris. Baris `#` = komentar. Kosong = web terbuka.
- Login default: `admin` / `rahasia123` — **ganti dulu**.
- **Beda dengan versi lokal:** di Vercel, mengubah `users.txt` harus lewat GitHub lalu **deploy ulang** (filesystem Vercel tidak bisa diedit langsung saat berjalan).

## Batas Vercel yang perlu diketahui
Vercel bukan server yang hidup terus, jadi ada batasan wajar:
- **Ukuran per permintaan/hasil ~4,5 MB.** Untuk TTS pendek, podcast, dan batch aman (tiap baris diproses satu per satu). Kalau **mengunggah audio referensi sendiri** di tab Kloning, pakai klip pendek (≤ ±3 MB). Preset bawaan tidak terpengaruh karena filenya dibaca di sisi server.
- **Waktu jalan per fungsi dibatasi** (diset 60 detik di `vercel.json`). Teks sangat panjang sebaiknya dipecah.

Kalau butuh tanpa batasan ini (audio panjang, upload besar), pakai host server biasa seperti **Render** — kode versi Express yang lama jalan di sana tanpa batas tersebut.

## Kalau setelah deploy preset/login tidak muncul
Biasanya karena file `voices/` atau `users.txt` tidak ikut ter-bundle ke fungsi. Itu diatur oleh baris `includeFiles` di `vercel.json` — pastikan file `vercel.json` ikut ter-upload ke GitHub.

## Catatan
- API Boson: **public preview, gratis + rate limit**. Error 429 = kena batas, tunggu lalu ulangi.
- Hanya klon suara yang kamu punya haknya.
- Link donasi di header mengarah ke pembuat asli (Korobroo). Ganti di `public/index.html` (cari `HEADER / BRANDING`).
- Dokumentasi API: https://docs.boson.ai/models/higgs-audio-tts/overview
