import React, { useEffect, useMemo, useState } from 'react';
import {
  Monitor,
  Download,
  X,
  CheckCircle2,
  Terminal,
  Package,
  Copy,
  Check,
  HardDrive,
  Link2,
  AlertCircle,
  Laptop,
  Smartphone,
} from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';
import { createZipBlob, ZipEntryInput } from '../../utils/zipBuilder';

interface DesktopExportModalProps {
  open: boolean;
  onClose: () => void;
}

type DesktopTargetOs = 'windows' | 'macos' | 'android';

const ELECTRON_MAIN_CJS = `const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'SuperAnimatorData');
  try {
    fs.mkdirSync(portableDataDir, { recursive: true });
    app.setPath('userData', portableDataDir);
  } catch {}
}

app.setName('Super Animator Studio');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

const gotLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function registerAppProtocol() {
  const distDir = path.resolve(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    let relPath = decodeURIComponent(reqUrl.pathname || '/');
    if (relPath === '/' || relPath === '') relPath = '/index.html';
    const safeRel = path.normalize(relPath).replace(/^(\\.\\.([/\\\\]))+/, '').replace(/^[/\\\\]+/, '');
    let targetPath = path.join(distDir, safeRel);
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(distDir, 'index.html');
    }
    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const iconWin = path.resolve(__dirname, '..', 'public', 'icon.ico');
  const iconPng = path.resolve(__dirname, '..', 'public', 'pwa-512x512.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'Super Animator Studio — Desktop',
    backgroundColor: '#0B0D11',
    autoHideMenuBar: !isMac,
    icon: isMac ? (fs.existsSync(iconPng) ? iconPng : undefined) : (fs.existsSync(iconWin) ? iconWin : undefined),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow.loadURL('app://studio/index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerAppProtocol();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
`;

const ELECTRON_PRELOAD_CJS = `const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopStudio', {
  isDesktop: true,
  isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
  platform: process.platform,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
});
`;

const ELECTRON_BUILDER_JSON = `{
  "appId": "com.superanimator.studio.desktop",
  "productName": "Super Animator Studio",
  "directories": { "output": "release", "buildResources": "public" },
  "files": ["dist/**/*", "electron/**/*", "public/icon.ico", "public/pwa-512x512.png", "package.json"],
  "win": {
    "icon": "public/icon.ico",
    "target": [{ "target": "portable", "arch": ["x64"] }]
  },
  "portable": {
    "artifactName": "Super-Animator-Studio-Portable.exe",
    "requestExecutionLevel": "user"
  },
  "mac": {
    "icon": "public/pwa-512x512.png",
    "category": "public.app-category.video",
    "identity": null,
    "hardenedRuntime": false,
    "gatekeeperAssess": false,
    "extendInfo": {
      "LSMinimumSystemVersion": "10.15.0"
    },
    "target": [
      { "target": "dmg", "arch": ["x64"] },
      { "target": "zip", "arch": ["x64"] }
    ]
  },
  "dmg": {
    "artifactName": "Super-Animator-Studio-macOS-10.15-x64.dmg",
    "title": "Super Animator Studio (macOS 10.15+)",
    "contents": [
      { "x": 130, "y": 220 },
      { "x": 410, "y": 220, "type": "link", "path": "/Applications" }
    ]
  }
}
`;

const CAPACITOR_CONFIG_JSON = `{
  "appId": "com.superanimator.studio.android",
  "appName": "Super Animator Studio",
  "webDir": "dist",
  "bundledWebRuntime": false,
  "server": {
    "androidScheme": "https"
  },
  "android": {
    "allowMixedContent": false,
    "backgroundColor": "#0B0D11"
  }
}
`;

const BUILD_BAT = `@echo off
title Gerador Desktop Portable (.exe) - Super Animator Studio
color 0E
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERRO] Node.js nao encontrado! Instale em: https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" call npm install
if not exist "node_modules\\electron" call npm install -D electron electron-builder
call npm run build
call npx electron-builder --config electron-builder.json --win portable
echo Pronto! Arquivo gerado em release\\Super-Animator-Studio-Portable.exe
start "" "release"
pause
`;

const BUILD_MAC_COMMAND = `#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "========================================================"
echo "  SUPER ANIMATOR STUDIO - INSTALADOR macOS 10.15.8 (.DMG)"
echo "========================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js nao encontrado! Baixe em: https://nodejs.org"
  read -p "Pressione Enter para sair..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

echo "Instalando Electron 31.7.7 (compativel com macOS 10.15.8 Catalina)..."
npm install -D electron@31.7.7 electron-builder
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --config electron-builder.json --mac dmg zip --x64

echo "Pronto! Instalador gerado em release/Super-Animator-Studio-macOS-10.15-x64.dmg"
open release || true
read -p "Pressione Enter para fechar..."
`;

const BUILD_ANDROID_BAT = `@echo off
title Gerador Android (.apk) - Super Animator Studio
color 0A
cd /d "%~dp0"

if not exist "node_modules" call npm install
if not exist "node_modules\\@capacitor\\android" (
  call npm install @capacitor/core @capacitor/android
  call npm install -D @capacitor/cli
)
call npm run build
if not exist "android" call npx cap add android
call npx cap sync android
cd android
call gradlew.bat assembleDebug
cd ..
if not exist "release" mkdir release
copy /Y "android\\app\\build\\outputs\\apk\\debug\\app-debug.apk" "release\\Super-Animator-Studio-Android.apk" >nul
echo Pronto! APK gerado em release\\Super-Animator-Studio-Android.apk
start "" "release"
pause
`;

const BUILD_ANDROID_SH = `#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then npm install; fi
if [ ! -d "node_modules/@capacitor/android" ]; then
  npm install @capacitor/core @capacitor/android
  npm install -D @capacitor/cli
fi
npm run build
if [ ! -d "android" ]; then npx cap add android; fi
npx cap sync android
cd android && chmod +x gradlew && ./gradlew assembleDebug && cd ..
mkdir -p release
cp android/app/build/outputs/apk/debug/app-debug.apk release/Super-Animator-Studio-Android.apk
echo "Pronto! APK gerado em release/Super-Animator-Studio-Android.apk"
`;

function buildWindowsBatContent(appUrl: string): string {
  return [
    '@echo off',
    'title Super Animator Studio - Windows Desktop Portable',
    'cd /d "%~dp0"',
    'set "PROFILE_DIR=%~dp0SuperAnimatorDesktopProfile"',
    'if not exist "%PROFILE_DIR%" mkdir "%PROFILE_DIR%"',
    '',
    `set "APP_URL=${appUrl}"`,
    '',
    'set "EDGE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not exist "%EDGE%" set "EDGE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if exist "%EDGE%" (',
    '  start "" "%EDGE%" --app="%APP_URL%" --user-data-dir="%PROFILE_DIR%" --new-window',
    '  exit /b 0',
    ')',
    '',
    'set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if exist "%CHROME%" (',
    '  start "" "%CHROME%" --app="%APP_URL%" --user-data-dir="%PROFILE_DIR%" --new-window',
    '  exit /b 0',
    ')',
    '',
    'start "" "%APP_URL%"',
    '',
  ].join('\r\n');
}

function buildMacLauncherContent(appUrl: string): string {
  return [
    '#!/bin/bash',
    `APP_URL="${appUrl}"`,
    'PROFILE_DIR="$HOME/.super-animator-studio-desktop"',
    'mkdir -p "$PROFILE_DIR"',
    '',
    'if [ -d "/Applications/Google Chrome.app" ]; then',
    '  open -na "Google Chrome" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR" --new-window',
    'elif [ -d "/Applications/Microsoft Edge.app" ]; then',
    '  open -na "Microsoft Edge" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR" --new-window',
    'elif [ -d "/Applications/Brave Browser.app" ]; then',
    '  open -na "Brave Browser" --args --app="$APP_URL" --user-data-dir="$PROFILE_DIR" --new-window',
    'else',
    '  open "$APP_URL"',
    'fi',
    '',
  ].join('\n');
}

export const DesktopExportModal: React.FC<DesktopExportModalProps> = ({ open, onClose }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [targetOs, setTargetOs] = useState<DesktopTargetOs>(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search);
      if (q.get('android') === '1') return 'android';
    }
    if (typeof navigator !== 'undefined') {
      const ua = navigator.platform || navigator.userAgent;
      if (/Android/i.test(ua)) return 'android';
      if (/Mac/i.test(ua)) return 'macos';
    }
    return 'windows';
  });
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return targetOs === 'android'
      ? `${window.location.origin}/?android=1`
      : `${window.location.origin}/?desktop=1`;
  }, [targetOs]);

  const batDownloadUrl = useMemo(() => {
    if (!open || typeof window === 'undefined') return '';
    const batContent = buildWindowsBatContent(window.location.origin);
    return URL.createObjectURL(new Blob([batContent], { type: 'application/x-bat' }));
  }, [open]);

  const macCommandDownloadUrl = useMemo(() => {
    if (!open || typeof window === 'undefined') return '';
    const macContent = buildMacLauncherContent(window.location.origin);
    return URL.createObjectURL(new Blob([macContent], { type: 'text/x-shellscript' }));
  }, [open]);

  useEffect(() => {
    return () => {
      if (batDownloadUrl) URL.revokeObjectURL(batDownloadUrl);
    };
  }, [batDownloadUrl]);

  useEffect(() => {
    return () => {
      if (macCommandDownloadUrl) URL.revokeObjectURL(macCommandDownloadUrl);
    };
  }, [macCommandDownloadUrl]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    let createdUrl: string | null = null;

    const prepareZip = async () => {
      const readme = [
        'SUPER ANIMATOR STUDIO - ANDROID (.APK), WINDOWS (.EXE) & macOS 10.15.8 (.DMG)',
        '==============================================================================',
        '',
        '1. ANDROID (.APK via Capacitor):',
        '   - Coloque estes arquivos na raiz do projeto baixado.',
        '   - No Windows: de duplo clique em GERAR-ANDROID-APK.bat',
        '   - No Mac/Linux: ./GERAR-ANDROID-APK.sh',
        '   - Requer Node.js 18+ e Java JDK 17+ / Android SDK.',
        '   - Saida: release/Super-Animator-Studio-Android.apk',
        '',
        '2. WINDOWS PORTABLE (.EXE):',
        '   - De duplo clique em GERAR-PORTABLE-EXE.bat',
        '   - Saida: release\\Super-Animator-Studio-Portable.exe',
        '',
        '3. macOS 10.15.8 CATALINA (.DMG x64):',
        '   - Execute: chmod +x GERAR-MACOS-DMG.command && ./GERAR-MACOS-DMG.command',
        '   - Saida: release/Super-Animator-Studio-macOS-10.15-x64.dmg',
        '',
      ].join('\r\n');

      const entries: ZipEntryInput[] = [
        { path: 'capacitor.config.json', content: CAPACITOR_CONFIG_JSON },
        { path: 'GERAR-ANDROID-APK.bat', content: BUILD_ANDROID_BAT },
        { path: 'GERAR-ANDROID-APK.sh', content: BUILD_ANDROID_SH },
        { path: 'electron/main.cjs', content: ELECTRON_MAIN_CJS },
        { path: 'electron/preload.cjs', content: ELECTRON_PRELOAD_CJS },
        { path: 'electron-builder.json', content: ELECTRON_BUILDER_JSON },
        { path: 'GERAR-PORTABLE-EXE.bat', content: BUILD_BAT },
        { path: 'GERAR-MACOS-DMG.command', content: BUILD_MAC_COMMAND },
        { path: 'LEIA-ME-PLATFORMS.txt', content: readme },
      ];

      try {
        const [icoRes, pngRes] = await Promise.all([
          fetch('/icon.ico'),
          fetch('/pwa-512x512.png'),
        ]);
        if (icoRes.ok) {
          entries.push({ path: 'public/icon.ico', content: new Uint8Array(await icoRes.arrayBuffer()) });
        }
        if (pngRes.ok) {
          entries.push({ path: 'public/pwa-512x512.png', content: new Uint8Array(await pngRes.arrayBuffer()) });
        }
      } catch {
        // Optional icon assets
      }

      if (!active) return;
      const blob = createZipBlob(entries);
      createdUrl = URL.createObjectURL(blob);
      setZipUrl(createdUrl);
    };

    void prepareZip();
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      setZipUrl(null);
    };
  }, [open]);

  if (!open) return null;

  const isDesktopEnv = Boolean(window.desktopStudio?.isDesktop);
  const isPortableEnv = Boolean(window.desktopStudio?.isPortable);

  const buildCommand =
    targetOs === 'android'
      ? 'npm install && npm install @capacitor/core @capacitor/android && npm install -D @capacitor/cli && npm run build && npx cap add android && npx cap sync android'
      : targetOs === 'macos'
      ? 'npm install && npm install -D electron@31.7.7 electron-builder && npm run desktop:build:mac'
      : 'npm install && npm install -D electron electron-builder && npm run desktop:build:portable';

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(buildCommand);
      setCopiedCmd(true);
      window.setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      setStatusMessage('Copie manualmente: ' + buildCommand);
    }
  };

  const handleCopyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setStatusMessage('Link direto: ' + shareLink);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-[#13161D] border border-white/12 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3 bg-[#0F1218]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/35 flex items-center justify-center shrink-0">
              {targetOs === 'android' ? (
                <Smartphone className="w-4 h-4 text-emerald-400" />
              ) : (
                <Monitor className="w-4 h-4 text-amber-400" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate">
                Versões Instaláveis — Android (.apk), Windows (.exe) & macOS (.dmg)
              </h2>
              <p className="text-[11px] text-slate-400 truncate">
                Instale offline direto no Android ou baixe o kit para gerar APK, EXE e DMG
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Platform Switcher */}
        <div className="px-4 pt-2 flex items-center gap-1 sm:gap-2 border-b border-white/8 bg-[#10131A] overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => {
              setTargetOs('android');
              setStatusMessage(null);
            }}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              targetOs === 'android'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            Android (.apk / App Offline)
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetOs('windows');
              setStatusMessage(null);
            }}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              targetOs === 'windows'
                ? 'border-amber-500 text-amber-300'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
            Windows Portable (.exe)
          </button>
          <button
            type="button"
            onClick={() => {
              setTargetOs('macos');
              setStatusMessage(null);
            }}
            className={`px-3 py-2 text-xs font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              targetOs === 'macos'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            macOS 10.15.8 (.dmg)
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 overflow-y-auto">
          {isDesktopEnv && (
            <div className="rounded-xl bg-emerald-500/15 border border-emerald-500/35 p-3 flex items-center gap-2.5 text-xs text-emerald-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold">Modo Desktop Ativo!</span>{' '}
                {isPortableEnv
                  ? 'Executando como Portable (.exe) com dados salvos localmente na pasta SuperAnimatorData.'
                  : 'Executando na janela nativa Desktop Electron.'}
              </div>
            </div>
          )}

          {/* Direct Links & Instant Install Bar */}
          <div className="rounded-xl bg-[#0F1218] border border-cyan-500/30 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                <Link2 className="w-3.5 h-3.5" />
                {targetOs === 'android'
                  ? 'Instalação Offline & Kit Android (.APK)'
                  : targetOs === 'macos'
                  ? 'Links Diretos para macOS 10.15.8 Catalina (x64)'
                  : 'Links Diretos para Windows Portable (.exe)'}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                className="h-6 px-2 rounded bg-white/5 hover:bg-white/10 text-[10px] font-semibold text-slate-300 inline-flex items-center gap-1 cursor-pointer shrink-0"
                title="Copiar link direto para abrir esta aba"
              >
                {copiedLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedLink ? 'Link copiado' : 'Copiar link'}
              </button>
            </div>

            {targetOs === 'android' ? (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {isInstallable && !isInstalled ? (
                    <button
                      type="button"
                      onClick={() => void install()}
                      className="rounded-lg bg-emerald-500 hover:bg-emerald-400 border border-emerald-400 text-slate-950 px-3 py-2.5 flex items-center gap-2.5 transition-colors cursor-pointer text-left"
                    >
                      <Smartphone className="w-4 h-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold truncate">Instalar no Android Agora</div>
                        <div className="text-[10px] opacity-80 truncate">
                          App offline na tela inicial (1 clique)
                        </div>
                      </div>
                    </button>
                  ) : (
                    <a
                      href={shareLink || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/40 px-3 py-2.5 flex items-center gap-2.5 transition-colors"
                    >
                      <Smartphone className="w-4 h-4 text-emerald-300 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          Abrir Link de Instalação Android
                        </div>
                        <div className="text-[10px] text-emerald-200/80 truncate">
                          No Chrome Android: menu ⋮ → Instalar app
                        </div>
                      </div>
                    </a>
                  )}

                  <a
                    href={zipUrl || '#'}
                    download="Super-Animator-Studio-Android-Desktop-Kit.zip"
                    onClick={(e) => {
                      if (!zipUrl) {
                        e.preventDefault();
                        return;
                      }
                      setStatusMessage('Kit Android APK (.zip) baixado com Capacitor + scripts automáticos!');
                    }}
                    className={`rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors border ${
                      zipUrl
                        ? 'bg-amber-500 hover:bg-amber-400 border-amber-400 text-slate-950'
                        : 'bg-amber-500/30 border-amber-500/30 text-slate-300 pointer-events-none'
                    }`}
                  >
                    <Package className="w-4 h-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">Baixar Kit Gerador .APK (.zip)</div>
                      <div className="text-[10px] opacity-80 truncate">
                        Capacitor + GERAR-ANDROID-APK (.bat/.sh)
                      </div>
                    </div>
                  </a>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {targetOs === 'macos' ? (
                  <a
                    href={macCommandDownloadUrl || '#'}
                    download="Super-Animator-Studio-macOS-Desktop.command"
                    onClick={() =>
                      setStatusMessage(
                        'Launcher macOS (.command) baixado! No Terminal rode: chmod +x ~/Downloads/Super-Animator-Studio-macOS-Desktop.command e dê duplo clique.'
                      )
                    }
                    className="rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 px-3 py-2.5 flex items-center gap-2.5 transition-colors"
                  >
                    <Download className="w-4 h-4 text-cyan-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        Baixar App Launcher macOS (.command)
                      </div>
                      <div className="text-[10px] text-cyan-200/80 truncate">
                        Abre janela separada no macOS 10.15.8
                      </div>
                    </div>
                  </a>
                ) : (
                  <a
                    href={batDownloadUrl || '#'}
                    download="Super-Animator-Studio-Desktop-Portable.bat"
                    onClick={() =>
                      setStatusMessage(
                        'Launcher Windows (.bat) baixado! Dê duplo clique no Windows para abrir em janela Desktop isolada.'
                      )
                    }
                    className="rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/40 px-3 py-2.5 flex items-center gap-2.5 transition-colors"
                  >
                    <Download className="w-4 h-4 text-cyan-300 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        Baixar Launcher Desktop (.bat)
                      </div>
                      <div className="text-[10px] text-cyan-200/80 truncate">
                        Roda direto no Windows 10/11 sem compilar
                      </div>
                    </div>
                  </a>
                )}

                <a
                  href={zipUrl || '#'}
                  download="Super-Animator-Studio-Desktop-Kit.zip"
                  onClick={(e) => {
                    if (!zipUrl) {
                      e.preventDefault();
                      return;
                    }
                    setStatusMessage(
                      targetOs === 'macos'
                        ? 'Kit Instalável macOS 10.15.8 (.dmg) baixado!'
                        : 'Kit Gerador Portable (.zip) baixado com sucesso!'
                    );
                  }}
                  className={`rounded-lg px-3 py-2.5 flex items-center gap-2.5 transition-colors border ${
                    zipUrl
                      ? 'bg-amber-500 hover:bg-amber-400 border-amber-400 text-slate-950'
                      : 'bg-amber-500/30 border-amber-500/30 text-slate-300 pointer-events-none'
                  }`}
                >
                  <Package className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      {targetOs === 'macos'
                        ? 'Baixar Kit Instalador .DMG (.zip)'
                        : 'Baixar Kit Portable .EXE (.zip)'}
                    </div>
                    <div className="text-[10px] opacity-80 truncate">
                      {targetOs === 'macos'
                        ? 'Electron 31.7.7 (10.15.8) + GERAR-MACOS-DMG.command'
                        : 'Electron + icon.ico + GERAR-PORTABLE-EXE.bat'}
                    </div>
                  </div>
                </a>
              </div>
            )}

            {targetOs !== 'android' && isInstallable && !isInstalled && (
              <button
                type="button"
                onClick={() => void install()}
                className="w-full h-8 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Instalar Aplicativo Agora (Chrome / Edge)
              </button>
            )}
          </div>

          {/* Platform Specific Details */}
          <div className="rounded-xl bg-[#0B0D11] border border-amber-500/25 p-3.5 space-y-2.5">
            {targetOs === 'android' ? (
              <>
                <div className="flex items-start gap-2">
                  <Smartphone className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    <strong className="text-white">Como instalar no celular Android em 10 segundos (100% Offline):</strong>{' '}
                    abra o link no <strong>Google Chrome do Android</strong> e toque em <strong>&ldquo;Instalar aplicativo&rdquo;</strong> (ou menu <strong>⋮ → Adicionar à tela inicial</strong>). Ele vira um app com ícone próprio na gaveta de apps, tela cheia sem barra do navegador e salvamento local offline. Para gerar um arquivo <code>.apk</code> tradicional via Capacitor, use o <code>GERAR-ANDROID-APK.bat</code> / <code>.sh</code>.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">App PWA + Armazenamento Offline</div>
                      <div className="text-slate-400">IndexedDB local + Service Worker para usar sem internet</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">APK Nativo via Capacitor</div>
                      <div className="text-slate-400">Saída: <code>release/Super-Animator-Studio-Android.apk</code></div>
                    </div>
                  </div>
                </div>
              </>
            ) : targetOs === 'macos' ? (
              <>
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    <strong className="text-white">Compatibilidade garantida com macOS Catalina 10.15.8 (Intel x64):</strong>{' '}
                    o instalador usa <code className="text-cyan-300">Electron 31.7.7</code> (última versão oficial compatível com macOS 10.15) e <code className="text-cyan-300">LSMinimumSystemVersion: 10.15.0</code>. Gere o <code>.dmg</code> diretamente no Mac com 1 comando ou via <code className="text-amber-300">GERAR-MACOS-DMG.command</code>.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">Instalador .DMG + Pasta Aplicativos</div>
                      <div className="text-slate-400">Arraste o app para <code>/Applications</code> no Finder</div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">Sem Assinatura Pago (Gatekeeper)</div>
                      <div className="text-slate-400">Se pedir permissão no 1º abrir: clique direito → Abrir</div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-slate-300 leading-relaxed">
                    <strong className="text-white">Sobre o binário <code>Super-Animator-Studio-Portable.exe</code> (~95 MB):</strong>{' '}
                    este servidor de nuvem roda em Linux sem compilador Windows/Wine para gerar o arquivo <code>.exe</code> compilado diretamente aqui. Para obter o <code>.exe</code> final offline no seu PC Windows, use o <strong>Launcher (.bat)</strong> acima para testar na hora, ou baixe o projeto e dê duplo clique em <code className="text-amber-300">GERAR-PORTABLE-EXE.bat</code>.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">100% Portable (Sem Instalação)</div>
                      <div className="text-slate-400">Salva projetos na pasta <code>SuperAnimatorData</code></div>
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 flex items-start gap-2">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">Geração em 1 Clique</div>
                      <div className="text-slate-400">Saída: <code>release\Super-Animator-Studio-Portable.exe</code></div>
                    </div>
                  </div>
                </div>
              </>
            )}

            <div className="rounded-lg bg-[#13161D] border border-white/8 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-slate-400">
                <span>
                  {targetOs === 'android'
                    ? 'Comando para gerar o projeto Android (.apk via Capacitor):'
                    : targetOs === 'macos'
                    ? 'Comando no Terminal do macOS 10.15.8 para gerar o .dmg:'
                    : 'Comando no Windows para compilar o .exe portable:'}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyCommand()}
                  className="inline-flex items-center gap-1 text-amber-300 hover:text-amber-200 cursor-pointer font-semibold"
                >
                  {copiedCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedCmd ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="text-[10px] font-mono text-emerald-300 overflow-x-auto no-scrollbar select-all">
                {buildCommand}
              </pre>
            </div>
          </div>

          {statusMessage && (
            <div className="rounded-lg bg-emerald-500/15 border border-emerald-500/35 px-3 py-2 text-[11px] text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
