# ==============================================================================
# SLUGA AI Agent — Интерактивный пошаговый мастер установки для Windows
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "   🤖 SLUGA AI Agent — Мастер установки серверного агента (Windows)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# ------------------------------------------------------------------------------
# ШАГ 1: Проверка Python
# ------------------------------------------------------------------------------
Write-Host "🔹 [ШАГ 1/5] Проверка окружения Python..." -ForegroundColor Yellow

$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    if (Get-Command $cmd -ErrorAction SilentlyContinue) {
        try {
            $ver = & $cmd -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')" 2>$null
            if ($ver -and [version]$ver -ge [version]"3.9") {
                $pythonCmd = $cmd
                break
            }
        } catch {}
    }
}

if (-not $pythonCmd) {
    Write-Host "❌ Python 3.9+ не найден в системе!" -ForegroundColor Red
    Write-Host "Пожалуйста, скачайте и установите Python с официального сайта: https://www.python.org/downloads/" -ForegroundColor Red
    Write-Host "⚠️ ОБЯЗАТЕЛЬНО отметьте галочку: 'Add Python to PATH' при установке!" -ForegroundColor Yellow
    Read-Host "Нажмите ENTER для выхода..."
    exit 1
}

Write-Host "   ✅ Найден интерпретатор: $pythonCmd" -ForegroundColor Green

# Создание виртуального окружения
if (-not (Test-Path ".venv")) {
    Write-Host "   🐍 Создание виртуального окружения .venv..." -ForegroundColor Yellow
    & $pythonCmd -m venv .venv
}

$venvPython = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$venvPip = Join-Path $ScriptDir ".venv\Scripts\pip.exe"

if (-not (Test-Path $venvPython)) {
    $venvPython = $pythonCmd
    $venvPip = "$pythonCmd -m pip"
}

Write-Host "   📦 Обновление pip и установка зависимостей..." -ForegroundColor Yellow
& $venvPython -m pip install --upgrade pip -q 2>$null
& $venvPython -m pip install -r requirements.txt -q

Write-Host "   ✅ Все библиотеки успешно установлены!" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# ШАГ 2: Подготовка .env
# ------------------------------------------------------------------------------
Write-Host "🔹 [ШАГ 2/5] Подготовка файла настроек .env..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "   ✅ Файл .env создан из шаблона." -ForegroundColor Green
} else {
    Write-Host "   ✅ Файл .env уже существует." -ForegroundColor Green
}
Write-Host ""

# ------------------------------------------------------------------------------
# ШАГ 3: Токен связи (Bot Token)
# ------------------------------------------------------------------------------
Write-Host "🔹 [ШАГ 3/5] Настройка токена связи с ботом (Bot Token)..." -ForegroundColor Yellow
Write-Host "   Токен используется клиентским приложением (псевдо-Телеграм) для безопасного подключения." -ForegroundColor Gray

$currentToken = ""
if (Test-Path ".env") {
    $match = Select-String -Path ".env" -Pattern "^SLUGA_BOT_TOKEN=(.+)$"
    if ($match) {
        $currentToken = $match.Matches[0].Groups[1].Value.Trim()
    }
}

$userToken = Read-Host "   Введите свой токен (или нажмите ENTER для автогенерации)"
if ([string]::IsNullOrWhiteSpace($userToken)) {
    if (-not [string]::IsNullOrWhiteSpace($currentToken) -and $currentToken -ne "sluga-7722-e4a8b1" -and $currentToken -ne "sluga-your-bot-token-here" -and $currentToken -ne "sluga-core-token") {
        $finalToken = $currentToken
    } else {
        $randHex = -join ((1..6) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
        $randId = Get-Random -Min 1000 -Max 9999
        $finalToken = "sluga-$randId-$randHex"
    }
} else {
    $finalToken = $userToken.Trim()
}

# Обновляем .env
$envContent = Get-Content ".env" -Raw -Encoding UTF8
if ($envContent -match "SLUGA_BOT_TOKEN=") {
    $envContent = $envContent -replace "SLUGA_BOT_TOKEN=.*", "SLUGA_BOT_TOKEN=$finalToken"
} else {
    $envContent += "`nSLUGA_BOT_TOKEN=$finalToken"
}
[System.IO.File]::WriteAllText((Join-Path $ScriptDir ".env"), $envContent, [System.Text.Encoding]::UTF8)

Write-Host "   🔑 Установлен токен связи: $finalToken" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# ШАГ 4: Настройка LiteAI API Key и модели
# ------------------------------------------------------------------------------
Write-Host "🔹 [ШАГ 4/5] Настройка шлюза нейросетей LiteAI (https://liteai.tech)..." -ForegroundColor Yellow
Write-Host "   💡 Баланс зависит от выбора модели" -ForegroundColor Cyan

$currentApiKey = ""
$matchKey = Select-String -Path ".env" -Pattern "^LITEAI_API_KEY=(.+)$"
if ($matchKey) {
    $currentApiKey = $matchKey.Matches[0].Groups[1].Value.Trim()
}

if (-not [string]::IsNullOrWhiteSpace($currentApiKey) -and $currentApiKey -ne "sk-bf-your-api-key-here") {
    Write-Host "   ✅ API-ключ LiteAI уже сохранен в .env" -ForegroundColor Green
    $changeKey = Read-Host "   Хотите изменить его? (y/N)"
    if ($changeKey -match "^[yYдД]") {
        $inputKey = Read-Host "   Введите новый LITEAI_API_KEY (sk-bf-...)"
        if (-not [string]::IsNullOrWhiteSpace($inputKey)) {
            $envContent = Get-Content ".env" -Raw -Encoding UTF8
            $envContent = $envContent -replace "LITEAI_API_KEY=.*", "LITEAI_API_KEY=$($inputKey.Trim())"
            [System.IO.File]::WriteAllText((Join-Path $ScriptDir ".env"), $envContent, [System.Text.Encoding]::UTF8)
        }
    }
} else {
    $inputKey = Read-Host "   Введите ваш LITEAI_API_KEY (или нажмите ENTER чтобы указать позже)"
    if (-not [string]::IsNullOrWhiteSpace($inputKey)) {
        $envContent = Get-Content ".env" -Raw -Encoding UTF8
        $envContent = $envContent -replace "LITEAI_API_KEY=.*", "LITEAI_API_KEY=$($inputKey.Trim())"
        [System.IO.File]::WriteAllText((Join-Path $ScriptDir ".env"), $envContent, [System.Text.Encoding]::UTF8)
        Write-Host "   ✅ Ключ успешно сохранен!" -ForegroundColor Green
    } else {
        Write-Host "   ℹ️ Вы сможете указать ключ позже в файле .env" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "   💡 Каталог LiteAI (все модели доступны по единому ключу sk-bf-...):" -ForegroundColor Gray
Write-Host "   --- Anthropic Claude ---" -ForegroundColor Yellow
Write-Host "   1)  claude-sonnet-4-6                (Баланс скорости и качества, для кода и архитектуры) [ПО УМОЛЧАНИЮ]" -ForegroundColor Cyan
Write-Host "   2)  claude-sonnet-5                  (Следующее поколение: баланс скорости и качества)" -ForegroundColor Cyan
Write-Host "   3)  claude-opus-5                    (Флагман нового поколения для самых сложных задач)" -ForegroundColor Cyan
Write-Host "   4)  claude-opus-4-8                  (Самая мощная, сложные задачи - 200K)" -ForegroundColor Cyan
Write-Host "   5)  claude-opus-4-8[1m]              (Самая мощная, огромный контекст 1.0M)" -ForegroundColor Cyan
Write-Host "   6)  claude-haiku-4-5                 (Быстрые инференс-задачи)" -ForegroundColor Cyan
Write-Host "   --- OpenAI GPT-5.x ---" -ForegroundColor Yellow
Write-Host "   7)  gpt-5.6-luna                     (Длинный контекст 1.1M и творческие задачи)" -ForegroundColor Cyan
Write-Host "   8)  gpt-5.6-sol                      (Строгий формат 1.1M и точные инструкции)" -ForegroundColor Cyan
Write-Host "   9)  gpt-5.6-terra                    (Многошаговые рассуждения и пайплайны 1.1M)" -ForegroundColor Cyan
Write-Host "   --- Открытые модели (Максимальная экономия баланса) ---" -ForegroundColor Yellow
Write-Host "   10) deepseek/deepseek-v4-flash-0731  (Ультра-эконом: открытая модель, контекст 1.3M)" -ForegroundColor Cyan
Write-Host "   11) qwen/qwen3.7-flash               (Alibaba Qwen 3.7, мультиязычная, 1.0M)" -ForegroundColor Cyan
Write-Host "   12) z-ai/glm-5.3-flash               (Zhipu GLM-5.3 Flash, быстрая, 1.3M)" -ForegroundColor Cyan
Write-Host "   13) nvidia/nemotron-3.5-lightning    (NVIDIA Nemotron, быстрая, 262K)" -ForegroundColor Cyan
Write-Host "   14) xiaomi/mimo-v2.5                 (Xiaomi MiMo v2.5, эффективная, 1.1M)" -ForegroundColor Cyan
Write-Host "   15) ibm-granite/granite-4.2-8b       (IBM Granite 4.2, свежий релиз, 131K)" -ForegroundColor Cyan
Write-Host "   0)  Ввести другое название модели вручную" -ForegroundColor White
$modelChoice = Read-Host "   Выберите вариант [1-15, по умолчанию 1]"

$chosenModel = "claude-sonnet-4-6"
switch ($modelChoice) {
    "2" { $chosenModel = "claude-sonnet-5" }
    "3" { $chosenModel = "claude-opus-5" }
    "4" { $chosenModel = "claude-opus-4-8" }
    "5" { $chosenModel = "claude-opus-4-8[1m]" }
    "6" { $chosenModel = "claude-haiku-4-5" }
    "7" { $chosenModel = "gpt-5.6-luna" }
    "8" { $chosenModel = "gpt-5.6-sol" }
    "9" { $chosenModel = "gpt-5.6-terra" }
    "10" { $chosenModel = "deepseek/deepseek-v4-flash-0731" }
    "11" { $chosenModel = "qwen/qwen3.7-flash" }
    "12" { $chosenModel = "z-ai/glm-5.3-flash" }
    "13" { $chosenModel = "nvidia/nemotron-3.5-lightning" }
    "14" { $chosenModel = "xiaomi/mimo-v2.5" }
    "15" { $chosenModel = "ibm-granite/granite-4.2-8b" }
    "0" {
        $customM = Read-Host "   Введите точное название модели"
        if (-not [string]::IsNullOrWhiteSpace($customM)) { $chosenModel = $customM.Trim() }
    }
    Default { $chosenModel = "claude-sonnet-4-6" }
}

$envContent = Get-Content ".env" -Raw -Encoding UTF8
$envContent = $envContent -replace "LITEAI_MODEL=.*", "LITEAI_MODEL=$chosenModel"
[System.IO.File]::WriteAllText((Join-Path $ScriptDir ".env"), $envContent, [System.Text.Encoding]::UTF8)
Write-Host "   ✅ Выбрана модель: $chosenModel" -ForegroundColor Green
Write-Host ""

# ------------------------------------------------------------------------------
# ШАГ 5: Папка данных и готовность к запуску
# ------------------------------------------------------------------------------
Write-Host "🔹 [ШАГ 5/5] Подготовка рабочей директории данных..." -ForegroundColor Yellow
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}
Write-Host "   ✅ Каталог данных готов." -ForegroundColor Green
Write-Host ""

Write-Host "=================================================================" -ForegroundColor Green
Write-Host "🎉 УСТАНОВКА СЕРВЕРНОГО АГЕНТА SLUGA УСПЕШНО ЗАВЕРШЕНА!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "📱 ДАННЫЕ ДЛЯ ПОДКЛЮЧЕНИЯ В КЛИЕНТЕ (ПСЕВДО-ТЕЛЕГРАМ):" -ForegroundColor Yellow
Write-Host "   • Адрес сервера (WebSocket) : ws://localhost:8080/ws" -ForegroundColor White
Write-Host "   • Токен связи с ботом       : $finalToken" -ForegroundColor Cyan
Write-Host ""
Write-Host "🚀 ДЛЯ ЗАПУСКА СЕРВЕРА ВЫПОЛНИТЕ:" -ForegroundColor Yellow
Write-Host "   .\start.bat" -ForegroundColor Green
Write-Host "или" -ForegroundColor Gray
Write-Host "   .venv\Scripts\python.exe main.py start" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""

$startNow = Read-Host "Запустить сервер сейчас? (Y/n)"
if ($startNow -notmatch "^[nNнН]") {
    Write-Host "Запуск сервера..." -ForegroundColor Cyan
    & $venvPython main.py start
}
