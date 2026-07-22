import { listPresets, BOSON_PRESETS } from "./_lib.js";
export default function handler(_req, res) {
  res.status(200).json({ presets: listPresets().map((p) => ({ name: p.name, hasText: p.hasText })), bosonPresets: BOSON_PRESETS });
}
