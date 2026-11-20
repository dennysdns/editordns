@echo off
title Gerador Desktop Portable (.exe) - Super Animator Studio
color 0E
cd /d "%~dp0"

echo ========================================================
echo   SUPER ANIMATOR STUDIO - WINDOWS PORTABLE (.EXE)
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERRO] Node.js nao encontrado! Instale em: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/4] Instalando dependencias do projeto...
  call npm install
)

echo [2/4] Verificando Electron e Electron-Builder...
if not exist "node_modules\electron" (
  call npm install -D electron electron-builder
)

echo [3/4] Compilando aplicativo offline (Vite)...
call npm run build
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao compilar o bundle web.
  pause
  exit /b 1
)

echo [4/4] Gerando Super-Animator-Studio-Portable.exe...
call npx electron-builder --config electron-builder.json --win portable
if %errorlevel% neq 0 (
  echo [ERRO] Falha ao empacotar .exe portable.
  pause
  exit /b 1
)

echo.
echo ========================================================
echo   PRONTO! Seu .exe portable esta em:
echo   release\Super-Animator-Studio-Portable.exe
echo ========================================================
start "" "release"
pause
