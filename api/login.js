import { readUsers, makeToken, isAdFree, ensureJoined, graceInfo, isVip } from "./_lib.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = (req.body?.username || "").toString().trim();
  const pass = (req.body?.password || "").toString();
  const users = readUsers();
  if (!users.size) return res.status(200).json({ ok: true, token: "", open: true, adFree: false, paid: false });
  if (users.has(user) && users.get(user) === pass) {
    const vip = isVip(user);                    // VIP: bebas iklan selamanya
    const paid = vip || await isAdFree(user);   // atau sudah beli Hapus Iklan
    const joined = await ensureJoined(user);    // mulai hitung masa bebas iklan (login pertama)
    const g = graceInfo(joined);                // masih dalam masa awal?
    const adFree = paid || g.grace;
    return res.status(200).json({ ok: true, token: makeToken(user), username: user, adFree, paid });
  }
  return res.status(401).json({ ok: false, error: "Username atau password salah." });
}
