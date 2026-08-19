// 플랫폼 비의존 순수 JS — 활성화 증서(Ed25519) 서명 · 검증
// 브라우저 / Node / Cloudflare Workers 어디서나 동일하게 동작한다 (Web Crypto만 사용).
//
// 증서 포맷: base64url(payload JSON) + "." + base64url(Ed25519 서명)
// 키 인코딩: 공개키 = raw 32바이트, 개인키 = pkcs8 DER — 둘 다 base64url 문자열로 다룬다.
//   (server/scripts/genkeys.mjs 가 이 인코딩으로 키쌍을 생성한다)
//
// docs/archive/유료화_Phase1_구현계획.md 3장 payload 스펙 그대로.

const ALG = { name: 'Ed25519' };

export function toBase64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** pkcs8(base64url) 개인키 문자열 → CryptoKey (서명 전용) */
export async function importPrivateKey(pkcs8Base64Url) {
  return crypto.subtle.importKey('pkcs8', fromBase64Url(pkcs8Base64Url), ALG, false, ['sign']);
}

/** raw(base64url) 공개키 문자열 → CryptoKey (검증 전용) */
export async function importPublicKey(rawBase64Url) {
  return crypto.subtle.importKey('raw', fromBase64Url(rawBase64Url), ALG, false, ['verify']);
}

/** payload 객체에 서명해 증서 문자열을 만든다 */
export async function signCertificate(payload, privateKey) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign(ALG, privateKey, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sig))}`;
}

/** 증서 문자열을 검증하고 payload를 반환한다. 검증 실패 시 null. */
export async function verifyCertificate(cert, publicKey) {
  if (typeof cert !== 'string') return null;
  const dot = cert.indexOf('.');
  if (dot < 0) return null;
  const payloadPart = cert.slice(0, dot);
  const sigPart = cert.slice(dot + 1);
  let payloadBytes, sigBytes;
  try {
    payloadBytes = fromBase64Url(payloadPart);
    sigBytes = fromBase64Url(sigPart);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(ALG, publicKey, sigBytes, payloadBytes);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
}

/**
 * payload를 계획서 3장 스펙대로 구성해 서명까지 한 번에 수행한다.
 * device / keyId는 호출측(라우트)에서 검증된 값을 넘긴다.
 */
export async function issueCertificate({ deviceHash, keyId, privateKey, features }) {
  const payload = {
    v: 1,
    product: 'numdraw',
    edition: 'full',
    device: deviceHash,
    key_id: keyId,
    issued_at: new Date().toISOString(),
    features: features || { watermark: false, maxPages: 0 },
  };
  return signCertificate(payload, privateKey);
}
