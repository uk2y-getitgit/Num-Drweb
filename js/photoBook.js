/* photoBook.js — 외관조사 사진첩 생성
   순서의 기준은 도면이 아니라 외관집계표 행 순서다 (옥상 → 지상 → 지하 → 외부).
   집계표 각 행에서 라벨(1F-01)을 만들고, 넘버링·사진 파일과 3자 대조한 뒤
   A4 6칸 격자로 그린다. 색상 리터럴은 캔버스 렌더라 CSS 변수를 쓸 수 없다. */
'use strict';

const PhotoBook = (() => {
  /* A4 세로 150dpi — pageManager.js 와 같은 기준 */
  const A4    = { w: 1240, h: 1754 };
  const PT2PX = A4.w / 595.28;      // 1pt → px (A4 폭 595.28pt)
  const MM2PT = 72 / 25.4;

  /* 엑셀 사진첩 시트 실측 격자 (단위: pt)
     열너비 문자수 → px(96dpi) → pt 로 환산한 값이다.
     A열 7.75자 = 59.25px = 44.44pt / B~G 6.625자 × 6 = 308.25px = 231.19pt */
  const G = {
    marginX:     13 * MM2PT,   // 좌우 여백 13mm (엑셀 페이지 설정)
    marginY:      4 * MM2PT,   // 상하 여백 4mm
    titleH:      30,           // 표제(용역명) 행 30pt
    rowH:        18.95,        // 본문 행 높이
    labelW:      44.44,        // 번호 열
    photoW:     231.19,        // 사진 열
    photoRows:   12,
    captionRows:  2,
    pad:          1 * MM2PT,   // 사진 여백 1mm (엑셀 margin 2.835pt)
  };
  const COLS      = 2;
  const ROWS      = 3;
  const PER_PAGE  = COLS * ROWS;   // 6칸 고정

  /* ── 상태 ── */
  let rows       = [];     // 집계표 행 [{ no, loc, floorKey, label, caption, note }]
  let sourceInfo = null;   // { fileName, sheet, captionCol, count, composed }

  /* ═══════════════════════ 집계표 파싱 ═══════════════════════ */

  /* 조사위치 → 층키 역변환 (VBA IsMatchFloorFixed 의 역방향)
     '지상1층'→'1F' / '지하1층'→'B1F' / '옥상층'→'RF' / '외부'→'W' */
  function floorKeyOf(loc) {
    const s = String(loc == null ? '' : loc).replace(/\s+/g, '');
    if (!s) return null;
    if (/외부|외벽/.test(s))   return 'W';
    if (/옥상|지붕/.test(s))   return 'RF';
    const b = s.match(/지하(\d+)/);
    if (b) return 'B' + Number(b[1]) + 'F';
    const g = s.match(/지상(\d+)/) || s.match(/^(\d+)층/);
    if (g) return Number(g[1]) + 'F';
    return null;
  }

  function labelOf(floorKey, no) {
    return floorKey + '-' + String(no).padStart(2, '0');
  }

  /* P열이 비어 있을 때의 대비책 — 엑셀 P열 수식과 같은 규칙으로 직접 조합 */
  function _composeCaption(r) {
    const dim = [r.w, r.l, r.d].filter(v => Number(v) > 0);
    const size = dim.length ? ' (' + dim.join('x') + ')' : '';
    const note = String(r.note || '').trim();
    const isNew = /신규/.test(note);
    const tail  = (note && !isNew) ? ' (' + note + ')' : '';
    return (isNew ? '(신규) ' : '') +
           [r.loc, r.part, r.damage].filter(Boolean).join(' ') + size + tail;
  }

  /* 집계표 파일 읽기 — .xlsx / .xlsm / .csv */
  async function loadSummary(file) {
    if (typeof XLSX === 'undefined') throw new Error('SheetJS 로드 중입니다. 잠시 후 다시 시도해주세요');

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array' });

    /* '외관집계표' 시트 우선, 없으면 첫 시트 */
    const sheet = wb.SheetNames.find(n => n.replace(/\s+/g, '').includes('외관집계표')) || wb.SheetNames[0];
    const aoa   = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: false });

    /* 데이터 시작 행 탐지 — A열이 1이고 B열이 층 표기인 첫 행 */
    let start = aoa.findIndex(r => r && Number(r[0]) === 1 && floorKeyOf(r[1]));
    if (start === -1) throw new Error('집계표에서 데이터 시작 행을 찾지 못했습니다 (A열 번호 + B열 조사위치 확인)');

    const CAP = 15;   // P열 (0-based)
    const body = aoa.slice(start);
    const hasP = body.some(r => String(r[CAP] || '').trim());

    const out = [];
    body.forEach(r => {
      const no  = Number(r[0]);
      const key = floorKeyOf(r[1]);
      if (!no || no < 1 || !key) return;         // 빈 행·합계 행은 건너뛴다
      const row = {
        no, loc: String(r[1]).trim(), floorKey: key,
        part:   String(r[2] || '').trim(),
        damage: String(r[3] || '').trim(),
        w: r[4], l: r[5], d: r[6],
        note:   String(r[13] || '').trim(),      // N열 비고
      };
      row.label   = labelOf(key, no);
      row.caption = hasP ? String(r[CAP] || '').trim() : _composeCaption(row);
      if (!row.caption) row.caption = _composeCaption(row);
      out.push(row);
    });

    if (!out.length) throw new Error('집계표에서 유효한 결함 행을 찾지 못했습니다');

    rows = out;
    sourceInfo = {
      fileName: file.name, sheet, count: out.length,
      captionCol: hasP ? 'P' : '조합', composed: !hasP,
    };
    return sourceInfo;
  }

  function getSummary()  { return rows; }
  function getSource()   { return sourceInfo; }
  function hasSummary()  { return rows.length > 0; }
  function clearSummary() { rows = []; sourceInfo = null; }

  /* ═══════════════════════ 3자 대조 ═══════════════════════ */

  /* 전 페이지 넘버링 라벨 수집 → Map(label → 페이지이름) */
  function _numberingLabels() {
    const map = new Map();
    if (typeof PageManager === 'undefined') return map;
    PageManager.saveCurrentPageState();
    PageManager.getPages().forEach(page => {
      if (!page.annJSON) return;
      let items;
      try { items = JSON.parse(page.annJSON).items || []; } catch { return; }
      const pfx = page.prefix || '';
      const put = e => {
        if (e.num == null) return;
        map.set(labelOf(pfx, e.num), page.name);
      };
      items.forEach(i => {
        if (i.noNum) return;                       // 해치 도형은 번호가 없다
        put(i);
        if (i.merged) i.merged.forEach(put);
        if (i.labels) i.labels.forEach(put);
      });
    });
    return map;
  }

  function _baseName(n) { return String(n).replace(/\.[^.]+$/, '').toLowerCase(); }

  /* 집계표 순서대로 항목 조립 + 미매칭 3종 분류 */
  function collectEntries() {
    const photos = (typeof FileManager !== 'undefined') ? FileManager.getPhotos() : [];
    const numMap = _numberingLabels();
    const used   = new Set();

    const entries     = [];
    const noPhoto     = [];   // 번호는 있는데 사진 파일이 없음
    const noNumbering = [];   // 집계표에만 있고 도면에 없음
    const orphan      = [];   // 도면에만 있고 집계표에 없음

    rows.forEach(r => {
      const base  = FileManager.extractPhotoName(r.label);   // '1F-01' → '101'
      const photo = photos.find(p => _baseName(p.name) === base.toLowerCase()) || null;
      const inDwg = numMap.has(r.label);

      if (inDwg) used.add(r.label);
      if (!photo) noPhoto.push(r.label);
      if (!inDwg) noNumbering.push(r.label);

      entries.push({
        label:   r.label,
        caption: r.caption,
        photo,                       // { name, handle } | null
        fileBase: base,
        inDrawing: inDwg,
      });
    });

    numMap.forEach((pageName, label) => {
      if (!used.has(label)) orphan.push(label);
    });

    return { entries, report: { noPhoto, noNumbering, orphan, total: entries.length } };
  }

  /* ═══════════════════════ 레이아웃 ═══════════════════════ */

  /* 엑셀 격자를 A4 안에 균일 배율로 앉힌다 (가로·세로 중 더 빡빡한 쪽 기준, 상단 정렬) */
  function layout() {
    const blockH  = (G.photoRows + G.captionRows) * G.rowH;   // 한 칸 높이 (14행)
    const halfW   = G.labelW + G.photoW;                      // 한 칸 너비
    const natW    = halfW * COLS;
    const natH    = G.titleH + blockH * ROWS;

    const availW  = (A4.w - 2 * G.marginX * PT2PX) / PT2PX;
    const availH  = (A4.h - 2 * G.marginY * PT2PX) / PT2PX;
    const s       = Math.min(availW / natW, availH / natH) * PT2PX;   // pt → px 배율

    const gridW = natW * s;
    return {
      s,
      x0:       (A4.w - gridW) / 2,
      y0:       G.marginY * PT2PX,
      titleH:   G.titleH * s,
      rowH:     G.rowH * s,
      labelW:   G.labelW * s,
      photoW:   G.photoW * s,
      halfW:    halfW * s,
      blockH:   blockH * s,
      photoH:   G.photoRows * G.rowH * s,
      captionH: G.captionRows * G.rowH * s,
      pad:      G.pad * s,
      gridW,
    };
  }

  function pageCount(total) { return Math.max(1, Math.ceil(total / PER_PAGE)); }

  /* ═══════════════════════ 렌더 ═══════════════════════ */

  const FONT = "'Malgun Gothic','맑은 고딕',Inter,sans-serif";

  /* 사진 로드 — EXIF 회전 반영, 실패하면 null */
  async function _loadBitmap(photo) {
    if (!photo) return null;
    try {
      const file = await photo.handle.getFile();
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      console.warn('사진 로드 실패', photo.name, e);
      return null;
    }
  }

  /* 치수 괄호 — (0.2x2.1) / (0.3) 처럼 숫자로만 이루어진 괄호.
     (신규)·(보수완료) 같은 글자 괄호는 걸리지 않는다. */
  const DIM_RE = /\s*(\([0-9][0-9.]*(?:[xX×][0-9][0-9.]*)*\))/;

  const DONE_RE = /\s*(\(보수완료\))/;

  /* '(보수완료)' 만 파란색·굵게 — 엑셀 Module5 서식 재현
     둘째 줄에는 괄호 항목을 내린다 — 치수가 있으면 치수 앞에서,
     치수가 없으면 (보수완료) 앞에서 줄을 바꾼다. */
  function _breakLine(text) {
    const s = String(text || '');
    if (DIM_RE.test(s))  return s.replace(DIM_RE, '\n$1');
    if (DONE_RE.test(s)) return s.replace(DONE_RE, '\n$1');
    return s;
  }

  function _segments(text) {
    const out = [];
    let rest = _breakLine(text);
    const KEY = '(보수완료)';
    let i;
    while ((i = rest.indexOf(KEY)) !== -1) {
      if (i > 0) out.push({ text: rest.slice(0, i), hi: false });
      out.push({ text: KEY, hi: true });
      rest = rest.slice(i + KEY.length);
    }
    if (rest) out.push({ text: rest, hi: false });
    return out;
  }

  function _wrapRich(ctx, segs, maxW, fontPx) {
    const lines = [[]];
    let lineW = 0;
    segs.forEach(seg => {
      const font = (seg.hi ? '700 ' : '400 ') + fontPx + 'px ' + FONT;
      for (const ch of seg.text) {
        if (ch === '\n') {                    // 치수 앞 강제 줄바꿈
          if (lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
          continue;
        }
        ctx.font = font;
        const w = ctx.measureText(ch).width;
        if (lineW + w > maxW && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
        lines[lines.length - 1].push({ ch, hi: seg.hi, w });
        lineW += w;
      }
    });
    return lines.filter(l => l.length);
  }

  function _drawCaption(ctx, text, box) {
    let fontPx = Math.round(box.h * 0.34);
    let lines;
    /* 3줄을 넘기면 글자를 줄여 칸 안에 넣는다 */
    for (let t = 0; t < 6; t++) {
      lines = _wrapRich(ctx, _segments(text), box.w - box.h * 0.2, fontPx);
      if (lines.length <= 2 || fontPx <= 7) break;
      fontPx -= 1;
    }
    const lh = fontPx * 1.28;
    let y = box.y + box.h / 2 - (lines.length - 1) * lh / 2;
    ctx.textBaseline = 'middle';
    lines.forEach(line => {
      const totW = line.reduce((a, c) => a + c.w, 0);
      let x = box.x + (box.w - totW) / 2;
      line.forEach(c => {
        ctx.font      = (c.hi ? '700 ' : '400 ') + fontPx + 'px ' + FONT;
        ctx.fillStyle = c.hi ? '#0000ff' : '#111111';
        ctx.textAlign = 'left';
        ctx.fillText(c.ch, x, y);
        x += c.w;
      });
      y += lh;
    });
  }

  function _strokeRect(ctx, x, y, w, h, lw) {
    ctx.lineWidth   = lw;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  /* 사진첩 1장 렌더 — entries 중 pageIdx 구간을 그린다
     scale: 미리보기는 0.5 등으로 낮춰 메모리를 아낀다 */
  async function renderPage(entries, pageIdx, title, scale = 1) {
    const L      = layout();
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(A4.w * scale);
    canvas.height = Math.round(A4.h * scale);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(scale, scale);

    const lw = Math.max(1, 1.2);

    /* 표제 (용역명) */
    _strokeRect(ctx, L.x0, L.y0, L.gridW, L.titleH, lw);
    ctx.fillStyle    = '#000000';
    ctx.font         = '700 ' + Math.round(L.titleH * 0.44) + 'px ' + FONT;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title || '', L.x0 + L.gridW / 2, L.y0 + L.titleH / 2);

    const slice = entries.slice(pageIdx * PER_PAGE, (pageIdx + 1) * PER_PAGE);

    for (let i = 0; i < slice.length; i++) {
      const e   = slice[i];
      const r   = Math.floor(i / COLS);
      const c   = i % COLS;
      const bx  = L.x0 + c * L.halfW;
      const by  = L.y0 + L.titleH + r * L.blockH;

      /* 번호 칸 (세로 병합) */
      _strokeRect(ctx, bx, by, L.labelW, L.blockH, lw);
      ctx.fillStyle    = '#000000';
      ctx.font         = '700 ' + Math.round(L.rowH * 0.72) + 'px ' + FONT;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.label, bx + L.labelW / 2, by + L.blockH / 2);

      /* 사진 칸 */
      const px = bx + L.labelW, py = by;
      _strokeRect(ctx, px, py, L.photoW, L.photoH, lw);

      const bmp = await _loadBitmap(e.photo);
      if (bmp) {
        /* 엑셀 매크로와 동일 — 비율 무시하고 칸에 꽉 늘린다 */
        ctx.drawImage(bmp, px + L.pad, py + L.pad, L.photoW - L.pad * 2, L.photoH - L.pad * 2);
        bmp.close();
      } else {
        ctx.fillStyle    = '#999999';
        ctx.font         = '600 ' + Math.round(L.rowH * 0.8) + 'px ' + FONT;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('사진 없음', px + L.photoW / 2, py + L.photoH / 2);
      }

      /* 문구 칸 */
      const cy = py + L.photoH;
      _strokeRect(ctx, px, cy, L.photoW, L.captionH, lw);
      _drawCaption(ctx, e.caption, { x: px, y: cy, w: L.photoW, h: L.captionH });
    }

    ctx.restore();
    return canvas;
  }

  function getTitle() {
    if (typeof TitleBlock === 'undefined') return '';
    return TitleBlock.getSettings().projectTitle || '';
  }

  return {
    loadSummary, getSummary, getSource, hasSummary, clearSummary,
    floorKeyOf, labelOf,
    collectEntries, layout, pageCount, renderPage, getTitle,
    PER_PAGE, A4,
  };
})();
