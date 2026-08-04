/* appMode.js — 앱 전역 작업 모드 (외관조사망도 / 장비시험망도) */
'use strict';

const AppMode = (() => {
  /* exterior: 외관조사망도(현재 구조) / equip: 장비시험망도(신규 구조, 개발 예정) */
  const MODES = { EXTERIOR: 'exterior', EQUIP: 'equip' };

  let _mode     = MODES.EXTERIOR;
  let _onChange = null;

  function init(onChangeCb) { _onChange = onChangeCb; }

  function get() { return _mode; }

  /* opts.silent: onChange 콜백 억제 (복원 시 사용)
     opts.force : 동일 모드라도 콜백 강제 실행 (초기 UI 동기화용) */
  function set(mode, opts = {}) {
    if (mode !== MODES.EXTERIOR && mode !== MODES.EQUIP) return;
    if (mode === _mode && !opts.force) return;
    _mode = mode;
    if (_onChange && !opts.silent) _onChange(_mode, opts);
  }

  return { MODES, init, get, set };
})();
