// src/index.js — Cloudflare Worker.
// Menyajikan halaman statis DAN menyimpan API key sebagai secret.
// Key tidak pernah sampai ke browser pengunjung.

const BOSON_URL = "https://api.boson.ai/v1/audio/speech";
const MODEL = "higgs-audio-v3-tts";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Endpoint yang dipanggil halaman web.
    if (url.pathname === "/api/speech" && request.method === "POST") {
      return handleSpeech(request, env);
    }

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, keyConfigured: Boolean(env.BOSON_API_KEY) });
    }

    // Selain itu: layani file statis dari folder ./public (index.html, dll).
    return env.ASSETS.fetch(request);
  },
};

async function handleSpeech(request, env) {
  try {
    if (!env.BOSON_API_KEY) {
      return Response.json(
        { error: "Server belum dikonfigurasi: BOSON_API_KEY kosong." },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const text = (body.text || "").toString().trim();
    const voice = (body.voice || "").toString().trim();

    if (!text) {
      return Response.json({ error: "Teks tidak boleh kosong." }, { status: 400 });
    }
    if (text.length > 5000) {
      return Response.json({ error: "Teks terlalu panjang (maks 5000 karakter)." }, { status: 400 });
    }

    const payload = { model: MODEL, input: text };
    if (voice && voice !== "default") payload.voice = voice;

    const upstream = await fetch(BOSON_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.BOSON_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        { error: `Boson AI menolak permintaan (HTTP ${upstream.status}).`, detail: detail.slice(0, 500) },
        { status: upstream.status }
      );
    }

    // Teruskan audio langsung ke browser (streaming).
    const contentType = upstream.headers.get("content-type") || "audio/mpeg";
    return new Response(upstream.body, {
      status: 200,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    return Response.json({ error: "Terjadi kesalahan di server.", detail: String(err) }, { status: 500 });
  }
}
