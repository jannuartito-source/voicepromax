import { loginEnabled, API_KEY, MODEL } from "./_lib.js";
export default function handler(_req, res) {
  res.status(200).json({
    authRequired: loginEnabled(),
    keyConfigured: Boolean(API_KEY),
    model: MODEL,
    buyUrlWeek: process.env.BUY_URL_WEEK || "",
    buyUrlMonth: process.env.BUY_URL_MONTH || "",
    priceWeek: process.env.AD_PRICE_WEEK || "Rp9.900",
    priceMonth: process.env.AD_PRICE_MONTH || "Rp24.500",
  });
}
