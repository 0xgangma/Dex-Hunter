import requests
import time

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHANNEL_ID = "@yourchannel"

SEEN = set()

def send(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHANNEL_ID, "text": text})

def scan():
    # DexScreener newest Solana pairs
    url = "https://api.dexscreener.com/latest/dex/pairs/solana"
    data = requests.get(url).json()

    for pair in data.get("pairs", []):
        token = pair["baseToken"]["address"]

        if token in SEEN:
            continue

        # filter mcap + volume
        mcap = pair.get("fdv", 0)
        vol = pair.get("volume", {}).get("h24", 0)

        if mcap and mcap < 50000 and vol and vol > 10000:
            SEEN.add(token)

            msg = f"""
🔥 New Solana Gem Found!
📍 Address: {token}
💰 Market Cap: ${mcap}
📈 24H Volume: ${vol}
🔗 Link: {pair['url']}
            """

            send(msg)

while True:
    scan()
    time.sleep(30)
