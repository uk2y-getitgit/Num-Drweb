/* titleBlock.js — 도면 도곽 렌더링 (A4 비례 레이아웃) */
'use strict';

const TitleBlock = (() => {
  let enabled = false;

  let settings = {
    projectTitle: '',
    drawingName:  '',
    scale:        'NONE',
  };

  function init() {}
  function setEnabled(v) { enabled = v; }
  function isEnabled()   { return enabled; }
  function applySettings(patch) { Object.assign(settings, patch); }
  function getSettings()        { return { ...settings }; }

  /* ── 도곽 렌더 ──
     canvasW × canvasH 는 A4 비례로 생성된 용지 캔버스 전체 크기.
     여백(10mm)·표제란(20mm)을 A4 비율로 환산해 테두리와 셀을 그린다.
  */
  function render(ctx, canvasW, canvasH) {
    if (!enabled) return;

    const tbScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().tbScale || 1) : 1;

    /* A4 비례 계산 */
    const landscape = canvasW >= canvasH;
    const a4W = landscape ? 297 : 210;   // mm
    const pxMm = canvasW / a4W;          // pixels per mm

    const M  = Math.round(10 * pxMm);                    // 10mm 여백
    const BH = Math.round(20 * pxMm * tbScale);           // 표제란 높이 20mm × 배율
    const LW = Math.max(0.5, Math.round(pxMm * 4) / 10); // 선 두께 ~0.4mm

    ctx.save();
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = LW * 1.5;

    /* ① 외곽 테두리 */
    ctx.strokeRect(M, M, canvasW - 2 * M, canvasH - 2 * M);

    /* ② 표제란 영역 */
    const ox = M, oy = M, ow = canvasW - 2 * M, oh = canvasH - 2 * M;
    const bx = ox, by = oy + oh - BH, bw = ow, bh = BH;

    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, bw, bh);

    /* 표제란 상단 구분선 (굵게) */
    ctx.lineWidth = LW * 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();
    ctx.lineWidth = LW;

    /* ③ 열 비율: [PT 42%] | [DN 46%] | [SC 12%] */
    const c0 = Math.round(bw * 0.42);
    const c1 = Math.round(bw * 0.46);
    const c2 = bw - c0 - c1;

    [[c0], [c0 + c1]].forEach(([dx]) => {
      ctx.beginPath();
      ctx.moveTo(bx + dx, by);
      ctx.lineTo(bx + dx, by + bh);
      ctx.stroke();
    });

    /* ④ 셀 내용 렌더 — tScale: mm → px 변환 + 텍스트 배율 */
    const tScale = pxMm * tbScale;
    _renderCell(ctx, bx,           by, c0, bh, 'PROJECT TITLE', settings.projectTitle, tScale);
    _renderCell(ctx, bx + c0,      by, c1, bh, 'DRAWING NAME',  settings.drawingName,  tScale);
    _renderScaleCell(ctx, bx + c0 + c1, by, c2, bh, settings.scale || 'NONE', tScale);

    ctx.restore();
  }

  /* 라벨 + 내용 셀 */
  function _renderCell(ctx, cx, cy, cw, ch, label, value, tScale) {
    const PAD     = Math.max(4, Math.round(2.0 * tScale));
    /* 폰트 크기를 셀 높이의 일정 비율로 제한해 넘침 방지 */
    const labelSz = Math.max(7, Math.min(Math.round(2.6 * tScale), Math.round(ch * 0.22)));
    const labelH  = labelSz + Math.round(1.4 * tScale);
    const valueSz = Math.max(10, Math.min(Math.round(4.8 * tScale), Math.round(ch * 0.50)));
    const valueArea = ch - labelH;

    /* 라벨 */
    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx + PAD, cy + Math.round(1.4 * tScale));

    /* 내용 — 세로 중앙 정렬 */
    ctx.font      = `700 ${valueSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle = '#111';
    const maxW  = cw - PAD * 2;
    const lines = _wrapText(ctx, value || '', maxW, 2);
    const lineH = valueSz * 1.25;
    const textH = lines.length * lineH;
    const startY = cy + labelH + (valueArea - textH) / 2 + valueSz * 0.1;

    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, cx + PAD, startY + i * lineH);
    });
  }

  /* SCALE 셀 */
  function _renderScaleCell(ctx, cx, cy, cw, ch, value, tScale) {
    const labelSz = Math.max(7, Math.min(Math.round(2.6 * tScale), Math.round(ch * 0.22)));
    const valueSz = Math.max(9, Math.min(Math.round(4.2 * tScale), Math.round(ch * 0.45)));

    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SCALE', cx + cw / 2, cy + Math.round(1.4 * tScale));

    ctx.font         = `700 ${valueSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#111';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, cx + cw / 2, cy + ch * 0.62);
  }

  /* 텍스트 줄 분할 */
  function _wrapText(ctx, text, maxW, maxLines) {
    if (!text) return [''];
    const words = text.split(/\s+/);
    const lines = [];
    let   line  = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) lines.length = maxLines;
    let last = lines[lines.length - 1];
    if (ctx.measureText(last).width > maxW) {
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW)
        last = last.slice(0, -1);
      lines[lines.length - 1] = last + '…';
    }
    return lines;
  }

  return { init, setEnabled, isEnabled, applySettings, getSettings, render };
})();
