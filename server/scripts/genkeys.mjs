#!/usr/bin/env node
// Ed25519 서명 키쌍 생성 스크립트.
// 실행: cd server && npm run genkeys   (또는 node scripts/genkeys.mjs)
//
// 공개키는 앱에 내장해도 안전하다 (서명 검증 전용).
// 개인키는 절대 저장소에 커밋하지 말고 Cloudflare Workers Secret에만 넣는다.

import { toBase64Url } from '../src/core/cert.js';

async function main() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ]);

  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  const privPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));

  const pubB64 = toBase64Url(pubRaw);
  const privB64 = toBase64Url(privPkcs8);

  console.log('=================================================================');
  console.log(' NumDraw 활성화 서버 — Ed25519 키쌍 생성 완료');
  console.log('=================================================================');
  console.log('');
  console.log('[공개키] — 앱에 내장한다. 유출돼도 안전하다 (검증 전용).');
  console.log('  넣을 위치: electron/license/pubkey.js  (license-core 담당 파일)');
  console.log('');
  console.log('  ' + pubB64);
  console.log('');
  console.log('-----------------------------------------------------------------');
  console.log('');
  console.log('[개인키] — 서명 전용, 반드시 비밀로 유지한다. 저장소에 절대 커밋하지 않는다.');
  console.log('  넣을 위치: Cloudflare Workers Secret (CERT_PRIVATE_KEY)');
  console.log('');
  console.log('  ' + privB64);
  console.log('');
  console.log('-----------------------------------------------------------------');
  console.log('');
  console.log('다음 할 일:');
  console.log('  1) electron/license/pubkey.js 의 PUBLIC_KEY 값을 아래 줄로 교체한다.');
  console.log("     const PUBLIC_KEY = '" + pubB64 + "';");
  console.log('  2) 개인키를 Secret으로 등록한다 (server/ 폴더에서 실행):');
  console.log('       npx wrangler secret put CERT_PRIVATE_KEY');
  console.log('     프롬프트가 뜨면 위 [개인키] 값을 붙여넣는다. 다른 곳에 저장하지 않는다.');
  console.log('  3) 이 명령을 실행한 터미널의 스크롤백(기록)을 지운다 — 개인키가 화면에 남는다.');
  console.log('  4) 관리자 토큰도 같은 방식으로 등록한다:');
  console.log('       npx wrangler secret put ADMIN_TOKEN');
  console.log('     (예: openssl rand -hex 16 같은 임의의 긴 문자열)');
  console.log('=================================================================');
}

main().catch((err) => {
  console.error('키 생성 실패:', err);
  process.exit(1);
});
