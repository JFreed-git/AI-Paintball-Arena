const { app, BrowserWindow, globalShortcut, session } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  // Clear cached JS so source file edits always take effect on reload
  session.defaultSession.clearCache();

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      sandbox: false
    }
  });

  win.loadFile('dev.html');

  // Cmd+R / Ctrl+R to reload, Cmd+Shift+I / Ctrl+Shift+I for DevTools
  win.webContents.on('before-input-event', (event, input) => {
    if (input.meta || input.control) {
      if (input.key === 'r' && !input.shift) { win.reload(); event.preventDefault(); }
      if (input.key === 'I' && input.shift) { win.webContents.toggleDevTools(); event.preventDefault(); }
    }
  });
});

app.on('window-all-closed', () => app.quit());
