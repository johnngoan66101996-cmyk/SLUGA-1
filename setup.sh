#!/usr/bin/env bash
# ==============================================================================
# SLUGA AI Agent — Интерактивный пошаговый мастер установки
# Работает как на обычных VPS (root/sudo), так и на хостингах без sudo (SpaceWeb и др.)
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

clear || true
echo "================================================================="
echo "   🤖 SLUGA AI Agent — Пошаговый установщик серверного агента"
echo "================================================================="
echo ""

# ------------------------------------------------------------------------------
# ШАГ 1: Поиск и проверка Python
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 1/5] Проверка окружения Python..."

PYTHON_BIN=""
for py in python3 python3.11 python3.10 python3.9 python; do
    if command -v $py &> /dev/null; then
        PY_VER=$($py -c 'import sys; print(".".join(map(str, sys.version_info[:2])))' 2>/dev/null || true)
        if [ -n "$PY_VER" ]; then
            PYTHON_BIN="$py"
            break
        fi
    fi
done

if [ -z "$PYTHON_BIN" ]; then
    echo "❌ Python не найден! Пожалуйста, установите Python 3.9+."
    exit 1
fi
echo "   ✅ Найден интерпретатор: $PYTHON_BIN (версия $PY_VER)"

# Проверяем наличие прав sudo (не падаем при отказе!)
HAS_SUDO=false
if command -v sudo &> /dev/null; then
    if sudo -n true 2>/dev/null; then
        HAS_SUDO=true
    fi
fi

# Если есть root/sudo и apt-get, тихо доустанавливаем системные пакеты
if [ "$HAS_SUDO" = true ] && command -v apt-get &> /dev/null; then
    echo "   📦 Проверка системных пакетов через sudo apt-get..."
    sudo apt-get update -y -qq >/dev/null 2>&1 || true
    sudo apt-get install -y -qq python3-venv python3-pip ffmpeg >/dev/null 2>&1 || true
else
    echo "   ℹ️ Запуск в пользовательском режиме (без sudo)"
fi

# Создаем виртуальное окружение .venv
if [ ! -d ".venv" ]; then
    echo "   🐍 Создание виртуального окружения .venv..."
    $PYTHON_BIN -m venv .venv 2>/dev/null || virtualenv -p $PYTHON_BIN .venv 2>/dev/null || {
        echo "   ⚠️ venv недоступен, установка будет выполнена через pip --user"
    }
fi

if [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
    PIP_CMD="pip"
else
    PIP_CMD="$PYTHON_BIN -m pip"
fi

echo "   📦 Установка необходимых библиотек..."
$PIP_CMD install --upgrade pip -q >/dev/null 2>&1 || true
$PIP_CMD install -r requirements.txt -q
echo "   ✅ Все зависимости успешно установлены!"
echo ""

# ------------------------------------------------------------------------------
# ШАГ 2: Конфигурация .env
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 2/5] Подготовка файла настроек .env..."
if [ ! -f ".env" ]; then
    cp .env.example .env
fi
echo "   ✅ Файл .env готов к настройке."
echo ""

# ------------------------------------------------------------------------------
# ШАГ 3: Настройка Токена связи (Bot Token)
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 3/5] Настройка токена связи с ботом (Bot Token)..."
CURRENT_TOKEN=$(grep -E "^SLUGA_BOT_TOKEN=" .env | cut -d '=' -f2- || true)

while true; do
    echo "   Токен используется клиентом (псевдо-Телеграм на ПК/телефоне) для защиты сокета."
    read -p "   Введите свой токен (или нажмите ENTER для автогенерации): " USER_TOKEN
    
    if [ -z "$USER_TOKEN" ]; then
        if [ -n "$CURRENT_TOKEN" ] && [ "$CURRENT_TOKEN" != "sluga-7722-e4a8b1" ]; then
            FINAL_TOKEN="$CURRENT_TOKEN"
        else
            FINAL_TOKEN=$($PYTHON_BIN -c "import secrets; print(f'sluga-{secrets.token_hex(2)}-{secrets.token_hex(3)}')")
        fi
        echo "   ✅ Использован токен: $FINAL_TOKEN"
        break
    else
        FINAL_TOKEN="$USER_TOKEN"
        echo "   ✅ Принят пользовательский токен: $FINAL_TOKEN"
        break
    fi
done

sed -i "s|^SLUGA_BOT_TOKEN=.*|SLUGA_BOT_TOKEN=$FINAL_TOKEN|" .env
echo ""

# ------------------------------------------------------------------------------
# ШАГ 4: Настройка ключа LiteAI и выбор модели
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 4/5] Настройка шлюза LiteAI (https://liteai.tech)..."
CURRENT_KEY=$(grep -E "^LITEAI_API_KEY=" .env | cut -d '=' -f2- || true)

if [ -z "$CURRENT_KEY" ] || [ "$CURRENT_KEY" == "sk-bf-your-api-key-here" ]; then
    echo "   Получите единый API-ключ в кабинете liteai.tech (формат sk-bf-...)"
    read -p "   Вставьте ваш LiteAI API Key [или ENTER, чтобы ввести позже]: " USER_KEY
    if [ -n "$USER_KEY" ]; then
        sed -i "s|^LITEAI_API_KEY=.*|LITEAI_API_KEY=$USER_KEY|" .env
        echo "   ✅ API-ключ сохранен в .env"
    else
        echo "   ⚠️ Ключ не введен. Вы сможете добавить его позже в файл .env"
    fi
else
    echo "   ℹ️ LiteAI API-ключ уже настроен."
fi

echo ""
echo "   Выберите активную ИИ-модель:"
echo "   [1] claude-sonnet-4.6        (Рекомендуется: код, архитектура, баланс ~3$/1M)"
echo "   [2] deepseek/deepseek-chat   (Ультра-эконом: в 20 раз дешевле Sonnet, ~0.14$/1M)"
echo "   [3] openai/gpt-4o            (Универсальная мультимодальная модель ~2.5$/1M)"
echo "   [4] claude-opus-4.8          (Максимальная логическая мощность ~15$/1M)"
read -p "   Ваш выбор [по умолчанию 1]: " MODEL_CHOICE

case "$MODEL_CHOICE" in
    2) SELECTED_MODEL="deepseek/deepseek-chat" ;;
    3) SELECTED_MODEL="openai/gpt-4o" ;;
    4) SELECTED_MODEL="claude-opus-4.8" ;;
    *) SELECTED_MODEL="claude-sonnet-4.6" ;;
esac

sed -i "s|^LITEAI_MODEL=.*|LITEAI_MODEL=$SELECTED_MODEL|" .env
echo "   ✅ Установлена модель: $SELECTED_MODEL"
echo ""

# ------------------------------------------------------------------------------
# ШАГ 5: Запуск сервера и фонового режима
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 5/5] Запуск серверного агента..."

SERVER_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "IP_СЕРВЕРА")

# Проверка: есть ли systemd и sudo
if [ "$HAS_SUDO" = true ] && command -v systemctl &> /dev/null; then
    read -p "   Настроить автозапуск через службу systemd 24/7? [y/N]: " SETUP_SYS
    if [[ "$SETUP_SYS" =~ ^[Yy]$ ]]; then
        SERVICE_FILE="/etc/systemd/system/sluga.service"
        CURRENT_USER=$(whoami)
        sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=SLUGA Autonomous AI Agent Service
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/.venv/bin/python $SCRIPT_DIR/main.py start
Restart=always
RestartSec=5
EnvironmentFile=$SCRIPT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF"
        sudo systemctl daemon-reload
        sudo systemctl enable sluga.service
        sudo systemctl restart sluga.service
        echo "   ✅ Служба sluga.service запущена 24/7!"
    fi
else
    # Режим без sudo (nohup background daemon)
    read -p "   Запустить сервер в фоновом режиме прямо сейчас? [Y/n]: " RUN_BG
    if [[ ! "$RUN_BG" =~ ^[Nn]$ ]]; then
        pkill -f "main.py start" 2>/dev/null || true
        nohup $PYTHON_BIN main.py start > sluga_server.log 2>&1 &
        SERVER_PID=$!
        sleep 2
        if ps -p $SERVER_PID > /dev/null 2>&1; then
            echo "   ✅ Сервер успешно запущен в фоновом режиме (PID: $SERVER_PID)!"
            echo "   Логи сервера пишутся в: sluga_server.log"
        else
            echo "   ℹ️ Для ручного запуска введите: python main.py start"
        fi
    fi
fi

echo ""
echo "================================================================="
echo "   🎉 УСТАНОВКА И НАСТРОЙКА SLUGA УСПЕШНО ЗАВЕРШЕНЫ!"
echo "================================================================="
echo "📱 ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ В ПРИЛОЖЕНИИ (псевдо-Телеграм):"
echo "   • Адрес сервера (WebSocket) : ws://${SERVER_IP}:8080/ws"
echo "   • Токен связи с ботом       : ${FINAL_TOKEN}"
echo "   • Выбранная модель          : ${SELECTED_MODEL}"
echo ""
echo "⚡ Команды управления:"
echo "   • Просмотр логов:   tail -f sluga_server.log"
echo "   • Проверка статуса: python main.py status"
echo "   • Новый токен:      python main.py reset-token"
echo "================================================================="
