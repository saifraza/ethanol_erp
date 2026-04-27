"""
Direct Telegram sender — bypasses cloud so alarms fire even if cloud is down.

Factory PC has corporate cert-chain interception on HTTPS, so we use a permissive
SSL context. Acceptable because the bridge is on the factory LAN behind Tailscale,
and the alternative is no alarm at all.
"""
import json
import logging
import os
import ssl
import urllib.request
import urllib.error

log = logging.getLogger("telegram_local")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
BOILER_CHAT_ID = os.environ.get("TELEGRAM_BOILER_CHAT_ID", "-4992192716")

# Permissive SSL context for factory PC corporate cert-chain
_CTX = ssl.create_default_context()
_CTX.check_hostname = False
_CTX.verify_mode = ssl.CERT_NONE


def send(text: str, chat_id: str = None, parse_mode: str = "Markdown") -> bool:
    """Send a Telegram message. Returns True on success."""
    if not BOT_TOKEN:
        log.warning("TELEGRAM_BOT_TOKEN not set — direct alarm path disabled")
        return False
    cid = chat_id or BOILER_CHAT_ID
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    body = json.dumps({"chat_id": cid, "parse_mode": parse_mode, "text": text}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=body,
                                     headers={"Content-Type": "application/json"},
                                     method="POST")
        resp = urllib.request.urlopen(req, timeout=10, context=_CTX)
        if resp.getcode() == 200:
            return True
        log.warning(f"Telegram returned HTTP {resp.getcode()}")
        return False
    except Exception as e:
        log.error(f"Direct Telegram send failed: {e}")
        return False
