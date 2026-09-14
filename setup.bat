@echo off
chcp 65001 >nul
title SLUGA Agent Setup (Windows)

cd /d "%~dp0"

:: Попытка запуска через PowerShell с обходом ExecutionPolicy
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0setup.ps1"
if %errorlevel% equ 0 goto :eof

echo.
echo [!] PowerShell вернул ошибку, переключаемся на базовый командный режим...
echo =================================================================
echo    SLUGA AI Agent - Базовая установка (Windows CMD)
echo =================================================================

:: 1. Проверка Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python не найден! Установите Python 3.9+ с сайта python.org и добавьте в PATH.
    pause
    exit /b 1
)

:: 2. Создание venv
if not exist ".venv" (
    echo [*] Создание виртуального окружения .venv...
    python -m venv .venv
)

:: 3. Установка зависимостей
echo [*] Установка зависимостей...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip -q
pip install -r requirements.txt -q

:: 4. Настройка .env
if not exist ".env" (
    copy .env.example .env >nul
    echo [*] Создан файл .env
)

if not exist "data" mkdir data

echo.
echo =================================================================
echo [OK] Установка успешно завершена!
echo.
echo Для запуска сервера выполните:
echo   start.bat
echo или
echo   .venv\Scripts\python.exe main.py start
echo =================================================================
pause
