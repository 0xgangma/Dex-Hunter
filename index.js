/**
 * 1G TRACKER PRO — single-file production-ready bot
 * - Dexscreener discovery (Solana)
 * - Honeypot / anti-rug heuristics
 * - Risk score & trending filters
 * - GIF + thumbnail
 * - Instant Buy button (opens Jupiter)
 * - Sniper link (opens your panel)
 * - Paid subscriptions via SOL payments to your wallet (verify with /verify <tx_sig>)
 * - Subscribers persisted in subscribers.json
 *
 * SECURITY: BOT_TOKEN must be set in environment variable process.env.BOT_TOKEN
 * No other secrets required.
 */

import axios from "axios";
import { Telegraf } from "telegraf";
import cron from "node-cron";
import express from "express";
import bodyParser from "body-parser";
import fs from "fs-extra";
import { Connection } from "@solana/web3.js";
import path from "path";

/* =========================
   HARD-CODED CONFIG (change only if you want)
   ========================= */

// Channel (hard-coded as you provided)
const CHANNEL_ID = "-1003440689758";

// Admin username (for display)
const ADMIN_USERNAME = "xusddev";

// Your SOL receiver wallet (you provided)
const RECEIVER_WALLET = "DLTkXkT5RZu8rVWnaYMwUpg3sYgFxecCsQRVN3F1k2DV";

// Sniper base URL (link-only). If you have a panel, set here. Otherwise it opens a placeholder.
const SNIPER_BASE_URL = "https://your-sniper.example/launch?mint=";

// Banner / GIF / thumbnail (change if you want other images)
const BANNER_GIF_URL = "https://media.giphy.com/media/3o7aD6I0dYv6I3K1w0/giphy.gif";
const THUMBNAIL_URL = "https://i.imgur.com/yourThumbnail.png";

// Dexscreener Solana endpoint
const DEXSCREENER_SOLANA_URL = "https://api.dexscreener.com/latest/dex/pairs/solana";

// Thresholds & rules
const MAX_MARKET_CAP = 50000;      // USD
const MIN_LIQUIDITY = 12000;       // USD
const MIN_VOLUME_1H = 2000;        // USD
const COOLDOWN_MINUTES = 60;       // don't announce same token within this window

// Solana RPC (public)
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const SOL_CONN = new Connection(SOLANA_RPC, "confirmed");

// Subscriber DB file
const SUB_FILE = path.resolve("./subscribers.json");

/* =========================
   SECRETS — only BOT_TOKEN as env var (you set this on Render)
   ========================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("ERROR: BOT_TOKEN environment variable missing. Set BOT_TOKEN before running.");
  process.exit(1);
}

/* =========================
   State
   ========================= */
await fs.ensureFile(SUB_FILE);
let subsData = (await fs.readJson(SUB_FILE, { throws: false })) || { subscribers: [] };
if (!Array.isArray(subsData.subscribers)) subsData = { subscribers: [] };

// Seen set to avoid duplicates
let seenSet = new Set();

/* =========================
   Utility helpers
   ========================= */
function formatUSD(n) {
  if (!n && n !== 0) return "N/A";
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(2)}K`;
  return `$${Math.round(n)}`;
}
async function saveSubs() { await fs.writeJson(SUB_FILE, subsData, { spaces: 2 }); }
function isSubscriber(id) { return subsData.subscribers.some(s => String(s.id) === String(id)); }
async function addSubscriber(id, meta={}) {
  if (isSubscriber(id)) return false;
  subsData.subscribers.push({ id: String(id), addedAt: Date.now(), meta });
  await saveSubs();
  return true;
}
async function removeSubscriber(id) {
  const before = subsData.subscribers.length;
  subsData.subscribers = subsData.subscribers.filter(s => String(s.id) !== String(id));
  await saveSubs();
  return subsData.subscribers.length !== before;
}

/* =========================
   Risk & honeypot heuristics (using Dexscreener data)
   ========================= */
function computeRisk(pair) {
  // pair: object from Dexscreener
  const liquidity = pair.liquidity?.usd || pair.liquidityUsd || 0;
  const vol1h = pair.volume?.h1 || pair.volumeUsd || 0;
  const fdv = pair.fdv || pair.marketCap || pair.market_cap || 0;
  const holders = pair.holders || null;

  let score = 100;
  const reasons = [];

  if (liquidity < MIN_LIQUIDITY) { score -= 40; reasons.push("Low liquidity"); }
  if (vol1h < MIN_VOLUME_1H) { score -= 20; reasons.push("Low 1h volume"); }
  if (fdv > MAX_MARKET_CAP) { score -= 30; reasons.push("High market cap"); }
  if (holders !== null && holders < 20) { score -= 15; reasons.push("Few holders"); }

  if (pair.honeypot === true || pair.isHoneypot === true) { score = 0; reasons.push("Honeypot flagged"); }

  let label = "🟢 Green";
  if (score < 70 && score >= 40) label = "🟡 Yellow";
  if (score < 40) label = "🔴 Red";

  return { score, label, reasons, liquidity, vol1h, fdv, holders };
}

/* =========================
   Publish alert (public channel + DM subscribers)
   ========================= */
async function publishAlert(pair) {
  try {
    const baseAddr = pair.base?.token?.address || pair.base?.address || pair.address || pair.pair || null;
    const symbol = pair.base?.token?.symbol || pair.base?.symbol || "NEW";
    const slug = encodeURIComponent(pair.pair || pair.pairName || symbol);
    const mint = baseAddr;

    const risk = computeRisk(pair);
    if (risk.label === "🔴 Red") {
      console.log("Skipping red risk pair:", symbol);
      return;
    }

    const title = "🔥 1G TRACKER — Print Money Strategy 🔥";
    const text = `${title}\n\n<b>${symbol}</b>\n<code>${mint}</code>\n\n💰 MC: ${formatUSD(risk.fdv)}\n💧 Liquidity: ${formatUSD(risk.liquidity)}\n📈 Vol (1h): ${formatUSD(risk.vol1h)}\n\n🛡 Risk: ${risk.label}\n${risk.reasons.length ? `• ${risk.reasons.join("\n• ")}` : ""}\n\n🔗 <a href="https://dexscreener.com/solana/${slug}">Open on Dexscreener</a>`;

    const buyUrl = `https://jup.ag/swap?outputMint=${mint}`;
    const sniperUrl = `${SNIPER_BASE_URL}${encodeURIComponent(mint)}`;

    const markup = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔁 Dexscreener", url: `https://dexscreener.com/solana/${slug}` }, { text: "🛒 Instant Buy (open)", url: buyUrl }],
          [{ text: "🚀 Launch Sniper (link)", url: sniperUrl }, { text: "📋 Copy Contract", url: `https://solscan.io/token/${mint}` }]
        ]
      },
      parse_mode: "HTML",
      disable_web_page_preview: true
    };

    // Send GIF (if available) with caption/markup
    try {
      if (BANNER_GIF_URL) {
        await BOT.telegram.sendAnimation(CHANNEL_ID, BANNER_GIF_URL, { caption: text, ...markup });
      } else {
        await BOT.telegram.sendMessage(CHANNEL_ID, text, markup);
      }
    } catch (e) {
      console.warn("Failed public send:", e.message);
    }

    // DM subscribers (private)
    for (const s of subsData.subscribers) {
      try {
        if (THUMBNAIL_URL) {
          await BOT.telegram.sendPhoto(s.id, THUMBNAIL_URL, { caption: text, ...markup });
        } else {
          await BOT.telegram.sendMessage(s.id, text, markup);
        }
      } catch (e) {
        console.warn("Failed DM to subscriber", s.id, e.message);
      }
    }

    console.log("Published:", symbol);
  } catch (e) {
    console.error("publishAlert error:", e.message);
  }
}

/* =========================
   Scanner scheduler (Dexscreener)
   ========================= */
cron.schedule("*/1 * * * *", async () => {
  console.log("Scanner tick:", new Date().toISOString());
  try {
    const res = await axios.get(DEXSCREENER_SOLANA_URL, { timeout: 15000 });
    const data = res.data || {};
    const pairs = data.pairs || [];
    for (const p of pairs) {
      const uniqueId = p.pair || (p.base?.token?.address || "") + ":" + (p.quote?.token?.address || "");
      if (!uniqueId) continue;
      if (seenSet.has(uniqueId)) continue;

      const liquidity = p.liquidity?.usd || p.liquidityUsd || 0;
      const vol1h = p.volume?.h1 || p.volumeUsd || 0;
      const fdv = p.fdv || p.marketCap || p.market_cap || 0;

      if (fdv > MAX_MARKET_CAP) continue;
      if (liquidity < MIN_LIQUIDITY) continue;
      if (vol1h < MIN_VOLUME_1H) continue;

      seenSet.add(uniqueId);
      await publishAlert(p);
    }

    // Trim seenSet occasionally
    if (seenSet.size > 20000) {
      seenSet = new Set(Array.from(seenSet).slice(-8000));
    }
  } catch (e) {
    console.error("Scanner failed:", e.message);
  }
});

/* =========================
   Telegram bot & commands
   ========================= */

const BOT = new Telegraf(BOT_TOKEN);

// /status
BOT.command("status", (ctx) => {
  ctx.reply(`1G Tracker running. Subscribers: ${subsData.subscribers.length}`);
});

// /pause & /resume (admin only) simple flags
let paused = false;
function isAdmin(ctx) { return String(ctx.from.id) === String(process.env.ADMIN_TELEGRAM_ID || ""); }

BOT.command("pause", (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Unauthorized.");
  paused = true;
  ctx.reply("Scanner paused.");
});
BOT.command("resume", (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Unauthorized.");
  paused = false;
  ctx.reply("Scanner resumed.");
});

// demo subscribe (adds caller as paid subscriber for testing)
BOT.command("subscribe_demo", async (ctx) => {
  const id = ctx.from.id;
  const ok = await addSubscriber(id, { demo: true });
  ctx.reply(ok ? "You were added as a demo subscriber." : "You are already subscribed.");
});

// unsubscribe
BOT.command("unsubscribe", async (ctx) => {
  const id = ctx.from.id;
  const ok = await removeSubscriber(id);
  ctx.reply(ok ? "You have been unsubscribed." : "You were not subscribed.");
});

// /list_subs (admin)
BOT.command("list_subs", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Unauthorized.");
  const list = subsData.subscribers.map(s => `${s.id} (added ${new Date(s.addedAt).toLocaleString()})`).slice(0,200).join("\n") || "none";
  ctx.reply(`Subscribers:\n${list}`);
});

// /verify <tx_sig> - verify on-chain payment to your RECEIVER_WALLET
BOT.command("verify", async (ctx) => {
  const args = (ctx.message.text || "").split(/\s+/);
  if (args.length < 2) return ctx.reply("Usage: /verify <transaction_signature>. Make sure you included your numeric Telegram id as memo.");
  const txSig = args[1].trim();
  const telegramId = ctx.from.id;
  ctx.reply("Verifying payment... please wait.");

  try {
    const tx = await SOL_CONN.getParsedTransaction(txSig, { maxSupportedTransactionVersion: 0 });
    if (!tx) return ctx.reply("Transaction not found or not yet confirmed. Try again later.");

    // find transfers to RECEIVER_WALLET
    let lamportsReceived = 0;
    let memo = null;
    const instructions = tx.transaction.message.instructions || [];
    for (const inst of instructions) {
      // system transfer
      if (inst.program === "system" && inst.parsed?.type === "transfer") {
        const info = inst.parsed.info || {};
        const to = info.to;
        const lamports = parseInt(info.lamports || 0, 10);
        if (to === RECEIVER_WALLET) lamportsReceived += lamports;
      }
      // memo program checks
      if (inst.program === "spl-memo" || inst.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr") {
        if (inst.parsed && typeof inst.parsed === "string") memo = inst.parsed;
        else if (inst.data) memo = inst.data;
        else if (inst.parsed?.info?.memo) memo = inst.parsed.info.memo;
      }
    }

    if (lamportsReceived === 0) return ctx.reply("No transfer to receiver wallet found in that transaction.");
    const solReceived = lamportsReceived / 1e9;
    if (solReceived < parseFloat(process.env.PRICE_SOL || "0.5")) return ctx.reply(`You sent ${solReceived} SOL — payment must be >= ${process.env.PRICE_SOL || "0.5"} SOL.`);

    // fallback check in tx.meta.logMessages
    if (!memo && tx.meta && Array.isArray(tx.meta.logMessages)) {
      const m = tx.meta.logMessages.find(l => typeof l === "string" && l.includes("Memo"));
      if (m) memo = m.replace(/^Memo:\s*/, '');
    }

    if (!memo) return ctx.reply("No memo found in transaction. You must set the memo to your numeric Telegram id when sending payment.");

    const memoTrim = String(memo).trim();
    if (memoTrim === String(telegramId)) {
      const added = await addSubscriber(telegramId, { tx: txSig, amount: solReceived });
      if (!added) return ctx.reply("You are already a subscriber.");
      return ctx.reply("Payment verified — you are now a paid subscriber. ✅");
    } else {
      return ctx.reply(`Memo mismatch. Memo: "${memoTrim}" — it must equal your numeric Telegram id. Try again.`);
    }
  } catch (e) {
    console.error("verify error:", e.message);
    return ctx.reply("Error verifying transaction: " + e.message);
  }
});

/* =========================
   Minimal admin HTTP interface (optional)
   ========================= */
const APP = express();
APP.use(bodyParser.json());
APP.get("/admin/subscribers", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1] || "";
  // If ADMIN_HTTP_TOKEN env var is set, require it. Otherwise, deny.
  if (!process.env.ADMIN_HTTP_TOKEN || token !== process.env.ADMIN_HTTP_TOKEN) return res.status(401).json({ error: "unauthorized" });
  return res.json({ subscribers: subsData.subscribers });
});
APP.get("/", (req, res) => res.send("1G Tracker Pro (single-file) running"));
const PORT = process.env.PORT || 3000;
APP.listen(PORT, () => console.log(`HTTP server listening on ${PORT}`));

/* =========================
   Start bot
   ========================= */
BOT.launch().then(()=>console.log("Telegram bot launched")).catch(e=>console.error("Bot launch failed", e));

process.once('SIGINT', () => BOT.stop('SIGINT'));
process.once('SIGTERM', () => BOT.stop('SIGTERM'));
