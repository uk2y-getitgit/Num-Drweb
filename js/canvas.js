/* canvas.js — 도면 렌더링 & 지시선 그리기 */
'use strict';

const CanvasManager = (() => {
  let wrap, container, imgEl, drawCanvas, ctx, interactionLayer;
  let zoom = 1, panX = 0, panY = 0;
  let imgW = 0, imgH = 0;
  let paperW = 0, paperH = 0;
  /* 이미지 배치 좌표 — renderAnnotations 에서 매번 갱신 */
  let drawOffX = 0, drawOffY = 0, drawW = 0, drawH = 0;
  /* pageManager가 저장한 고정 배치 좌표. 있으면 동적 계산 대신 사용 */
  let _imgLayout = null;

  let isPanning = false, panStart = null;

  let dragState = {
    active:   false,
    item:     null,
    handle:   null,
    offsetX:  0,
    offsetY:  0,
  };

  let selectedItemId  = null;
  let mousedownPos    = null;
  let onSelectItem    = null;
  /* 사이드바 사용 후 캔버스 재진입 여부 — true면 첫 클릭을 입장 클릭으로 소비 */
  let needsReactivation = false;

  let drawState = {
    tool:      'arrow',
    ortho:     false,
    lineWidth: 1.5,
    phase:     0,
    p1:        null,
    previewP2: null,
  };

  let onAnnotationAdd   = null;
  let onDrawStateChange = null;
  let afterRenderCb     = null;

  /* A4 고정 해상도: 150 DPI */
  const A4_PX_MM = 150 / 25.4;  // ≈ 5.906 px/mm

  /* ── 초기화 ── */
  function init(wrapEl, containerEl, imgElement, drawEl, interactEl) {
    wrap = wrapEl; container = containerEl; imgEl = imgElement;
    drawCanvas = drawEl; ctx = drawCanvas.getContext('2d');
    interactionLayer = interactEl;
    _bindEvents();
  }

  /* ── 이미지 로드 ──
     A4 용지를 150 DPI 고정 픽셀로 설정 (해상도 무관하게 동일한 용지 크기).
     imgLayout이 전달되면 해당 좌표를 고정 배치로 사용하여 PDF 저장 시 위치 완벽 일치.
  */
  function loadImage(src, w, h, imgLayout) {
    imgW = w; imgH = h;
    _imgLayout = imgLayout || null;

    const landscape = w >= h;
    paperW = Math.round((landscape ? 297 : 210) * A4_PX_MM);
    paperH = Math.round((landscape ? 210 : 297) * A4_PX_MM);

    /* <img> 는 소스 전용 — 화면 표시는 캔버스가 담당 */
    imgEl.style.display = 'none';

    drawCanvas.width   = paperW;
    drawCanvas.height  = paperH;
    interactionLayer.style.width  = paperW + 'px';
    interactionLayer.style.height = paperH + 'px';
    container.style.width  = paperW + 'px';
    container.style.height = paperH + 'px';

    fitToView();

    let rendered = false;
    const doRender = () => {
      if (rendered) return; rendered = true;
      renderAnnotations(typeof Annotation !== 'undefined' ? Annotation.getAll() : []);
    };
    imgEl.onload = doRender;
    imgEl.src = src;
    if (imgEl.complete && imgEl.naturalWidth > 0) doRender();
  }

  /* ── 이미지 배치 계산 ──
     imgLayout이 있으면(신규 불러오기) pageManager가 저장한 고정 좌표를 사용.
     없으면(레거시 세션 데이터) 기존 동적 계산으로 폴백하여 하위 호환성 유지.
  */
  function _computeImageLayout() {
    if (!paperW || !imgW) return null;

    if (_imgLayout) {
      return { offX: _imgLayout.offX, offY: _imgLayout.offY, dW: _imgLayout.dW, dH: _imgLayout.dH };
    }

    /* 레거시 폴백: 동적 계산 */
    const landscape = paperW >= paperH;
    const a4W  = landscape ? 297 : 210;
    const pxMm = paperW / a4W;
    const mPx  = Math.round(10 * pxMm);
    const tbPx = Math.round(20 * pxMm);
    const cW = paperW - 2 * mPx;
    const cH = Math.max(10, paperH - 2 * mPx - tbPx);
    const sc = Math.min(cW / imgW, cH / imgH);
    const dW = Math.round(imgW * sc);
    const dH = Math.round(imgH * sc);
    return {
      offX: mPx + Math.round((cW - dW) / 2),
      offY: mPx + Math.round((cH - dH) / 2),
      dW, dH,
    };
  }

  /* ── 뷰 맞추기 ── */
  function fitToView() {
    if (!paperW || !paperH) return;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    zoom = Math.min((ww - 40) / paperW, (wh - 40) / paperH, 1);
    panX = (ww - paperW * zoom) / 2;
    panY = (wh - paperH * zoom) / 2;
    _applyTransform();
  }

  function _applyTransform() {
    container.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
    const pct = Math.round(zoom * 100) + '%';
    const el  = document.getElementById('zoom-level');
    const el2 = document.getElementById('zoom-level-float');
    if (el)  el.textContent  = pct;
    if (el2) el2.textContent = pct;
  }

  /* ── 이벤트 ── */
  function _bindEvents() {
    wrap.addEventListener('wheel',       _onWheel, { passive: false });
    wrap.addEventListener('mousedown',   _onMouseDown);
    wrap.addEventListener('mousemove',   _onMouseMove);
    wrap.addEventListener('mouseup',     _onMouseUp);
    wrap.addEventListener('mouseleave',  _onMouseLeave);
    wrap.addEventListener('contextmenu', e => e.preventDefault());
  }

  function _onWheel(e) {
    e.preventDefault();
    if (e.shiftKey) {
      const cfg   = Annotation.getConfig();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const ns    = Math.round(Math.max(0.5, Math.min(3.0, cfg.scale + delta)) * 10) / 10;
      const slider = document.getElementById('annotation-scale');
      const label  = document.getElementById('annotation-scale-val');
      if (slider) slider.value = ns;
      if (label)  label.textContent = ns.toFixed(1);
      Annotation.setConfig({ scale: ns });
      return;
    }
    const rect  = wrap.getBoundingClientRect();
    const mx    = e.clientX - rect.left;
    const my    = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const nz    = Math.max(0.1, Math.min(10, zoom * delta));
    panX = mx - (mx - panX) * (nz / zoom);
    panY = my - (my - panY) * (nz / zoom);
    zoom = nz;
    _applyTransform();
  }

  function _onMouseDown(e) {
    if (e.button === 1 || e.button === 2 || e.altKey) {
      isPanning = true;
      panStart  = { x: e.clientX - panX, y: e.clientY - panY };
      wrap.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || !paperW) return;

    const cp = _toCanvasPos(e.clientX, e.clientY);
    /* 도면 이미지 영역 밖 클릭 무시 (drawOffX/Y/W/H 는 마지막 renderAnnotations 에서 갱신됨) */
    if (drawW === 0) return;
    if (cp.x < drawOffX || cp.y < drawOffY ||
        cp.x > drawOffX + drawW || cp.y > drawOffY + drawH) return;

    /* 사이드바 사용 후 캔버스 재진입: 첫 클릭은 입장 클릭으로 소비 */
    if (needsReactivation) {
      needsReactivation = false;
      wrap.style.cursor = 'crosshair';
      return;
    }

    /* 드로잉 대기 상태일 때만 드래그 히트 테스트 */
    if (drawState.phase === 0) {
      const hit = _hitTest(cp);
      if (hit) {
        dragState.active  = true;
        dragState.item    = hit.item;
        dragState.handle  = hit.handle;
        dragState.offsetX = cp.x - hit.item[hit.handle].x;
        dragState.offsetY = cp.y - hit.item[hit.handle].y;
        mousedownPos = { x: e.clientX, y: e.clientY };
        wrap.style.cursor = 'grabbing';
        return; /* 새 넘버링 시작 차단 */
      }
      /* 빈 공간 클릭 시 선택 해제 */
      selectedItemId = null;
      if (onSelectItem) onSelectItem(null);
      renderAnnotations(Annotation.getAll());

      drawState.p1    = cp;
      drawState.phase = 1;
      if (onDrawStateChange) onDrawStateChange(drawState);
    } else {
      const savedP1 = drawState.p1;
      const p2      = _applyOrtho(savedP1, cp);
      drawState.phase     = 0;
      drawState.p1        = null;
      drawState.previewP2 = null;
      if (onDrawStateChange) onDrawStateChange(drawState);
      if (onAnnotationAdd) onAnnotationAdd(savedP1, p2, drawState.tool);
    }
  }

  function _onMouseMove(e) {
    if (isPanning) {
      panX = e.clientX - panStart.x;
      panY = e.clientY - panStart.y;
      _applyTransform();
      return;
    }
    if (dragState.active) {
      const cp = _toCanvasPos(e.clientX, e.clientY);
      const newPos = {
        x: cp.x - dragState.offsetX,
        y: cp.y - dragState.offsetY,
      };
      Annotation.updateItem(dragState.item.id, { [dragState.handle]: newPos });
      renderAnnotations(Annotation.getAll());
      return;
    }
    if (drawState.phase === 1) {
      const cp = _toCanvasPos(e.clientX, e.clientY);
      drawState.previewP2 = _applyOrtho(drawState.p1, cp);
      if (onDrawStateChange) onDrawStateChange(drawState);
      renderAnnotations(Annotation.getAll());
    } else if (drawState.phase === 0 && !isPanning) {
      /* 히트 테스트 기반 커서 변경 */
      const cp = _toCanvasPos(e.clientX, e.clientY);
      const hit = _hitTest(cp);
      wrap.style.cursor = hit ? 'grab' : 'crosshair';
    }
  }

  function _onMouseUp(e) {
    if (dragState.active) {
      const moved = mousedownPos
        ? Math.hypot(e.clientX - mousedownPos.x, e.clientY - mousedownPos.y)
        : 99;
      const wasClick = moved < 5;

      dragState.active = false;
      const clickedItem = dragState.item;
      dragState.item = null;
      dragState.handle = null;
      mousedownPos = null;

      if (wasClick) {
        selectedItemId = (selectedItemId === clickedItem.id) ? null : clickedItem.id;
        if (onSelectItem) onSelectItem(selectedItemId);
        renderAnnotations(Annotation.getAll());
      }
      wrap.style.cursor = 'crosshair';
      return;
    }
    if (isPanning) { isPanning = false; wrap.style.cursor = 'crosshair'; }
  }
  function _onMouseLeave() {
    dragState.active = false;
    mousedownPos = null;
    if (isPanning) { isPanning = false; wrap.style.cursor = 'crosshair'; }
  }

  function _toCanvasPos(cx, cy) {
    const rect = wrap.getBoundingClientRect();
    return { x: (cx - rect.left - panX) / zoom, y: (cy - rect.top - panY) / zoom };
  }

  function _hitTest(cp) {
    const items = Annotation.getAll();
    const scale = Annotation.getConfig().scale || 1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (Math.hypot(cp.x - item.p2.x, cp.y - item.p2.y) < 14 * scale)
        return { item, handle: 'p2' };
      if (Math.hypot(cp.x - item.p1.x, cp.y - item.p1.y) < 10 * scale)
        return { item, handle: 'p1' };
    }
    return null;
  }

  function _applyOrtho(p1, p2) {
    if (!drawState.ortho) return p2;
    const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
    return dx >= dy ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  }

  function _buildPath(p1, p2, style) {
    switch (style) {
      case 'elbow-h': return [p1, { x: p2.x, y: p1.y }, p2];
      case 'elbow-v': return [p1, { x: p1.x, y: p2.y }, p2];
      case 'zigzag': {
        const mx = (p1.x + p2.x) / 2;
        return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
      }
      default: return [p1, p2];
    }
  }

  /* ── 렌더링 ── */
  function renderAnnotations(items) {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    if (paperW > 0) {
      /* 흰색 용지 배경 */
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, paperW, paperH);

      /* 이미지 배치 — tbScale 반영해 매 렌더마다 재계산 */
      const L = _computeImageLayout();
      if (L) {
        drawOffX = L.offX; drawOffY = L.offY;
        drawW    = L.dW;   drawH    = L.dH;
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          ctx.drawImage(imgEl, L.offX, L.offY, L.dW, L.dH);
        }
      }
    }

    /* 미리보기 */
    if (drawState.phase === 1 && drawState.p1 && drawState.previewP2) {
      const cfg      = Annotation.getConfig();
      const cats     = Annotation.getCategories();
      const cat      = Annotation.getActiveCategory();
      const preColor = cats[cat]?.color || '#888';
      _drawLeader({
        p1: drawState.p1, p2: drawState.previewP2,
        type: drawState.tool, lineStyle: cfg.lineStyle, arrowFlip: cfg.arrowFlip,
        color: preColor, textColor: cfg.textColor,
        num: 0, preview: true,
      });
    }

    items.forEach(item => {
      const label = _buildLabel(item);
      const isSelected = (item.id === selectedItemId);
      _drawLeader({ ...item, label, preview: false, selected: isSelected });
    });

    if (afterRenderCb) afterRenderCb(ctx, drawCanvas.width, drawCanvas.height);
  }

  function _buildLabel(item) {
    const cfg    = Annotation.getConfig();
    const prefix = cfg.prefix ? cfg.prefix + '-' : '';
    return prefix + String(item.num).padStart(2, '0');
  }

  function _drawLeader({ p1, p2, type, lineStyle, arrowFlip, color, textColor, num, label, preview, selected }) {
    const scale = preview ? 1 : (Annotation.getConfig().scale || 1);
    ctx.save();
    ctx.globalAlpha  = preview ? 0.5 : 1;
    ctx.strokeStyle  = preview ? '#aaa' : color;
    ctx.fillStyle    = preview ? '#aaa' : color;
    ctx.lineWidth    = drawState.lineWidth * (preview ? 1 : scale);
    ctx.setLineDash(preview ? [5, 4] : []);

    const path = _buildPath(p1, p2, lineStyle || 'straight');

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    const fwd = path.length >= 2
      ? { x: path[1].x - path[0].x, y: path[1].y - path[0].y }
      : { x: 1, y: 0 };
    const flipActive = arrowFlip ?? Annotation.getConfig().arrowFlip;
    const lineDir    = flipActive ? { x: -fwd.x, y: -fwd.y } : fwd;

    if (type === 'arrow') {
      _drawArrowHead(p1, lineDir, preview ? '#aaa' : color);
    } else {
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!preview && num > 0) {
      _drawNumBox(p2, label || String(num), color, textColor || '#fff');
    } else if (preview) {
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 선택 하이라이트 */
    if (selected && !preview) {
      ctx.save();
      ctx.strokeStyle = '#5B5BD6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 12 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 14 * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  function _drawArrowHead(tip, dir, color) {
    const scale = Annotation.getConfig().scale || 1;
    const angle = Math.atan2(dir.y, dir.x);
    const size  = 10 * scale;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - size * Math.cos(angle - 0.4), tip.y - size * Math.sin(angle - 0.4));
    ctx.lineTo(tip.x - size * Math.cos(angle + 0.4), tip.y - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function _drawNumBox(p, label, bgColor, textColor) {
    const scale    = Annotation.getConfig().scale || 1;
    const fontSize = Math.round(12 * scale);
    ctx.save();
    ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
    const tw  = ctx.measureText(label).width;
    const padX = 8 * scale, padY = 4 * scale;
    const bw  = tw + padX * 2, bh = fontSize + padY * 2;
    const bx  = p.x - bw / 2, by = p.y - bh / 2;
    const r   = Math.max(3, 4 * scale);

    ctx.globalAlpha = 1;
    ctx.fillStyle   = bgColor;
    _roundRect(bx, by, bw, bh, r);
    ctx.fill();

    ctx.fillStyle    = textColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, p.x, p.y);
    ctx.restore();
  }

  function _roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /* ── 공개 세터 ── */
  function setTool(t)      { drawState.tool     = t; }
  function setOrtho(v)     { drawState.ortho    = v; }
  function setLineWidth(w) { drawState.lineWidth = w; renderAnnotations(Annotation.getAll()); }
  function cancelDraw()    {
    drawState.phase = 0; drawState.p1 = null; drawState.previewP2 = null;
    renderAnnotations(Annotation.getAll());
  }
  /* 사이드바 사용 후 캔버스 재진입 대기 상태로 전환 */
  function deactivate()    { needsReactivation = true; wrap.style.cursor = 'default'; }
  function getCanvasSize() { return { w: paperW || imgW, h: paperH || imgH }; }
  function getCanvas()     { return drawCanvas; }
  function getImage()      { return imgEl; }

  function zoomIn()  {
    const c = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
    zoom = Math.min(10, zoom * 1.2);
    panX = c.x - (c.x - panX) * 1.2; panY = c.y - (c.y - panY) * 1.2;
    _applyTransform();
  }
  function zoomOut() {
    const c = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
    zoom = Math.max(0.1, zoom / 1.2);
    panX = c.x - (c.x - panX) / 1.2; panY = c.y - (c.y - panY) / 1.2;
    _applyTransform();
  }

  function onAdd(cb)          { onAnnotationAdd   = cb; }
  function onStateChange(cb)  { onDrawStateChange = cb; }
  function setAfterRender(cb) { afterRenderCb     = cb; }

  /* ── 오프스크린 페이지 렌더 (다중 페이지 PDF 내보내기용) ──
     imgLayout이 있으면 화면 표시와 동일한 고정 좌표 사용 → 지시점 위치 픽셀 일치 보장.
     없으면(레거시 데이터) 동적 계산 폴백. */
  async function createPageExport(imgSrc, origW, origH, annJSON, imgLayout) {
    const landscape = origW >= origH;
    const pW = Math.round((landscape ? 297 : 210) * A4_PX_MM);
    const pH = Math.round((landscape ? 210 : 297) * A4_PX_MM);

    let offX, offY, dW, dH;

    if (imgLayout) {
      /* 신규 데이터: pageManager가 저장한 고정 좌표 그대로 사용 */
      offX = imgLayout.offX; offY = imgLayout.offY;
      dW   = imgLayout.dW;   dH   = imgLayout.dH;
    } else {
      /* 레거시 폴백: 동적 계산 */
      const a4W  = landscape ? 297 : 210;
      const pxMm = pW / a4W;
      const mPx  = Math.round(10 * pxMm);
      const tbPx = Math.round(20 * pxMm);
      const cW   = pW - 2 * mPx;
      const cH   = Math.max(10, pH - 2 * mPx - tbPx);
      const sc   = Math.min(cW / origW, cH / origH);
      dW   = Math.round(origW * sc);
      dH   = Math.round(origH * sc);
      offX = mPx + Math.round((cW - dW) / 2);
      offY = mPx + Math.round((cH - dH) / 2);
    }

    const off    = document.createElement('canvas');
    off.width    = pW; off.height = pH;
    const offCtx = off.getContext('2d');

    await new Promise(resolve => {
      const tmp = new Image();
      tmp.onload = () => {
        offCtx.fillStyle = '#ffffff';
        offCtx.fillRect(0, 0, pW, pH);
        offCtx.drawImage(tmp, offX, offY, dW, dH);
        resolve();
      };
      tmp.onerror = resolve;
      tmp.src = imgSrc;
    });

    /* 넘버링 항목 파싱 */
    let annItems = [], annPrefix = '';
    if (annJSON) {
      try {
        const d  = JSON.parse(annJSON);
        annItems  = d.items  || [];
        annPrefix = (d.config && d.config.prefix) || '';
      } catch {}
    }

    /* ctx 임시 교체 후 넘버링 렌더 */
    if (annItems.length > 0) {
      const savedCtx  = ctx;
      const savedPW   = paperW, savedPH   = paperH;
      const savedDW   = drawW,  savedDH   = drawH;
      const savedOX   = drawOffX, savedOY = drawOffY;

      ctx = offCtx;
      paperW = pW; paperH = pH;
      drawW  = dW; drawH  = dH;
      drawOffX = offX; drawOffY = offY;

      annItems.forEach(item => {
        const prefix = annPrefix ? annPrefix + '-' : '';
        const label  = prefix + String(item.num).padStart(2, '0');
        _drawLeader({ ...item, label, preview: false });
      });

      ctx = savedCtx;
      paperW = savedPW; paperH = savedPH;
      drawW  = savedDW; drawH  = savedDH;
      drawOffX = savedOX; drawOffY = savedOY;
    }

    if (typeof TitleBlock !== 'undefined' && TitleBlock.isEnabled()) {
      TitleBlock.render(offCtx, pW, pH);
    }

    return { canvas: off, w: pW, h: pH };
  }

  function getSelectedId() { return selectedItemId; }
  function clearSelection() {
    selectedItemId = null;
    renderAnnotations(Annotation.getAll());
  }
  function onSelect(cb) { onSelectItem = cb; }

  /* ── PDF 내보내기용: 오프스크린 캔버스에 지시점만 렌더링 ──
     targetCanvas : page.imgSrc 이미지가 이미 그려진 캔버스
     annJSON      : 페이지에 저장된 Annotation JSON 문자열
  */
  function renderAnnotationsTo(targetCanvas, annJSON) {
    if (!annJSON) return;
    let annItems = [], annCfg = {};
    try {
      const d = JSON.parse(annJSON);
      annItems = d.items  || [];
      annCfg   = d.config || {};
    } catch { return; }
    if (!annItems.length) return;

    const targetCtx = targetCanvas.getContext('2d');
    const savedCtx  = ctx;
    const savedPW   = paperW, savedPH = paperH;

    ctx    = targetCtx;
    paperW = targetCanvas.width;
    paperH = targetCanvas.height;

    annItems.forEach(item => {
      const prefix = annCfg.prefix ? annCfg.prefix + '-' : '';
      const label  = prefix + String(item.num).padStart(2, '0');
      _drawLeader({ ...item, label, preview: false, selected: false });
    });

    ctx    = savedCtx;
    paperW = savedPW;
    paperH = savedPH;
  }

  return {
    init, loadImage, fitToView, renderAnnotations,
    setTool, setOrtho, setLineWidth, cancelDraw, deactivate,
    getCanvasSize, getCanvas, getImage,
    zoomIn, zoomOut, onAdd, onStateChange, setAfterRender,
    createPageExport, renderAnnotationsTo,
    getSelectedId, clearSelection, onSelect,
  };
})();
