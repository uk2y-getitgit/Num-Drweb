// Workers 어댑터 계층의 공용 헬퍼 (플랫폼 의존 — core/에 넣지 않는다)

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- 관리자 인증 방어 (M-2) --------------------------------------------------
//
// ADMIN_TOKEN 하나가 발급 백오피스 전체(키 발급·대장 열람·정지)를 지키므로,
// 짧은 토큰과 무제한 추측 시도를 둘 다 막는다.
//
// 1) 최소 길이 — 운영자가 'admin1234' 같은 값을 넣으면 관리자 화면을 아예 열지 않는다.
//    약한 토큰으로 서비스하느니 503으로 막고 재설정을 강제하는 편이 안전하다.
// 2) 실패 잠금 — IP당 실패 횟수를 세어 한도를 넘으면 자격증명 검사 전에 429로 끊는다.
//    성공하면 카운터를 즉시 비운다(정상 운영자가 오타 한 번으로 잠기지 않도록).
//
// activate.js의 rate limit과 같은 한계를 공유한다: isolate 메모리 기반이라
// 콜드스타트·엣지 분산 시 초기화되는 최선노력(best-effort) 방어다. 판매 규모가 커지면
// D1/KV 기반으로 옮겨야 한다. 토큰 최소 길이 검사는 이 한계와 무관하게 항상 유효하다.

const MIN_ADMIN_TOKEN_LEN = 24;
const ADMIN_MAX_FAILS = 8;
const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;
const ADMIN_BUCKET_CAP = 1000; // 메모리 무한 증식 방지

const adminFailBuckets = new Map();

function pruneAdminBuckets(now) {
  for (const [ip, b] of adminFailBuckets) {
    if (now > b.resetAt) adminFailBuckets.delete(ip);
  }
  // 만료 정리 후에도 넘치면(분산 스캔 등) 오래된 것부터 버린다 — Map은 삽입 순서를 유지한다
  while (adminFailBuckets.size > ADMIN_BUCKET_CAP) {
    adminFailBuckets.delete(adminFailBuckets.keys().next().value);
  }
}

function isAdminLocked(ip, now) {
  const b = adminFailBuckets.get(ip);
  if (!b || now > b.resetAt) return false;
  return b.fails >= ADMIN_MAX_FAILS;
}

function recordAdminFailure(ip, now) {
  const b = adminFailBuckets.get(ip);
  if (!b || now > b.resetAt) {
    adminFailBuckets.set(ip, { fails: 1, resetAt: now + ADMIN_LOCKOUT_MS });
  } else {
    b.fails++;
  }
  if (adminFailBuckets.size > ADMIN_BUCKET_CAP) pruneAdminBuckets(now);
}

let _tokenWarned = false;

/**
 * Basic Auth 헤더에서 비밀번호를 꺼낸다.
 *
 * atob()는 Latin-1 바이트 문자열을 돌려줄 뿐 UTF-8 디코드를 하지 않는다. 브라우저는
 * 비밀번호를 UTF-8 바이트로 인코딩해 보내므로, 한글 등 비ASCII 토큰을 그냥 비교하면
 * **절대 일치하지 않는다** — 운영자는 원인 모를 401을 반복하다 8회 만에 스스로 잠긴다.
 * 그래서 바이트로 되돌린 뒤 UTF-8로 디코드한다. 2차 검수 L-10.
 */
function extractBasicPassword(authHeader) {
  const binary = atob(authHeader.slice(6));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const decoded = new TextDecoder('utf-8').decode(bytes);
  const idx = decoded.indexOf(':');
  return idx >= 0 ? decoded.slice(idx + 1) : decoded;
}

/**
 * 교차 사이트 상태 변경 요청(CSRF) 차단 — 관리자 POST 전용. 2차 검수 M-7.
 *
 * 관리자 인증이 Basic Auth라 SameSite 쿠키 보호가 원리적으로 적용되지 않는다.
 * 운영자가 관리 화면에 로그인한 브라우저로 공격자 페이지를 열면, 숨은 폼 하나로
 * /admin/release(좌석 무단 반납 = 2대 제한 우회)나 /admin/revoke(정상 고객 정지)를
 * 대신 실행시킬 수 있다. 폼 POST는 단순요청이라 L-5의 CORS 제거로는 막히지 않는다
 * (응답을 못 읽을 뿐 상태 변경은 이미 일어난다).
 *
 * 판정 기준:
 *   - Sec-Fetch-Site가 same-origin/none이 아니면 거부 (Chrome·Edge·Firefox 모두 전송)
 *   - Origin 헤더가 있는데 요청 호스트와 다르면 거부
 *   - 두 헤더가 모두 없으면 통과 — curl 같은 도구는 브라우저 자격증명을 자동으로
 *     붙이지 않으므로 CSRF 경로가 아니다. 구형 브라우저 호환도 겸한다.
 */
function isCrossSiteWrite(request) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return true;

  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) return true;
    } catch {
      return true; // 파싱 불가한 Origin은 신뢰하지 않는다
    }
  }
  return false;
}

/**
 * 관리자 엔드포인트 보호 — 브라우저 기본 Basic Auth 팝업을 그대로 이용한다.
 * 비개발자 운영자가 헤더를 직접 만들 필요 없이, 브라우저가 뜬 로그인창에
 * (아이디는 아무거나, 비밀번호에 ADMIN_TOKEN)을 입력하면 된다.
 */
export function requireAdmin(request, env, handler) {
  const token = typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';

  if (token.length < MIN_ADMIN_TOKEN_LEN) {
    if (!_tokenWarned) {
      _tokenWarned = true;
      console.error(
        `ADMIN_TOKEN이 없거나 너무 짧습니다(최소 ${MIN_ADMIN_TOKEN_LEN}자). ` +
          '관리자 화면을 비활성화했습니다. `npx wrangler secret put ADMIN_TOKEN`으로 재설정하세요.'
      );
    }
    return new Response(
      `관리자 화면이 비활성화되어 있습니다. ADMIN_TOKEN을 ${MIN_ADMIN_TOKEN_LEN}자 이상으로 설정하세요.`,
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }
    );
  }

  // 인증보다 먼저 본다 — 교차 사이트 요청은 자격증명이 유효해도 실행하면 안 된다
  if (request.method === 'POST' && isCrossSiteWrite(request)) {
    return new Response('교차 사이트 요청은 처리하지 않습니다.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now();

  if (isAdminLocked(ip, now)) {
    return new Response('로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.', {
      status: 429,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'retry-after': String(Math.ceil(ADMIN_LOCKOUT_MS / 1000)),
      },
    });
  }

  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const pass = extractBasicPassword(auth);
      if (timingSafeEqual(pass, token)) {
        adminFailBuckets.delete(ip);
        return handler();
      }
    } catch {
      // 아래 401로 낙하
    }
  }

  recordAdminFailure(ip, now);
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="NumDraw Admin"' },
  });
}
