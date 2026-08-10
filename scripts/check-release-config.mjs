/* scripts/check-release-config.mjs — 배포 빌드 전 라이선스 설정 점검 (M-6)
 *
 * 왜 필요한가:
 *   자리표시자 공개키와 빈 activationUrl 상태로도 `npm run build`는 그냥 성공한다.
 *   그렇게 만들어진 설치파일은 **모든 구매자가 활성화에 실패하고 체험판으로 떨어진다.**
 *   앱이 안 켜지는 게 아니라 "정품인데 워터마크가 찍히는" 형태로 나타나서
 *   출고 전에 알아채기 어렵다. 그래서 빌드 자체를 막는다.
 *
 * package.json의 "prebuild"로 연결돼 있어 `npm run build` 시 자동 실행된다.
 *
 * 체험판 배포본이나 UI 확인용 빌드를 일부러 만들려면 (PowerShell):
 *   $env:NUMDRAW_ALLOW_UNCONFIGURED_BUILD=1; npm run build; $env:NUMDRAW_ALLOW_UNCONFIGURED_BUILD=$null
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

/* ── 1) 증서 검증 공개키 ── */
try {
  const pubkey = require(join(ROOT, 'electron/license/pubkey.js'));
  if (pubkey.isPlaceholder()) {
    errors.push(
      '공개키가 아직 자리표시자입니다 (electron/license/pubkey.js 의 PUBLIC_KEY).\n' +
        '     → server 폴더에서 `npm run genkeys` 실행 후 출력된 공개키를 붙여넣으세요.'
    );
  } else if (!pubkey.getKeyObject()) {
    // getKeyObject()가 null이면 값은 들어갔는데 Ed25519 키로 파싱되지 않는다는 뜻
    errors.push(
      '공개키 값이 Ed25519 키로 해석되지 않습니다 (electron/license/pubkey.js).\n' +
        '     → genkeys 출력값을 줄바꿈·따옴표 없이 그대로 붙여넣었는지 확인하세요.'
    );
  }
} catch (e) {
  errors.push('electron/license/pubkey.js 를 읽을 수 없습니다: ' + e.message);
}

/* ── 2) 활성화 서버 주소 · 지원 연락처 ── */
try {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'electron/license/config.json'), 'utf8'));

  const url = String(cfg.activationUrl || '').trim();
  if (!url) {
    errors.push(
      'activationUrl 이 비어 있습니다 (electron/license/config.json).\n' +
        '     → `npm run deploy` 후 출력된 주소 + "/api/activate" 를 넣으세요.'
    );
  } else if (!url.startsWith('https://')) {
    // http로 나가면 키와 증서가 평문으로 흐른다
    errors.push('activationUrl 은 https:// 로 시작해야 합니다 (현재: ' + url + ')');
  } else if (!url.includes('/api/activate')) {
    warnings.push('activationUrl 에 /api/activate 경로가 없습니다 (현재: ' + url + ')');
  }

  if (!String(cfg.supportContact || '').trim()) {
    // 활성화 실패 안내 문구에 붙는 값 — 비어 있으면 구매자가 연락할 곳을 못 찾는다
    warnings.push('supportContact 가 비어 있습니다 — 활성화 실패 시 문의처가 표시되지 않습니다.');
  }

  if (cfg.enforceKeyChecksum !== true) {
    warnings.push('enforceKeyChecksum 이 true 가 아닙니다 — 오타 키가 서버까지 전달됩니다.');
  }
} catch (e) {
  errors.push('electron/license/config.json 을 읽을 수 없습니다: ' + e.message);
}

/* ── 3) 개인키가 설치파일에 섞여 들어가는지 ── */
try {
  const pubSrc = readFileSync(join(ROOT, 'electron/license/pubkey.js'), 'utf8');
  if (pubSrc.includes('BEGIN PRIVATE KEY') || pubSrc.includes('BEGIN EC PRIVATE KEY')) {
    errors.push(
      'pubkey.js 안에 개인키로 보이는 문자열이 있습니다. 개인키는 Cloudflare Secret 에만 두세요.\n' +
        '     → asar:false 라서 설치 폴더의 이 파일은 구매자가 그대로 열어볼 수 있습니다.'
    );
  }
} catch {
  /* 위 1)에서 이미 보고됨 */
}

/* ── 결과 출력 ── */
const BAR = '─'.repeat(62);

for (const w of warnings) console.warn('  ⚠ ' + w);

if (errors.length === 0) {
  if (warnings.length) console.warn('');
  console.log('✓ 라이선스 배포 설정 확인 완료 — 빌드를 진행합니다.');
  process.exit(0);
}

const bypass = process.env.NUMDRAW_ALLOW_UNCONFIGURED_BUILD === '1';

console.error('\n' + BAR);
console.error(bypass ? '  라이선스 설정 미완료 (강제 진행 중)' : '  빌드 중단 — 라이선스 설정이 완료되지 않았습니다');
console.error(BAR);
for (const e of errors) console.error('  ✕ ' + e);
console.error(BAR);

if (bypass) {
  console.error('  NUMDRAW_ALLOW_UNCONFIGURED_BUILD=1 이 설정되어 그대로 진행합니다.');
  console.error('  ⚠ 이 설치파일로는 아무도 정품 인증을 할 수 없습니다 (전원 체험판).');
  console.error('     판매용으로 배포하지 마세요.');
  console.error(BAR + '\n');
  process.exit(0);
}

console.error('  이 상태로 만든 설치파일은 구매자 전원이 활성화에 실패하고 체험판으로 동작합니다.');
console.error('  체험판 배포본을 일부러 만드는 것이라면 (PowerShell):');
console.error('     $env:NUMDRAW_ALLOW_UNCONFIGURED_BUILD=1');
console.error('     npm run build');
console.error('     $env:NUMDRAW_ALLOW_UNCONFIGURED_BUILD=$null    ← 끝나면 반드시 해제');
console.error(BAR + '\n');
process.exit(1);
