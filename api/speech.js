import { requireAuth, synth, API_KEY } from "./_lib.js";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAuth(req, res)) return;
  try {
    if (!API_KEY) return res.status(500).json({ error: "Server belum punya BOSON_API_KEY." });
    const input = (req.body?.input || "").toString().trim();
    if (!input) return res.status(400).json({ error: "Teks tidak boleh kosong." });
    if (input.length > 8000) return res.status(400).json({ error: "Teks terlalu panjang (maks 8000)." });
    const { mime, buf } = await synth({
      input, voice: req.body?.voice, preset: req.body?.preset,
      ref_audio: req.body?.ref_audio, ref_text: req.body?.ref_text, response_format: req.body?.response_format,
    });
    res.setHeader("Content-Type", mime);
    res.status(200).send(buf);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, detail: e.detail });
  }
}
