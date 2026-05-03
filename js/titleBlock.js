/* titleBlock.js — 도면 도곽 렌더링 (A4 비례 레이아웃) */
'use strict';

const TitleBlock = (() => {
  let enabled = false;

  const BASE = {
    margin:  20,   // 외곽 여백(px) — tbScale=1 기준
    borderW: 1.5,
  };

  let settings = {
    projectTitle: '',
    drawingName:  '',
    scale:        'NONE',
    /* 열 비율 (0~1, 합계 ≤ 1 — 나머지가 SCALE 열) */
    col0: 0.42,
    col1: 0.46,
    /* 글씨 크기 기준값 (px, tbScale=1 기준) */
    labelFontSz: 10,
    valueFontSz: 14,
    /* 표제란 높이 기준값 (px, tbScale=1 기준) */
    blockH: 68,
  };

  function init() {}
  function setEnabled(v) { enabled = v; }
  function isEnabled()   { return enabled; }

  function applySettings(patch) {
    /* col0+col1 합이 0.9 초과하면 col1 자동 보정 */
    if (patch.col0 !== undefined || patch.col1 !== undefined) {
      const c0 = patch.col0 !== undefined ? patch.col0 : settings.col0;
      const c1 = patch.col1 !== undefined ? patch.col1 : settings.col1;
      if (c0 + c1 > 0.90) patch.col1 = Math.max(0.05, 0.90 - c0);
    }
    Object.assign(settings, patch);
  }

  function getSettings() { return { ...settings }; }

  /* ── 도곽 렌더 ──
     canvasW × canvasH 는 A4 비례로 생성된 용지 캔버스 전체 크기.
     여백(10mm)·표제란(20mm)을 A4 비율로 환산해 테두리와 셀을 그린다.
  */
  function render(ctx, canvasW, canvasH) {
    if (!enabled) return;

    const tbScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().tbScale || 1) : 1;

    const M  = Math.round(BASE.margin        * tbScale);
    const BH = Math.round(settings.blockH    * tbScale);
    const LW = BASE.borderW;

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

    /* 표제란 상단 구분선 */
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = LW * 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();
    ctx.lineWidth = LW;

    /* ③ 열 비율 적용 */
    const c0 = Math.round(bw * settings.col0);
    const c1 = Math.round(bw * settings.col1);
    const c2 = bw - c0 - c1;

    /* 세로 구분선 */
    [c0, c0 + c1].forEach(dx => {
      ctx.beginPath();
      ctx.moveTo(bx + dx, by);
      ctx.lineTo(bx + dx, by + bh);
      ctx.stroke();
    });

    /* ④ 각 셀 렌더 */
    _renderCell(ctx, bx,           by, c0, bh, 'PROJECT TITLE', settings.projectTitle, tbScale);
    _renderCell(ctx, bx + c0,      by, c1, bh, 'DRAWING NAME',  settings.drawingName,  tbScale);
    _renderScaleCell(ctx, bx + c0 + c1, by, c2, bh, settings.scale || 'NONE', tbScale);

    ctx.restore();
  }

  /* 라벨 + 내용 셀 */
  function _renderCell(ctx, cx, cy, cw, ch, label, value, tbScale) {
    const PAD     = Math.max(5, Math.round(8 * tbScale));
    const labelSz = Math.max(6, Math.round(settings.labelFontSz * tbScale));
    const labelH  = labelSz + Math.round(4 * tbScale);
    const valueSz = Math.max(8, Math.round(settings.valueFontSz * tbScale));
    const valArea = ch - labelH;

    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx + PAD, cy + Math.round(1.4 * tbScale));

    ctx.font      = `700 ${valueSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle = '#111';
    const maxW    = cw - PAD * 2;
    const lines   = _wrapText(ctx, value || '', maxW, 2);
    const lineH   = valueSz * 1.25;
    const textH   = lines.length * lineH;
    const startY  = cy + labelH + (valArea - textH) / 2 + valueSz * 0.1;

    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, cx + PAD, startY + i * lineH));
  }

  /* SCALE 셀 */
  function _renderScaleCell(ctx, cx, cy, cw, ch, value, tbScale) {
    const labelSz = Math.max(6,  Math.round(settings.labelFontSz * tbScale));
    const valueSz = Math.max(8,  Math.round((settings.valueFontSz - 1) * tbScale));

    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SCALE', cx + cw / 2, cy + Math.round(1.4 * tbScale));

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
    let line = '';
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

  /* 합성 Canvas */
  function compositeCanvas(imgEl, annotationCanvas, imgW, imgH) {
    const comp = document.createElement('canvas');
    comp.width  = imgW;
    comp.height = imgH;
    const ctx   = comp.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.drawImage(annotationCanvas, 0, 0);
    render(ctx, imgW, imgH);
    return comp;
  }

  return { init, setEnabled, isEnabled, applySettings, getSettings, render, compositeCanvas };
})();
