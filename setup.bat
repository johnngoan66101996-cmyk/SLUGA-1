@echo off
chcp 65001 >nul
title SLUGA Agent Setup (Windows)

echo =================================================================
echo    SLUGA AI Agent - Master Ustanovki (Windows)
echo =================================================================

cd /d "%~dp0"

:: 1. Proverka Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python ne nayden! Pozhaluysta, ustanovite Python 3.9+ i dobavte v PATH.
    pause
    exit /b 1
)

:: 2. Sozdanie venv
if not exist ".venv" (
    echo [*] Sozdanie virtualnogo okruzheniya .venv...
    python -m venv .venv
)

:: 3. Ustanovka zavisimostey
echo [*] Ustanovka zavisimostey...
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -r requirements.txt

:: 4. Nastroyka .env
if not exist ".env" (
    copy .env.example .env >nul
    echo [*] Sozdan fayl .env
)

echo.
echo =================================================================
echo [OK] Ustanovka uspeshno zavershena!
echo.
echo Dlya zapuska servera vypolnite:
echo   start.bat
echo ili
echo   .venv\Scripts\python.exe main.py start
echo =================================================================
pause
