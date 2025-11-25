import requests
import time
from flask import Flask

app = Flask(__name__)

BOT_TOKEN = "YOUR_TELEGRAM_BOT_TOKEN"
CHANNEL_ID = "@yourchannel"

SEEN = set()

def send(text):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    requests.post(url, data={"chat_id": CHANNEL_ID, "text": text})

def scan():
    url = "https://api.dexscreener.com/latest/dex/search?q=solana"
    data = requests.get(url).json()

    for pair in data.get("pairs", []):
        token = pair["baseToken"]["address"]
        if token in SEEN:
            continue

        mcap = pair.get("fdv", 0)
        vol = pair.get("volume", {}).get("h24", 0)

        if mcap and mcap < 50000 and vol and vol > 10000:
            SEEN.add(token)
            msg = f"""
🔥 SOLANA NEW GEM
Token: {token}
MCAP: ${mcap}
Volume (24H): ${vol}
Link: {pair['url']}
"""
            send(msg)

@app.route("/")
def home():
    return "Bot Running!", 200

if __name__ == "__main__":
    while True:
        scan()
        time.sleep(30)
