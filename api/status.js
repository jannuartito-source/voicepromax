import { isAdFree, getJoined, graceInfo, isVip } from "./_lib.js";
// Cek status bebas iklan sebuah username.
export default async function handler(req, res) {
  const u = (req.query?.u || "").toString();
  const vip = isVip(u);
  const paid = vip || await isAdFree(u);
  const g = graceInfo(await getJoined(u));
  res.status(200).json({ adFree: paid || g.grace, paid });
}
