/* titleBlock.js — 도면 도곽 렌더링 */
'use strict';

const TitleBlock = (() => {
  let enabled = false;

  /* 기준치 (tbScale=1.0 일 때) */
  const BASE = {
    margin:    20,   // 외곽 여백(px)
    blockH:    68,   // 표제란 높이(px)
    borderW:   1.5,  // 선 두께
  };

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

  /* ── 도곽 렌더 ── */
  function render(ctx, imgW, imgH) {
    if (!enabled) return;

    const tbScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().tbScale || 1) : 1;

    const M  = Math.round(BASE.margin  * tbScale);   // 외곽 여백
    const BH = Math.round(BASE.blockH  * tbScale);   // 표제란 높이
    const LW = BASE.borderW;

    ctx.save();

    /* ① 외곽 사각형 */
    const ox = M, oy = M, ow = imgW - M * 2, oh = imgH - M * 2;
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = LW;
    ctx.strokeRect(ox, oy, ow, oh);

    /* ② 표제란 */
    const bx = ox, by = oy + oh - BH, bw = ow, bh = BH;

    /* 표제란 배경 */
    ctx.fillStyle = '#fff';
    ctx.fillRect(bx, by, bw, bh);

    /* 표제란 상단 구분선 (굵게) */
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = LW * 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();
    ctx.lineWidth = LW;

    /* ③ 열 비율: [PT라벨+내용 42%] | [DN라벨+내용 46%] | [SC라벨+값 12%] */
    const c0 = Math.round(bw * 0.42);
    const c1 = Math.round(bw * 0.46);
    const c2 = bw - c0 - c1;

    /* 세로 구분선 */
    [[c0, 0], [c0 + c1, 0]].forEach(([dx]) => {
      ctx.beginPath();
      ctx.moveTo(bx + dx, by);
      ctx.lineTo(bx + dx, by + bh);
      ctx.stroke();
    });

    /* ④ 각 셀 내용 렌더 */
    _renderCell(ctx, bx,           by, c0, bh, 'PROJECT TITLE', settings.projectTitle, tbScale);
    _renderCell(ctx, bx + c0,      by, c1, bh, 'DRAWING NAME',  settings.drawingName,  tbScale);
    _renderScaleCell(ctx, bx + c0 + c1, by, c2, bh, settings.scale || 'NONE', tbScale);

    ctx.restore();
  }

  /* 라벨 + 내용 셀 (PROJECT TITLE / DRAWING NAME) */
  function _renderCell(ctx, cx, cy, cw, ch, label, value, tbScale) {
    const PAD      = Math.max(5, Math.round(8 * tbScale));
    const labelSz  = Math.max(8, Math.round(10 * tbScale));
    const labelH   = labelSz + Math.round(4 * tbScale);   // 라벨 영역 높이
    const valueSz  = Math.max(11, Math.round(14 * tbScale));
    const valueArea = ch - labelH;                         // 내용 영역 높이

    /* 라벨 */
    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, cx + PAD, cy + Math.round(4 * tbScale));

    /* 내용 — 세로 중앙 정렬, 긴 텍스트 2줄 처리 */
    ctx.font      = `700 ${valueSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle = '#111';
    const maxW    = cw - PAD * 2;
    const lines   = _wrapText(ctx, value || '', maxW, 2);
    const lineH   = valueSz * 1.25;
    const textH   = lines.length * lineH;
    const startY  = cy + labelH + (valueArea - textH) / 2 + valueSz * 0.1;

    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, cx + PAD, startY + i * lineH);
    });
  }

  /* SCALE 셀 */
  function _renderScaleCell(ctx, cx, cy, cw, ch, value, tbScale) {
    const labelSz = Math.max(8,  Math.round(10 * tbScale));
    const valueSz = Math.max(10, Math.round(13 * tbScale));
    const PAD     = Math.max(4,  Math.round(6  * tbScale));

    ctx.font         = `600 ${labelSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#666';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('SCALE', cx + cw / 2, cy + Math.round(4 * tbScale));

    ctx.font         = `700 ${valueSz}px "Malgun Gothic","Arial",sans-serif`;
    ctx.fillStyle    = '#111';
    ctx.textBaseline = 'middle';
    ctx.fillText(value, cx + cw / 2, cy + ch * 0.62);
  }

  /* 텍스트 줄 분할 (최대 maxLines줄, 초과 시 말줄임) */
  function _wrapText(ctx, text, maxW, maxLines) {
    if (!text) return [''];
    const words  = text.split(/\s+/);
    const lines  = [];
    let   line   = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);

    if (lines.length > maxLines) lines.length = maxLines;
    /* 마지막 줄 말줄임 */
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
    comp.width = imgW; comp.height = imgH;
    const ctx  = comp.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, imgW, imgH);
    ctx.drawImage(annotationCanvas, 0, 0);
    render(ctx, imgW, imgH);
    return comp;
  }

  return { init, setEnabled, isEnabled, applySettings, getSettings, render, compositeCanvas };
})();
