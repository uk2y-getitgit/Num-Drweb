// 관리자(발급 백오피스) 라우트 — 비개발자 운영자가 브라우저만으로 쓸 수 있게 만든 화면.
// 인증은 index.js에서 requireAdmin()으로 감싸 처리한다 (Basic Auth, 브라우저 기본 팝업).

import { generateLicenseKey, parseAndValidate, keyHash, maskKey } from '../core/keygen.js';
import { htmlResponse, escapeHtml } from '../util.js';

const PAGE_STYLE = `
  body { font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; background:#f4f4f6; color:#1a1a1f; margin:0; padding:32px; }
  .wrap { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .sub { color:#666; font-size: 13px; margin-bottom: 24px; }
  .card { background:#fff; border:1px solid #e2e2e8; border-radius:10px; padding:24px; margin-bottom:20px; }
  label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
  input[type=text], input[type=email], input[type=number] {
    width:100%; box-sizing:border-box; padding:9px 10px; border:1px solid #d4d4dc; border-radius:6px; font-size:14px;
  }
  button, .btn { background:#5B5BD6; color:#fff; border:none; border-radius:6px; padding:9px 16px; font-size:14px; cursor:pointer; text-decoration:none; display:inline-block; }
  button.danger, .btn.danger { background:#D93025; }
  button.ghost, .btn.ghost { background:#eceef4; color:#333; }
  table { width:100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align:left; padding: 8px 10px; border-bottom: 1px solid #ececf1; vertical-align: top; }
  th { color:#666; font-weight:600; }
  .masked { font-family: Consolas, monospace; }
  .status-active { color:#2D9E6B; font-weight:600; }
  .status-revoked { color:#D93025; font-weight:600; }
  .device-row { font-size:12px; color:#555; margin-bottom:4px; display:flex; align-items:center; gap:8px; }
  .device-hash { font-family: Consolas, monospace; }
  .keybox { font-family: Consolas, monospace; font-size: 20px; letter-spacing: 1px; background:#f4f4f6; border:1px dashed #999; border-radius:8px; padding:16px; text-align:center; margin:16px 0; }
  .warn { background:#fff7e6; border:1px solid #ecd48a; color:#8a6100; border-radius:8px; padding:12px 16px; font-size:13px; }
  form.inline { display:inline; }
  .topnav { margin-bottom: 16px; font-size: 13px; }
  .topnav a { color:#5B5BD6; text-decoration:none; margin-right: 16px; }
`;

function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Quickspect 관리</title>
<style>${PAGE_STYLE}</style></head>
<body><div class="wrap">
<div class="topnav"><a href="/admin/issue">키 발급</a><a href="/admin/list">발급 대장</a></div>
${bodyHtml}
</div></body></html>`;
}

// ---- GET /admin/issue ----------------------------------------------------

export async function handleAdminIssueForm() {
  return htmlResponse(
    layout(
      '키 발급',
      `
    <h1>새 라이선스 키 발급</h1>
    <div class="sub">입금 확인 후에만 발급하세요. 발급된 키는 이 화면을 벗어나면 다시 볼 수 없습니다.</div>
    <div class="card">
      <form method="post" action="/admin/issue">
        <label>구매자 이름</label>
        <input type="text" name="buyer_name" placeholder="홍길동">
        <label>이메일</label>
        <input type="email" name="buyer_email" placeholder="buyer@example.com">
        <label>메모 (입금일·금액 등)</label>
        <input type="text" name="memo" placeholder="2026-08-07 입금확인, 99,000원">
        <label>최대 활성화 대수</label>
        <input type="number" name="max_seats" value="2" min="1" max="10">
        <div style="margin-top:20px;"><button type="submit">키 발급</button></div>
      </form>
    </div>
  `
    )
  );
}

// ---- POST /admin/issue -----------------------------------------------------

export async function handleAdminIssueSubmit(request, env) {
  const form = await request.formData();
  const buyerName = String(form.get('buyer_name') || '').trim();
  const buyerEmail = String(form.get('buyer_email') || '').trim();
  const memo = String(form.get('memo') || '').trim();
  // 폼의 min/max는 클라이언트 힌트일 뿐이라 서버에서 다시 가둔다.
  // 상한이 없으면 운영자 오타(20 → 200) 한 번으로 좌석 제한이 사실상 사라진다. 2차 검수 L-18.
  const MAX_SEATS_LIMIT = 10;
  let maxSeats = parseInt(form.get('max_seats'), 10);
  if (!Number.isInteger(maxSeats) || maxSeats < 1) maxSeats = 2;
  if (maxSeats > MAX_SEATS_LIMIT) maxSeats = MAX_SEATS_LIMIT;

  let displayKey = null;
  let hash, masked;
  for (let attempt = 0; attempt < 5 && !displayKey; attempt++) {
    const candidate = generateLicenseKey();
    const parsed = parseAndValidate(candidate);
    // generateLicenseKey는 항상 유효한 키를 만들지만, 확인 없이 .normalized를 쓰면
    // 생성기가 깨졌을 때 undefined가 그대로 sha256("undefined")로 해싱돼
    // 모든 구매자에게 같은 key_hash가 박힌다. 값이 이상하면 발급하지 않는다. L-8 수정.
    if (!parsed.valid) continue;
    const h = await keyHash(parsed.normalized);
    const exists = await env.DB.prepare('SELECT 1 FROM licenses WHERE key_hash = ?')
      .bind(h)
      .first();
    if (!exists) {
      displayKey = candidate;
      hash = h;
      masked = maskKey(candidate);
    }
  }

  if (!displayKey) {
    return htmlResponse(
      layout('발급 실패', `<h1>키 발급 실패</h1><p>키 생성 충돌이 반복되었습니다. 다시 시도해 주세요.</p>`),
      500
    );
  }

  const issuedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO licenses (key_hash, key_masked, buyer_name, buyer_email, memo, max_seats, status, issued_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
  )
    .bind(hash, masked, buyerName || null, buyerEmail || null, memo || null, maxSeats, issuedAt)
    .run();

  return htmlResponse(
    layout(
      '발급 완료',
      `
    <h1>키가 발급되었습니다</h1>
    <div class="warn">이 화면을 벗어나면 평문 키를 다시 볼 수 없습니다. 지금 복사해 구매자에게 전달하세요.</div>
    <div class="keybox">${escapeHtml(displayKey)}</div>
    <table>
      <tr><th>구매자</th><td>${escapeHtml(buyerName || '-')} ${buyerEmail ? `(${escapeHtml(buyerEmail)})` : ''}</td></tr>
      <tr><th>메모</th><td>${escapeHtml(memo || '-')}</td></tr>
      <tr><th>최대 대수</th><td>${maxSeats}대</td></tr>
      <tr><th>대장 표기</th><td class="masked">${escapeHtml(masked)}</td></tr>
    </table>
    <div style="margin-top:20px;">
      <a class="btn" href="/admin/issue">다른 키 발급</a>
      <a class="btn ghost" href="/admin/list">발급 대장 보기</a>
    </div>
  `
    )
  );
}

// ---- GET /admin/list --------------------------------------------------------

export async function handleAdminList(env) {
  const licenses = await env.DB.prepare(
    'SELECT * FROM licenses ORDER BY issued_at DESC'
  ).all();
  const activations = await env.DB.prepare(
    'SELECT * FROM activations WHERE released_at IS NULL ORDER BY activated_at DESC'
  ).all();

  const byKey = new Map();
  for (const a of activations.results || []) {
    if (!byKey.has(a.key_hash)) byKey.set(a.key_hash, []);
    byKey.get(a.key_hash).push(a);
  }

  const rows = (licenses.results || [])
    .map((lic) => {
      const acts = byKey.get(lic.key_hash) || [];
      const statusHtml =
        lic.status === 'active'
          ? '<span class="status-active">사용중</span>'
          : '<span class="status-revoked">정지됨</span>';

      const deviceRows = acts
        .map(
          (a) => `
        <div class="device-row">
          <span class="device-hash">${escapeHtml(a.device_hash.slice(0, 10))}…</span>
          <span>${escapeHtml(a.activated_at)}</span>
          <form class="inline" method="post" action="/admin/release" onsubmit="return confirm('이 기기의 좌석을 반납할까요?');">
            <input type="hidden" name="key_hash" value="${escapeHtml(lic.key_hash)}">
            <input type="hidden" name="activation_id" value="${a.id}">
            <button type="submit" class="ghost" style="padding:2px 8px; font-size:11px;">반납</button>
          </form>
        </div>`
        )
        .join('');

      const revokeForm =
        lic.status === 'active'
          ? `
        <form class="inline" method="post" action="/admin/revoke" onsubmit="return confirm('이 키를 정지할까요? 이후 활성화 요청이 모두 거부됩니다.');">
          <input type="hidden" name="key_hash" value="${escapeHtml(lic.key_hash)}">
          <button type="submit" class="danger" style="font-size:12px; padding:6px 10px;">정지</button>
        </form>`
          : '';

      return `
      <tr>
        <td class="masked">${escapeHtml(lic.key_masked)}</td>
        <td>${escapeHtml(lic.buyer_name || '-')}<br><span style="color:#888">${escapeHtml(lic.buyer_email || '')}</span></td>
        <td>${escapeHtml(lic.memo || '-')}</td>
        <td>${acts.length} / ${lic.max_seats}</td>
        <td>${statusHtml}</td>
        <td>${escapeHtml(lic.issued_at)}</td>
        <td>${deviceRows || '<span style="color:#aaa">활성화된 기기 없음</span>'}</td>
        <td>${revokeForm}</td>
      </tr>`;
    })
    .join('');

  return htmlResponse(
    layout(
      '발급 대장',
      `
    <h1>라이선스 발급 대장</h1>
    <div class="sub">총 ${licenses.results?.length || 0}건</div>
    <div class="card" style="overflow-x:auto;">
      <table>
        <thead><tr>
          <th>키</th><th>구매자</th><th>메모</th><th>좌석</th><th>상태</th><th>발급일</th><th>활성 기기 (반납)</th><th>정지</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="color:#aaa">발급된 키가 없습니다</td></tr>'}</tbody>
      </table>
    </div>
  `
    )
  );
}

// ---- POST /admin/revoke ------------------------------------------------------

export async function handleAdminRevoke(request, env) {
  const form = await request.formData();
  const hash = String(form.get('key_hash') || '');
  if (hash) {
    await env.DB.prepare("UPDATE licenses SET status = 'revoked' WHERE key_hash = ?")
      .bind(hash)
      .run();
  }
  return new Response(null, { status: 303, headers: { Location: '/admin/list' } });
}

// ---- POST /admin/release ------------------------------------------------------

export async function handleAdminRelease(request, env) {
  const form = await request.formData();
  const hash = String(form.get('key_hash') || '');
  const activationId = parseInt(form.get('activation_id'), 10);
  if (hash && Number.isInteger(activationId)) {
    await env.DB.prepare(
      'UPDATE activations SET released_at = ? WHERE id = ? AND key_hash = ? AND released_at IS NULL'
    )
      .bind(new Date().toISOString(), activationId, hash)
      .run();
  }
  return new Response(null, { status: 303, headers: { Location: '/admin/list' } });
}
