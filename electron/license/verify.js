/* electron/license/verify.js — 활성화 증서(Ed25519) 검증
   증서 형식:  base64url(payload JSON) + "." + base64url(서명)

   payload:
     { v:1, product:'numdraw', edition:'full', device:'<hex64>',
       key_id:'...', issued_at:'ISO8601', features:{ watermark:false, maxPages:0 } }

   서명 대상(signing input) — payload JSON 원문 바이트 **하나만** 인정한다.
     server/src/core/cert.js 의 signCertificate 가 TextEncoder 로 인코딩한
     JSON.stringify(payload) 바이트에 서명한다(= base64url 세그먼트를 디코드한 값).
     JWS 식(base64url 세그먼트 ASCII 바이트) 후보는 서버가 쓰지 않으므로 받지 않는다
     — 검증 경로를 하나로 줄여 공격 표면을 없앤다.
*/
'use strict';

const crypto = require('crypto');
const pubkey = require('./pubkey');

const MAX_CERT_LEN = 4096;   // 증서로 위장한 대용량 입력 차단

function _b64urlToBuf(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/* 길이 노출을 줄이는 상수시간 문자열 비교 */
function _sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/* 증서에 적힌 기능값만 신뢰한다. 값이 없거나 형식이 틀리면 안전한 쪽(제한 있음)으로 간다. */
function _featuresOf(payload) {
  const f = (payload && typeof payload.features === 'object' && payload.features) || {};
  return {
    watermark: f.watermark === false ? false : true,
    maxPages:  Number.isInteger(f.maxPages) && f.maxPages >= 0 ? f.maxPages : 1,
  };
}

/**
 * @param {string} cert           저장된 증서 문자열
 * @param {string} expectedDevice 이 PC 의 기기지문 hex64
 * @returns {{ok:boolean, reason?:string, payload?:object, edition?:string, features?:object}}
 */
function verifyCert(cert, expectedDevice) {
  if (typeof cert !== 'string' || !cert || cert.length > MAX_CERT_LEN) {
    return { ok: false, reason: 'NO_CERT' };
  }

  const key = pubkey.getKeyObject();
  if (!key) return { ok: false, reason: 'NO_PUBKEY' };

  const parts = cert.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const [seg, sigSeg] = parts;

  let sig, payloadRaw, payload;
  try {
    sig        = _b64urlToBuf(sigSeg);
    payloadRaw = _b64urlToBuf(seg);
    payload    = JSON.parse(payloadRaw.toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }

  if (sig.length !== 64) return { ok: false, reason: 'BAD_SIGNATURE' };

  /* 서명 검증 — 인정하는 signing input 은 payload JSON 원문 바이트 하나뿐 */
  if (!_verifyOne(key, payloadRaw, sig)) return { ok: false, reason: 'BAD_SIGNATURE' };

  /* 서명이 확인된 뒤에야 payload 내용을 신뢰한다 */
  if (payload.v !== 1)                  return { ok: false, reason: 'VERSION' };
  if (payload.product !== 'numdraw')    return { ok: false, reason: 'PRODUCT' };
  if (payload.edition !== 'full')       return { ok: false, reason: 'EDITION' };
  if (!_sameHex(payload.device, expectedDevice)) return { ok: false, reason: 'DEVICE_MISMATCH' };

  return {
    ok:       true,
    payload,
    edition:  payload.edition,
    features: _featuresOf(payload),
  };
}

function _verifyOne(key, msg, sig) {
  try {
    return crypto.verify(null, msg, key, sig);   // Ed25519 는 알고리즘 인자 null
  } catch {
    return false;
  }
}

module.exports = { verifyCert };
