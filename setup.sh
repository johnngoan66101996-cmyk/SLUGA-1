#!/usr/bin/env bash
# ==============================================================================
# Скрипт автоматической установки и настройки агента SLUGA на Linux VPS (Ubuntu/Debian)
# ==============================================================================

set -e

echo "================================================================="
echo "   🤖 SLUGA AI Agent — Мастер установки серверного агента"
echo "================================================================="

# 1. Проверка прав и зависимостей системы
if command -v apt-get &> /dev/null; then
    echo "📦 Проверка системных пакетов (python3-venv, ffmpeg)..."
    if ! command -v ffmpeg &> /dev/null || ! dpkg -l | grep -q python3-venv; then
        echo "🔧 Установка недостающих пакетов..."
        sudo apt-get update -y && sudo apt-get install -y python3-venv python3-pip ffmpeg
    fi
fi

# 2. Создание изолированного виртуального окружения
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d ".venv" ]; then
    echo "🐍 Создание виртуального окружения Python (.venv)..."
    python3 -m venv .venv
fi

echo "🚀 Установка зависимостей из requirements.txt..."
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# 3. Настройка файла конфигурации .env
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

# 4. Проверка или генерация Bot Token
CURRENT_TOKEN=$(grep -E "^SLUGA_BOT_TOKEN=" .env | cut -d '=' -f2- || true)
if [ -z "$CURRENT_TOKEN" ] || [ "$CURRENT_TOKEN" == "sluga-7722-e4a8b1" ]; then
    echo ""
    echo "🔑 НАСТРОЙКА ТОКЕНА СВЯЗИ БОТА (Bot Token)"
    echo "Токен требуется клиенту (псевдо-Телеграм / ПК / телефон) для безопасного подключения."
    read -p "Введите свой токен или нажмите ENTER для автогенерации: " USER_TOKEN
    
    if [ -z "$USER_TOKEN" ]; then
        GEN_TOKEN=$(python3 -c "import secrets; print(f'sluga-{secrets.token_hex(2)}-{secrets.token_hex(3)}')")
        FINAL_TOKEN="$GEN_TOKEN"
        echo "✅ Сгенерирован уникальный токен: $FINAL_TOKEN"
    else
        FINAL_TOKEN="$USER_TOKEN"
    fi
    sed -i "s|^SLUGA_BOT_TOKEN=.*|SLUGA_BOT_TOKEN=$FINAL_TOKEN|" .env
else
    FINAL_TOKEN="$CURRENT_TOKEN"
    echo "ℹ️ Используется существующий токен: $FINAL_TOKEN"
fi

# 5. Проверка LiteAI API Key
CURRENT_KEY=$(grep -E "^LITEAI_API_KEY=" .env | cut -d '=' -f2- || true)
if [ -z "$CURRENT_KEY" ] || [ "$CURRENT_KEY" == "sk-bf-your-api-key-here" ]; then
    echo ""
    echo "🌐 НАСТРОЙКА КЛЮЧА НЕЙРОСЕТЕЙ LITEAI (https://liteai.tech)"
    read -p "Введите ваш API-ключ (sk-bf-...) [нажмите ENTER чтобы ввести позже]: " USER_KEY
    if [ -n "$USER_KEY" ]; then
        sed -i "s|^LITEAI_API_KEY=.*|LITEAI_API_KEY=$USER_KEY|" .env
        echo "✅ API-ключ сохранен в .env"
    fi
fi

# 6. Вопрос о настройке фоновой службы systemd
echo ""
read -p "⚙️ Настроить фоновую службу systemd (sluga.service) для автозапуска 24/7? [y/N]: " SETUP_SYSTEMD
if [[ "$SETUP_SYSTEMD" =~ ^[Yy]$ ]]; then
    SERVICE_FILE="/etc/systemd/system/sluga.service"
    CURRENT_USER=$(whoami)
    echo "📝 Создание службы $SERVICE_FILE..."
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
    echo "✅ Служба sluga.service успешно запущена и включена в автозагрузку!"
    echo "   Проверить статус: sudo systemctl status sluga"
fi

# 7. Вывод итоговых реквизитов
SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')
echo ""
echo "================================================================="
echo "   🎉 УСТАНОВКА АГЕНТА SLUGA УСПЕШНО ЗАВЕРШЕНА!"
echo "================================================================="
echo "📱 Реквизиты для подключения клиента (псевдо-Телеграм):"
echo "   • Адрес WebSocket : ws://${SERVER_IP}:8080/ws"
echo "   • Токен связи     : ${FINAL_TOKEN}"
echo ""
echo "⚡ Ручной запуск сервера (если не используете systemd):"
echo "   source .venv/bin/activate && python main.py start"
echo ""
echo "📊 Проверка статуса и моделей:"
echo "   source .venv/bin/activate && python main.py status"
echo "================================================================="
