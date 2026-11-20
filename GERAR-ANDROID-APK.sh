#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "========================================================"
echo "  SUPER ANIMATOR STUDIO - ANDROID (.APK INSTALAVEL)"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado! Baixe em: https://nodejs.org"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[1/5] Instalando dependencias do projeto..."
  npm install
fi

if [ ! -d "node_modules/@capacitor/android" ]; then
  echo "[2/5] Instalando Capacitor Android..."
  npm install @capacitor/core @capacitor/android
  npm install -D @capacitor/cli
fi

echo "[3/5] Compilando aplicativo offline (Vite)..."
npm run build

if [ ! -d "android" ]; then
  echo "[4/5] Criando projeto nativo Android..."
  npx cap add android
fi

npx cap sync android

echo "[5/5] Compilando APK Android..."
cd android
chmod +x gradlew
./gradlew assembleDebug
cd ..

mkdir -p release
cp android/app/build/outputs/apk/debug/app-debug.apk release/Super-Animator-Studio-Android.apk

echo ""
echo "========================================================"
echo "  PRONTO! APK Android gerado em:"
echo "  release/Super-Animator-Studio-Android.apk"
echo "========================================================"
