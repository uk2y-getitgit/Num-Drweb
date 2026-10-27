/* electron/preload.js — 렌더러(app.js)에 안전하게 Electron API 노출 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /* 앱 시작 시 더블클릭으로 열린 프로젝트 파일(.qspec·.numdraw) 내용 요청 */
  getStartupFile: () => ipcRenderer.invoke('get-startup-file'),

  /* 앱 실행 중 다른 프로젝트 파일 열기 요청 수신 (이미 앱이 켜진 상태) */
  onOpenFile: (callback) => {
    ipcRenderer.on('open-project-file', (_, content) => callback(content));
  },

  /* 종료 시 저장 확인 — 렌더러가 파일 미저장 여부를 알려주고, "예"를 고르면 저장 후 닫기 요청 */
  setDirty:          (v)        => ipcRenderer.send('app:set-dirty', !!v),
  onSaveBeforeClose: (callback) => ipcRenderer.on('app:save-before-close', () => callback()),
  closeNow:          ()         => ipcRenderer.send('app:close-now'),

  /* 라이선스 — 검증은 전부 메인 프로세스에서 수행하고 결과만 받는다 */
  license: {
    getStatus:  ()    => ipcRenderer.invoke('license:status'),
    activate:   (key) => ipcRenderer.invoke('license:activate', key),
    deactivate: ()    => ipcRenderer.invoke('license:deactivate'),
  },
});
