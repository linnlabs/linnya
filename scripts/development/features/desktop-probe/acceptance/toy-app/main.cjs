const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 800, height: 600 });
  await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  if (BrowserWindow.getAllWindows()[0] !== window) {
    throw new Error('探针引导破坏了 BrowserWindow 身份');
  }
});
app.on('window-all-closed', () => app.quit());
