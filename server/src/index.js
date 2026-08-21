// Quickspect 활성화 서버 — Cloudflare Workers 진입점 (라우팅만 담당)
// 순수 로직은 src/core/*, 요청 처리는 src/routes/* 에 있다.

import { handleActivate } from './routes/activate.js';
import {
  handleAdminIssueForm,
  handleAdminIssueSubmit,
  handleAdminList,
  handleAdminRevoke,
  handleAdminRelease,
} from './routes/admin.js';
import { requireAdmin, jsonResponse } from './util.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      // CORS 헤더를 붙이지 않는다. 활성화 요청은 Electron **메인 프로세스**의 Node fetch로만
      // 나가며(electron/license/activate.js), 그 경로에는 오리진 개념도 프리플라이트도 없다.
      // 예전 버전은 'access-control-allow-origin: *' 를 달아 임의의 웹페이지가 방문자 브라우저로
      // 활성화를 시도하고 응답 증서까지 읽을 수 있었다 — 쓰지 않는 권한이므로 제거한다. L-5 수정.
      if (pathname === '/api/activate' && method === 'POST') {
        return await handleActivate(request, env);
      }

      if (pathname === '/admin/issue' && method === 'GET') {
        return await requireAdmin(request, env, () => handleAdminIssueForm());
      }
      if (pathname === '/admin/issue' && method === 'POST') {
        return await requireAdmin(request, env, () => handleAdminIssueSubmit(request, env));
      }
      if (pathname === '/admin/list' && method === 'GET') {
        return await requireAdmin(request, env, () => handleAdminList(env));
      }
      if (pathname === '/admin/revoke' && method === 'POST') {
        return await requireAdmin(request, env, () => handleAdminRevoke(request, env));
      }
      if (pathname === '/admin/release' && method === 'POST') {
        return await requireAdmin(request, env, () => handleAdminRelease(request, env));
      }

      if (pathname === '/' || pathname === '/health') {
        return new Response('Quickspect activation server OK', { status: 200 });
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.error('unhandled error:', err && err.message);
      return jsonResponse(
        { ok: false, code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' },
        500
      );
    }
  },
};
