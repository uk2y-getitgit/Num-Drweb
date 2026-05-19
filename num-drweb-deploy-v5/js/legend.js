/* legend.js — 범례 오버레이 렌더링 */
'use strict';

const Legend = (() => {
  let enabled = true;

  function setEnabled(v) { enabled = v; }
  function isEnabled()   { return enabled; }

  function render(ctx, canvasW, canvasH) {
    if (!enabled) return;

    const lgScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().lgScale || 1) : 1;

    const cats    = (typeof Annotation !== 'undefined')
      ? Annotation.getCategories() : {};
    const catList = Object.values(cats);
    if (!catList.length) return;

    const PAD      = Math.round(10 * lgScale);
    const lineLen  = Math.round(30 * lgScale);
    const rowH     = Math.round(20 * lgScale);
    const fontSize = Math.max(9, Math.round(12 * lgScale));
    const gapX     = Math.round(8  * lgScale);
    const lineW    = Math.max(1.5, Math.round(2 * lgScale));

    ctx.save();

    /* 라벨 최대 너비 측정 */
    ctx.font = `600 ${fontSize}px "Malgun Gothic","Arial",sans-serif`;
    let maxLabelW = 0;
    catList.forEach(c => {
      const w = ctx.measureText(c.label).width;
      if (w > maxLabelW) maxLabelW = w;
    });

    const boxW   = PAD * 2 + lineLen + gapX + maxLabelW;
    const boxH   = PAD * 2 + catList.length * rowH;
    const margin = Math.round(30 * lgScale);
    const bx     = canvasW - margin - boxW;
    const by     = margin;

    /* 배경 박스 */
    ctx.fillStyle   = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth   = 1;
    const r = Math.max(3, Math.round(5 * lgScale));
    ctx.beginPath();
    ctx.roundRect(bx, by, boxW, boxH, r);
    ctx.fill();
    ctx.stroke();

    /* 카테고리 행 */
    catList.forEach((cat, i) => {
      const rowY = by + PAD + i * rowH + rowH / 2;
      const lx   = bx + PAD;

      /* 색상 선 */
      ctx.strokeStyle = cat.color;
      ctx.lineWidth   = lineW;
      ctx.beginPath();
      ctx.moveTo(lx, rowY);
      ctx.lineTo(lx + lineLen, rowY);
      ctx.stroke();

      /* 라벨 */
      ctx.fillStyle    = '#1A1A1F';
      ctx.font         = `600 ${fontSize}px "Malgun Gothic","Arial",sans-serif`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(cat.label, lx + lineLen + gapX, rowY);
    });

    ctx.restore();
  }

  return { setEnabled, isEnabled, render };
})();
