/* electron/preload.js — 렌더러(app.js)에 안전하게 Electron API 노출 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* 앱 시작 시 더블클릭으로 열린 .numdraw 파일 내용 요청 */
  getStartupFile: () => ipcRenderer.invoke('get-startup-file'),

  /* 앱 실행 중 다른 .numdraw 파일 열기 요청 수신 (이미 앱이 켜진 상태) */
  onOpenFile: (callback) => {
    ipcRenderer.on('open-numdraw-file', (_, content) => callback(content));
  },
});
