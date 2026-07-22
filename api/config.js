import { loginEnabled, API_KEY, MODEL } from "./_lib.js";
export default function handler(_req, res) {
  res.status(200).json({ authRequired: loginEnabled(), keyConfigured: Boolean(API_KEY), model: MODEL });
}
