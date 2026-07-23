import { isAdFree, getJoined, graceInfo } from "./_lib.js";
// Cek status bebas iklan sebuah username (dipakai "Saya sudah bayar" & saat buka halaman).
export default async function handler(req, res) {
  const u = (req.query?.u || "").toString();
  const paid = await isAdFree(u);
  const g = graceInfo(await getJoined(u));
  res.status(200).json({ adFree: paid || g.grace, paid });
}
