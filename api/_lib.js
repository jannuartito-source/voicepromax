// api/_lib.js — kode bersama untuk semua fungsi serverless.
// File diawali "_" tidak menjadi endpoint sendiri.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const BOSON_URL = "https://api.boson.ai/v1/audio/speech";
export const MODEL = process.env.BOSON_MODEL || "higgs-tts-3"; // fallback: higgs-audio-v3-tts
export const API_KEY = process.env.BOSON_API_KEY;
// Kunci untuk menandatangani token login. WAJIB diisi di Environment Variables Vercel.
const AUTH_SECRET = process.env.AUTH_SECRET || "ganti-secret-ini-di-vercel";

const ROOT = process.cwd();
const VOICES_DIR = path.join(ROOT, "voices");
const USERS_FILE = path.join(ROOT, "users.txt");

export const AUDIO_EXT = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
export const BOSON_PRESETS = ["default", "jake"];

// ---------- penyimpanan status "bebas iklan" (Vercel KV / Upstash Redis) ----------
// Mendukung penamaan env dari Vercel KV maupun Upstash.
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const kvReady = Boolean(KV_URL && KV_TOKEN);

async function kv(parts) {
  const path_ = parts.map(encodeURIComponent).join("/");
  const r = await fetch(`${KV_URL}/${path_}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  if (!r.ok) throw new Error("KV error " + r.status);
  return (await r.json()).result;
}
const adKey = (u) => `adfree:${String(u || "").trim().toLowerCase()}`;

// Tandai username bebas iklan selama N hari (pakai TTL Redis -> otomatis hangus).
export async function setAdFree(username, days = 30) {
  if (!kvReady) throw new Error("KV belum dikonfigurasi (KV_REST_API_URL / KV_REST_API_TOKEN).");
  return kv(["setex", adKey(username), String(Math.round(days * 86400)), "1"]);
}
// Cek apakah username masih bebas iklan.
export async function isAdFree(username) {
  if (!kvReady || !username) return false;
  try { return (await kv(["get", adKey(username)])) === "1"; } catch { return false; }
}

// ---------- masa percobaan bebas iklan (grace) untuk user baru ----------
// Jam mulai dihitung sejak LOGIN PERTAMA (otomatis, tanpa catat tanggal manual).
const GRACE_DAYS = Number(process.env.GRACE_DAYS || 14);
const joinKey = (u) => `joined:${String(u || "").trim().toLowerCase()}`;

// Set waktu bergabung kalau belum ada (dipakai HANYA saat login terverifikasi).
export async function ensureJoined(username) {
  if (!kvReady || !username) return 0;
  try {
    const j = await kv(["get", joinKey(username)]);
    if (j) return Number(j);
    const now = Date.now();
    await kv(["set", joinKey(username), String(now)]);
    return now;
  } catch { return 0; }
}
// Baca saja (tanpa membuat) — dipakai endpoint status publik.
export async function getJoined(username) {
  if (!kvReady || !username) return 0;
  try { const j = await kv(["get", joinKey(username)]); return j ? Number(j) : 0; } catch { return 0; }
}
export function graceInfo(joinedTs) {
  if (!joinedTs) return { grace: false, daysLeft: 0 };
  const left = GRACE_DAYS * 86400000 - (Date.now() - joinedTs);
  return { grace: left > 0, daysLeft: Math.max(0, Math.ceil(left / 86400000)) };
}

// ---------- user & login (stateless, cocok untuk serverless) ----------
export function readUsers() {
  const users = new Map();
  try {
    const txt = fs.readFileSync(USERS_FILE, "utf8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf(":");
      if (i <= 0) continue;
      users.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }
  } catch {}
  return users;
}
export function loginEnabled() { return readUsers().size > 0; }

const b64u = (b) => Buffer.from(b).toString("base64url");
function sign(data) { return crypto.createHmac("sha256", AUTH_SECRET).update(data).digest("base64url"); }

export function makeToken(user) {
  const payload = b64u(JSON.stringify({ u: user, exp: Date.now() + 30 * 24 * 3600 * 1000 }));
  return `${payload}.${sign(payload)}`;
}
export function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (sign(payload) !== sig) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > exp) return null;
    return { user: u };
  } catch { return null; }
}
// true kalau boleh lanjut; kalau tidak, kirim 401 dan return false.
export function requireAuth(req, res) {
  if (!loginEnabled()) return true;
  if (verifyToken(req.headers["x-auth-token"])) return true;
  res.status(401).json({ error: "Sesi tidak valid. Silakan login.", needLogin: true });
  return false;
}

// ---------- preset suara ----------
export function listPresets() {
  let files = [];
  try { files = fs.readdirSync(VOICES_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!AUDIO_EXT[ext]) continue;
    const base = path.basename(f, ext);
    out.push({ name: base, file: f, ext, hasText: fs.existsSync(path.join(VOICES_DIR, base + ".txt")) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export function presetAsRef(name) {
  const p = listPresets().find((x) => x.name === name);
  if (!p) return null;
  const buf = fs.readFileSync(path.join(VOICES_DIR, p.file));
  const dataUri = `data:${AUDIO_EXT[p.ext] || "audio/mpeg"};base64,${buf.toString("base64")}`;
  let refText = "";
  if (p.hasText) { try { refText = fs.readFileSync(path.join(VOICES_DIR, p.name + ".txt"), "utf8").trim(); } catch {} }
  return { ref_audio: dataUri, ref_text: refText };
}

// ---------- panggil Boson ----------
export async function synth({ input, voice, preset, ref_audio, ref_text, response_format }) {
  const payload = { model: MODEL, input, response_format: response_format || "mp3" };
  if (ref_audio) { payload.ref_audio = ref_audio; if (ref_text) payload.ref_text = ref_text; }
  else if (preset) {
    const ref = presetAsRef(preset);
    if (!ref) throw Object.assign(new Error(`Preset "${preset}" tidak ditemukan.`), { status: 400 });
    payload.ref_audio = ref.ref_audio; if (ref.ref_text) payload.ref_text = ref.ref_text;
  } else if (voice && voice !== "default") payload.voice = voice;

  const r = await fetch(BOSON_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 500);
    throw Object.assign(new Error(`Boson AI menolak (HTTP ${r.status}).`), { status: r.status, detail });
  }
  const mime = r.headers.get("content-type") || "audio/mpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime, buf };
}
