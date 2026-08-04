/* legend.js — 범례표 오버레이 렌더링 (기호 | 설명 2열 표) */
'use strict';

const Legend = (() => {
  let enabled = true;

  function setEnabled(v) { enabled = v; }
  function isEnabled()   { return enabled; }

  /* equipFilter: 장비 key 배열 — 있으면 해당 장비만 범례 표기 (페이지별 선택).
     undefined/null 이면 전체 표기. */
  function render(ctx, canvasW, canvasH, equipFilter) {
    if (!enabled) return;

    const lgScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().lgScale || 1) : 1;

    /* 장비 모드: 장비 범례(기호=접두어) / 외관 모드: 카테고리 범례(기호=색상 선) */
    const isEquip = typeof AppMode !== 'undefined' && AppMode.get() === AppMode.MODES.EQUIP;
    let rows;
    if (isEquip && typeof Equipment !== 'undefined') {
      let eqList = Equipment.getList();
      if (Array.isArray(equipFilter)) eqList = eqList.filter(e => equipFilter.includes(e.key));
      rows = eqList.map(e => ({ color: e.color, sym: e.prefix || '', desc: e.desc || e.label }));
    } else {
      const cats = (typeof Annotation !== 'undefined') ? Annotation.getCategories() : {};
      rows = Object.values(cats).map(c => ({ color: c.color, sym: '', desc: c.label }));
    }
    if (!rows.length) return;

    const fontSize = Math.max(9, Math.round(12 * lgScale));
    const padX     = Math.round(10 * lgScale);
    const rowH     = Math.round(24 * lgScale);
    const symFont  = `700 ${fontSize}px "Malgun Gothic","Arial",sans-serif`;
    const descFont = `600 ${fontSize}px "Malgun Gothic","Arial",sans-serif`;

    ctx.save();

    /* 열 너비 측정 — 기호열은 최소 폭 확보 */
    ctx.font = symFont;
    let symW = Math.round(28 * lgScale);
    rows.forEach(r => { const w = ctx.measureText(r.sym).width; if (w > symW) symW = w; });
    symW += padX * 2;

    ctx.font = descFont;
    let descW = 0;
    rows.forEach(r => { const w = ctx.measureText(r.desc).width; if (w > descW) descW = w; });
    descW += padX * 2;

    const boxW   = symW + descW;
    const boxH   = rows.length * rowH;
    const margin = Math.round(30 * lgScale);
    const bx     = canvasW - margin - boxW;
    const by     = margin;

    /* 표 배경 */
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillRect(bx, by, boxW, boxH);

    /* 각 행 — 기호·설명 모두 장비(카테고리) 선택 색상으로 표기 */
    ctx.textBaseline = 'middle';
    rows.forEach((row, i) => {
      const cy = by + i * rowH + rowH / 2;
      ctx.fillStyle = row.color;
      if (row.sym) {
        ctx.font      = symFont;
        ctx.textAlign = 'center';
        ctx.fillText(row.sym, bx + symW / 2, cy);
      } else {
        /* 접두어가 없는 카테고리 범례: 색상 선 샘플로 대체 */
        ctx.strokeStyle = row.color;
        ctx.lineWidth   = Math.max(1.5, Math.round(2 * lgScale));
        ctx.beginPath();
        ctx.moveTo(bx + padX, cy);
        ctx.lineTo(bx + symW - padX, cy);
        ctx.stroke();
      }
      ctx.font      = descFont;
      ctx.textAlign = 'left';
      ctx.fillText(row.desc, bx + symW + padX, cy);
    });

    /* 표 괘선 — 외곽 + 행 구분선 + 열 구분선 */
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth   = Math.max(1, Math.round(lgScale));
    ctx.strokeRect(bx, by, boxW, boxH);
    ctx.beginPath();
    for (let i = 1; i < rows.length; i++) {
      ctx.moveTo(bx, by + i * rowH);
      ctx.lineTo(bx + boxW, by + i * rowH);
    }
    ctx.moveTo(bx + symW, by);
    ctx.lineTo(bx + symW, by + boxH);
    ctx.stroke();

    ctx.restore();
  }

  return { setEnabled, isEnabled, render };
})();
