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
        if [ -n "$CURRENT_TOKEN" ] && [ "$CURRENT_TOKEN" != "sluga-7722-e4a8b1" ] && [ "$CURRENT_TOKEN" != "sluga-your-bot-token-here" ] && [ "$CURRENT_TOKEN" != "sluga-core-token" ]; then
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
echo "🔹 [ШАГ 4/6] Настройка шлюза LiteAI (https://liteai.tech)..."
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
echo "   💡 Каталог LiteAI (все модели доступны по единому ключу sk-bf-...):"
echo "   --- Anthropic Claude ---"
echo "   [1]  claude-sonnet-4-6                (Баланс скорости и качества, для кода и архитектуры) [ПО УМОЛЧАНИЮ]"
echo "   [2]  claude-sonnet-5                  (Следующее поколение: баланс скорости и качества)"
echo "   [3]  claude-opus-5                    (Флагман нового поколения для самых сложных задач)"
echo "   [4]  claude-opus-4-8                  (Самая мощная, сложные задачи - 200K)"
echo "   [5]  claude-opus-4-8[1m]              (Самая мощная, огромный контекст 1.0M)"
echo "   [6]  claude-haiku-4-5                 (Быстрые инференс-задачи)"
echo "   --- OpenAI GPT-5.x ---"
echo "   [7]  gpt-5.6-luna                     (Длинный контекст 1.1M и творческие задачи)"
echo "   [8]  gpt-5.6-sol                      (Строгий формат 1.1M и точные инструкции)"
echo "   [9]  gpt-5.6-terra                    (Многошаговые рассуждения и пайплайны 1.1M)"
echo "   --- Открытые модели (Максимальная экономия баланса) ---"
echo "   [10] deepseek/deepseek-v4-flash-0731  (Ультра-эконом: открытая модель, контекст 1.3M)"
echo "   [11] qwen/qwen3.7-flash               (Alibaba Qwen 3.7, мультиязычная, 1.0M)"
echo "   [12] z-ai/glm-5.3-flash               (Zhipu GLM-5.3 Flash, быстрая, 1.3M)"
echo "   [13] nvidia/nemotron-3.5-lightning    (NVIDIA Nemotron, быстрая, 262K)"
echo "   [14] xiaomi/mimo-v2.5                 (Xiaomi MiMo v2.5, эффективная, 1.1M)"
echo "   [15] ibm-granite/granite-4.2-8b       (IBM Granite 4.2, свежий релиз, 131K)"
echo "   [0]  Ввести другое название модели вручную"
read -p "   Ваш выбор [1-15, по умолчанию 1]: " MODEL_CHOICE

case "$MODEL_CHOICE" in
    2) SELECTED_MODEL="claude-sonnet-5" ;;
    3) SELECTED_MODEL="claude-opus-5" ;;
    4) SELECTED_MODEL="claude-opus-4-8" ;;
    5) SELECTED_MODEL="claude-opus-4-8[1m]" ;;
    6) SELECTED_MODEL="claude-haiku-4-5" ;;
    7) SELECTED_MODEL="gpt-5.6-luna" ;;
    8) SELECTED_MODEL="gpt-5.6-sol" ;;
    9) SELECTED_MODEL="gpt-5.6-terra" ;;
    10) SELECTED_MODEL="deepseek/deepseek-v4-flash-0731" ;;
    11) SELECTED_MODEL="qwen/qwen3.7-flash" ;;
    12) SELECTED_MODEL="z-ai/glm-5.3-flash" ;;
    13) SELECTED_MODEL="nvidia/nemotron-3.5-lightning" ;;
    14) SELECTED_MODEL="xiaomi/mimo-v2.5" ;;
    15) SELECTED_MODEL="ibm-granite/granite-4.2-8b" ;;
    0) 
       read -p "   Введите точное название модели: " CUSTOM_M
       SELECTED_MODEL="${CUSTOM_M:-claude-sonnet-4-6}"
       ;;
    *) SELECTED_MODEL="claude-sonnet-4-6" ;;
esac

sed -i "s|^LITEAI_MODEL=.*|LITEAI_MODEL=$SELECTED_MODEL|" .env
echo "   ✅ Установлена модель: $SELECTED_MODEL"
echo ""

# ------------------------------------------------------------------------------
# ШАГ 5: Способ связи со SlugaGram (обход локальной сети)
# ------------------------------------------------------------------------------
echo "🔹 [ШАГ 5/6] Настройка канала связи со SlugaGram..."
SERVER_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "IP_СЕРВЕРА")

# Автопроверка наличия доменов и папок сайтов на хостинге SpaceWeb / Linux / Beget
FOUND_DIRS=()
# Стандартный поиск public_html
while IFS= read -r -d '' dir; do
    FOUND_DIRS+=("$dir")
done < <(find "$HOME" -maxdepth 3 -type d -name "public_html" -print0 2>/dev/null || true)

# Дополнительный поиск: $HOME/$USER_DOMAIN/www
if [ -n "${USER_DOMAIN:-}" ]; then
    for extra in "$HOME/$USER_DOMAIN/www" "$HOME/$USER_DOMAIN" "$HOME/domains/$USER_DOMAIN/public_html"; do
        if [ -d "$extra" ]; then FOUND_DIRS+=("$extra"); fi
    done
fi

SAVED_DOMAIN=$(grep -E "^SLUGA_DOMAIN=" .env 2>/dev/null | cut -d '=' -f2- || true)
if [ -n "$SAVED_DOMAIN" ]; then
    DOMAIN_LABEL="[1] Собственный домен ($SAVED_DOMAIN) через Reverse Proxy (.htaccess)"
else
    DOMAIN_LABEL="[1] Собственный домен через Reverse Proxy (.htaccess / Nginx)"
fi

echo "   🌐 Выберите способ подключения SlugaGram к вашему серверу:"
echo "   $DOMAIN_LABEL [РЕКОМЕНДУЕТСЯ]"
echo "   [2] Cloudflare Zero-Trust Tunnel (автоматический туннель без домена)"
echo "   [3] Прямой IP (ws://${SERVER_IP}:8080/ws)"
read -p "   Ваш выбор [по умолчанию 1]: " NET_CHOICE

if [ -z "$NET_CHOICE" ] || [ "$NET_CHOICE" = "1" ]; then
    USE_DOMAIN=true
    USE_CF=false
elif [ "$NET_CHOICE" = "2" ]; then
    USE_CF=true
    USE_DOMAIN=false
else
    USE_CF=false
    USE_DOMAIN=false
    USE_DIRECT_IP=true
fi

FINAL_CLIENT_URL="ws://${SERVER_IP}:8080/ws"

if [ "$USE_CF" = true ]; then
    echo ""
    echo "   ⚡ Подготовка Cloudflare Zero-Trust Tunnel..."
    mkdir -p tools 2>/dev/null || true
    ARCH=$(uname -m)
    CF_URL=""
    if [ "$ARCH" = "x86_64" ]; then
        CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    elif [[ "$ARCH" =~ "arm" ]] || [ "$ARCH" = "aarch64" ]; then
        CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    fi

    if [ -n "$CF_URL" ] && [ ! -f "tools/cloudflared" ]; then
        echo "   📥 Скачивание cloudflared в tools/cloudflared..."
        curl -L -s --max-time 45 "$CF_URL" -o tools/cloudflared 2>/dev/null || true
        chmod +x tools/cloudflared 2>/dev/null || true
    fi

    cat << 'EOF' > start_tunnel.sh
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [ -f "./tools/cloudflared" ]; then
    exec ./tools/cloudflared tunnel --url http://127.0.0.1:8080
else
    exec cloudflared tunnel --url http://127.0.0.1:8080
fi
EOF
    chmod +x start_tunnel.sh 2>/dev/null || true
    echo "   ✅ Скрипт туннеля готов."

elif [ "$USE_DOMAIN" = true ]; then
    echo ""
    echo "   🌐 Настройка Reverse Proxy (.htaccess / Nginx)..."
    SAVED_DOMAIN=$(grep -E "^SLUGA_DOMAIN=" .env 2>/dev/null | cut -d '=' -f2- || true)
    if [ -n "$SAVED_DOMAIN" ]; then
        PROMPT_TEXT="   Введите имя вашего домена [по умолчанию: $SAVED_DOMAIN]: "
    else
        PROMPT_TEXT="   Введите имя вашего домена (например, mysite.ru): "
    fi

    read -p "$PROMPT_TEXT" USER_DOMAIN
    if [ -z "$USER_DOMAIN" ]; then
        USER_DOMAIN="${SAVED_DOMAIN:-ваш-домен.ru}"
    fi

    # Зачищаем домен от любых префиксов через Python (надёжнее sed на любом хостинге)
    USER_DOMAIN=$(python3 -c "
import re, sys
d = sys.argv[1].strip()
d = re.sub(r'^(https?|wss?)://', '', d)
d = re.sub(r'/.*$', '', d)
print(d)
" "$USER_DOMAIN" 2>/dev/null || echo "$USER_DOMAIN" | sed 's|https://||g; s|http://||g; s|wss://||g; s|ws://||g; s|/.*||')

    echo "   ✅ Домен принят: $USER_DOMAIN"

    # Сохраняем домен в .env
    if grep -q "^SLUGA_DOMAIN=" .env 2>/dev/null; then
        sed -i "s|^SLUGA_DOMAIN=.*|SLUGA_DOMAIN=$USER_DOMAIN|" .env
    else
        echo "SLUGA_DOMAIN=$USER_DOMAIN" >> .env
    fi

    # Добавляем SERVER_DOMAIN в .env если отсутствует (устаревший ключ для обратной совместимости)
    SRV_PORT=$(grep -E '^SERVER_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8888)
    # Обновляем SERVER_PORT на 8888 если он всё ещё равен проблемному 8080
    if [ "$SRV_PORT" = "8080" ]; then
        sed -i 's|^SERVER_PORT=8080|SERVER_PORT=8888|' .env 2>/dev/null || true
        SRV_PORT=8888
        echo "   ⚠️  Порт 8080 занят системой хостинга — автоматически изменён на $SRV_PORT"
    fi

    HTACCESS_CONTENT="<IfModule mod_rewrite.c>
RewriteEngine On

# SLUGA Reverse Proxy — не редактировать вручную!
# 1. WebSocket
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^ws(.*) ws://127.0.0.1:${SRV_PORT}/ws\$1 [P,L]

# 2. Health-check
RewriteCond %{HTTP:Upgrade} !=websocket [NC]
RewriteRule ^health(.*) http://127.0.0.1:${SRV_PORT}/health\$1 [P,L]

# 3. REST API
RewriteCond %{HTTP:Upgrade} !=websocket [NC]
RewriteRule ^api/(.*) http://127.0.0.1:${SRV_PORT}/api/\$1 [P,L]
</IfModule>"

    # Записываем .htaccess в проект
    printf '%s\n' "$HTACCESS_CONTENT" > .htaccess
    echo "   ✅ .htaccess создан в: $(pwd)/.htaccess"

    # Ищем все возможные корни сайта SpaceWeb/Beget и копируем туда
    HTACCESS_TARGETS=("$HOME")
    for _candidate in \
        "$HOME/${USER_DOMAIN}/public_html" \
        "$HOME/${USER_DOMAIN}/www" \
        "$HOME/${USER_DOMAIN}" \
        "$HOME/public_html" \
        "$HOME/www" \
        "$HOME/web" \
        "$HOME/htdocs"; do
        [ -d "$_candidate" ] && HTACCESS_TARGETS+=("$_candidate")
    done
    for _dir in "${FOUND_DIRS[@]}"; do HTACCESS_TARGETS+=("$_dir"); done

    for _target in "${HTACCESS_TARGETS[@]}"; do
        if [ -w "$_target" ]; then
            printf '%s\n' "$HTACCESS_CONTENT" > "$_target/.htaccess"
            echo "   🚀 .htaccess скопирован в: $_target/.htaccess"
        fi
    done

    FINAL_CLIENT_URL="wss://${USER_DOMAIN}/ws"
else
    SRV_PORT=$(grep -E '^SERVER_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8888)
    echo "   ✅ Выбран прямой IP: ws://${SERVER_IP}:${SRV_PORT}/ws"
    FINAL_CLIENT_URL="ws://${SERVER_IP}:${SRV_PORT}/ws"
fi

# ------------------------------------------------------------------------------
# ШАГ 6: Запуск сервера и фонового режима
# ------------------------------------------------------------------------------
echo ""
echo "🔹 [ШАГ 6/6] Запуск серверного агента..."

# Запуск без sudo (nohup background daemon)
read -p "   Запустить сервер в фоновом режиме прямо сейчас? [Y/n]: " RUN_BG
if [[ ! "$RUN_BG" =~ ^[Nn]$ ]]; then
    SRV_PORT=$(grep -E '^SERVER_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8888)

    # Определяем путь к Python: ВСЕГДА .venv, никогда системный
    VENV_PY="$SCRIPT_DIR/.venv/bin/python"
    if [ ! -f "$VENV_PY" ]; then
        VENV_PY="$SCRIPT_DIR/.venv/bin/python3"
    fi
    if [ ! -f "$VENV_PY" ]; then
        VENV_PY="$PYTHON_BIN"  # fallback на системный если venv не найден
    fi
    echo "   🐍 Используемый Python: $VENV_PY"

    # Убиваем предыдущий экземпляр SLUGA
    pkill -f "main.py start" 2>/dev/null || true
    fuser -k ${SRV_PORT}/tcp 2>/dev/null || true
    sleep 2

    nohup "$VENV_PY" main.py start > sluga_server.log 2>&1 &
    SERVER_PID=$!
    disown -h $SERVER_PID 2>/dev/null || true
    echo "   💾 PID сервера: $SERVER_PID (сохранен в server.pid)"
    echo $SERVER_PID > server.pid

    # Ожидание готовности (30с)
    echo "   ⏳ Ожидание готовности сервера (до 30с)..."
    SERVER_READY=false
    for i in {1..30}; do
        sleep 1
        if curl -s --max-time 1 "http://127.0.0.1:${SRV_PORT}/health" >/dev/null 2>&1; then
            SERVER_READY=true
            echo "   ✅ Сервер ответил на /health за ${i}с!"
            break
        fi
    done

    if [ "$USE_CF" = true ] && [ -f "tools/cloudflared" ]; then
        echo "   🚀 Запуск Cloudflare туннеля в фоне..."
        pkill -f "cloudflared tunnel" 2>/dev/null || true
        nohup ./tools/cloudflared tunnel --url "http://127.0.0.1:${SRV_PORT}" > tunnel.log 2>&1 &
        disown -h $! 2>/dev/null || true
        echo "   ⏳ Ожидание выделения защищенного адреса WSS..."
        for i in {1..10}; do
            sleep 1
            CF_DOMAIN=$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' tunnel.log 2>/dev/null | head -n 1 || true)
            if [ -n "$CF_DOMAIN" ]; then
                FINAL_CLIENT_URL="${CF_DOMAIN/https:/wss:}/ws"
                break
            fi
        done
    fi

    # Создание watchdog.sh — использует .venv/bin/python
    WATCHDOG_PORT="$SRV_PORT"
    WATCHDOG_PY="$VENV_PY"
    cat > watchdog.sh << WATCHDOG_EOF
#!/usr/bin/env bash
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\$SCRIPT_DIR"
if ! curl -s --max-time 2 "http://127.0.0.1:${WATCHDOG_PORT}/health" >/dev/null 2>&1; then
    echo "\$(date): SLUGA не отвечает, перезапуск..." >> sluga_watchdog.log
    pkill -f "main.py start" 2>/dev/null || true
    sleep 2
    nohup ${WATCHDOG_PY} main.py start >> sluga_server.log 2>&1 &
    disown -h \$! 2>/dev/null || true
    echo \$! > server.pid
fi
WATCHDOG_EOF
    chmod +x watchdog.sh
    echo "   ✅ Создан watchdog.sh (порт $SRV_PORT, Python: $VENV_PY)"
    echo "   💡 Добавить в cron: (crontab -l 2>/dev/null; echo '*/5 * * * * $SCRIPT_DIR/watchdog.sh') | crontab -"

    if [ "$SERVER_READY" = true ]; then
        echo "   ✅ Сервер успешно запущен и отвечает на /health (PID: $SERVER_PID)!"
    else
        echo ""
        echo "   ⚠️  Сервер не ответил за 30с. Диагностика:"
        echo "   tail -n 20 sluga_server.log"
        tail -n 10 sluga_server.log 2>/dev/null || true
    fi
fi

# Сохраняем файл с готовыми реквизитами для подключения
cat << EOF > connection_info.txt
=================================================================
📱 ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ В ПРИЛОЖЕНИИ SLUGAGRAM:
=================================================================
• Адрес сервера (WebSocket) : ${FINAL_CLIENT_URL}
• Токен связи с ботом       : ${FINAL_TOKEN}
• Модель ИИ                 : ${SELECTED_MODEL}
=================================================================
EOF

echo ""
echo "================================================================="
echo "   🎉 УСТАНОВКА И НАСТРОЙКА SLUGA УСПЕШНО ЗАВЕРШЕНЫ!"
echo "================================================================="
echo "📱 ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ В ПРИЛОЖЕНИИ SLUGAGRAM:"
echo "   • Адрес сервера (WebSocket) : ${FINAL_CLIENT_URL}"
echo "   • Токен связи с ботом       : ${FINAL_TOKEN}"
echo "   • Выбранная модель          : ${SELECTED_MODEL}"
echo ""
echo "💾 Реквизиты также сохранены в файл: connection_info.txt"
echo "⚡ Команды управления сервером:"
echo "   • Просмотр логов:   tail -f sluga_server.log"
echo "   • Проверка статуса: python main.py status"
echo "   • Новый токен:      python main.py reset-token"
echo "================================================================="
