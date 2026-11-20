const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// Portable persistence: when running as Windows Portable .exe, store projects and media
// right next to the executable in ./SuperAnimatorData
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  const portableDataDir = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'SuperAnimatorData');
  try {
    fs.mkdirSync(portableDataDir, { recursive: true });
    app.setPath('userData', portableDataDir);
  } catch {
    // Fallback to default userData if folder is read-only
  }
}

app.setName('Super Animator Studio');

// Register privileged custom scheme so IndexedDB, Canvas, WebAudio and MediaRecorder
// share a consistent secure origin across Desktop restarts
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
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

function getDistDir() {
  return path.resolve(__dirname, '..', 'dist');
}

function registerAppProtocol() {
  const distDir = getDistDir();
  protocol.handle('app', (request) => {
    const reqUrl = new URL(request.url);
    let relPath = decodeURIComponent(reqUrl.pathname || '/');
    if (relPath === '/' || relPath === '') {
      relPath = '/index.html';
    }

    const safeRel = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
    let targetPath = path.join(distDir, safeRel);

    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
      targetPath = path.join(distDir, 'index.html');
    }

    return net.fetch(pathToFileURL(targetPath).toString());
  });
}

function buildDesktopMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { label: 'Sobre o Super Animator Studio', role: 'about' },
              { type: 'separator' },
              { label: 'Ocultar', role: 'hide' },
              { label: 'Ocultar Outros', role: 'hideOthers' },
              { label: 'Mostrar Tudo', role: 'unhide' },
              { type: 'separator' },
              { label: 'Sair', accelerator: 'Cmd+Q', role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Arquivo',
      submenu: [
        {
          label: 'Recarregar Estúdio',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow && mainWindow.reload(),
        },
        { type: 'separator' },
        {
          label: 'Abrir Pasta de Dados Locais',
          click: () => {
            const dataDir = app.getPath('userData');
            shell.openPath(dataDir);
          },
        },
        ...(isMac
          ? []
          : [
              { type: 'separator' },
              {
                label: 'Sair',
                accelerator: 'Alt+F4',
                role: 'quit',
              },
            ]),
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', role: 'undo' },
        { label: 'Refazer', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Colar', role: 'paste' },
        { label: 'Selecionar Tudo', role: 'selectAll' },
      ],
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Tela Cheia', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Zoom +', role: 'zoomIn' },
        { label: 'Zoom -', role: 'zoomOut' },
        { label: 'Zoom Padrão', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Ferramentas de Desenvolvedor', accelerator: isMac ? 'Alt+Cmd+I' : 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Fechar', role: 'close' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const iconWin = path.resolve(__dirname, '..', 'public', 'icon.ico');
  const iconPng = path.resolve(__dirname, '..', 'public', 'pwa-512x512.png');
  const resolvedIcon = isMac
    ? (fs.existsSync(iconPng) ? iconPng : undefined)
    : (fs.existsSync(iconWin) ? iconWin : undefined);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1024,
    minHeight: 640,
    title: 'Super Animator Studio — Desktop',
    backgroundColor: '#0B0D11',
    autoHideMenuBar: !isMac,
    icon: resolvedIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadURL('app://studio/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerAppProtocol();
  buildDesktopMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
