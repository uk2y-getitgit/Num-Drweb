/* 홍보자료용 화면 촬영기.
   SHOT_JS 가 문자열 dataURL 을 반환하면 그 이미지를 저장하고,
   아니면 창 전체를 캡처한다. SHOT_ZOOM 으로 배율을 올려 선명하게 찍는다. */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');

app.disableHardwareAcceleration();

/* 어떤 이유로든 멈추면 강제 종료한다 — 배치 촬영이 통째로 막히지 않게 */
setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, parseInt(process.env.SHOT_LIMIT || '90000', 10));

app.whenReady().then(async () => {
  const W = parseInt(process.env.SHOT_W || '1600', 10);
  const H = parseInt(process.env.SHOT_H || '1000', 10);
  const win = new BrowserWindow({
    width: W, height: H, show: false, frame: false, useContentSize: true,
    webPreferences: { offscreen: process.env.SHOT_OFF === '1', backgroundThrottling: false, webSecurity: false }
  });
  try {
    await win.loadFile(process.env.SHOT_TARGET);
    const zf = parseFloat(process.env.SHOT_ZF || '1');
    if (zf !== 1) win.webContents.setZoomFactor(zf);
    await new Promise(r => setTimeout(r, parseInt(process.env.SHOT_WAIT || '2500', 10)));

    let out = null;
    if (process.env.SHOT_JS) {
      out = await win.webContents.executeJavaScript(process.env.SHOT_JS, true);
      await new Promise(r => setTimeout(r, parseInt(process.env.SHOT_AFTER || '900', 10)));
    }

    if (typeof out === 'string' && out.startsWith('data:image')) {
      const b64 = out.slice(out.indexOf(',') + 1);
      fs.writeFileSync(process.env.SHOT_OUT, Buffer.from(b64, 'base64'));
      console.log('saved-dataurl');
    } else if (typeof out === 'string' && out.startsWith('PROBE:')) {
      console.log(out);
    } else {
      const img = await win.capturePage();
      fs.writeFileSync(process.env.SHOT_OUT, img.toPNG());
      console.log('saved-capture ' + img.getSize().width + 'x' + img.getSize().height);
    }
  } catch (e) {
    console.log('ERR ' + e.message);
  }
  app.exit(0);
});
