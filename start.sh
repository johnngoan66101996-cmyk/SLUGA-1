#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d ".venv" ]; then
    echo "Виртуальное окружение не найдено. Запустите сначала bash setup.sh"
    exit 1
fi

source .venv/bin/activate
exec python main.py start
