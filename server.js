// server.js — backend Voice Pro Max (web, tanpa Gradio).
// Menyimpan API key & memanggil Boson AI Higgs TTS. Key tidak pernah ke browser.

import express from "express";
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BOSON_URL = "https://api.boson.ai/v1/audio/speech";
const MODEL = process.env.BOSON_MODEL || "higgs-tts-3"; // fallback lama: higgs-audio-v3-tts
const API_KEY = process.env.BOSON_API_KEY;
const APP_PASSWORD = process.env.APP_PASSWORD || ""; // opsional; kalau diisi, web minta password
const VOICES_DIR = path.join(__dirname, "voices");

const AUDIO_EXT = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };
const BOSON_PRESETS = ["default", "jake"]; // preset milik Boson (lihat halaman Voices)

const app = express();
app.use(express.json({ limit: "30mb" }));
app.use(express.static(path.join(__dirname, "public")));

if (!API_KEY) console.warn("\n[PERINGATAN] BOSON_API_KEY kosong. Isi di file .env.\n");

// --- daftar preset suara bawaan (dari folder voices/) ---
function listPresets() {
  if (!fs.existsSync(VOICES_DIR)) return [];
  const files = fs.readdirSync(VOICES_DIR);
  const out = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (!AUDIO_EXT[ext]) continue;
    const base = path.basename(f, ext);
    const hasText = fs.existsSync(path.join(VOICES_DIR, base + ".txt"));
    out.push({ name: base, file: f, ext, hasText });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function presetAsRef(name) {
  const p = listPresets().find((x) => x.name === name);
  if (!p) return null;
  const buf = fs.readFileSync(path.join(VOICES_DIR, p.file));
  const mime = AUDIO_EXT[p.ext] || "audio/mpeg";
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  let refText = "";
  if (p.hasText) {
    try { refText = fs.readFileSync(path.join(VOICES_DIR, p.name + ".txt"), "utf8").trim(); } catch {}
  }
  return { ref_audio: dataUri, ref_text: refText };
}

// --- middleware password opsional ---
function guard(req, res, next) {
  if (!APP_PASSWORD) return next();
  if ((req.get("x-app-password") || "") === APP_PASSWORD) return next();
  return res.status(401).json({ error: "Password salah atau belum login." });
}

// --- inti: panggil Boson untuk satu potong teks ---
async function synth({ input, voice, preset, ref_audio, ref_text, response_format }) {
  const payload = { model: MODEL, input, response_format: response_format || "mp3" };

  if (ref_audio) {
    // kloning dari audio yang diunggah user
    payload.ref_audio = ref_audio;
    if (ref_text) payload.ref_text = ref_text;
  } else if (preset) {
    // kloning dari preset bawaan
    const ref = presetAsRef(preset);
    if (!ref) throw new Error(`Preset "${preset}" tidak ditemukan.`);
    payload.ref_audio = ref.ref_audio;
    if (ref.ref_text) payload.ref_text = ref.ref_text;
  } else if (voice && !BOSON_PRESETS.includes(voice)) {
    payload.voice = voice;
  } else if (voice && voice !== "default") {
    payload.voice = voice;
  }

  const r = await fetch(BOSON_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text();
    const err = new Error(`Boson AI menolak (HTTP ${r.status}).`);
    err.status = r.status; err.detail = detail.slice(0, 500);
    throw err;
  }
  const mime = r.headers.get("content-type") || "audio/mpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return { mime, buf };
}

// --- API ---
app.get("/api/config", (_req, res) => {
  res.json({ authRequired: Boolean(APP_PASSWORD), keyConfigured: Boolean(API_KEY), model: MODEL });
});

app.get("/api/voices", (_req, res) => {
  res.json({ presets: listPresets().map((p) => ({ name: p.name, hasText: p.hasText })), bosonPresets: BOSON_PRESETS });
});

// satu hasil audio
app.post("/api/speech", guard, async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: "Server belum dikonfigurasi: BOSON_API_KEY kosong." });
    const input = (req.body?.input || "").toString().trim();
    if (!input) return res.status(400).json({ error: "Teks tidak boleh kosong." });
    if (input.length > 8000) return res.status(400).json({ error: "Teks terlalu panjang (maks 8000 karakter)." });

    const { mime, buf } = await synth({
      input,
      voice: req.body?.voice,
      preset: req.body?.preset,
      ref_audio: req.body?.ref_audio,
      ref_text: req.body?.ref_text,
      response_format: req.body?.response_format,
    });
    res.setHeader("Content-Type", mime);
    res.send(buf);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail });
  }
});

// multi-pembicara (podcast / buku audio): "Speaker N: teks" per baris
app.post("/api/multi", guard, async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: "Server belum dikonfigurasi: BOSON_API_KEY kosong." });
    const script = (req.body?.script || "").toString();
    const speakers = Array.isArray(req.body?.speakers) ? req.body.speakers : [];
    const format = req.body?.response_format || "mp3";
    const turns = parseScript(script);
    if (!turns.length) return res.status(400).json({ error: "Skrip kosong." });

    const segments = [];
    for (let i = 0; i < turns.length; i++) {
      const { speaker, text } = turns[i];
      const sp = speakers[speaker] || speakers[0] || {};
      const { mime, buf } = await synth({
        input: text,
        voice: sp.voice,
        preset: sp.preset,
        ref_audio: sp.ref_audio,
        ref_text: sp.ref_text,
        response_format: format,
      });
      segments.push({ index: i, speaker, text, mime, audio: buf.toString("base64") });
    }
    res.json({ segments });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail });
  }
});

// "Speaker 0: halo" / "Pembicara 1: hai" / "[2] teks" -> [{speaker, text}]
function parseScript(script) {
  const out = [];
  const pats = [/^speaker\s*(\d+)\s*[:.\-]\s*(.+)$/i, /^pembicara\s*(\d+)\s*[:.\-]\s*(.+)$/i, /^\[(\d+)\]\s*(.+)$/];
  for (const raw of (script || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let matched = false;
    for (const p of pats) {
      const m = line.match(p);
      if (m) { out.push({ speaker: parseInt(m[1], 10), text: m[2].trim() }); matched = true; break; }
    }
    if (!matched) out.push({ speaker: 0, text: line });
  }
  return out;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`\n  Voice Pro Max web  →  http://localhost:${PORT}\n`));
