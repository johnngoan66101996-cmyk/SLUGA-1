#!/usr/bin/env bash
# ==============================================================================
# SLUGA AI Agent — Однокнопочный апдейтер сервера (SpaceWeb / Linux / VPS)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "================================================================="
echo "   🔄 Обновление серверного агента SLUGA из GitHub..."
echo "================================================================="
echo ""

# 1. Получаем свежий код
git pull origin main

# 2. Обновляем зависимости
if [ -f ".venv/bin/pip" ]; then
    .venv/bin/pip install -r requirements.txt -q --upgrade
elif command -v pip3 &> /dev/null; then
    pip3 install -r requirements.txt -q --user --upgrade
fi

# 3. Перезапускаем сервер в фоне
echo "🔄 Перезапуск фонового процесса сервера..."
pkill -f "main.py start" 2>/dev/null || true
sleep 1

PYTHON_BIN="python3"
if [ -f ".venv/bin/python" ]; then
    PYTHON_BIN=".venv/bin/python"
fi

nohup $PYTHON_BIN main.py start > sluga_server.log 2>&1 &
SERVER_PID=$!
sleep 2

if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo "✅ Сервер успешно обновлен и перезапущен в фоне (PID: $SERVER_PID)!"
else
    echo "ℹ️ Проверьте лог сервера: tail -f sluga_server.log"
fi

echo ""
echo "================================================================="
echo "🎉 Обновление сервера завершено!"
echo "================================================================="
