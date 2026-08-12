/* electron/license/pubkey.js — 증서 검증용 Ed25519 공개키 (앱 내장)
   개인키는 절대 이 파일에 들어가지 않는다. 서명은 활성화 서버에서만 수행한다.

   ┌──────────────────────────────────────────────────────────────┐
   │ 운영자 작업                                                   │
   │  1) server/scripts/genkeys.mjs 로 Ed25519 키쌍을 생성한다      │
   │  2) 출력된 "공개키"를 아래 PUBLIC_KEY 값에 붙여넣는다          │
   │  3) 개인키는 Cloudflare Workers Secret 에만 넣는다            │
   │     (저장소·앱·dist/ 어디에도 두지 않는다)                     │
   └──────────────────────────────────────────────────────────────┘

   허용 형식 (아무거나 가능 — 자동 판별)
     - raw 32바이트 base64        (예: 'kx1p...==' 44자)
     - SPKI DER 44바이트 base64   (genkeys가 이 형식으로 뽑을 수도 있음)
     - PEM 문자열 ('-----BEGIN PUBLIC KEY-----' 로 시작)
*/
'use strict';

const crypto = require('crypto');

/* ⚠ 자리표시자 — 실제 키로 교체하기 전까지 모든 증서 검증이 실패한다(= 체험판 동작) */
const PLACEHOLDER = 'REPLACE_WITH_ED25519_PUBLIC_KEY';

const PUBLIC_KEY = 'LJ4WoXQ7NmUbpISPKP6nqO2gTaTS4lsHohJZm1MeirI';

/* SPKI DER 헤더 (Ed25519, RFC 8410) — raw 32바이트 앞에 붙이면 표준 SPKI가 된다 */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let _warned = false;
let _cached = null;   // null = 아직 시도 안 함, false = 사용 불가

function isPlaceholder() {
  return !PUBLIC_KEY || PUBLIC_KEY === PLACEHOLDER;
}

/* 검증에 쓸 KeyObject 반환. 자리표시자거나 형식이 틀리면 null */
function getKeyObject() {
  if (_cached !== null) return _cached || null;

  if (isPlaceholder()) {
    _warn(
      '공개키가 아직 자리표시자입니다.\n' +
      '  → electron/license/pubkey.js 의 PUBLIC_KEY 를 실제 값으로 교체하세요.\n' +
      '  → 교체 전까지 정품 인증은 항상 실패하고 앱은 체험판으로 동작합니다.'
    );
    _cached = false;
    return null;
  }

  try {
    const raw = PUBLIC_KEY.trim();

    if (raw.startsWith('-----BEGIN')) {
      _cached = crypto.createPublicKey({ key: raw, format: 'pem' });
      return _cached;
    }

    /* server/scripts/genkeys.mjs 는 base64url 로 출력한다 — 표준 base64 로 되돌린 뒤 디코드 */
    const b64 = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    const buf = Buffer.from(b64, 'base64');

    /* 32바이트면 raw 키 → SPKI 로 감싼다. 44바이트면 이미 SPKI DER */
    const der = buf.length === 32 ? Buffer.concat([SPKI_PREFIX, buf]) : buf;
    _cached = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return _cached;
  } catch (e) {
    _warn('공개키 형식이 올바르지 않습니다 (' + e.message + '). 체험판으로 동작합니다.');
    _cached = false;
    return null;
  }
}

function _warn(msg) {
  if (_warned) return;
  _warned = true;
  console.warn(
    '\n' +
    '╔════════════════════════════════════════════════════════════╗\n' +
    '║  [NumDraw 라이선스] 공개키 설정 필요                        ║\n' +
    '╚════════════════════════════════════════════════════════════╝\n' +
    msg + '\n'
  );
}

module.exports = { getKeyObject, isPlaceholder, PLACEHOLDER };
