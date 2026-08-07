// NumDraw 활성화 서버 — Cloudflare Workers 진입점 (라우팅만 담당)
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

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    try {
      // 활성화 엔드포인트는 Electron 렌더러(app:// 오리진)에서 직접 fetch할 가능성을
      // 배제할 수 없어 CORS를 허용한다. 세션/쿠키를 쓰지 않으므로 * 허용이 안전하다.
      if (pathname === '/api/activate' && method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      if (pathname === '/api/activate' && method === 'POST') {
        const res = await handleActivate(request, env);
        const withCors = new Response(res.body, res);
        for (const [k, v] of Object.entries(CORS_HEADERS)) withCors.headers.set(k, v);
        return withCors;
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
        return new Response('NumDraw activation server OK', { status: 200 });
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
