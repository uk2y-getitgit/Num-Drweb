// POST /api/activate — 유료화_Phase1_구현계획.md 7장 API 계약 그대로 구현.

import { parseAndValidate, keyHash, isValidDeviceHash } from '../core/keygen.js';
import { importPrivateKey, issueCertificate } from '../core/cert.js';
import { jsonResponse } from '../util.js';

// 초기 판매량이 적으므로 별도 인프라(KV/D1) 없이 isolate 메모리 기반 간이 rate limit.
// (콜드스타트·다중 엣지 분산 시 초기화되는 최선노력 방어 — README에 한계 명시)
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

let cachedPrivateKey = null;
async function getPrivateKey(env) {
  if (!env.CERT_PRIVATE_KEY) {
    throw new Error('CERT_PRIVATE_KEY secret이 설정되지 않았습니다');
  }
  if (!cachedPrivateKey) {
    cachedPrivateKey = await importPrivateKey(env.CERT_PRIVATE_KEY);
  }
  return cachedPrivateKey;
}

export async function handleActivate(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return jsonResponse(
      { ok: false, code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.' },
      429
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, 400);
  }

  const { key, device, product } = body || {};

  if (product && product !== 'numdraw') {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, 400);
  }
  if (!isValidDeviceHash(device)) {
    return jsonResponse({ ok: false, code: 'BAD_REQUEST', message: '잘못된 요청입니다.' }, 400);
  }

  const parsed = parseAndValidate(key || '');
  if (!parsed.valid) {
    return jsonResponse(
      { ok: false, code: 'INVALID_KEY', message: '키를 다시 확인해 주세요.' },
      404
    );
  }

  const hash = await keyHash(parsed.normalized);
  const deviceHash = device.toLowerCase();

  const license = await env.DB.prepare(
    'SELECT key_hash, max_seats, status FROM licenses WHERE key_hash = ?'
  )
    .bind(hash)
    .first();

  if (!license) {
    return jsonResponse(
      { ok: false, code: 'INVALID_KEY', message: '키를 다시 확인해 주세요.' },
      404
    );
  }
  if (license.status === 'revoked') {
    return jsonResponse(
      { ok: false, code: 'REVOKED', message: '판매자에게 문의해 주세요.' },
      403
    );
  }

  // 원자적 조건부 INSERT — "좌석 수 확인"과 "삽입"을 한 SQL 문으로 묶는다.
  // (예전 버전은 COUNT → 판정 → INSERT가 세 번의 독립 왕복이라 서로 다른 기기의 동시
  //  요청이 모두 같은 좌석 수를 읽고 모두 통과해버리는 경쟁 조건이 있었다. H-1 수정.)
  // SQLite(D1)는 단일 writer 모델이라 이 한 문장이 실행되는 동안 다른 쓰기가 끼어들 수 없다 —
  // COUNT 서브쿼리와 INSERT가 하나의 원자적 단위로 처리된다.
  // WHERE 절 두 조건:
  //   1) NOT EXISTS: 이 기기가 이미 활성 상태면(재설치 등) 새 좌석을 소모하지 않는다
  //   2) COUNT < max_seats: 활성 좌석 수가 최대 대수 미만일 때만 삽입한다
  const now = new Date().toISOString();
  const insertResult = await env.DB.prepare(
    `INSERT INTO activations (key_hash, device_hash, activated_at)
     SELECT ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM activations WHERE key_hash = ? AND device_hash = ? AND released_at IS NULL
     )
     AND (SELECT COUNT(*) FROM activations WHERE key_hash = ? AND released_at IS NULL) < ?`
  )
    .bind(hash, deviceHash, now, hash, deviceHash, hash, license.max_seats)
    .run();

  const inserted = (insertResult.meta && insertResult.meta.changes) || 0;

  if (inserted === 0) {
    // 삽입되지 않은 이유는 둘 중 하나뿐이다.
    //  (a) 이 기기가 이미 활성 상태 → 좌석 추가 소모 없이 증서만 재발급 (재설치 대응)
    //  (b) 좌석이 이미 가득 참 → 거부
    const already = await env.DB.prepare(
      'SELECT id FROM activations WHERE key_hash = ? AND device_hash = ? AND released_at IS NULL'
    )
      .bind(hash, deviceHash)
      .first();
    if (!already) {
      return jsonResponse(
        {
          ok: false,
          code: 'SEAT_LIMIT',
          message: `이 라이선스는 이미 ${license.max_seats}대에서 사용 중입니다.`,
        },
        409
      );
    }
  }

  const seatsUsed = await countActiveSeats(env, hash);

  const privateKey = await getPrivateKey(env);
  const cert = await issueCertificate({
    deviceHash,
    keyId: hash.slice(0, 12),
    privateKey,
    features: { watermark: false, maxPages: 0 },
  });

  return jsonResponse({ ok: true, cert, seats_used: seatsUsed, max_seats: license.max_seats });
}

async function countActiveSeats(env, hash) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM activations WHERE key_hash = ? AND released_at IS NULL'
  )
    .bind(hash)
    .first();
  return row ? row.n : 0;
}
