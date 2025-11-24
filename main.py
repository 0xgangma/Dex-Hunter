import requests
import time

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHANNEL_ID = "@yourchannel"

SEEN = set()

def send(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHANNEL_ID, "text": text})

def scan():
    url = "https://public-api.birdeye.so/public/defi/tokens?sort_by=mc&sort_type=asc&offset=0&limit=50"
    headers = {"X-API-KEY": "birdeye_api_key_here"}
    data = requests.get(url, headers=headers).json()

    for token in data.get("data", []):
        addr = token["address"]
        if addr in SEEN:
            continue

        mcap = token.get("mc", 0)
        vol = token.get("v24hUSD", 0)

        if mcap < 50000 and vol > 10000:
            SEEN.add(addr)
            msg = f"""
🔥 New Solana Gem!
Address: {addr}
Market Cap: ${mcap}
24H Volume: ${vol}
"""
            send(msg)

while True:
    scan()
    time.sleep(30)
