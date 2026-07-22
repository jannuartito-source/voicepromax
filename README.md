# Voice Pro Max — versi web (tanpa Gradio)

Meniru tampilan & fungsi aplikasi **PINOKIO PROMAX / Voice Pro Max**, tapi dibangun sebagai web biasa (HTML/CSS/JS + backend kecil Node). Suara dihasilkan lewat **Boson AI Higgs TTS** — jadi **tidak perlu GPU, torch, atau llama.cpp**.

```
Browser (tampilan)  →  server.js (menyimpan API key)  →  api.boson.ai
```

---

## ⚠️ Baca dulu: amankan API key kamu
Kamu sempat menempelkan API key asli di chat. Anggap key itu sudah bocor. **Buat ulang (regenerate)** di https://boson.ai/workspace, lalu simpan key **baru** hanya di file `.env` (langkah di bawah). Jangan pernah menaruh key di dalam file HTML/JS.

---

## Cara menjalankan (lokal)

1. Pasang **Node.js 18+** dari https://nodejs.org
2. Salin file contoh jadi `.env`, lalu isi key baru kamu:
   ```bash
   cp .env.example .env
   ```
   ```
   BOSON_API_KEY=bai-key-baru-kamu
   ```
3. Pasang dependency dan jalankan:
   ```bash
   npm install
   npm start
   ```
4. Buka **http://localhost:3000**

---

## Isi tiap tab

- **TTS** — teks → suara. Pilih suara: preset Boson (`Default`, `jake`) atau preset bawaan (kloning).
- **Ekspresi** — sisipkan tag `<|emotion:…|>`, `<|prosody:…|>`, `<|style:…|>`, `<|sfx:…|>` lewat tombol chip untuk mengatur emosi, kecepatan, nada, jeda, dan efek suara.
- **Kloning** — unggah audio referensi (≤30 detik) atau pilih preset bawaan, lalu (opsional) isi transkripnya untuk hasil lebih mirip.
- **Podcast** — tulis skrip `Speaker 0: …` / `Speaker 1: …` per baris, atur suara tiap pembicara, hasilnya digabung.
- **Buku Audio** — sama seperti Podcast: `Speaker 0` sebagai narator, `Speaker 1` dst untuk tokoh.
- **Batch** — satu baris = satu file audio; semua diproses berurutan.

Format keluaran (mp3 / wav) diatur di kanan atas.

---

## Preset suara
Semua file audio di folder `voices/` otomatis jadi preset kloning. Preset dari aplikasi lamamu sudah disertakan. Menambah suara sendiri:
1. Taruh file audio di `voices/` (mis. `Budi.wav`). Nama file = nama di dropdown.
2. (Disarankan) buat `Budi.txt` berisi transkrip persis audio itu — meningkatkan kemiripan.
3. Restart server. Format didukung: `.wav .mp3 .flac .ogg .m4a`.

---

## Yang sengaja diubah dari aplikasi asli
- **Tanpa Gradio** — murni web, jadi bisa dipasang di hosting biasa dan di depan Cloudflare.
- **Pakai API Boson (bukan model lokal)** — tak perlu GPU. Karena itu slider *temperature/top-p/top-k/seed* dihilangkan (API hosted tidak menyediakannya).
- **Sutradara teks AI** (penulis skrip & pemberi tag otomatis) di versi asli memakai LLM lokal (llama.cpp) — **tidak disertakan**. Di sini tag ekspresi disisipkan manual lewat tombol. (Bisa ditambahkan nanti kalau kamu punya API LLM.)
- **Branding & tautan donasi milik "Korobroo" dihapus** — itu identitas/monetisasi orang lain. Header dibuat netral supaya bisa kamu ganti dengan brand-mu sendiri (edit di `public/index.html` bagian `<div class="brand">`).

---

## Menaruh ke domain / Cloudflare
- **Render / VPS:** `npm install` lalu `npm start` (pakai `pm2` di VPS). Arahkan domain via DNS.
- **Di depan Cloudflare:** tambahkan domain ke Cloudflare, buat DNS record **Proxied**, set SSL/TLS **Full**.
- **Password sederhana (opsional):** isi `APP_PASSWORD=...` di `.env` — web akan minta password saat dibuka. (Ini gerbang sederhana, bukan sistem multi-user seperti `users.txt` versi asli.)

## Catatan
- API Boson masih **public preview: gratis tapi ada rate limit**. Error HTTP 429 = kena batas, tunggu lalu ulangi.
- Kalau muncul error terkait nama model, ubah `BOSON_MODEL` di `.env` (mis. `higgs-audio-v3-tts`).
- **Hanya klon suara yang kamu punya haknya.** Dilarang meniru suara orang tanpa izin.
- Dokumentasi API: https://docs.boson.ai/models/higgs-audio-tts/overview
