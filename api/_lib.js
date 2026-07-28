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

// Beberapa perintah sekaligus dalam SATU perjalanan jaringan.
// Tanpa ini, satu pemeriksaan kuota butuh 4-5 kali bolak-balik ke Redis dan
// itu menambah ratusan milidetik pada setiap potongan teks.
async function kvPipe(cmds) {
  if (!kvReady || !cmds.length) return [];
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
  });
  if (!r.ok) throw new Error("KV pipeline error " + r.status);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map((x) => (x && typeof x === "object" && "result" in x ? x.result : null));
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
// users.txt dibaca ulang dari disk pada SETIAP pemeriksaan token, dan requireAuth()
// + isVip() memanggilnya dua kali per permintaan. Isinya hanya berubah saat deploy
// ulang, jadi cukup dibaca sekali per instans fungsi (hangus 60 detik untuk jaga-jaga).
let _usersCache = null, _usersSampai = 0;
function parseUsers() {
  if (_usersCache && Date.now() < _usersSampai) return _usersCache;
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
  _usersCache = rows; _usersSampai = Date.now() + 60000;
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
// Daftar file preset tidak pernah berubah selama fungsi hidup. Sebelumnya
// readdirSync() dijalankan pada setiap permintaan /api/speech dan /api/voices.
let _presetCache = null;
export function listPresets() {
  if (_presetCache) return _presetCache;
  let files = [];
  try { files = fs.readdirSync(VOICES_DIR); } catch { return []; }
  const out = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!AUDIO_EXT[ext]) continue;
    const base = path.basename(f, ext);
    out.push({ name: base, file: f, ext, hasText: fs.existsSync(path.join(VOICES_DIR, base + ".txt")) });
  }
  _presetCache = out.sort((a, b) => a.name.localeCompare(b.name));
  return _presetCache;
}
// Hasil base64 preset juga disimpan. Mengubah WAV 20 detik menjadi base64 pada
// setiap potongan teks adalah pekerjaan berat yang hasilnya selalu sama persis:
// satu teks 5.000 karakter memicu ±25 kali penyandian ulang file yang identik.
const _refCache = new Map();
export function presetAsRef(name) {
  if (_refCache.has(name)) return _refCache.get(name);
  const p = listPresets().find((x) => x.name === name);
  if (!p) return null;
  const buf = fs.readFileSync(path.join(VOICES_DIR, p.file));
  const dataUri = `data:${AUDIO_EXT[p.ext] || "audio/mpeg"};base64,${buf.toString("base64")}`;
  let refText = "";
  if (p.hasText) { try { refText = fs.readFileSync(path.join(VOICES_DIR, p.name + ".txt"), "utf8").trim(); } catch {} }
  const ref = { ref_audio: dataUri, ref_text: refText };
  _refCache.set(name, ref);
  return ref;
}

// ---------- singgahan audio referensi ----------
// ref_audio 20 detik ≈ 1,3 MB base64, dan dulu ikut TIAP potongan teks: satu
// pekerjaan kloning 5.000 karakter mengunggah ±32 MB yang isinya sama persis.
// Sekarang klien cukup mengirim sidik jarinya (ref_id); audio penuh hanya perlu
// menyertai beberapa potongan pertama, sekadar untuk "mengisi" instans yang
// melayani. Disimpan di memori instans, bukan di Redis: ukurannya terlalu besar
// untuk Redis dan isinya memang hanya berguna selama satu pekerjaan berjalan.
const REF_MAKS = Math.max(1, Number(process.env.REF_CACHE_MAX || 4));
const _refAudio = new Map();          // ref_id -> { ref_audio, ref_text }

export function refAmbil(id) {
  if (!id) return null;
  const v = _refAudio.get(id);
  if (!v) return null;
  _refAudio.delete(id); _refAudio.set(id, v);   // yang baru dipakai = paling akhir dibuang
  return v;
}
export function refSimpan(id, ref_audio, ref_text) {
  if (!id || !ref_audio) return;
  _refAudio.delete(id);
  _refAudio.set(id, { ref_audio, ref_text: ref_text || "" });
  // Dibatasi jumlahnya supaya memori fungsi tidak menggelembung.
  while (_refAudio.size > REF_MAKS) _refAudio.delete(_refAudio.keys().next().value);
}

// ---------- pengaman rate limit (429) ----------
// Status yang layak dicoba ulang. 429 = terlalu banyak permintaan,
// 5xx = gangguan sementara di sisi Boson. Sisanya (400/401/413) permanen:
// mengulang hanya memperparah antrean.
const STATUS_ULANG = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
// Dulu 4 (= 5 percobaan). Karena halaman JUGA mengulang sampai 5x, satu potongan
// bisa berubah menjadi 25 panggilan ke Boson. Halaman sudah punya gerbang laju
// + masa dingin global yang jauh lebih pintar (menahan SELURUH antrean, bukan
// satu permintaan), jadi tugas server cukup menyerap gangguan sekejap saja.
const MAX_ULANG = Math.max(0, Number(process.env.BOSON_MAX_RETRY ?? 1));
const JEDA_AWAL_MS = Math.max(200, Number(process.env.BOSON_RETRY_BASE_MS ?? 900));
const JEDA_MAKS_MS = Math.max(1000, Number(process.env.BOSON_RETRY_MAX_MS ?? 12000));
// Fungsi Vercel dibatasi 60 detik (vercel.json). Sisakan ruang untuk generasi itu
// sendiri, jadi total waktu menunggu tidak boleh mendekati batas tersebut.
// Dulu 40 detik. Fungsi yang tidur 40 detik tetap ditagih Vercel sebagai waktu
// jalan, padahal tidak mengerjakan apa pun. Lebih murah menyerah cepat dan
// membiarkan halaman menjadwalkan ulang lewat gerbangnya sendiri.
const ANGGARAN_ULANG_MS = Math.max(2000, Number(process.env.BOSON_RETRY_BUDGET_MS ?? 12000));

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
// Dulu bawaannya 0 = MATI, sehingga satu-satunya rem adalah kode di browser —
// dan itu bisa dilewati total hanya dengan memanggil /api/speech langsung.
// 90/menit tidak mengganggu pemakaian wajar (teks panjang pun di bawah itu),
// tapi menghentikan skrip yang menghantam endpoint terus-menerus.
const LIMIT_PER_MIN = Math.max(0, Number(process.env.RATE_LIMIT_PER_MIN ?? 90));
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

// ================== KUOTA KARAKTER (gratis & masa percobaan) ==================
// Tiga pagar yang berbeda tugasnya:
//   1. perRequest  — batas satu kali kirim (dihitung di browser & di sini).
//   2. burst       — 10.000 karakter; kalau lewat, istirahat 30 menit.
//   3. weekly      — 65.000 karakter per pekan, selalu direset hari Senin 00:00.
// VIP (tanda "*" di users.txt) tidak pernah tersentuh ketiganya.
export const QUOTA = {
  perRequest: Math.max(1, Number(process.env.QUOTA_PER_REQUEST || 5000)),
  burst: Math.max(1, Number(process.env.QUOTA_BURST || 10000)),
  burstCooldown: Math.max(60, Number(process.env.QUOTA_BURST_COOLDOWN_SEC || 1800)), // 30 menit
  weekly: Math.max(1, Number(process.env.QUOTA_WEEKLY || 65000)),
  tzOffset: Number(process.env.QUOTA_TZ_OFFSET ?? 7),   // WIB
  exemptPaid: process.env.QUOTA_EXEMPT_PAID === "1",    // ikut bebaskan pembeli "Hapus Iklan"
};
export const PESAN_BURST = "Tunggu lagi dalam 30 menit, sistem sedang banyak permintaan";
export const PESAN_WEEKLY = "Batas mingguan sudah habis";

// Senin 00:00 waktu lokal sebagai awal pekan; berakhir Senin berikutnya 00:00.
// Dihitung dengan getter UTC atas waktu yang sudah digeser, supaya hasilnya
// tidak ikut berubah mengikuti zona waktu server Vercel.
export function pekanIni(now = Date.now()) {
  const off = QUOTA.tzOffset * 3600000;
  const lokal = new Date(now + off);
  const jarakKeSenin = (lokal.getUTCDay() + 6) % 7;     // Minggu=6, Senin=0
  const seninLokal = Date.UTC(lokal.getUTCFullYear(), lokal.getUTCMonth(), lokal.getUTCDate()) - jarakKeSenin * 86400000;
  const mulai = seninLokal - off;
  const selesai = mulai + 7 * 86400000;
  return {
    label: new Date(seninLokal).toISOString().slice(0, 10),
    mulai, selesai,
    sisaDetik: Math.max(60, Math.ceil((selesai - now) / 1000)),
  };
}

const kunciKuota = (u) => String(u || "").trim().toLowerCase();
const kWeek = (u, label) => `q:w:${kunciKuota(u)}:${label}`;
const kBurst = (u) => `q:b:${kunciKuota(u)}`;
const kSeen = (u, h) => `q:s:${kunciKuota(u)}:${h}`;

const sidik = (u, teks) =>
  crypto.createHash("sha1").update(kunciKuota(u) + "\u0000" + String(teks)).digest("base64url").slice(0, 16);

// Siapa yang dibatasi. Gratis & masa percobaan -> dibatasi. VIP -> tidak.
export async function kenaKuota(username) {
  if (!username) return true;                       // tamu/IP tetap dibatasi
  if (isVip(username)) return false;
  if (QUOTA.exemptPaid && (await isAdFree(username))) return false;
  return true;
}

const angka = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function ringkasan(pekanTerpakai, burstTerpakai, burstTtl, pekan) {
  return {
    perRequest: QUOTA.perRequest,
    weekly: { used: pekanTerpakai, limit: QUOTA.weekly, sisa: Math.max(0, QUOTA.weekly - pekanTerpakai), resetAt: pekan.selesai },
    burst: {
      used: burstTerpakai, limit: QUOTA.burst,
      blockedUntil: burstTerpakai >= QUOTA.burst && burstTtl > 0 ? Date.now() + burstTtl * 1000 : 0,
    },
  };
}

// Hanya membaca — dipakai halaman untuk memeriksa SEBELUM generate dimulai,
// supaya pengguna tidak mendapat audio setengah jadi saat kuotanya mepet.
export async function quotaStatus(username) {
  const dibatasi = await kenaKuota(username);
  const pekan = pekanIni();
  if (!dibatasi || !kvReady) {
    return { limited: dibatasi, enforced: dibatasi && kvReady, ...ringkasan(0, 0, 0, pekan) };
  }
  try {
    const [w, b, ttl] = await kvPipe([
      ["GET", kWeek(username, pekan.label)],
      ["GET", kBurst(username)],
      ["TTL", kBurst(username)],
    ]);
    return { limited: true, enforced: true, ...ringkasan(angka(w), angka(b), angka(ttl), pekan) };
  } catch {
    return { limited: true, enforced: false, ...ringkasan(0, 0, 0, pekan) };
  }
}

// Periksa lalu catat. Dipanggil /api/speech untuk SETIAP potongan teks.
// Urutannya sengaja "periksa dulu, baru tambah": permintaan yang menembus batas
// tetap dilayani, yang berikutnya baru ditolak. Kalau dibalik, sebuah teks
// panjang bisa berhenti di tengah dan menyisakan audio terpotong.
export async function quotaConsume(username, teks) {
  const chars = String(teks || "").length;
  const dibatasi = await kenaKuota(username);
  if (!dibatasi) return { ok: true, exempt: true };
  if (!kvReady) return { ok: true, enforced: false };   // KV mati -> jangan halangi

  const pekan = pekanIni();
  const wKey = kWeek(username, pekan.label), bKey = kBurst(username);
  const sKey = kSeen(username, sidik(username, teks));

  let baru = true, terpakaiW = 0, terpakaiB = 0, ttlB = 0;
  try {
    // SET NX menandai potongan ini "sudah pernah dihitung". Percobaan ulang atas
    // teks yang sama (lihat pagar anti-ngelantur di halaman) karena itu tidak
    // memakan kuota dua kali — yang dihitung adalah teks yang diminta pengguna.
    const [seen, w, b, ttl] = await kvPipe([
      ["SET", sKey, "1", "NX", "EX", "900"],
      ["GET", wKey],
      ["GET", bKey],
      ["TTL", bKey],
    ]);
    baru = seen === "OK";
    terpakaiW = angka(w); terpakaiB = angka(b); ttlB = angka(ttl);
  } catch {
    return { ok: true, enforced: false };
  }

  // --- pagar mingguan ---
  if (terpakaiW >= QUOTA.weekly) {
    return {
      ok: false, reason: "weekly", message: PESAN_WEEKLY,
      resetAt: pekan.selesai, retryAfter: pekan.sisaDetik,
      ...ringkasan(terpakaiW, terpakaiB, ttlB, pekan),
    };
  }
  // --- pagar 30 menit ---
  if (terpakaiB >= QUOTA.burst) {
    const sisa = ttlB > 0 ? ttlB : QUOTA.burstCooldown;
    return {
      ok: false, reason: "burst", message: PESAN_BURST,
      resetAt: Date.now() + sisa * 1000, retryAfter: sisa,
      ...ringkasan(terpakaiW, terpakaiB, ttlB, pekan),
    };
  }

  if (!baru || chars <= 0) return { ok: true, retry: !baru };

  try {
    // Urutan hasil mengikuti urutan perintah — EXPIRE menempati indeks 1.
    const [wBaru, , bBaru] = await kvPipe([
      ["INCRBY", wKey, chars],
      ["EXPIRE", wKey, pekan.sisaDetik + 120],   // hangus sendiri setelah Senin
      ["INCRBY", bKey, chars],
    ]);
    const susulan = [];
    // Jendela 30 menit dimulai saat pemakaian pertama...
    if (angka(bBaru) === chars) susulan.push(["EXPIRE", bKey, QUOTA.burstCooldown]);
    // ...dan disetel ulang tepat saat batas ditembus, supaya jeda yang dijanjikan
    // ke pengguna benar-benar 30 menit penuh, bukan sisa jendela sebelumnya.
    else if (angka(bBaru) >= QUOTA.burst && terpakaiB < QUOTA.burst) susulan.push(["EXPIRE", bKey, QUOTA.burstCooldown]);
    if (susulan.length) await kvPipe(susulan);
    return { ok: true, ...ringkasan(angka(wBaru), angka(bBaru), QUOTA.burstCooldown, pekan) };
  } catch {
    return { ok: true, enforced: false };
  }
}
