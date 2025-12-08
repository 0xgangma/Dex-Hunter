// =========================
// 1G TRACKER PRO - FULL INDEX.JS
// =========================

import axios from "axios";
import { Telegraf } from "telegraf";
import cron from "node-cron";

// =========================
// CONFIG (YOUR VALUES HERE)
// =========================

// ❗❗ PASTE YOUR BOT TOKEN ON THIS LINE ONLY
const BOT_TOKEN = "8587749757:AAFEHh3oZEtEwYYnGyUcjPFgsw7VY6gnfEQ";  

// ❗ YOUR CHANNEL ID (SAFE)
// This is safe to include publicly:
const CHANNEL_ID = "-1003440689758";

// BASIC BOT SETTINGS
const CONFIG = {
  MAX_MARKET_CAP: 50000,
  MIN_LIQUIDITY: 12000,
  COOLDOWN_MIN: 60,
  SOLSCAN_KEY: "",
  HELIUS_KEY: "",
  ADMIN_ID: ""
};

// =========================
// INTERNAL STATE
// =========================
const seen = new Map();

function canPost(mint) {
  const last = seen.get(mint);
  const now = Date.now();

  if (!last) {
    seen.set(mint, now);
    return true;
  }

  const diff = (now - last) / 60000;
  if (diff > CONFIG.COOLDOWN_MIN) {
    seen.set(mint, now);
    return true;
  }

  return false;
}

// =========================
// SOLSCAN API
// =========================
async function fetchNewTokens() {
  try {
    const url = "https://pro-api.solscan.io/v1.0/token/new?limit=20";
    const res = await axios.get(url, {
      headers: { token: CONFIG.SOLSCAN_KEY }
    });
    return res.data.data || [];
  } catch (e) {
    console.error("Solscan Error:", e.message);
    return [];
  }
}

async function fetchTokenMarket(mint) {
  try {
    const url = `https://pro-api.solscan.io/v1.0/market/token/${mint}`;
    const res = await axios.get(url, {
      headers: { token: CONFIG.SOLSCAN_KEY }
    });
    return res.data.data || null;
  } catch (e) {
    console.error("Market Error:", e.message);
    return null;
  }
}

// =========================
// RISK SCORE
// =========================
function riskScore(t) {
  let score = 100;

  if (t.liquidity < CONFIG.MIN_LIQUIDITY) score -= 40;
  if (t.marketCap > CONFIG.MAX_MARKET_CAP) score -= 20;
  if (t.holders < 50) score -= 15;
  if (t.lpLocked < 7) score -= 20;

  if (score > 80) return { label: "🟢 Green", score };
  if (score > 50) return { label: "🟡 Yellow", score };
  return { label: "🔴 Red", score };
}

// =========================
// TELEGRAM MESSAGE FORMAT
// =========================
function formatAlert(t, risk) {
  return `
🚀 <b>New Solana Meme Detected</b>
<b>${t.name}</b> (${t.symbol})
<code>${t.mint}</code>

💰 <b>MC:</b> $${t.marketCap.toLocaleString()}
💧 <b>Liquidity:</b> $${t.liquidity.toLocaleString()}
📈 <b>Vol (1h):</b> $${t.volume1h}

🛡 <b>Risk:</b> ${risk.label} (${risk.score})

🔗 <a href="https://solscan.io/token/${t.mint}">View on Solscan</a>

⚠️ <i>Informational only — not financial advice.</i>
`;
}

// =========================
// TELEGRAM BOT
// =========================
const bot = new Telegraf(BOT_TOKEN);

bot.command("status", (ctx) =>
  ctx.reply("1G Tracker is running normally.")
);

// =========================
// SCANNER (EVERY 1 MIN)
// =========================
cron.schedule("*/1 * * * *", async () => {
  console.log("Scanning...");

  const tokens = await fetchNewTokens();
  for (const t of tokens) {
    const market = await fetchTokenMarket(t.mint);
    if (!market) continue;

    const enriched = {
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      marketCap: market.market_cap,
      liquidity: market.liquidity,
      holders: market.holder,
      lpLocked: market.lp_locked,
      volume1h: market.volume_1h,
      ageMinutes: (Date.now() - t.createdTime * 1000) / 60000
    };

    if (enriched.marketCap > CONFIG.MAX_MARKET_CAP) continue;
    if (enriched.liquidity < CONFIG.MIN_LIQUIDITY) continue;
    if (enriched.ageMinutes > 60) continue;
    if (!canPost(enriched.mint)) continue;

    const risk = riskScore(enriched);
    const msg = formatAlert(enriched, risk);

    await bot.telegram.sendMessage(CHANNEL_ID, msg, {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    console.log("Posted:", enriched.name);
  }
});

// =========================
// START BOT
// =========================
bot.launch();
console.log("1G Tracker Pro Started!");
