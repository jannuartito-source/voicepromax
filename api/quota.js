import { verifyToken, quotaStatus, isVip, QUOTA, PESAN_BURST, PESAN_WEEKLY } from "./_lib.js";

// Dibaca halaman SEBELUM tombol "Hasilkan" dijalankan, supaya pengguna yang
// kuotanya sudah mepet diberi tahu lebih dulu — bukan setelah audionya jadi
// separuh. Hanya membaca, tidak pernah menambah hitungan.
export default async function handler(req, res) {
  const t = verifyToken(req.headers["x-auth-token"]);
  const ip = (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim();
  const user = t?.user || (req.query?.u || "").toString().trim() || ("ip:" + (ip || "anon"));

  const s = await quotaStatus(user);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    ...s,
    vip: isVip(user),
    cooldownSec: QUOTA.burstCooldown,
    pesan: { burst: PESAN_BURST, weekly: PESAN_WEEKLY },
  });
}
