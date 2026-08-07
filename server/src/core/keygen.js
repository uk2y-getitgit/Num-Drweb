// 플랫폼 비의존 순수 JS — 라이선스 키 생성 · 정규화 · 체크섬
// 브라우저 / Node / Cloudflare Workers 어디서나 동일하게 동작한다 (Web Crypto만 사용).
//
// 키 포맷: ND2-XXXXX-XXXXX-XXXXX-XXXXX
//   - 접두어 ND2 뒤 20자 = 본문 16자(80비트 난수) + 체크섬 4자
//   - 문자 집합: Crockford Base32 (혼동되는 0/O, 1/I/L 등을 제외한 32자)
//   - 체크섬은 오타를 서버에 묻지 않고도 즉시 감지하기 위한 것 — 암호학적 보장이 아니다
//
// 유료화_Phase1_구현계획.md 2장 참조.

export const CHARSET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const CHAR_INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < CHARSET.length; i++) m.set(CHARSET[i], i);
  return m;
})();

const KEY_PREFIX = 'ND2';
const BODY_LEN = 16; // 80비트 난수
const CHECK_LEN = 4; // 체크섬
const GROUP_SIZE = 5;

function getRandomBytes(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return arr;
}

/** 16자 무작위 본문 생성 (80비트) */
function randomBody() {
  const bytes = getRandomBytes(BODY_LEN);
  let out = '';
  for (let i = 0; i < BODY_LEN; i++) {
    // 256을 32로 나눈 나머지 편향은 80비트 전체로 보면 실질적 영향이 없다 (MVP 수준에서 허용)
    out += CHARSET[bytes[i] % 32];
  }
  return out;
}

/**
 * 본문 16자로부터 체크섬 4자를 계산한다 (20비트).
 * 순수 위치 가중 다항식 해시 — 오타·전치 오류 감지용, 위조 방지 목적이 아니다.
 */
export function computeChecksum(body16) {
  const MOD = 32 ** CHECK_LEN; // 1,048,576
  let acc = 0;
  for (let i = 0; i < body16.length; i++) {
    const v = CHAR_INDEX.get(body16[i]);
    if (v === undefined) throw new Error('INVALID_CHAR_IN_BODY');
    acc = (acc * 33 + v + 1) % MOD;
  }
  let out = '';
  let n = acc;
  for (let i = 0; i < CHECK_LEN; i++) {
    out = CHARSET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function groupWithDashes(joined20) {
  const groups = [];
  for (let i = 0; i < joined20.length; i += GROUP_SIZE) {
    groups.push(joined20.slice(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

/** 신규 라이선스 키 생성 → 'ND2-XXXXX-XXXXX-XXXXX-XXXXX' (화면에 1회 표시하는 형식) */
export function generateLicenseKey() {
  const body = randomBody();
  const check = computeChecksum(body);
  return `${KEY_PREFIX}-${groupWithDashes(body + check)}`;
}

/**
 * 사용자 입력 정규화: 대문자 변환, 공백/하이픈 제거,
 * 오인식 쉬운 문자 치환(O→0, I·L→1) — Crockford Base32 관례.
 */
export function normalizeInput(raw) {
  if (!raw) return '';
  let s = String(raw).toUpperCase().replace(/[\s-]/g, '');
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  return s;
}

/**
 * 정규화 후 접두어·길이·문자셋·체크섬을 검증한다.
 * 반환: { valid:true, body, checksum, normalized } | { valid:false, reason }
 * normalized = 'ND2' + body16 + checksum4 (하이픈 없음) — DB 해시 입력의 단일 기준.
 */
export function parseAndValidate(raw) {
  const normalized = normalizeInput(raw);
  if (!normalized.startsWith(KEY_PREFIX)) {
    return { valid: false, reason: 'BAD_PREFIX' };
  }
  const rest = normalized.slice(KEY_PREFIX.length);
  if (rest.length !== BODY_LEN + CHECK_LEN) {
    return { valid: false, reason: 'BAD_LENGTH' };
  }
  const body = rest.slice(0, BODY_LEN);
  const checksum = rest.slice(BODY_LEN);
  for (const ch of body + checksum) {
    if (!CHAR_INDEX.has(ch)) return { valid: false, reason: 'BAD_CHAR' };
  }
  if (computeChecksum(body) !== checksum) {
    return { valid: false, reason: 'BAD_CHECKSUM' };
  }
  return { valid: true, body, checksum, normalized };
}

/** SHA-256 해시(hex). Web Crypto 표준 — 브라우저/Node/Workers 공통 */
export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** DB 저장용 키 해시 — 평문 키는 저장하지 않는다. normalizeAndValidate().normalized를 넣는다 */
export async function keyHash(normalizedFullKey) {
  return sha256Hex(normalizedFullKey);
}

/** 발급 직후 표시용 마스킹: 'ND2-A7K3M-****-****-9QX2' (schema.sql 주석 예시와 동일 규칙) */
export function maskKey(dashedDisplayKey) {
  const parts = dashedDisplayKey.split('-');
  if (parts.length !== 5) return dashedDisplayKey;
  const [prefix, g1, , , g4] = parts;
  return `${prefix}-${g1}-****-****-${g4}`;
}

/** 기기지문 해시(hex 64자) 형식 검증 */
export function isValidDeviceHash(device) {
  return typeof device === 'string' && /^[0-9a-f]{64}$/i.test(device);
}
