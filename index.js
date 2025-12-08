// =========================
// 1G TRACKER PRO - SOLANA MEME BOT
// =========================

import axios from "axios";
import { Telegraf } from "telegraf";
import cron from "node-cron";

// =========================
// CONFIG
// =========================

// ❗❗ PASTE YOUR BOT TOKEN HERE
const BOT_TOKEN = "8587749757:AAFEHh3oZEtEwYYnGyUcjPFgsw7VY6gnfEQ";

// ❗ YOUR CHANNEL ID
const CHANNEL_ID = "-1003440689758";

// SETTINGS
const CONFIG = {
  MAX_MARKET_CAP: 50000,
  MIN_LIQUIDITY: 12000,
  COOLDOWN_MIN: 60
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
// PUBLIC SOLANA API
// =========================
// Fetch recent tokens via Helius free endpoint
async function fetchNewTokens() {
  try {
    const res = await axios.get(
      "https://api.helius.xyz/v0/addresses?api-key=demo&filters=recent"
    );
    // NOTE: 'demo' key is free for testing, replace if you want faster updates
    return res.data || [];
  } catch (e) {
    console.error("Fetch tokens error:", e.message);
    return [];
  }
}

// Simulate market data (since no Solscan Pro)
async function fetchTokenMarket(mint) {
  try {
    // Random mock data for demo
    return {
      mint: mint,
      market_cap: Math.floor(Math.random() * 50000),
      liquidity: 12000 + Math.floor(Math.random() * 50000),
      holders: 50 + Math.floor(Math.random() * 200),
      lp_locked: 7 + Math.floor(Math.random() * 10),
      volume_1h: Math.floor(Math.random() * 10000)
    };
  } catch {
    return null;
  }
}

// =========================
// RISK SCORING
// =========================
function riskScore(t) {
  let score = 100;
  if (t.liquidity < CONFIG.MIN_LIQUIDITY) score -= 40;
  if (t.marketCap > CONFIG.MAX_MARKET_CAP) score -= 20;
  if (t.holders < 50) score -= 15;
  if (t.lp_locked < 7) score -= 20;

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
<b>${t.name || t.mint}</b> (${t.symbol || "MEME"})

💰 <b>MC:</b> $${t.marketCap.toLocaleString()}
💧 <b>Liquidity:</b> $${t.liquidity.toLocaleString()}
📈 <b>Vol (1h):</b> $${t.volume_1h}

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

    if (market.market_cap > CONFIG.MAX_MARKET_CAP) continue;
    if (market.liquidity < CONFIG.MIN_LIQUIDITY) continue;
    if (!canPost(t.mint)) continue;

    const risk = riskScore(market);
    const msg = formatAlert(market, risk);

    await bot.telegram.sendMessage(CHANNEL_ID, msg, {
      parse_mode: "HTML",
      disable_web_page_preview: true
    });

    console.log("Posted:", t.mint);
  }
});

// =========================
// START BOT
// =========================
bot.launch();
console.log("1G Tracker Pro Started!");
