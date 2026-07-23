# Panduan Menghubungkan: Hapus Iklan + Pembayaran Otomatis + Adsterra

Dokumen ini menyambungkan 4 bagian: **penyimpanan (Vercel KV)**, **pembayaran**, **webhook otomatis**, dan **iklan Adsterra**.

Cara kerja singkat:
```
User (gratis)  →  tiap generate ke-2 muncul iklan Adsterra
User klik "Hapus Iklan" → bayar (username dibawa otomatis di order_id)
Platform bayar → kirim webhook ke /api/webhook → username ditandai BEBAS IKLAN 30 hari (di KV)
User login/segarkan → iklan hilang otomatis
```

Semua status disimpan per-username di Vercel KV. Tidak ada kode yang perlu disalin user.

---

## LANGKAH 1 — Aktifkan penyimpanan (Vercel KV / Upstash)

Ini "ingatan" aplikasi: siapa yang sudah bebas iklan.

1. Di dashboard Vercel, buka proyekmu → tab **Storage**.
2. Pilih **KV** (Upstash Redis) → **Create**. Ikuti sampai selesai (pilih region terdekat, mis. Singapore).
3. Klik **Connect to Project** → pilih proyekmu → **Connect**.

Vercel otomatis menambahkan env `KV_REST_API_URL` dan `KV_REST_API_TOKEN` ke proyekmu. Tidak perlu menyalin manual. (Kalau kamu pakai Upstash langsung, isi `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN` — kode mendukung keduanya.)

---

## LANGKAH 2 — Tambahkan Environment Variables

Di **Settings → Environment Variables**, pastikan ada semua ini:

| Nama | Isi | Keterangan |
|---|---|---|
| `BOSON_API_KEY` | `bai-...` | (sudah ada) |
| `AUTH_SECRET` | teks acak | (sudah ada) untuk token login |
| `KV_REST_API_URL` | otomatis dari Langkah 1 | |
| `KV_REST_API_TOKEN` | otomatis dari Langkah 1 | |
| `WEBHOOK_SECRET` | teks acak buatanmu, mis. `whk_9f2kx8` | pengaman webhook |
| `BUY_URL_WEEK` | link bayar paket mingguan | dari Langkah 3 |
| `BUY_URL_MONTH` | link bayar paket bulanan | dari Langkah 3 |
| `AD_PRICE_WEEK` | `Rp9.900` | (opsional) tulisan harga |
| `AD_PRICE_MONTH` | `Rp24.500` | (opsional) tulisan harga |
| `GRACE_DAYS` | `14` | (opsional) masa bebas iklan otomatis untuk user baru |

Setelah menambah/mengubah env, **Redeploy** agar terbaca.

---

## LANGKAH 3 — Buat produk & link pembayaran

Kamu butuh **dua produk / dua link bayar**:
- **Mingguan** — Rp9.900 (aktif 7 hari)
- **Bulanan** — Rp24.500 (aktif 30 hari)

Aplikasi otomatis menambahkan penanda paket ke `order_id`:
- Mingguan → `order_id = username__w__waktu`
- Bulanan → `order_id = username__m__waktu`

Webhook membaca penanda `w`/`m` untuk menentukan 7 atau 30 hari. (Kalau penanda tidak terbawa, ia menebak dari nominal: ≤ Rp15.000 dianggap mingguan.)

### Pilihan A — Pakasir (paling cocok)
1. Daftar di pakasir.com, buat **Project**.
2. Buat dua item harga (9.900 dan 24.500), ambil link checkout masing-masing → isikan ke `BUY_URL_WEEK` dan `BUY_URL_MONTH`.
3. Aplikasi menambahkan `?order_id=username__w__...` / `__m__...` secara otomatis.
4. Isi **URL Webhook** project dengan:
   ```
   https://DOMAINKAMU.vercel.app/api/webhook?secret=WEBHOOK_SECRET_KAMU
   ```

### Pilihan B — Mayar
1. Buat **dua produk** (Rp9.900 dan Rp24.500). Salin link masing-masing → `BUY_URL_WEEK` & `BUY_URL_MONTH`.
2. Aktifkan **Webhook** ke URL yang sama seperti di atas.
3. Mayar mungkin tidak membawa `order_id` dari URL. Webhook sudah menebak paket dari **nominal** (9.900 = mingguan, 24.500 = bulanan), jadi tetap jalan. Tapi username perlu dibawa lewat **field khusus** `username` di form, atau kirim saya contoh payload Mayar agar saya sesuaikan.

> Uang masuk ke saldo platform, lalu ditarik ke rekening bankmu.

---

## LANGKAH 4 — Uji dulu TANPA bayar (penting!)

Sebelum menyambung pembayaran sungguhan, pastikan pipa-nya jalan. Ganti `DOMAIN`, `WEBHOOK_SECRET`, dan `namauser` (username yang kamu pakai login):

```bash
curl -X POST "https://DOMAIN.vercel.app/api/webhook?secret=WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"paid\",\"order_id\":\"namauser__m__123\"}"
```

(`__m__` = bulanan/30 hari, `__w__` = mingguan/7 hari.)

Kalau balasannya `{"ok":true,"username":"namauser","adFree":true}` → berhasil. Sekarang login sebagai `namauser` (atau tekan "Saya sudah bayar") → iklan hilang.

Cek juga status langsung di browser:
```
https://DOMAIN.vercel.app/api/status?u=namauser   ->  {"adFree":true}
```

---

## LANGKAH 5 — Pasang iklan Adsterra

1. Daftar di adsterra.com sebagai **Publisher**, tambahkan situs `DOMAIN.vercel.app`, tunggu disetujui.
2. Buat ad unit **Banner 300×250** → Adsterra memberi potongan kode `<script>...</script>`.
3. Buka `public/index.html`, cari baris:
   ```js
   const ADSTERRA_HTML = ``;
   ```
   Tempel seluruh kode Adsterra di antara dua backtick tersebut:
   ```js
   const ADSTERRA_HTML = `<script type="text/javascript">atOptions = {...};</script><script src="//..."></script>`;
   ```
4. Commit → tunggu Vercel Ready.

Selama belum diisi, modal iklan tetap muncul tapi menampilkan kotak "Slot iklan" (tidak menghasilkan uang, hanya placeholder). Jadi alurnya bisa diuji lebih dulu.

---

## Cara kerja iklannya (pola 2×)
- Hitungan generate dilacak di sisi browser. **Generate ke-1 bersih, ke-2 iklan, ke-3 bersih, ke-4 iklan**, dst.
- Berlaku untuk semua tab (TTS, Ekspresi, Kloning, Podcast, Buku Audio, Batch).
- User yang sudah "Hapus Iklan" → `AD_FREE` → tidak pernah lihat iklan.

## Masa bebas iklan otomatis untuk user baru (senyap)
- Setiap user baru otomatis **bebas iklan selama 14 hari** (atur lewat `GRACE_DAYS`). Jam mulainya dihitung sejak **login pertama** — kamu tidak perlu mencatat tanggal manual di `users.txt`.
- **Tanpa label apa pun** (tidak ada tulisan "trial/uji coba", tidak ada badge). Pembeli hanya merasa aplikasinya bersih. Setelah masa itu habis, iklan mulai muncul dan tombol "Hapus Iklan" tampil.
- Badge "✓ Bebas iklan aktif" **hanya** muncul untuk yang benar-benar membeli Hapus Iklan.
- Perlu Vercel KV (Langkah 1) aktif, karena waktu login pertama disimpan di sana.

## Anti-adblocker
- Saat halaman dibuka dan saat waktunya iklan (generate ke-2), aplikasi memeriksa apakah ada adblocker (pakai elemen & skrip umpan).
- Kalau terdeteksi, muncul dinding: "Adblocker terdeteksi" dengan pilihan **matikan lalu coba lagi** atau **Hapus Iklan**. User tidak bisa lewat begitu saja.
- **Jujur soal batasnya:** deteksi adblocker tidak pernah 100%. Sebagian pemblokir canggih atau pengguna teknis tetap bisa lolos, dan kadang ada *false positive* (ekstensi privasi non-adblock ikut ketahuan) yang bisa mengganggu user jujur. Ini wajar untuk semua situs. Jangan dibuat terlalu galak agar user asli tidak kabur.

## Yang perlu kamu tahu (jujur)
- **Framing "Hapus Iklan":** tombol sengaja tidak memakai kata "premium/langganan" agar terasa ringan. Tapi masa aktifnya tetap **30 hari** dan itu tetap ditulis kecil di modal — ini penting supaya tidak menyesatkan (kalau disembunyikan, user bisa merasa tertipu saat iklan muncul lagi). Silakan atur kata-katanya, tapi sebaiknya durasi tetap terlihat.
- **Keamanan username:** karena username bebas dibuat, orang bisa membeli untuk username apa pun. Itu hanya menguntungkan username tsb, jadi risikonya kecil. Kalau nanti perlu, bisa ditambah pembatasan.
- **Webhook wajib HTTPS + secret.** Jangan bagikan `WEBHOOK_SECRET`.
- **Adsterra** butuh trafik untuk menghasilkan; jangan mengklik iklan sendiri (bisa kena banned).

## Ringkasan URL penting
- Bayar (dibuka user): `BUY_URL` + `?order_id=username__waktu` (otomatis)
- Webhook (diisi di platform): `https://DOMAIN.vercel.app/api/webhook?secret=WEBHOOK_SECRET`
- Cek status: `https://DOMAIN.vercel.app/api/status?u=username`
