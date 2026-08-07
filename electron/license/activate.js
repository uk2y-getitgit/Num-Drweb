/* electron/license/activate.js — 키 정규화 · 체크섬 · 활성화 서버 요청

   키 포맷:  ND2-XXXXX-XXXXX-XXXXX-XXXXX
     문자집합 : 0123456789ABCDEFGHJKMNPQRSTVWXYZ  (Crockford Base32, I/L/O/U 제외)
     앞 16자  : 80비트 난수
     뒤 4자   : 체크섬 (오타를 서버에 묻지 않고 즉시 감지)

   체크섬 알고리즘은 server/src/core/keygen.js 의 computeChecksum 과 동일해야 한다.
   (서버 구현을 기준으로 맞춘 것 — 위치 가중 다항식 해시 mod 32^4)
     acc = 0;  각 문자마다  acc = (acc * 33 + 문자인덱스 + 1) mod 32^4
     acc 를 32진수 4자리로 인코딩
   오타 감지용이지 위조 방지용이 아니다. 서버가 최종 판정을 한다.
*/
'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ALPHABET     = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX       = 'ND2';
const BODY_LEN     = 16;
const CHECK_LEN    = 4;
const REQ_TIMEOUT  = 15000;

/* ── 운영자 설정 ── */
let _cfg = null;
function getConfig() {
  if (_cfg) return _cfg;
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch { /* 없으면 기본값 */ }
  _cfg = {
    activationUrl:      (process.env.NUMDRAW_ACTIVATION_URL  || file.activationUrl  || '').trim(),
    supportContact:     (process.env.NUMDRAW_SUPPORT_CONTACT || file.supportContact || '').trim(),
    enforceKeyChecksum: file.enforceKeyChecksum === true,
  };
  return _cfg;
}

/* ── 정규화: 소문자·공백·하이픈·혼동문자를 모두 흡수 ── */
function normalizeKey(input) {
  if (typeof input !== 'string') return '';
  let s = input.toUpperCase().replace(/[^0-9A-Z]/g, '');
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.startsWith(PREFIX)) s = s.slice(PREFIX.length);
  return s;
}

/* 화면 표시용 하이픈 형식 */
function formatKey(normalized) {
  const g = normalized.match(/.{1,5}/g) || [];
  return [PREFIX].concat(g).join('-');
}

/* 문자집합·길이만 확인 (체크섬 제외) */
function isWellFormed(normalized) {
  if (normalized.length !== BODY_LEN + CHECK_LEN) return false;
  for (const ch of normalized) if (ALPHABET.indexOf(ch) === -1) return false;
  return true;
}

/* server/src/core/keygen.js 의 computeChecksum 과 반드시 동일 */
function computeChecksum(body16) {
  const MOD = Math.pow(32, CHECK_LEN);
  let acc = 0;
  for (const ch of body16) {
    const v = ALPHABET.indexOf(ch);
    if (v === -1) return '';
    acc = (acc * 33 + v + 1) % MOD;
  }
  let out = '', n = acc;
  for (let i = 0; i < CHECK_LEN; i++) { out = ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
  return out;
}

function hasValidChecksum(normalized) {
  if (!isWellFormed(normalized)) return false;
  return computeChecksum(normalized.slice(0, BODY_LEN)) === normalized.slice(BODY_LEN);
}

/**
 * 활성화 서버에 키 + 기기지문을 보내고 증서를 받는다.
 * @returns {{ok:boolean, cert?:string, seats_used?:number, max_seats?:number, code?:string, message?:string}}
 */
async function requestActivation(rawKey, deviceHash, appVersion) {
  const cfg = getConfig();
  const key = normalizeKey(rawKey);

  if (!isWellFormed(key)) {
    return { ok: false, code: 'INVALID_KEY', message: '키 형식이 올바르지 않습니다. ND2- 로 시작하는 25자리 키를 확인해 주세요.' };
  }
  if (cfg.enforceKeyChecksum && !hasValidChecksum(key)) {
    return { ok: false, code: 'INVALID_KEY', message: '키에 오타가 있는 것 같습니다. 다시 확인해 주세요.' };
  }
  if (!cfg.activationUrl) {
    return { ok: false, code: 'NO_ENDPOINT', message: '활성화 서버 주소가 설정되지 않았습니다. 판매자에게 문의해 주세요.' };
  }

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);

  try {
    const res = await fetch(cfg.activationUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        key:         formatKey(key),
        device:      deviceHash,
        product:     'numdraw',
        app_version: appVersion,
      }),
      signal: ctrl.signal,
    });

    let data = null;
    try { data = await res.json(); } catch { /* 본문이 JSON 이 아님 */ }

    if (!res.ok || !data || data.ok !== true) {
      const code = (data && data.code) || (res.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR');
      return { ok: false, code, message: (data && data.message) || messageFor(code) };
    }
    if (typeof data.cert !== 'string' || !data.cert) {
      return { ok: false, code: 'SERVER_ERROR', message: messageFor('SERVER_ERROR') };
    }

    return {
      ok:         true,
      cert:       data.cert,
      seats_used: data.seats_used,
      max_seats:  data.max_seats,
      keyMasked:  formatKey(key),
      normalized: key,
    };
  } catch (e) {
    const code = e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    return { ok: false, code, message: messageFor(code) };
  } finally {
    clearTimeout(timer);
  }
}

/* API 계약(7장)의 code → 사용자 안내 문구 */
function messageFor(code) {
  const support = getConfig().supportContact;
  const tail    = support ? ' (문의: ' + support + ')' : '';
  switch (code) {
    case 'INVALID_KEY':  return '키를 다시 확인해 주세요.';
    case 'REVOKED':      return '사용이 중지된 키입니다. 판매자에게 문의해 주세요.' + tail;
    case 'SEAT_LIMIT':   return '이 라이선스는 이미 2대에서 사용 중입니다. 기존 PC를 해제한 뒤 다시 시도해 주세요.' + tail;
    case 'RATE_LIMITED': return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
    case 'TIMEOUT':      return '서버 응답이 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.';
    case 'NETWORK':      return '인터넷에 연결할 수 없습니다. 정품 인증은 최초 1회만 인터넷이 필요합니다.';
    case 'NO_ENDPOINT':  return '활성화 서버 주소가 설정되지 않았습니다.' + tail;
    case 'BAD_CERT':     return '서버가 보낸 증서를 확인할 수 없습니다. 판매자에게 문의해 주세요.' + tail;
    default:             return '활성화에 실패했습니다. 잠시 후 다시 시도해 주세요.' + tail;
  }
}

module.exports = {
  normalizeKey, formatKey, isWellFormed, computeChecksum, hasValidChecksum,
  requestActivation, messageFor, getConfig,
};
