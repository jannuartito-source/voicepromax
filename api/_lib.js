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
// Baca users.txt. Baris boleh diberi tanda "*" di depan username = VIP (bebas iklan selamanya).
// Contoh:  *budi:passbudi   -> user budi tidak pernah kena iklan.
function parseUsers() {
  const rows = [];
  try {
    const txt = fs.readFileSync(USERS_FILE, "utf8");
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf(":");
      if (i <= 0) continue;
      let user = line.slice(0, i).trim();
      const pass = line.slice(i + 1).trim();
      let vip = false;
      if (user.startsWith("*")) { vip = true; user = user.slice(1).trim(); }
      if (user) rows.push({ user, pass, vip });
    }
  } catch {}
  return rows;
}
export function readUsers() {
  const users = new Map();
  for (const r of parseUsers()) users.set(r.user, r.pass);
  return users;
}
// Kumpulan username VIP (bebas iklan permanen).
export function vipUsers() {
  const set = new Set();
  for (const r of parseUsers()) if (r.vip) set.add(r.user.toLowerCase());
  return set;
}
export function isVip(username) {
  return vipUsers().has(String(username || "").trim().toLowerCase());
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

// ---------- pengaman rate limit (429) ----------
// Status yang layak dicoba ulang. 429 = terlalu banyak permintaan,
// 5xx = gangguan sementara di sisi Boson. Sisanya (400/401/413) permanen:
// mengulang hanya memperparah antrean.
const STATUS_ULANG = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_ULANG = Math.max(0, Number(process.env.BOSON_MAX_RETRY ?? 4));
const JEDA_AWAL_MS = Math.max(200, Number(process.env.BOSON_RETRY_BASE_MS ?? 900));
const JEDA_MAKS_MS = Math.max(1000, Number(process.env.BOSON_RETRY_MAX_MS ?? 12000));
// Fungsi Vercel dibatasi 60 detik (vercel.json). Sisakan ruang untuk generasi itu
// sendiri, jadi total waktu menunggu tidak boleh mendekati batas tersebut.
const ANGGARAN_ULANG_MS = Math.max(2000, Number(process.env.BOSON_RETRY_BUDGET_MS ?? 40000));

const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
// Jitter penuh: acak 70%–130% supaya banyak permintaan tidak bangun serentak
// lalu menabrak rate limit lagi bersamaan ("thundering herd").
const jitter = (ms) => Math.round(ms * (0.7 + Math.random() * 0.6));

// Header Retry-After boleh berisi detik ("12") atau tanggal HTTP.
export function parseRetryAfter(nilai) {
  if (!nilai) return null;
  const detik = Number(String(nilai).trim());
  if (Number.isFinite(detik)) return Math.max(0, detik);
  const tgl = Date.parse(nilai);
  if (Number.isFinite(tgl)) return Math.max(0, (tgl - Date.now()) / 1000);
  return null;
}

function galat(pesan, status, extra = {}) {
  return Object.assign(new Error(pesan), { status, ...extra });
}

// ---------- panggil Boson ----------
export async function synth({ input, voice, preset, ref_audio, ref_text, response_format }) {
  const payload = { model: MODEL, input, response_format: response_format || "mp3" };
  if (ref_audio) { payload.ref_audio = ref_audio; if (ref_text) payload.ref_text = ref_text; }
  else if (preset) {
    const ref = presetAsRef(preset);
    if (!ref) throw galat(`Preset "${preset}" tidak ditemukan.`, 400);
    payload.ref_audio = ref.ref_audio; if (ref.ref_text) payload.ref_text = ref.ref_text;
  } else if (voice && voice !== "default") payload.voice = voice;

  const body = JSON.stringify(payload);
  const mulai = Date.now();
  let terakhir = null;

  for (let coba = 0; coba <= MAX_ULANG; coba++) {
    let r = null, galatJaringan = null;
    try {
      r = await fetch(BOSON_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body,
      });
    } catch (e) {
      galatJaringan = e;                       // koneksi putus / timeout soket
    }

    if (r && r.ok) {
      const mime = r.headers.get("content-type") || "audio/mpeg";
      const buf = Buffer.from(await r.arrayBuffer());
      return { mime, buf };
    }

    let status = 502, detail = "", retryAfter = null;
    if (r) {
      status = r.status;
      detail = (await r.text().catch(() => "")).slice(0, 500);
      retryAfter = parseRetryAfter(r.headers.get("retry-after"));
    } else {
      detail = String(galatJaringan?.message || galatJaringan || "gagal menghubungi Boson AI");
    }

    const pesan = status === 429
      ? "Boson AI sedang membatasi jumlah permintaan (HTTP 429)."
      : `Boson AI menolak (HTTP ${status}).`;
    terakhir = galat(pesan, status, { detail, retryAfter });

    // Permanen atau kesempatan habis -> lempar apa adanya.
    if (!STATUS_ULANG.has(status) || coba === MAX_ULANG) throw terakhir;

    // Backoff eksponensial: 0,9s -> 1,8s -> 3,6s -> 7,2s (dibatasi JEDA_MAKS_MS).
    // Kalau server memberi Retry-After, itu yang dipakai — server paling tahu.
    const eksponensial = jitter(JEDA_AWAL_MS * Math.pow(2, coba));
    let tunggu = Math.min(retryAfter != null ? retryAfter * 1000 : eksponensial, JEDA_MAKS_MS);

    // Jangan menunggu sampai fungsi serverless kehabisan waktu; lebih baik
    // menyerah rapi dan biarkan klien yang menjadwalkan ulang.
    if (Date.now() - mulai + tunggu > ANGGARAN_ULANG_MS) {
      terakhir.retryAfter = Math.max(1, Math.ceil(tunggu / 1000));
      throw terakhir;
    }
    await tidur(tunggu);
  }
  throw terakhir || galat("Gagal memanggil Boson AI.", 502);
}

// ---------- pembatas laju per pengguna (opsional, butuh KV) ----------
// Aktif hanya kalau RATE_LIMIT_PER_MIN > 0 dan KV terkonfigurasi. Gunanya menahan
// satu pengguna agar tidak menghabiskan kuota Boson untuk semua orang.
const LIMIT_PER_MIN = Math.max(0, Number(process.env.RATE_LIMIT_PER_MIN || 0));
export async function cekLaju(kunci) {
  if (!LIMIT_PER_MIN || !kvReady || !kunci) return { ok: true };
  const jendela = Math.floor(Date.now() / 60000);
  const k = `rl:${String(kunci).trim().toLowerCase()}:${jendela}`;
  try {
    const n = Number(await kv(["incr", k]));
    if (n === 1) await kv(["expire", k, "70"]);
    if (n > LIMIT_PER_MIN) {
      const sisa = 60 - Math.floor((Date.now() % 60000) / 1000);
      return { ok: false, retryAfter: Math.max(1, sisa), limit: LIMIT_PER_MIN };
    }
  } catch { return { ok: true }; }   // KV bermasalah -> jangan halangi pengguna
  return { ok: true };
}
