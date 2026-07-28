import { requireAuth, synth, API_KEY, verifyToken, cekLaju, quotaConsume, QUOTA, isVip,
         refAmbil, refSimpan } from "./_lib.js";

// Kunci pembatas laju: username kalau login aktif, kalau tidak pakai IP.
function kunciLaju(req) {
  const t = verifyToken(req.headers["x-auth-token"]);
  if (t?.user) return "u:" + t.user;
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return "ip:" + (ip || "anon");
}
// Identitas untuk kuota. Tanpa login, kuota menempel pada alamat IP.
function siapa(req) {
  const t = verifyToken(req.headers["x-auth-token"]);
  if (t?.user) return t.user;
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  return "ip:" + (ip || "anon");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;
  try {
    if (!API_KEY) return res.status(500).json({ error: "Server belum punya BOSON_API_KEY." });
    const input = (req.body?.input || "").toString().trim();
    if (!input) return res.status(400).json({ error: "Teks tidak boleh kosong." });

    const user = siapa(req);
    const vip = isVip(user);
    // Batas satu kali kirim. VIP memakai batas lama yang longgar.
    const batasKirim = vip ? 8000 : QUOTA.perRequest;
    if (input.length > batasKirim) {
      return res.status(400).json({
        error: `Teks terlalu panjang (maks ${batasKirim} karakter).`,
        overLimit: true, perRequest: batasKirim,
      });
    }

    // Pagar pertama: tahan permintaan bertubi-tubi dari satu pengguna sebelum
    // sampai ke Boson (hanya aktif kalau RATE_LIMIT_PER_MIN diisi).
    const laju = await cekLaju(kunciLaju(req));
    if (!laju.ok) {
      res.setHeader("Retry-After", String(laju.retryAfter));
      return res.status(429).json({
        error: `Terlalu banyak permintaan (batas ${laju.limit}/menit). Coba lagi dalam ${laju.retryAfter} detik.`,
        retryAfter: laju.retryAfter,
        rateLimited: true,
      });
    }

    // ---- audio referensi: cukup sidiknya, audio penuh hanya kalau belum tersimpan ----
    const refId = (req.body?.ref_id || "").toString().trim();
    let refAudio = req.body?.ref_audio, refText = req.body?.ref_text;
    if (refId) {
      if (refAudio) {
        refSimpan(refId, refAudio, refText);           // titipkan untuk potongan berikutnya
      } else {
        const simpanan = refAmbil(refId);
        // Instans ini belum pernah menerima audionya (atau sudah terbuang).
        // Minta klien mengirim ulang sekali; ini permintaan kecil dan tidak
        // menyentuh Boson, jadi tidak ada biaya generasi yang terbuang.
        if (!simpanan) {
          return res.status(409).json({
            error: "Audio referensi belum tersimpan di server.",
            refMissing: true, ref_id: refId,
          });
        }
        refAudio = simpanan.ref_audio;
        refText = simpanan.ref_text || refText;
      }
    }

    // Pagar kedua — kuota: 10.000 karakter -> jeda 30 menit, 65.000 karakter -> tutup
    // sampai Senin. Diperiksa SEBELUM Boson dipanggil, jadi permintaan yang
    // ditolak tidak memakan biaya apa pun.
    const kuota = await quotaConsume(user, input);
    if (!kuota.ok) {
      res.setHeader("Retry-After", String(kuota.retryAfter));
      return res.status(429).json({
        error: kuota.message,
        quota: {
          reason: kuota.reason, message: kuota.message,
          retryAfter: kuota.retryAfter, resetAt: kuota.resetAt,
          weekly: kuota.weekly, burst: kuota.burst,
        },
        retryAfter: kuota.retryAfter,
      });
    }

    const { mime, buf } = await synth({
      input, voice: req.body?.voice, preset: req.body?.preset,
      ref_audio: refAudio, ref_text: refText, response_format: req.body?.response_format,
    });
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
    if (kuota.weekly) res.setHeader("X-Quota-Weekly-Left", String(kuota.weekly.sisa));
    res.status(200).send(buf);
  } catch (e) {
    const status = e.status || 500;
    // Beri tahu klien berapa lama sebaiknya menunggu, supaya klien bisa
    // menjadwalkan ulang dengan tenang alih-alih mengulang seketika.
    const retryAfter = e.retryAfter != null
      ? Math.max(1, Math.ceil(e.retryAfter))
      : (status === 429 ? 5 : (status >= 500 ? 3 : null));
    if (retryAfter != null && (status === 429 || status >= 500)) {
      res.setHeader("Retry-After", String(retryAfter));
    }
    const pesan = status === 429
      ? "Kuota permintaan ke Boson AI sedang penuh. Permintaan akan dicoba ulang otomatis."
      : e.message;
    res.status(status).json({
      error: pesan,
      detail: e.detail,
      ...(retryAfter != null ? { retryAfter } : {}),
      ...(status === 429 ? { rateLimited: true } : {}),
    });
  }
}
