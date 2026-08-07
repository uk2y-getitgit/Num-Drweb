/* electron/license/index.js — 라이선스 상태 판정 (메인 프로세스 전용)

   설계 원칙
   1) 증서가 없거나 무효면 '체험판'으로 떨어진다. 앱이 안 켜지는 경우는 없다.
   2) 기능 제한값(watermark / maxPages)은 반드시 **서명이 검증된 증서 payload**에서 나온다.
      "정품이면 제한 해제" 라는 분기 하나가 아니라, 제한을 푸는 값 자체가 증서 안에만 존재한다.
   3) 온라인 검증은 활성화 1회뿐. 이후 실행은 전부 오프라인 서명 검증이다.
*/
'use strict';

const fingerprint = require('./fingerprint');
const verify      = require('./verify');
const store       = require('./store');
const activate    = require('./activate');
const pubkey      = require('./pubkey');

/* 체험판 기본 제한 — 증서가 없을 때 적용되는 값 */
const TRIAL_FEATURES = Object.freeze({ watermark: true, maxPages: 1 });

let _cached = null;

function _trial(reason) {
  return {
    edition:  'trial',
    features: { watermark: TRIAL_FEATURES.watermark, maxPages: TRIAL_FEATURES.maxPages },
    reason:   reason || 'NO_CERT',
  };
}

/* 현재 상태 판정 (동기) */
function getStatus() {
  if (_cached) return _cached;

  const device = fingerprint.get();
  const cfg    = activate.getConfig();
  const base   = {
    device,
    deviceShort:   device.slice(0, 12).toUpperCase(),
    pubkeyReady:   !pubkey.isPlaceholder(),
    endpointReady: !!cfg.activationUrl,
    supportContact: cfg.supportContact,
  };

  const saved = store.read();
  if (!saved || !saved.cert) {
    _cached = Object.assign({}, base, _trial('NO_CERT'));
    return _cached;
  }

  const r = verify.verifyCert(saved.cert, device);
  if (!r.ok) {
    console.warn('[license] 증서 검증 실패 (' + r.reason + ') — 체험판으로 동작합니다');
    _cached = Object.assign({}, base, _trial(r.reason));
    return _cached;
  }

  _cached = Object.assign({}, base, {
    edition:     r.edition,          // 증서 payload 값
    features:    r.features,         // 증서 payload 값
    keyMasked:   saved.keyMasked || '',
    activatedAt: saved.activatedAt || r.payload.issued_at || '',
    reason:      'OK',
  });
  return _cached;
}

/* 키로 활성화 시도 → 성공 시 증서 저장 후 새 상태 반환 */
async function activateWithKey(rawKey, appVersion) {
  const device = fingerprint.get();
  const res    = await activate.requestActivation(rawKey, device, appVersion);

  if (!res.ok) {
    return { ok: false, code: res.code, message: res.message, status: getStatus() };
  }

  /* 서버 응답을 그대로 믿지 않는다 — 저장 전에 이 PC 기준으로 서명을 검증한다 */
  const v = verify.verifyCert(res.cert, device);
  if (!v.ok) {
    return {
      ok: false,
      code: 'BAD_CERT',
      message: activate.messageFor('BAD_CERT') + ' [' + v.reason + ']',
      status: getStatus(),
    };
  }

  store.write({
    cert:        res.cert,
    keyMasked:   store.maskKey(res.keyMasked || ''),
    activatedAt: new Date().toISOString(),
    device,                                   // 참고용 (검증은 증서 안의 값으로 한다)
  });

  _cached = null;
  return {
    ok: true,
    seatsUsed: res.seats_used,
    maxSeats:  res.max_seats,
    status:    getStatus(),
  };
}

/* 이 PC 의 증서 삭제 (서버 좌석 반납은 운영자 엔드포인트 담당) */
function deactivateLocal() {
  store.clear();
  _cached = null;
  return getStatus();
}

function invalidateCache() { _cached = null; }

module.exports = { getStatus, activateWithKey, deactivateLocal, invalidateCache, TRIAL_FEATURES };
