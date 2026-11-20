@echo off
title Gerador Android (.apk) - Super Animator Studio
color 0A
cd /d "%~dp0"

echo ========================================================
echo   SUPER ANIMATOR STUDIO - ANDROID (.APK INSTALAVEL)
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERRO] Node.js nao encontrado! Instale em: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/5] Instalando dependencias do projeto...
  call npm install
)

echo [2/5] Verificando Capacitor Android...
if not exist "node_modules\@capacitor\android" (
  call npm install @capacitor/core @capacitor/android
  call npm install -D @capacitor/cli
)

echo [3/5] Compilando aplicativo web offline (Vite)...
call npm run build
if %errorlevel% neq 0 (
  echo [ERRO] Falha no build Vite.
  pause
  exit /b 1
)

if not exist "android" (
  echo [4/5] Criando projeto nativo Android...
  call npx cap add android
)

call npx cap sync android

echo [5/5] Compilando APK Android (Debug instalavel)...
cd android
call gradlew.bat assembleDebug
if %errorlevel% neq 0 (
  echo [ERRO] Verifique se o Java JDK 17+ e Android SDK estao instalados.
  cd ..
  pause
  exit /b 1
)
cd ..

if not exist "release" mkdir release
copy /Y "android\app\build\outputs\apk\debug\app-debug.apk" "release\Super-Animator-Studio-Android.apk" >nul

echo.
echo ========================================================
echo   PRONTO! APK Android gerado em:
echo   release\Super-Animator-Studio-Android.apk
echo ========================================================
start "" "release"
pause
