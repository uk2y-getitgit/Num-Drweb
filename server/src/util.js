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

/**
 * 관리자 엔드포인트 보호 — 브라우저 기본 Basic Auth 팝업을 그대로 이용한다.
 * 비개발자 운영자가 헤더를 직접 만들 필요 없이, 브라우저가 뜬 로그인창에
 * (아이디는 아무거나, 비밀번호에 ADMIN_TOKEN)을 입력하면 된다.
 */
export function requireAdmin(request, env, handler) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ') && env.ADMIN_TOKEN) {
    try {
      const decoded = atob(auth.slice(6));
      const idx = decoded.indexOf(':');
      const pass = idx >= 0 ? decoded.slice(idx + 1) : decoded;
      if (timingSafeEqual(pass, env.ADMIN_TOKEN)) {
        return handler();
      }
    } catch {
      // 아래 401로 낙하
    }
  }
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="NumDraw Admin"' },
  });
}
