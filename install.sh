#!/usr/bin/env bash
# Единый однострочный скрипт загрузки и установки SLUGA AI Agent
set -e
echo "🚀 Развертывание SLUGA AI Agent..."

if [ -d "SLUGA-1" ]; then
    cd SLUGA-1
    git pull origin main 2>/dev/null || true
else
    git clone https://github.com/johnngoan66101996-cmyk/SLUGA-1.git
    cd SLUGA-1
fi

bash setup.sh
