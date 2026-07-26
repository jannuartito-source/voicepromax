import { requireAuth, synth, API_KEY, verifyToken, cekLaju } from "./_lib.js";

// Kunci pembatas laju: username kalau login aktif, kalau tidak pakai IP.
function kunciLaju(req) {
  const t = verifyToken(req.headers["x-auth-token"]);
  if (t?.user) return "u:" + t.user;
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
    if (input.length > 8000) return res.status(400).json({ error: "Teks terlalu panjang (maks 8000)." });

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

    const { mime, buf } = await synth({
      input, voice: req.body?.voice, preset: req.body?.preset,
      ref_audio: req.body?.ref_audio, ref_text: req.body?.ref_text, response_format: req.body?.response_format,
    });
    res.setHeader("Content-Type", mime);
    res.setHeader("Cache-Control", "no-store");
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
