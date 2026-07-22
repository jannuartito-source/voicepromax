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
