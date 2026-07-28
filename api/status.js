import { isAdFree, getJoined, graceInfo, isVip, quotaStatus } from "./_lib.js";
// Cek status bebas iklan + sisa kuota sebuah username.
export default async function handler(req, res) {
  const u = (req.query?.u || "").toString();
  const vip = isVip(u);
  const paid = vip || await isAdFree(u);
  const g = graceInfo(await getJoined(u));
  const quota = await quotaStatus(u);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ adFree: paid || g.grace, paid, vip, grace: g.grace, quota });
}
