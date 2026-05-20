/* electron/main.js — NumDraw Electron 진입점
   - app:// 커스텀 프로토콜: secure context로 등록 → File System Access API 정상 동작
   - nodeIntegration: false, contextIsolation: true — 보안 기본값 유지
   - 창 크기/위치 자동 저장·복원
*/
'use strict';

const { app, BrowserWindow, protocol, net, screen } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');  // 프로젝트 루트 (electron/ 한 단계 위)

/* ── app:// 커스텀 프로토콜 — app.ready 전에 등록 필수 ── */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, corsEnabled: true, stream: true } }
]);

/* ── 창 상태 저장/복원 ── */
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized()) return;
  const b = win.getBounds();
  fs.writeFileSync(STATE_FILE, JSON.stringify(b), 'utf8');
}

/* ── BrowserWindow 생성 ── */
function createWindow() {
  const saved  = loadWindowState();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  const opts = {
    width:     saved?.width  || Math.min(1440, sw - 80),
    height:    saved?.height || Math.min(900,  sh - 80),
    x:         saved?.x,
    y:         saved?.y,
    minWidth:  960,
    minHeight: 600,
    title:     'NumDraw — 시설물 안전점검 넘버링 툴',
    show:      false,  // ready-to-show 후 표시 (흰 화면 방지)
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
    },
  };

  const win = new BrowserWindow(opts);
  win.setMenuBarVisibility(false);   // 메뉴바 숨김

  /* app:// → 로컬 파일 매핑 */
  protocol.handle('app', (req) => {
    const url      = new URL(req.url);
    const filePath = path.join(ROOT, url.pathname);
    return net.fetch('file://' + filePath.replace(/\\/g, '/'));
  });

  win.loadURL('app://localhost/index.html');

  /* 준비 후 표시 — 흰 화면 없이 바로 보임 */
  win.once('ready-to-show', () => win.show());

  /* 창 크기/위치 저장 */
  ['resize', 'move'].forEach(ev => win.on(ev, () => saveWindowState(win)));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
