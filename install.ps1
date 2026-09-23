# ==============================================================================
# SLUGA-1: Универсальный онлайн-установщик серверного агента для Windows PowerShell
# Запуск из любой папки одной командой:
# irm https://raw.githubusercontent.com/johnngoan66101996-cmyk/SLUGA-1/main/install.ps1 | iex
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "  🤖 УНИВЕРСАЛЬНЫЙ УСТАНОВЩИК СЕРВЕРНОГО АГЕНТА SLUGA-1 (WINDOWS)" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

# 1. Выбор директории установки
Write-Host "`n📁 Выбор директории для установки агента:" -ForegroundColor Yellow
$opt1 = "C:\SLUGA-1 (Рекомендуется, корень диска C:)"
$opt2 = "$HOME\Desktop\SLUGA-1 (Рабочий стол)"
$opt3 = "$HOME\SLUGA-1 (Домашняя папка пользователя)"
$opt4 = "Ввести свой путь вручную"

Write-Host "  [1] $opt1" -ForegroundColor Green
Write-Host "  [2] $opt2"
Write-Host "  [3] $opt3"
Write-Host "  [4] $opt4"

$targetDir = "C:\SLUGA-1"
$choice = Read-Host "`n> Выберите папку установки [1-4] (Enter = 1)"

if ($choice -eq "2") {
    $targetDir = "$HOME\Desktop\SLUGA-1"
} elseif ($choice -eq "3") {
    $targetDir = "$HOME\SLUGA-1"
} elseif ($choice -eq "4") {
    $custom = Read-Host "> Введите полный путь к папке"
    if ($custom.Trim()) { $targetDir = $custom.Trim() }
} else {
    $targetDir = "C:\SLUGA-1"
}

$targetDir = $targetDir.Trim().Trim('"').Trim("'")

Write-Host "`n🎯 Целевая папка установки: $targetDir" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $targetDir)) {
    Write-Host "📦 Создаю директорию $targetDir..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Set-Location $targetDir

if (Get-Command git -ErrorAction SilentlyContinue) {
    if (-not (Test-Path "$targetDir\.git")) {
        Write-Host "⬇️ Клонирование репозитория SLUGA-1..." -ForegroundColor Yellow
        git clone https://github.com/johnngoan66101996-cmyk/SLUGA-1.git .
    } else {
        Write-Host "🔄 Репозиторий уже существует. Обновление (git pull)..." -ForegroundColor Yellow
        git pull origin main
    }
} else {
    Write-Host "⬇️ Git не найден. Скачивание ZIP-архива с GitHub..." -ForegroundColor Yellow
    $zipUrl = "https://github.com/johnngoan66101996-cmyk/SLUGA-1/archive/refs/heads/main.zip"
    $zipFile = "$targetDir\sluga1.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile
    Expand-Archive -Path $zipFile -DestinationPath "$targetDir\temp_extract" -Force
    Copy-Item -Path "$targetDir\temp_extract\SLUGA-1-main\*" -Destination $targetDir -Recurse -Force
    Remove-Item -Path $zipFile -Force
    Remove-Item -Path "$targetDir\temp_extract" -Recurse -Force
}

Write-Host "`n🚀 Запуск настройки окружения и интерактивного мастера..." -ForegroundColor Green
if (Test-Path "$targetDir\setup.ps1") {
    & "$targetDir\setup.ps1"
} else {
    Write-Host "❌ Ошибка: setup.ps1 не найден в $targetDir" -ForegroundColor Red
}
