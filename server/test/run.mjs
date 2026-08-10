/* server/test/run.mjs — 활성화 서버 전체 시나리오 검증
 *
 * 실행: cd server && npm test
 *
 * 라우트 코드(src/**)를 수정 없이 그대로 import해서 Node 위에서 돌린다.
 * env.DB 자리에는 node:sqlite 기반 D1 호환 어댑터를 끼운다 (d1-adapter.mjs 주석 참고).
 *
 * 검증 항목
 *   기본   : 키 발급 / 신규 활성화 / 같은 기기 재요청 / 좌석 초과 / INVALID_KEY / REVOKED
 *   H-1    : 서로 다른 기기 5건 동시 요청 → 정확히 2건만 성공 (좌석 카운트 경쟁 조건)
 *   H-2    : 활성화 → 반납 → 같은 기기 재활성화 → 성공 (부분 유니크 인덱스)
 *   L-3    : 서버가 발급한 증서가 앱(electron/license/verify.js) 검증을 통과하는가
 *   L-5    : /api/activate 응답에 CORS 헤더가 없는가
 *   M-2    : ADMIN_TOKEN 길이 미달 시 503 / 로그인 연속 실패 시 잠금
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { D1Database } from './d1-adapter.mjs';
import { toBase64Url } from '../src/core/cert.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const require = createRequire(import.meta.url);

// ---- 초소형 테스트 러너 -------------------------------------------------------

let passed = 0;
const failures = [];
let section = '';

function group(name) {
  section = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 58 - name.length))}`);
}

function check(desc, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${desc}`);
  } else {
    failures.push(`[${section}] ${desc}${detail ? ` — ${detail}` : ''}`);
    console.log(`  ✕ ${desc}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---- 요청 헬퍼 ---------------------------------------------------------------

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef'; // 24자 이상 (M-2 최소 길이)

function basicAuth(pass) {
  return 'Basic ' + Buffer.from('admin:' + pass).toString('base64');
}

function makeRequest(path, { method = 'GET', json, form, auth, ip = '203.0.113.1' } = {}) {
  const headers = new Headers({ 'cf-connecting-ip': ip });
  let body;
  if (json !== undefined) {
    body = typeof json === 'string' ? json : JSON.stringify(json);
    headers.set('content-type', 'application/json');
  } else if (form) {
    body = new URLSearchParams(form).toString();
    headers.set('content-type', 'application/x-www-form-urlencoded');
  }
  if (auth) headers.set('authorization', auth);
  return new Request('https://numdraw.test' + path, { method, headers, body });
}

function randomDevice() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---- 준비: 키쌍 · worker · DB ------------------------------------------------

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
  'sign',
  'verify',
]);
const PUB_B64URL = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)));
const PRIV_B64URL = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey)));

const worker = (await import('../src/index.js')).default;

let db, env;
function resetDb(adminToken = ADMIN_TOKEN) {
  if (db) db.close();
  db = new D1Database(join(HERE, '../schema.sql'));
  env = { DB: db, CERT_PRIVATE_KEY: PRIV_B64URL, ADMIN_TOKEN: adminToken };
}
const call = (path, opts) => worker.fetch(makeRequest(path, opts), env);

/** 관리자 화면으로 키를 발급하고 평문 키를 뽑아낸다 (운영자가 실제로 하는 절차 그대로) */
async function issueKey(maxSeats = 2, ip = '203.0.113.9') {
  const res = await call('/admin/issue', {
    method: 'POST',
    form: { buyer_name: '홍길동', buyer_email: 'a@b.c', memo: '테스트', max_seats: String(maxSeats) },
    auth: basicAuth(ADMIN_TOKEN),
    ip,
  });
  const html = await res.text();
  const m = html.match(/<div class="keybox">([^<]+)<\/div>/);
  if (!m) throw new Error('키 발급 실패 — keybox를 찾을 수 없음\n' + html.slice(0, 400));
  return m[1].trim();
}

const activate = (key, device, ip = '203.0.113.1') =>
  call('/api/activate', { method: 'POST', json: { key, device, product: 'numdraw' }, ip });

const activeSeats = (hashPrefixIgnored) =>
  db.query('SELECT COUNT(*) AS n FROM activations WHERE released_at IS NULL')[0].n;

// =============================================================================
// 1. 기본 시나리오
// =============================================================================
resetDb();
group('기본 — 발급 · 활성화 · 좌석');

const key = await issueKey(2);
check('키 발급 형식 ND2-XXXXX-XXXXX-XXXXX-XXXXX', /^ND2(-[0-9A-Z]{5}){4}$/.test(key), key);
check(
  '평문 키가 DB에 저장되지 않음',
  db.query('SELECT key_hash, key_masked FROM licenses').every(
    (r) => !r.key_hash.includes(key.replace(/-/g, '')) && r.key_masked.includes('****')
  )
);

const devA = randomDevice();
const devB = randomDevice();
const devC = randomDevice();

const r1 = await activate(key, devA);
const j1 = await r1.json();
check('신규 활성화 → 200 ok', r1.status === 200 && j1.ok === true, `status=${r1.status}`);
check('seats_used = 1 / max_seats = 2', j1.seats_used === 1 && j1.max_seats === 2, JSON.stringify(j1));
check('증서 문자열 반환', typeof j1.cert === 'string' && j1.cert.includes('.'));

const r2 = await activate(key, devA);
const j2 = await r2.json();
check('같은 기기 재요청 → 200 (재설치 대응)', r2.status === 200 && j2.ok === true);
check('같은 기기 재요청이 좌석을 늘리지 않음', j2.seats_used === 1, `seats_used=${j2.seats_used}`);
check('activations 행도 늘지 않음', activeSeats() === 1, `rows=${activeSeats()}`);
check('증서는 재발급됨', typeof j2.cert === 'string' && j2.cert.length > 0);

const r3 = await activate(key, devB);
const j3 = await r3.json();
check('두 번째 기기 → 200, seats_used = 2', r3.status === 200 && j3.seats_used === 2);

const r4 = await activate(key, devC);
const j4 = await r4.json();
check('세 번째 기기 → 409 SEAT_LIMIT', r4.status === 409 && j4.code === 'SEAT_LIMIT', `status=${r4.status} code=${j4.code}`);
check('거부된 기기는 DB에 남지 않음', activeSeats() === 2, `rows=${activeSeats()}`);

// ---- 잘못된 입력 -------------------------------------------------------------
group('입력 검증');

const rUnknown = await activate('ND2-00000-00000-00000-3P2G', randomDevice());
check('미발급 키 → 404 INVALID_KEY', rUnknown.status === 404 && (await rUnknown.json()).code === 'INVALID_KEY');

const rTypo = await activate(key.slice(0, -1) + (key.at(-1) === 'Z' ? 'Y' : 'Z'), randomDevice());
check('체크섬 불일치 키 → 404 INVALID_KEY', rTypo.status === 404 && (await rTypo.json()).code === 'INVALID_KEY');

const rBadDev = await activate(key, 'not-a-hex-device');
check('잘못된 기기지문 → 400 BAD_REQUEST', rBadDev.status === 400 && (await rBadDev.json()).code === 'BAD_REQUEST');

const rBadProd = await call('/api/activate', {
  method: 'POST',
  json: { key, device: randomDevice(), product: 'other' },
});
check('다른 product → 400 BAD_REQUEST', rBadProd.status === 400);

const rBadJson = await call('/api/activate', { method: 'POST', json: '{not json' });
check('깨진 JSON → 400 BAD_REQUEST', rBadJson.status === 400);

// ---- 정지 -------------------------------------------------------------------
group('정지(revoke)');

const hashRow = db.query('SELECT key_hash FROM licenses')[0];
const rRevoke = await call('/admin/revoke', {
  method: 'POST',
  form: { key_hash: hashRow.key_hash },
  auth: basicAuth(ADMIN_TOKEN),
});
check('정지 → 303 리다이렉트', rRevoke.status === 303);

const rAfterRevoke = await activate(key, devA);
check('정지 후 활성화 요청 → 403 REVOKED', rAfterRevoke.status === 403 && (await rAfterRevoke.json()).code === 'REVOKED');
check(
  '정지해도 이미 발급된 증서는 서버가 회수하지 못한다 (README 5장의 알려진 한계)',
  db.query('SELECT COUNT(*) AS n FROM activations WHERE released_at IS NULL')[0].n === 2
);

// =============================================================================
// 2. H-2 회귀 — 반납 후 같은 기기 재활성화
// =============================================================================
resetDb();
group('H-2 회귀 — 반납 후 같은 기기 재활성화');

const key2 = await issueKey(2);
const devR = randomDevice();

const h2a = await activate(key2, devR);
check('① 최초 활성화 → 200', h2a.status === 200);

const listHtml = await (await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN) })).text();
const relMatch = listHtml.match(
  /action="\/admin\/release"[\s\S]*?name="key_hash" value="([^"]+)"[\s\S]*?name="activation_id" value="(\d+)"/
);
check('발급 대장에 반납 버튼이 노출됨', !!relMatch);

const rRelease = await call('/admin/release', {
  method: 'POST',
  form: { key_hash: relMatch[1], activation_id: relMatch[2] },
  auth: basicAuth(ADMIN_TOKEN),
});
check('② 좌석 반납 → 303', rRelease.status === 303);
check('반납 후 활성 좌석 0', activeSeats() === 0, `rows=${activeSeats()}`);
check(
  '반납 이력 행은 남아 있음',
  db.query('SELECT COUNT(*) AS n FROM activations WHERE released_at IS NOT NULL')[0].n === 1
);

const h2b = await activate(key2, devR);
const h2bj = await h2b.json();
check(
  '③ 같은 기기 재활성화 → 200 (구버전은 UNIQUE 위반으로 500이었음)',
  h2b.status === 200 && h2bj.ok === true,
  `status=${h2b.status} body=${JSON.stringify(h2bj)}`
);
check('재활성화 후 좌석 1', h2bj.seats_used === 1, `seats_used=${h2bj.seats_used}`);

// =============================================================================
// 3. H-1 회귀 — 서로 다른 기기 5건 동시 활성화
// =============================================================================
resetDb();
group('H-1 회귀 — 서로 다른 기기 5건 동시 요청');

const key3 = await issueKey(2);
const devices = Array.from({ length: 5 }, () => randomDevice());

const results = await Promise.all(devices.map((d, i) => activate(key3, d, `198.51.100.${i + 1}`)));
const bodies = await Promise.all(results.map((r) => r.json()));

const okCount = bodies.filter((b) => b.ok === true).length;
const limitCount = bodies.filter((b) => b.code === 'SEAT_LIMIT').length;

check('정확히 2건 성공', okCount === 2, `성공 ${okCount}건`);
check('나머지 3건 SEAT_LIMIT', limitCount === 3, `SEAT_LIMIT ${limitCount}건`);
check('DB 활성 좌석도 정확히 2', activeSeats() === 2, `rows=${activeSeats()}`);
check(
  '성공 응답의 seats_used가 max_seats를 넘지 않음',
  bodies.filter((b) => b.ok).every((b) => b.seats_used <= 2),
  JSON.stringify(bodies.filter((b) => b.ok).map((b) => b.seats_used))
);

// 같은 기기 5건 동시 요청은 좌석을 1개만 써야 한다 (재설치 중복 클릭 대응)
resetDb();
const key3b = await issueKey(2);
const devSame = randomDevice();
const sameResults = await Promise.all(
  Array.from({ length: 5 }, (_, i) => activate(key3b, devSame, `198.51.100.${20 + i}`))
);
const sameBodies = await Promise.all(sameResults.map((r) => r.json()));
check('같은 기기 5건 동시 → 전부 200', sameBodies.every((b) => b.ok === true));
check('같은 기기 5건 동시 → 좌석 1개만 소모', activeSeats() === 1, `rows=${activeSeats()}`);

// =============================================================================
// 4. L-5 — CORS 헤더 제거
// =============================================================================
resetDb();
group('L-5 — CORS 헤더 없음');

const key4 = await issueKey(2);
const rCors = await activate(key4, randomDevice());
check(
  'access-control-allow-origin 헤더 없음',
  rCors.headers.get('access-control-allow-origin') === null,
  String(rCors.headers.get('access-control-allow-origin'))
);
const rOptions = await call('/api/activate', { method: 'OPTIONS' });
check('OPTIONS 프리플라이트 미제공 → 404', rOptions.status === 404, `status=${rOptions.status}`);

// =============================================================================
// 5. M-2 — 관리자 인증 방어
// =============================================================================
group('M-2 — 관리자 인증');

resetDb();
const rNoAuth = await call('/admin/list', { ip: '198.51.100.50' });
check('인증 없음 → 401', rNoAuth.status === 401);
check('WWW-Authenticate 헤더 존재', (rNoAuth.headers.get('www-authenticate') || '').includes('Basic'));

const rWrong = await call('/admin/list', { auth: basicAuth('wrong-password'), ip: '198.51.100.51' });
check('틀린 비밀번호 → 401', rWrong.status === 401);

const rOk = await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN), ip: '198.51.100.52' });
check('올바른 비밀번호 → 200', rOk.status === 200);

// 실패 잠금: 같은 IP에서 8회 실패 후 9번째는 자격증명과 무관하게 429
const LOCK_IP = '198.51.100.60';
for (let i = 0; i < 8; i++) {
  await call('/admin/list', { auth: basicAuth('nope' + i), ip: LOCK_IP });
}
const rLocked = await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN), ip: LOCK_IP });
check('8회 실패 후 → 429 (올바른 비밀번호여도 차단)', rLocked.status === 429, `status=${rLocked.status}`);
check('retry-after 헤더 안내', !!rLocked.headers.get('retry-after'));

// 잠금은 IP별로 격리된다 — 다른 운영자가 같이 잠기면 안 된다
const rOtherIp = await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN), ip: '198.51.100.61' });
check('다른 IP는 잠기지 않음', rOtherIp.status === 200, `status=${rOtherIp.status}`);

// 성공하면 카운터가 비워진다 (오타 몇 번으로 운영자가 잠기지 않도록)
const RESET_IP = '198.51.100.70';
for (let i = 0; i < 5; i++) await call('/admin/list', { auth: basicAuth('x' + i), ip: RESET_IP });
await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN), ip: RESET_IP });
for (let i = 0; i < 5; i++) await call('/admin/list', { auth: basicAuth('y' + i), ip: RESET_IP });
const rAfterReset = await call('/admin/list', { auth: basicAuth(ADMIN_TOKEN), ip: RESET_IP });
check('성공 시 실패 카운터 초기화', rAfterReset.status === 200, `status=${rAfterReset.status}`);

// ADMIN_TOKEN 최소 길이
resetDb('short');
const rShort = await call('/admin/list', { auth: basicAuth('short'), ip: '198.51.100.80' });
check('ADMIN_TOKEN 24자 미만 → 503 (관리자 화면 비활성)', rShort.status === 503, `status=${rShort.status}`);

resetDb('');
const rEmpty = await call('/admin/list', { auth: basicAuth(''), ip: '198.51.100.81' });
check('ADMIN_TOKEN 미설정 → 503', rEmpty.status === 503, `status=${rEmpty.status}`);

// =============================================================================
// 6. L-3 — 서버 증서가 앱 검증(electron/license/verify.js)을 통과하는가
// =============================================================================
resetDb();
group('L-3 — 서버 증서 ↔ 앱 검증 상호운용');

const key5 = await issueKey(2);
const devV = randomDevice();
const certRes = await (await activate(key5, devV)).json();

// pubkey.js를 "운영자가 genkeys 출력값을 붙여넣은 상태"로 복제해 실제 파싱까지 검증한다
const tmpDir = mkdtempSync(join(tmpdir(), 'numdraw-verify-'));
let verifyMod;
try {
  const pubkeyPath = join(REPO, 'electron/license/pubkey.js');
  const patched = readFileSync(pubkeyPath, 'utf8').replace(
    /^const PUBLIC_KEY = '.*';$/m,
    `const PUBLIC_KEY = '${PUB_B64URL}';`
  );
  const tmpPubkey = join(tmpDir, 'pubkey.js');
  writeFileSync(tmpPubkey, patched, 'utf8');

  const realPubkey = require(tmpPubkey);
  check('genkeys 형식(raw 32B base64url) 공개키를 pubkey.js가 파싱함', !!realPubkey.getKeyObject());
  check('자리표시자 아님으로 판정', realPubkey.isPlaceholder() === false);

  // verify.js가 require('./pubkey')로 가져가는 자리에 위 모듈을 끼운다
  const verifyPath = require.resolve(join(REPO, 'electron/license/verify.js'));
  const origPubkeyPath = require.resolve(join(REPO, 'electron/license/pubkey.js'));
  const NodeModule = require('node:module');
  const stub = new NodeModule(origPubkeyPath, null);
  stub.filename = origPubkeyPath;
  stub.loaded = true;
  stub.exports = realPubkey;
  require.cache[origPubkeyPath] = stub;
  delete require.cache[verifyPath];
  verifyMod = require(verifyPath);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

const v = verifyMod.verifyCert(certRes.cert, devV);
check('정상 증서 → 검증 통과', v.ok === true, v.reason);
check("edition === 'full'", v.ok && v.edition === 'full');
check('features.watermark === false (제한 해제)', v.ok && v.features.watermark === false);
check('features.maxPages === 0 (무제한)', v.ok && v.features.maxPages === 0);

check(
  '다른 기기에서 같은 증서 → DEVICE_MISMATCH',
  verifyMod.verifyCert(certRes.cert, randomDevice()).reason === 'DEVICE_MISMATCH'
);

// payload를 조작하면 서명이 깨져야 한다
const [seg, sig] = certRes.cert.split('.');
const tamperedPayload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
tamperedPayload.edition = 'enterprise';
const tamperedCert =
  Buffer.from(JSON.stringify(tamperedPayload), 'utf8').toString('base64url') + '.' + sig;
check('payload 위조 → BAD_SIGNATURE', verifyMod.verifyCert(tamperedCert, devV).reason === 'BAD_SIGNATURE');

const flippedSig = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A');
check(
  '서명 1자 변조 → BAD_SIGNATURE',
  verifyMod.verifyCert(seg + '.' + flippedSig, devV).reason === 'BAD_SIGNATURE'
);

check('빈 증서 → NO_CERT', verifyMod.verifyCert('', devV).reason === 'NO_CERT');
check('형식 오류 → MALFORMED', verifyMod.verifyCert('abc', devV).reason === 'MALFORMED');

// L-3: JWS 식 서명 대상(base64url 세그먼트 ASCII 바이트)은 더 이상 인정하지 않는다
const jwsStyleSig = toBase64Url(
  new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, new TextEncoder().encode(seg)))
);
check(
  'JWS식 서명(세그먼트 ASCII에 서명) → 거부 (L-3 이중 허용 제거)',
  verifyMod.verifyCert(seg + '.' + jwsStyleSig, devV).reason === 'BAD_SIGNATURE'
);

// =============================================================================
// 결과
// =============================================================================
db.close();

console.log('\n' + '='.repeat(62));
if (failures.length === 0) {
  console.log(`  전체 통과 — ${passed}건`);
  console.log('='.repeat(62));
  process.exit(0);
}
console.log(`  실패 ${failures.length}건 / 통과 ${passed}건`);
console.log('='.repeat(62));
for (const f of failures) console.log('  ✕ ' + f);
console.log('');
process.exit(1);
