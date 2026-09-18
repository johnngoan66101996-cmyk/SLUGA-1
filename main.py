"""
SLUGA Agent — Главная точка входа (CLI & Server Runner).
Поддерживает команды:
  python main.py start         — запуск сервера FastAPI/WebSocket
  python main.py status        — проверка состояния, модели и токена
  python main.py reset-token   — генерация нового криптографического токена связи
  python main.py test-ai       — тестовый запрос к шлюзу LiteAI (https://liteai.tech)
  python main.py info          — вывод параметров для подключения клиента
"""

import sys
import argparse
import asyncio
from pathlib import Path

# Обеспечиваем корректный вывод UTF-8 в консолях Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Убедимся, что корень агента в sys.path
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

# Автоматический перезапуск внутри .venv (если запущен системным Python)
_venv_unix = BASE_DIR / ".venv" / "bin" / "python"
_venv_win = BASE_DIR / ".venv" / "Scripts" / "python.exe"
_venv_py = _venv_win if _venv_win.exists() else (_venv_unix if _venv_unix.exists() else None)
if _venv_py and Path(sys.executable).resolve() != _venv_py.resolve():
    import os
    os.execv(str(_venv_py), [str(_venv_py)] + sys.argv)

from config import settings, LITEAI_MODELS_CATALOG
from core.auth import rotate_token, get_or_create_bot_token


def cmd_status():
    """Выводит сводный статус агента."""
    meta = LITEAI_MODELS_CATALOG.get(settings.liteai_model, {})
    print("=" * 60)
    print("🤖 СЕРВЕРНЫЙ АГЕНТ SLUGA — ТЕКУЩИЙ СТАТУС")
    print("=" * 60)
    print(f"• Токен связи бота  : {settings.sluga_bot_token}")
    print(f"• Активная модель   : {settings.liteai_model} ({meta.get('name', '')})")
    print(f"• Расход токенов    : {meta.get('consumption', 'Сбалансированный')}")
    print(f"• Шлюз LiteAI       : {settings.liteai_base_url}")
    print(f"• LiteAI API Key    : {'[Настроен]' if settings.liteai_api_key else '[НЕ НАСТРОЕН ⚠️]'}")
    print(f"• Хост / Порт       : {settings.server_host}:{settings.server_port}")
    print(f"• База данных SQLite: {settings.sqlite_db_path}")
    print(f"• Голос Edge-TTS    : {settings.tts_voice}")
    print("=" * 60)


def cmd_reset_token():
    """Перегенерирует токен связи бота и сохраняет в .env."""
    print("🔄 Генерация нового криптографического Bot Token...")
    new_token = rotate_token()
    print("=" * 60)
    print("✅ НОВЫЙ ТОКЕН СВЯЗИ УСПЕШНО СОЗДАН И СОХРАНЕН В .env:")
    print(f"\n   {new_token}\n")
    print("⚠️ Скопируйте этот токен в настройки приложения на ПК или телефоне.")
    print("=" * 60)


def cmd_info():
    """Выводит реквизиты для подключения клиента к агенту."""
    print("=" * 60)
    print("📱 ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ КЛИЕНТА К АГЕНТУ SLUGA")
    print("=" * 60)
    print("1. В настройках клиента (псевдо-Телеграм или приложение) укажите:")
    print(f"   • Адрес сервера (WebSocket) : ws://{settings.server_host}:{settings.server_port}/ws")
    print(f"   • Токен связи с ботом       : {settings.sluga_bot_token}")
    print(f"   • HTTP API эндпоинт         : http://{settings.server_host}:{settings.server_port}")
    print("\n2. Для подключения с внешнего IP замените 0.0.0.0 или 127.0.0.1 на IP вашего VPS.")
    print(f"   Пример для внешнего VPS:")
    print(f"   ws://<YOUR_VPS_IP>:{settings.server_port}/ws?token={settings.sluga_bot_token}")
    print("=" * 60)


async def _async_test_ai():
    """Проверяет связь с официальным шлюзом LiteAI."""
    import httpx
    api_key = settings.liteai_api_key
    if not api_key:
        print("❌ Ошибка: LITEAI_API_KEY не указан в файле .env!")
        print("Получите ключ на сайте https://liteai.tech и добавьте в .env:")
        print("LITEAI_API_KEY=sk-bf-...")
        return

    model = settings.liteai_model
    url = f"{settings.liteai_base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "user", "content": "Ответь одним словом: 'Готов'."}
        ],
        "max_tokens": 20
    }

    print(f"📡 Отправка пинг-запроса к {url} (модель: {model})...")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(url, headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                reply = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                print(f"✅ Успешный ответ нейросети LiteAI: '{reply.strip()}'")
                print(f"🎉 Шлюз LiteAI полностью готов к боевой работе!")
            else:
                print(f"⚠️ Ошибка шлюза LiteAI (HTTP {resp.status_code}): {resp.text}")
    except Exception as e:
        print(f"❌ Сбой сетевого соединения: {e}")


def cmd_test_ai():
    asyncio.run(_async_test_ai())



def cmd_start(host: str = None, port: int = None, reload: bool = False):
    """Запускает веб-сервер uvicorn.

    ВАЖНО: В режиме работы через домен (Reverse Proxy / .htaccess) порт
    ВСЕГДА должен совпадать с тем, что прописан в .htaccess.
    По умолчанию: SERVER_PORT=8080 в .env — меняйте только оба сразу.
    """
    import socket
    import uvicorn

    h = host or settings.server_host
    p = port or settings.server_port

    # Жёсткая проверка: порт занят — сообщаем и выходим, не прыгаем на другой!
    # (авто-перебор портов несовместим с Reverse Proxy / .htaccess-конфигом)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _chk:
        _chk.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            _chk.bind((h, p))
        except OSError:
            print("=" * 60)
            print(f"❌ ПОРТ {p} УЖЕ ЗАНЯТ — СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ!")
            print("")
            print("Возможные причины и решения:")
            print(f"  1. Уже запущен другой экземпляр SLUGA:")
            print(f"     pkill -f 'main.py start'  && sleep 2 && python main.py start")
            print(f"  2. Порт {p} занят системным процессом хостинга:")
            print(f"     fuser -k {p}/tcp && python main.py start")
            print(f"  3. Сменить порт (обновить SERVER_PORT в .env И порт в .htaccess).")
            print("=" * 60)
            sys.exit(1)

    # Определяем URL для вывода (с учётом домена из .env)
    sluga_domain = getattr(settings, 'sluga_domain', None)
    if sluga_domain:
        ws_public = f"wss://{sluga_domain}/ws"
        http_public = f"https://{sluga_domain}"
    else:
        ws_public = f"ws://{h}:{p}/ws"
        http_public = f"http://{h}:{p}"

    print("=" * 60)
    print("🚀 ЗАПУСК БОЕВОГО СЕРВЕРА SLUGA")
    print(f"• Слушаем локально : http://{h}:{p}  (внутренний порт)")
    print(f"• Публичный WS URL : {ws_public}?token={settings.sluga_bot_token}")
    print(f"• Публичный API URL: {http_public}")
    print(f"• Модель по умолч. : {settings.liteai_model}")
    print("=" * 60)

    uvicorn.run(
        "server.app:app",
        host=h,
        port=p,
        reload=reload,
        log_level="info"
    )


def main():
    parser = argparse.ArgumentParser(description="SLUGA Autonomous AI Agent CLI")
    subparsers = parser.add_subparsers(dest="command", help="Доступные команды")

    # start
    parser_start = subparsers.add_parser("start", help="Запустить сервер агента")
    parser_start.add_argument("--host", default=None, help="Хост для биндинга (по умолч. из config)")
    parser_start.add_argument("--port", type=int, default=None, help="Порт (по умолч. из config)")
    parser_start.add_argument("--reload", action="store_true", help="Автоперезагрузка при правках кода")

    # status
    subparsers.add_parser("status", help="Показать статус агента и активную модель")

    # reset-token
    subparsers.add_parser("reset-token", help="Сгенерировать новый Bot Token")

    # info
    subparsers.add_parser("info", help="Показать параметры подключения клиента")

    # test-ai
    subparsers.add_parser("test-ai", help="Проверить связь с шлюзом LiteAI")

    args = parser.parse_args()

    if args.command == "start" or args.command is None:
        cmd_start(
            host=args.host if hasattr(args, "host") else None,
            port=args.port if hasattr(args, "port") else None,
            reload=args.reload if hasattr(args, "reload") else False
        )
    elif args.command == "status":
        cmd_status()
    elif args.command == "reset-token":
        cmd_reset_token()
    elif args.command == "info":
        cmd_info()
    elif args.command == "test-ai":
        cmd_test_ai()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
