@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtualenv ne nayden! Zapustite setup.bat dlya ustanovki.
    pause
    exit /b 1
)
.venv\Scripts\python.exe main.py start
