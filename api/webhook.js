import { setAdFree } from "./_lib.js";
// Dipanggil OTOMATIS oleh platform pembayaran saat lunas.
// order_id format: "username__PLAN__waktu"  (PLAN: w = 7 hari, m = 30 hari)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = (req.query?.secret || "").toString();
  if (!process.env.WEBHOOK_SECRET || secret !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Secret salah." });
  }

  const b = req.body || {};
  const statusStr = String(b.status || b.event || b.type || b.transaction?.status || b.data?.status || "").toLowerCase();
  const paid = ["paid", "completed", "complete", "success", "settle", "settlement", "capture", "received", "active"].some((w) => statusStr.includes(w));

  let ref = String(
    b.order_id || b.reference || b.username || b.merchantRef ||
    b.transaction?.order_id || b.data?.order_id || b.data?.reference || ""
  ).trim();
  const parts = ref.split("__");
  const username = (parts[0] || "").trim();
  const plan = (parts[1] || "").trim().toLowerCase();

  // tentukan durasi: dari kode paket, atau dari nominal bayar sebagai cadangan
  const amount = Number(b.amount || b.gross_amount || b.transaction?.amount || b.data?.amount || 0);
  let days = 30;
  if (plan === "w") days = 7;
  else if (plan === "m") days = 30;
  else if (amount && amount <= 15000) days = 7; // 9.900 -> mingguan

  if (!paid) return res.status(200).json({ ok: true, ignored: true, reason: "belum lunas", status: statusStr });
  if (!username) return res.status(200).json({ ok: true, ignored: true, reason: "username tidak ditemukan" });

  try { await setAdFree(username, days); }
  catch (e) { return res.status(500).json({ error: String(e) }); }
  return res.status(200).json({ ok: true, username, days, adFree: true });
}
