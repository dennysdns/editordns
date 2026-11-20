#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "========================================================"
echo "  SUPER ANIMATOR STUDIO - INSTALADOR macOS 10.15.8 (.DMG)"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado! Baixe em: https://nodejs.org"
  read -p "Pressione Enter para sair..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[1/4] Instalando dependencias do projeto..."
  npm install
fi

echo "[2/4] Instalando Electron 31.7.7 (compativel com macOS 10.15.8 Catalina)..."
npm install -D electron@31.7.7 electron-builder

echo "[3/4] Compilando aplicativo offline (Vite)..."
npm run build

echo "[4/4] Gerando instalador DMG para macOS 10.15.8 (x64)..."
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.json --mac dmg zip --x64

echo ""
echo "========================================================"
echo "  PRONTO! Instalador .dmg gerado em:"
echo "  release/Super-Animator-Studio-macOS-10.15-x64.dmg"
echo "========================================================"
open release || true
read -p "Pressione Enter para fechar..."
