const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('desktopStudio', {
  isDesktop: true,
  isPortable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
  platform: process.platform,
  portableDir: process.env.PORTABLE_EXECUTABLE_DIR || null,
});
