const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1600, height: 1000, show: false });
  try {
    await win.loadFile(process.env.SHOT_TARGET);
    await new Promise(r => setTimeout(r, 3000));
    if (process.env.SHOT_JS) {
      await win.webContents.executeJavaScript(process.env.SHOT_JS);
      await new Promise(r => setTimeout(r, 700));
    }
    fs.writeFileSync(process.env.SHOT_OUT, (await win.capturePage()).toPNG());
    console.log('saved');
  } catch (e) { console.log('ERR', e.message); }
  app.quit();
});
