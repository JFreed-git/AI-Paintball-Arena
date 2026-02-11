const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Agent Hub',
    webPreferences: {
      preload: path.join(__dirname, 'electron-hub-preload.js'),
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, 'hub.html'));

  win.webContents.on('before-input-event', (event, input) => {
    if (input.meta || input.control) {
      if (input.key === 'r' && !input.shift) { win.reload(); event.preventDefault(); }
      if (input.key === 'I' && input.shift) { win.webContents.toggleDevTools(); event.preventDefault(); }
    }
  });
});

app.on('window-all-closed', () => app.quit());
