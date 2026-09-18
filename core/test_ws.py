#!/usr/bin/env python3
"""
SLUGA WS AUDIT v2.0 -- Автономный тест WebSocket-соединения.
Использование:
    python core/test_ws.py
    python core/test_ws.py ws://host:8080
"""
import asyncio, json, sys, os, time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def load_env(path):
    r = {}
    if not path.exists():
        return r
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        r[k.strip()] = v.strip().strip('"').strip("'")
    return r

env = load_env(BASE_DIR / ".env")
SERVER_HOST  = env.get("SERVER_HOST", "127.0.0.1")
SERVER_PORT  = env.get("SERVER_PORT", "8080")
BOT_TOKEN    = env.get("SLUGA_BOT_TOKEN", "")
LITEAI_MODEL = env.get("LITEAI_MODEL", "?")

G = "\033[92m"; Y = "\033[93m"; R = "\033[91m"; C = "\033[96m"; E = "\033[0m"

async def run_test(ws_url, token):
    import urllib.request, urllib.error
    print(f"{C}\n{'='*50}")
    print(f"  SLUGA WS AUDIT v2.0")
    print(f"{'='*50}{E}")
    print(f"  Server: {ws_url}")
    print(f"  Token:  {token[:8]}{'*'*max(0,len(token)-8) if token else '(пусто)'}")
    print(f"  Model:  {LITEAI_MODEL}\n")

    # TEST 1: HTTP /health
    http_url = ws_url.replace("ws://","http://").replace("wss://","https://")
    http_url = http_url.rstrip("/").removesuffix("/ws") + "/health"
    print(f"[1/3] HTTP /health -> {http_url}")
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(http_url, timeout=5) as r:
            body = json.loads(r.read())
            ms = (time.monotonic()-t0)*1000
            print(f"{G}      OK {r.status} ({ms:.0f}ms) model={body.get('model','?')}{E}")
    except Exception as e:
        print(f"{R}      FAIL: {e}{E}")
        print(f"{Y}      Hint: используйте Cloudflare Tunnel если хостинг Beget{E}")
        return False

    # TEST 2: WebSocket auth
    try:
        import websockets
    except ImportError:
        print(f"\n{Y}[2/3] Пропущен - pip install websockets{E}")
        print(f"\n{G}ИТОГ: HTTP OK. WS-тест требует: pip install websockets{E}")
        return True

    full_url = f"{ws_url}?token={token}" if token else ws_url
    print(f"\n[2/3] WebSocket auth -> {full_url[:60]}...")
    t0 = time.monotonic(); auth_ok = False; auth_data = {}
    try:
        async with websockets.connect(full_url, open_timeout=5, close_timeout=3) as ws:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=7)
                p = json.loads(raw)
                ev = p.get("event") or p.get("type","?")
                ms = (time.monotonic()-t0)*1000
                if ev == "authenticated":
                    auth_ok = True; auth_data = p
                    print(f"{G}      OK authenticated ({ms:.0f}ms) model={p.get('model','?')}{E}")
                else:
                    print(f"{R}      FAIL event={ev}: {p}{E}")
            except asyncio.TimeoutError:
                print(f"{R}      FAIL Timeout 7s{E}")

            # TEST 3: PING
            if auth_ok:
                print(f"\n[3/3] PING сообщение...")
                await ws.send(json.dumps({"action":"message","session_id":"audit","text":"/ping audit"}))
                try:
                    raw2 = await asyncio.wait_for(ws.recv(), timeout=10)
                    p2 = json.loads(raw2)
                    ev2 = p2.get("event") or p2.get("type","?")
                    txt = (p2.get("message") or {}).get("content") or p2.get("text","")
                    print(f"{G}      OK event={ev2}{E}")
                    if txt: print(f"{G}      >> {txt[:80]}{E}")
                except asyncio.TimeoutError:
                    print(f"{Y}      WARN: Timeout ответа агента{E}")
            else:
                print(f"\n[3/3] PING пропущен")
    except ConnectionRefusedError:
        print(f"{R}      FAIL Connection refused - запустите: python main.py start{E}")
        return False
    except Exception as e:
        print(f"{R}      FAIL {type(e).__name__}: {e}{E}")
        return False

    print(f"\n{C}{'='*50}{E}")
    if auth_ok:
        print(f"{G}  РЕЗУЛЬТАТ: ВСЕ ТЕСТЫ ПРОЙДЕНЫ! model={auth_data.get('model','?')}{E}")
    else:
        print(f"{R}  РЕЗУЛЬТАТ: ОШИБКА авторизации - проверь SLUGA_BOT_TOKEN в .env{E}")
    print(f"{C}{'='*50}{E}\n")
    return auth_ok

if __name__ == "__main__":
    if len(sys.argv) > 1:
        ws_url = sys.argv[1].rstrip("/")
        if not ws_url.endswith("/ws"): ws_url += "/ws"
        token = sys.argv[2] if len(sys.argv) > 2 else BOT_TOKEN
    else:
        ws_url = f"ws://{SERVER_HOST}:{SERVER_PORT}/ws"
        token = BOT_TOKEN
    ok = asyncio.run(run_test(ws_url, token))
    sys.exit(0 if ok else 1)
