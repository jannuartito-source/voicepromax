import { readUsers, makeToken } from "./_lib.js";
export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const user = (req.body?.username || "").toString().trim();
  const pass = (req.body?.password || "").toString();
  const users = readUsers();
  if (!users.size) return res.status(200).json({ ok: true, token: "", open: true });
  if (users.has(user) && users.get(user) === pass) {
    return res.status(200).json({ ok: true, token: makeToken(user), username: user });
  }
  return res.status(401).json({ ok: false, error: "Username atau password salah." });
}
