/**
 * ShopEasy — Express backend
 * Razorpay order creation + payment verification + in-memory audit log.
 *
 * Secrets are loaded from .env (see .env.example for required variables).
 */

require("dotenv").config();

const express  = require("express");
const Razorpay = require("razorpay");
const crypto   = require("crypto");
const path     = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const KEY_ID     = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

// ── Groq API (for chat intent understanding) ───────────────────
// Drop-in replacement for Gemini — same prompt/intents, OpenAI-compatible format.
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL   = "openai/gpt-oss-120b";

// ── Gemini kept in .env but no longer used in the endpoint ─────
// const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Guard: crash fast with a clear message if any required env var is missing
const MISSING = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "GROQ_API_KEY"].filter(k => !process.env[k]);
if (MISSING.length) {
  console.error("❌  Missing required environment variables:", MISSING.join(", "));
  console.error("    Copy .env.example → .env and fill in your credentials.");
  process.exit(1);
}


// Product list used in the Gemini prompt (mirrors app.js — update both if products change)
const SHOP_PRODUCTS = [
  { id: 1, name: "Wireless Noise-Cancelling Headphones", price: 79.99 },
  { id: 2, name: "Mechanical Keyboard (TKL)",            price: 54.99 },
  { id: 3, name: "USB-C Fast Charger 65W",               price: 19.99 },
  { id: 4, name: "Portable Bluetooth Speaker",           price: 39.99 },
  { id: 5, name: "Smart LED Desk Lamp",                  price: 34.99 },
  { id: 6, name: "Ergonomic Mouse (Wireless)",           price: 44.99 },
];

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

// ══════════════════════════════════════════════════════════════
//  IN-MEMORY AUDIT LOG
// ══════════════════════════════════════════════════════════════

const auditLog = [];   // newest entries are unshifted to the front

function addLogEntry(actionType, description, amount = null) {
  const entry = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp:   new Date().toISOString(),
    actionType,
    description,
    amount:      (amount !== null && amount !== undefined) ? Number(amount) : null,
  };
  auditLog.unshift(entry);
  if (auditLog.length > 500) auditLog.pop();   // cap memory usage
  console.log(`[AUDIT] ${actionType} | ${description}`);
}

// ── POST /api/log — receive client-side log entries ────────────
app.post("/api/log", (req, res) => {
  const { actionType, description, amount } = req.body;
  if (!actionType || !description) {
    return res.status(400).json({ error: "actionType and description are required" });
  }
  addLogEntry(actionType, String(description), amount);
  res.json({ ok: true });
});

// ── GET /api/audit-log — return all entries, newest first ──────
app.get("/api/audit-log", (req, res) => {
  res.json(auditLog);
});

// ── POST /api/ai-understand — Groq intent classifier ───────────
// Takes the user's message + conversation context.
// Returns structured intent + extracted data.
// Groq ONLY interprets text — all business logic stays in the frontend.
app.post("/api/ai-understand", async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  const productList = SHOP_PRODUCTS
    .map(p => `  - id:${p.id} "${p.name}" ₹${p.price}`)
    .join("\n");

  const lastProduct = context?.lastMentionedProduct
    ? `"${context.lastMentionedProduct.name}" (id:${context.lastMentionedProduct.id})`
    : "None";

  const today    = context?.today    || new Date().toISOString().split("T")[0];
  const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString().split("T")[0];

  const prompt = `You are an intent classifier for ShopEasy, an e-commerce chatbot. Your ONLY job is to understand what the user means and return structured JSON. You make NO decisions and take NO actions.

CONVERSATION STATE: ${context?.state || "IDLE"}
LAST MENTIONED PRODUCT: ${lastProduct}
TODAY'S DATE: ${today}   TOMORROW: ${tomorrow}

AVAILABLE PRODUCTS:
${productList}

AVAILABLE FLIGHT ROUTES: Pune↔Bangalore, Mumbai↔Delhi, Delhi↔Goa, Chennai↔Hyderabad, Bangalore↔Mumbai

USER MESSAGE: "${message}"

Classify the intent as EXACTLY ONE of:
- "product_lookup"    — user asks about or mentions a product (even with typos/misspellings)
- "confirm_add"       — user wants to add the last mentioned product to cart ("yes", "add it", "sure", "I want to buy that", "I'll take it")
- "price_filter"      — user wants products under a certain price
- "checkout_start"    — user wants to begin checkout process
- "provide_detail"    — user is giving personal info (name/address/phone/email) during checkout
- "use_saved_details" — user wants to use their saved details (e.g. "use these", "same", "yes", "looks good")
- "update_details"    — user wants to enter new details (e.g. "update", "change", "no", "different")
- "pay_confirm"       — STRICT: ONLY classify as this if the user says "Pay by AI", "yes pay by ai", "confirm payment", "paybyai", or a very clear and unambiguous payment confirmation phrase. Do NOT use this for general enthusiasm, "yes", "let's go", "sure", or eagerness earlier in the conversation.
- "flight_search"     — user wants to search for or book a flight (mentions "flight", "plane", "fly", "ticket", or a city-to-city route)
- "cancel"            — user wants to stop/cancel
- "unclear"           — none of the above

Also extract (use null if not applicable):
- productId: integer matching the closest product in the list (even with typos), or null
- priceLimit: number in rupees for price_filter, or null
- detailValue: the raw text the user gave as their personal detail (for provide_detail), or null
- fromCity: departure city for flight_search (capitalised, e.g. "Pune"), or null
- toCity: destination city for flight_search (capitalised, e.g. "Bangalore"), or null
- flightDate: date in YYYY-MM-DD format for flight_search — resolve "today"→${today}, "tomorrow"→${tomorrow}, etc. — or null if no date mentioned
- preference: for flight_search — "cheapest" if user says cheapest/budget/cheap/lowest price, "fastest" if they say fastest/quickest/shortest, otherwise "default"

Respond ONLY with valid JSON, no markdown, no explanation:
{"intent":"...","extracted":{"productId":null,"priceLimit":null,"detailValue":null,"fromCity":null,"toCity":null,"flightDate":null,"preference":"default"}}`;

  try {
    const abortCtrl  = new AbortController();
    const abortTimer = setTimeout(() => {
      abortCtrl.abort();
      console.error("[ai-understand] Groq request timed out after 30s");
    }, 30000);

    let groqRes;
    try {
      groqRes = await fetch(GROQ_URL, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": "Bearer " + GROQ_API_KEY,
        },
        signal: abortCtrl.signal,
        body: JSON.stringify({
          model:           GROQ_MODEL,
          temperature:     0.1,
          max_tokens:      1000,
          response_format: { type: "json_object" },
          messages: [
            { role: "user", content: prompt },
          ],
        }),
      });
    } catch (fetchErr) {
      clearTimeout(abortTimer);
      if (fetchErr.name === "AbortError") {
        return res.status(504).json({ error: "Groq request timed out" });
      }
      throw fetchErr;   // re-throw unexpected network errors
    }
    clearTimeout(abortTimer);

    if (!groqRes.ok) {
      const errText = await groqRes.text();
      console.error("[ai-understand] Groq HTTP error:", groqRes.status, errText);
      return res.status(502).json({ error: "Groq API error", status: groqRes.status });
    }

    const groqData = await groqRes.json();
    const rawText  = groqData?.choices?.[0]?.message?.content || "";

    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
      if (!parsed || typeof parsed !== "object") throw new Error("Parsed JSON is not an object");
    } catch (parseErr) {
      console.error("[ai-understand] JSON parse failed:", parseErr.message);
      console.error("[ai-understand] Raw response from Groq:\n", rawText || "(empty response)");
      return res.status(502).json({ error: "Invalid JSON from Groq", raw: rawText });
    }

    const ALLOWED_INTENTS = [
      "product_lookup", "confirm_add", "price_filter", "checkout_start",
      "provide_detail", "use_saved_details", "update_details",
      "pay_confirm", "flight_search", "cancel", "unclear",
    ];
    if (!ALLOWED_INTENTS.includes(parsed.intent)) parsed.intent = "unclear";

    res.json({ intent: parsed.intent, extracted: parsed.extracted || {} });

  } catch (err) {
    console.error("[ai-understand] Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ══════════════════════════════════════════════════════════════
//  RAZORPAY ENDPOINTS
// ══════════════════════════════════════════════════════════════

// ── POST /create-order ─────────────────────────────────────────
app.post("/create-order", async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || typeof amount !== "number" || amount < 100) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount:   Math.round(amount),
      currency: "INR",
      receipt:  "receipt_" + Date.now(),
    });

    // Log checkout started (server-side)
    addLogEntry(
      "CHECKOUT_STARTED",
      `Payment initiated — Razorpay order ${order.id}`,
      (order.amount / 100).toFixed(2)
    );

    res.json({ orderId: order.id, amount: order.amount, currency: order.currency });
  } catch (err) {
    console.error("[create-order]", err.message);
    res.status(500).json({ error: "Failed to create Razorpay order" });
  }
});

// ── POST /verify-payment ───────────────────────────────────────
app.post("/verify-payment", (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: "Missing payment fields" });
    }

    const body     = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expected === razorpay_signature) {
      // Log payment success (server-side — most authoritative place)
      addLogEntry(
        "PAYMENT_SUCCESS",
        `Payment verified — Payment ID: ${razorpay_payment_id} | Order ID: ${razorpay_order_id}`,
        amount || null
      );
      res.json({ valid: true });
    } else {
      addLogEntry(
        "PAYMENT_FAILED",
        `Signature mismatch — Order ID: ${razorpay_order_id}`,
        amount || null
      );
      console.warn("[verify-payment] Signature mismatch");
      res.status(400).json({ valid: false, error: "Signature verification failed" });
    }
  } catch (err) {
    console.error("[verify-payment]", err.message);
    res.status(500).json({ error: "Verification error" });
  }
});

// ══════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  ShopEasy server running at http://localhost:${PORT}\n`);
});
