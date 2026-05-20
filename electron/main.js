/* electron/main.js — NumDraw Electron 진입점
   - app:// 커스텀 프로토콜: secure context → File System Access API 정상 동작
   - .numdraw 파일 연결 자동 등록 (HKCU, 관리자 권한 불필요)
   - 단일 인스턴스: 이미 실행 중이면 기존 창에 파일 전달
   - 창 크기/위치 자동 저장·복원
*/
'use strict';

const { app, BrowserWindow, protocol, net, screen, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');

/* ── 시작 인자에서 .numdraw 파일 경로 추출 ── */
let openFilePath = process.argv.find(a => /\.numdraw$/i.test(a)) || null;

/* ── 단일 인스턴스 잠금 ──
   이미 앱이 실행 중이면 기존 창에 파일 내용 전달 후 종료 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const fp = argv.find(a => /\.numdraw$/i.test(a));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (fp) {
        try {
          const content = fs.readFileSync(fp, 'utf8');
          mainWindow.webContents.send('open-numdraw-file', content);
        } catch {}
      }
    }
  });
}

/* ── app:// 커스텀 프로토콜 — app.ready 전에 등록 필수 ── */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, corsEnabled: true, stream: true } }
]);

/* ── .numdraw 파일 연결 Windows 레지스트리 자동 등록 ──
   HKCU 영역이므로 관리자 권한 불필요.
   실행할 때마다 재등록 → 포터블 exe를 다른 경로로 옮겨도 자동 갱신. */
function registerFileAssociation() {
  if (process.platform !== 'win32') return;
  const { spawnSync } = require('child_process');
  const exe     = process.execPath;
  const openCmd = `"${exe}" "%1"`;
  const entries = [
    ['HKCU\\Software\\Classes\\.numdraw',                              'NumDrawProject'],
    ['HKCU\\Software\\Classes\\NumDrawProject',                        'NumDraw 프로젝트 파일'],
    ['HKCU\\Software\\Classes\\NumDrawProject\\shell\\open\\command',  openCmd],
  ];
  for (const [key, value] of entries) {
    spawnSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'],
      { windowsHide: true });
  }
}

/* ── 창 상태 저장/복원 ── */
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}
function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized()) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify(win.getBounds()), 'utf8');
}

/* ── IPC: 스타트업 파일 내용 제공 ── */
ipcMain.handle('get-startup-file', () => {
  if (!openFilePath) return null;
  try { return fs.readFileSync(openFilePath, 'utf8'); } catch { return null; }
});

/* ── BrowserWindow 생성 ── */
let mainWindow = null;

function createWindow() {
  const saved = loadWindowState();
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width:     saved?.width  || Math.min(1440, sw - 80),
    height:    saved?.height || Math.min(900,  sh - 80),
    x:         saved?.x,
    y:         saved?.y,
    minWidth:  960,
    minHeight: 600,
    title:     'NumDraw — 시설물 안전점검 넘버링 툴',
    show:      false,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload:          path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setMenuBarVisibility(false);

  protocol.handle('app', (req) => {
    const url      = new URL(req.url);
    const filePath = path.join(ROOT, url.pathname);
    return net.fetch('file://' + filePath.replace(/\\/g, '/'));
  });

  mainWindow.loadURL('app://localhost/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  ['resize', 'move'].forEach(ev => mainWindow.on(ev, () => saveWindowState(mainWindow)));
}

app.whenReady().then(() => {
  registerFileAssociation();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
