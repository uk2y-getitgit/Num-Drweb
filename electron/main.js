/* electron/main.js — Quickspect Electron 진입점
   - app:// 커스텀 프로토콜: secure context → File System Access API 정상 동작
   - .qspec 파일 연결 자동 등록 (HKCU, 관리자 권한 불필요). .numdraw 는 구 확장자로 계속 받는다
   - 단일 인스턴스: 이미 실행 중이면 기존 창에 파일 전달
   - 창 크기/위치 자동 저장·복원
*/
'use strict';

const { app, BrowserWindow, protocol, net, screen, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

const ROOT = path.join(__dirname, '..');

/* ── 시작 인자에서 프로젝트 파일 경로 추출 (.qspec 신규 · .numdraw 구 확장자) ── */
let openFilePath = process.argv.find(a => /\.(qspec|numdraw)$/i.test(a)) || null;

/* ── 단일 인스턴스 잠금 ──
   이미 앱이 실행 중이면 기존 창에 파일 내용 전달 후 종료 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const fp = argv.find(a => /\.(qspec|numdraw)$/i.test(a));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (fp) {
        try {
          const content = fs.readFileSync(fp, 'utf8');
          mainWindow.webContents.send('open-project-file', content);
        } catch {}
      }
    }
  });
}

/* ── app:// 커스텀 프로토콜 — app.ready 전에 등록 필수 ── */
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, corsEnabled: true, stream: true } }
]);

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

/* ── 라이선스 ──
   메인 프로세스에서만 검증하고 preload 브리지로 결과만 렌더러에 내려준다.
   모듈 로드가 실패해도 앱은 켜져야 하므로 체험판 상태로 폴백한다. */
let License = null;
try {
  License = require('./license');
} catch (e) {
  console.error('[license] 모듈 로드 실패 — 체험판으로 동작합니다:', e.message);
}

const TRIAL_FALLBACK = {
  edition: 'trial',
  features: { watermark: true, maxPages: 1 },
  reason: 'MODULE_ERROR',
  device: '', deviceShort: '', pubkeyReady: false, endpointReady: false, supportContact: '',
};

ipcMain.handle('license:status', () => {
  try { return License ? License.getStatus() : TRIAL_FALLBACK; }
  catch (e) { console.error('[license] 상태 판정 실패:', e.message); return TRIAL_FALLBACK; }
});

ipcMain.handle('license:activate', async (_e, key) => {
  if (!License) return { ok: false, code: 'MODULE_ERROR', message: '라이선스 모듈을 불러올 수 없습니다.', status: TRIAL_FALLBACK };
  try {
    return await License.activateWithKey(String(key || ''), app.getVersion());
  } catch (e) {
    console.error('[license] 활성화 실패:', e.message);
    return { ok: false, code: 'SERVER_ERROR', message: '활성화 중 오류가 발생했습니다.', status: License.getStatus() };
  }
});

ipcMain.handle('license:deactivate', () => {
  if (!License) return TRIAL_FALLBACK;
  try { return License.deactivateLocal(); }
  catch { return TRIAL_FALLBACK; }
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
    title:     'Quickspect — 시설물 안전점검 조사보고서 작성',
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
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
