/* license.js — 정품 인증 UI (렌더러)
   검증 로직은 전부 메인 프로세스에 있다. 이 모듈은 상태를 받아 화면에 반영하고
   키 입력을 전달하는 역할만 한다.
   Electron 이 아닌 환경(브라우저로 index.html 을 직접 열었을 때)은 체험판으로 동작한다. */
'use strict';

const LicenseUI = (() => {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const PREFIX   = 'ND2';
  const KEY_LEN  = 20;

  /* 안전 기본값 — 상태를 못 받아오면 항상 제한이 걸린 쪽으로 */
  let _status = { edition: 'trial', features: { watermark: true, maxPages: 1 }, reason: 'INIT' };
  let _onChange = null;

  /* ── 초기화 ── */
  async function init(onChange) {
    _onChange = onChange || null;
    await refresh();
    _bindModal();
    _bindBadge();
    return _status;
  }

  async function refresh() {
    const api = window.electronAPI && window.electronAPI.license;
    if (api) {
      try {
        const s = await api.getStatus();
        if (s && s.features) _status = s;
      } catch (e) {
        console.warn('라이선스 상태 조회 실패 — 체험판으로 동작합니다', e);
      }
    }
    _renderBadge();
    if (_onChange) _onChange(_status);
    return _status;
  }

  /* ── 상태 접근자 (다른 모듈은 이 값만 본다) ── */
  function getStatus()   { return _status; }
  function getFeatures() { return _status.features || { watermark: true, maxPages: 1 }; }
  function isTrial()     { return _status.edition !== 'full'; }
  function hasWatermark(){ return getFeatures().watermark !== false; }
  function getMaxPages() { const n = getFeatures().maxPages; return Number.isInteger(n) ? n : 1; }

  /* ── 툴바 배지 ── */
  function _renderBadge() {
    const btn = document.getElementById('btn-license');
    if (!btn) return;
    const label = btn.querySelector('.license-badge-text');
    if (isTrial()) {
      btn.classList.add('trial');
      btn.classList.remove('full');
      btn.title = '체험판 — 클릭하여 정품 인증';
      if (label) label.textContent = '체험판 · 정품 인증';
    } else {
      btn.classList.add('full');
      btn.classList.remove('trial');
      btn.title = '정품 인증됨';
      if (label) label.textContent = '정품';
    }
  }

  function _bindBadge() {
    const btn = document.getElementById('btn-license');
    if (btn) btn.addEventListener('click', () => open());
  }

  /* ── 모달 ── */
  function open(noticeText) {
    const modal = document.getElementById('modal-license');
    if (!modal) return;
    modal.classList.remove('hidden');
    _renderModal(noticeText);
    const input = document.getElementById('license-key-input');
    if (input && isTrial()) setTimeout(() => input.focus(), 30);
  }

  function close() {
    const modal = document.getElementById('modal-license');
    if (modal) modal.classList.add('hidden');
  }

  /* 체험판 제한에 걸렸을 때 안내와 함께 모달을 띄운다 */
  function promptUpgrade(reason) {
    open(reason);
  }

  function _renderModal(noticeText) {
    const stateEl  = document.getElementById('license-state');
    const noticeEl = document.getElementById('license-notice');
    const formEl   = document.getElementById('license-form');
    const resultEl = document.getElementById('license-result');
    const devEl    = document.getElementById('license-device');
    const okBtn    = document.getElementById('modal-license-apply');

    if (resultEl) { resultEl.textContent = ''; resultEl.className = 'license-result'; }

    if (stateEl) {
      if (isTrial()) {
        stateEl.className = 'license-state trial';
        stateEl.innerHTML =
          '<strong>체험판</strong>' +
          '<span>도면 작업은 몇 장이든 자유롭게 하실 수 있습니다. ' +
          'PDF 저장 시 워터마크가 찍히고 ' + getMaxPages() + '장까지만 저장됩니다.</span>';
      } else {
        const km = _status.keyMasked ? ' · ' + _status.keyMasked : '';
        stateEl.className = 'license-state full';
        stateEl.innerHTML = '<strong>정품 인증됨</strong><span>모든 기능을 사용할 수 있습니다' + km + '</span>';
      }
    }

    if (noticeEl) {
      noticeEl.textContent = noticeText || '';
      noticeEl.classList.toggle('hidden', !noticeText);
    }

    if (formEl) formEl.classList.toggle('hidden', !isTrial());
    if (okBtn)  okBtn.classList.toggle('hidden', !isTrial());

    if (devEl) devEl.textContent = _status.deviceShort || '—';

    /* 운영자 설정 누락 안내 — 사용자가 아니라 배포 담당이 봐야 할 문제 */
    const warnEl = document.getElementById('license-setup-warn');
    if (warnEl) {
      const missing = [];
      if (_status.pubkeyReady === false)   missing.push('공개키');
      if (_status.endpointReady === false) missing.push('서버 주소');
      warnEl.textContent = missing.length ? '설정 필요: ' + missing.join(' · ') : '';
      warnEl.classList.toggle('hidden', !missing.length);
    }
  }

  /* 입력값을 ND2-XXXXX-XXXXX-XXXXX-XXXXX 형태로 정리 */
  function _formatInput(raw) {
    let s = (raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
    if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
    s = s.split('').filter(c => ALPHABET.indexOf(c) !== -1).join('').slice(0, KEY_LEN);
    const groups = s.match(/.{1,5}/g) || [];
    return { display: [PREFIX].concat(groups).join('-'), body: s };
  }

  function _bindModal() {
    const modal = document.getElementById('modal-license');
    if (!modal) return;

    const input   = document.getElementById('license-key-input');
    const applyBt = document.getElementById('modal-license-apply');

    ['modal-license-close', 'modal-license-cancel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', close);
    });

    modal.addEventListener('mousedown', e => { if (e.target === modal) close(); });

    if (input) {
      input.addEventListener('input', () => {
        const { display } = _formatInput(input.value);
        input.value = display;
      });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') _submit(); });
    }

    if (applyBt) applyBt.addEventListener('click', _submit);
  }

  async function _submit() {
    const input   = document.getElementById('license-key-input');
    const resEl   = document.getElementById('license-result');
    const applyBt = document.getElementById('modal-license-apply');
    if (!input) return;

    const { body, display } = _formatInput(input.value);

    if (body.length !== KEY_LEN) {
      _showResult(resEl, 'ND2- 로 시작하는 25자리 키를 모두 입력해 주세요.', 'fail');
      return;
    }

    const api = window.electronAPI && window.electronAPI.license;
    if (!api) {
      _showResult(resEl, '정품 인증은 설치판(NumDraw 앱)에서만 가능합니다.', 'fail');
      return;
    }

    if (applyBt) { applyBt.disabled = true; }
    _showResult(resEl, '인증 중...', 'info');

    try {
      const r = await api.activate(display);
      if (r && r.ok) {
        if (r.status && r.status.features) _status = r.status;
        _renderBadge();
        if (_onChange) _onChange(_status);
        const seat = (r.seatsUsed && r.maxSeats) ? ' (' + r.seatsUsed + '/' + r.maxSeats + '대 사용 중)' : '';
        _renderModal();                       // 정품 상태로 다시 그린 뒤 결과 표시 (순서 주의)
        _showResult(resEl, '정품 인증이 완료되었습니다' + seat, 'ok');
      } else {
        _showResult(resEl, (r && r.message) || '인증에 실패했습니다.', 'fail');
      }
    } catch (e) {
      _showResult(resEl, '인증 중 오류가 발생했습니다: ' + e.message, 'fail');
    } finally {
      if (applyBt) applyBt.disabled = false;
    }
  }

  function _showResult(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className   = 'license-result ' + (kind || '');
  }

  return {
    init, refresh, open, close, promptUpgrade,
    getStatus, getFeatures, isTrial, hasWatermark, getMaxPages,
  };
})();
