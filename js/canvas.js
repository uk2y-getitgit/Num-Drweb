/* canvas.js — 도면 렌더링 & 지시선 그리기 */
'use strict';

const CanvasManager = (() => {
  let wrap, container, imgEl, drawCanvas, ctx, interactionLayer;
  let zoom = 1, panX = 0, panY = 0;
  let imgW = 0, imgH = 0;
  let isPanning = false, panStart = null;

  let drawState = {
    tool:      'arrow',    // 'arrow' | 'dot'
    ortho:     false,
    lineWidth: 1.5,
    phase:     0,          // 0=대기 1=P1확정
    p1:        null,
    previewP2: null,
  };

  let onAnnotationAdd   = null;
  let onDrawStateChange = null;
  let afterRenderCb     = null;  // renderAnnotations 완료 후 항상 호출 (도곽 렌더용)

  /* ── 초기화 ── */
  function init(wrapEl, containerEl, imgElement, drawEl, interactEl) {
    wrap = wrapEl; container = containerEl; imgEl = imgElement;
    drawCanvas = drawEl; ctx = drawCanvas.getContext('2d');
    interactionLayer = interactEl;
    _bindEvents();
  }

  /* ── 이미지 로드 ── */
  function loadImage(src, w, h) {
    imgW = w; imgH = h;
    imgEl.src = src;
    imgEl.style.width  = w + 'px';
    imgEl.style.height = h + 'px';
    drawCanvas.width   = w;
    drawCanvas.height  = h;
    interactionLayer.style.width  = w + 'px';
    interactionLayer.style.height = h + 'px';
    container.style.width  = w + 'px';
    container.style.height = h + 'px';
    fitToView();
  }

  /* ── 뷰 맞추기 ── */
  function fitToView() {
    if (!imgW || !imgH) return;
    const ww = wrap.clientWidth, wh = wrap.clientHeight;
    zoom = Math.min((ww - 40) / imgW, (wh - 40) / imgH, 1);
    panX = (ww - imgW * zoom) / 2;
    panY = (wh - imgH * zoom) / 2;
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
    /* Shift+휠 → 넘버링 축척 조절 (onChange → _renderTitleBlock 포함 재렌더) */
    if (e.shiftKey) {
      const cfg   = Annotation.getConfig();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const ns    = Math.round(Math.max(0.5, Math.min(3.0, cfg.scale + delta)) * 10) / 10;
      /* 슬라이더 UI 동기화 */
      const slider = document.getElementById('annotation-scale');
      const label  = document.getElementById('annotation-scale-val');
      if (slider) slider.value = ns;
      if (label)  label.textContent = ns.toFixed(1);
      /* setConfig → onChange → app.js 콜백(_renderTitleBlock 포함) 자동 호출 */
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
    /* 팬 모드: 중간버튼 / 우클릭 / Alt+클릭 */
    if (e.button === 1 || e.button === 2 || e.altKey) {
      isPanning = true;
      panStart  = { x: e.clientX - panX, y: e.clientY - panY };
      wrap.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || !imgW) return;

    const cp = _toCanvasPos(e.clientX, e.clientY);
    /* 이미지 범위 밖 클릭 무시 */
    if (cp.x < 0 || cp.y < 0 || cp.x > imgW || cp.y > imgH) return;

    if (drawState.phase === 0) {
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
      /* onAnnotationAdd → Annotation.add() → onChange → _renderTitleBlock(도곽 포함)
         이 경로로 렌더링되므로 여기서 직접 renderAnnotations를 호출하지 않는다 */
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
    if (drawState.phase === 1) {
      const cp = _toCanvasPos(e.clientX, e.clientY);
      drawState.previewP2 = _applyOrtho(drawState.p1, cp);
      if (onDrawStateChange) onDrawStateChange(drawState);
      renderAnnotations(Annotation.getAll());
    }
  }

  function _onMouseUp()    { if (isPanning) { isPanning = false; wrap.style.cursor = 'crosshair'; } }
  function _onMouseLeave() { if (isPanning) { isPanning = false; wrap.style.cursor = 'crosshair'; } }

  /* ── 좌표 변환 ── */
  function _toCanvasPos(cx, cy) {
    const rect = wrap.getBoundingClientRect();
    return { x: (cx - rect.left - panX) / zoom, y: (cy - rect.top - panY) / zoom };
  }

  /* ── 직교모드 ── */
  function _applyOrtho(p1, p2) {
    if (!drawState.ortho) return p2;
    const dx = Math.abs(p2.x - p1.x), dy = Math.abs(p2.y - p1.y);
    return dx >= dy ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  }

  /* ── 꺾임 경로 계산 ── */
  function _buildPath(p1, p2, style) {
    /* 반환값: [{x,y}, ...] 배열 (p1 포함, p2 포함) */
    switch (style) {
      case 'elbow-h': {
        /* 수평 먼저 → 수직: ┐ 또는 └ */
        const mid = { x: p2.x, y: p1.y };
        return [p1, mid, p2];
      }
      case 'elbow-v': {
        /* 수직 먼저 → 수평: ┘ 또는 ┌ */
        const mid = { x: p1.x, y: p2.y };
        return [p1, mid, p2];
      }
      case 'zigzag': {
        /* 번개 모양: P1 → 중간수직1 → 중간수직2 → P2 */
        const mx = (p1.x + p2.x) / 2;
        return [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
      }
      default: /* straight */
        return [p1, p2];
    }
  }

  /* ── 렌더링 ── */
  function renderAnnotations(items) {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    /* 미리보기 */
    if (drawState.phase === 1 && drawState.p1 && drawState.previewP2) {
      const cfg    = Annotation.getConfig();
      const cats   = Annotation.getCategories();
      const cat    = Annotation.getActiveCategory();
      const preColor = cats[cat]?.color || '#888';
      _drawLeader({
        p1: drawState.p1, p2: drawState.previewP2,
        type: drawState.tool, lineStyle: cfg.lineStyle,
        color: preColor, textColor: cfg.textColor,
        num: 0, preview: true,
      });
    }

    items.forEach(item => {
      const label = _buildLabel(item);
      _drawLeader({ ...item, label, preview: false });
    });

    /* 모든 렌더 완료 후 도곽 등 오버레이 자동 처리 */
    if (afterRenderCb) afterRenderCb(ctx, imgW, imgH);
  }

  /* 접두어 포함 레이블 생성 */
  function _buildLabel(item) {
    const cfg = Annotation.getConfig();
    const prefix = cfg.prefix ? cfg.prefix + '-' : '';
    const numStr = String(item.num).padStart(2, '0');
    return prefix + numStr;
  }

  function _drawLeader({ p1, p2, type, lineStyle, arrowFlip, color, textColor, num, label, preview }) {
    const scale = preview ? 1 : (Annotation.getConfig().scale || 1);
    ctx.save();
    ctx.globalAlpha  = preview ? 0.5 : 1;
    ctx.strokeStyle  = preview ? '#aaa' : color;
    ctx.fillStyle    = preview ? '#aaa' : color;
    ctx.lineWidth    = drawState.lineWidth * (preview ? 1 : scale);
    ctx.setLineDash(preview ? [5, 4] : []);

    const path = _buildPath(p1, p2, lineStyle || 'straight');

    /* 선 경로 */
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    /* P1 표시 — arrowFlip에 따라 화살표 방향 결정
       flip=false: P1→P2 방향 (지시선을 향함)
       flip=true:  P1←P2 방향 (지시선 반대, 바깥을 향함) */
    const fwd = path.length >= 2
      ? { x: path[1].x - path[0].x, y: path[1].y - path[0].y }
      : { x: 1, y: 0 };
    const flipActive = preview ? false : (arrowFlip ?? Annotation.getConfig().arrowFlip);
    const lineDir = flipActive
      ? { x: -fwd.x, y: -fwd.y }
      : fwd;

    if (type === 'arrow') {
      _drawArrowHead(p1, lineDir, preview ? '#aaa' : color);
    } else {
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    /* P2 번호 박스 */
    if (!preview && num > 0) {
      _drawNumBox(p2, label || String(num), color, textColor || '#fff');
    } else if (preview) {
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2);
      ctx.fill();
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
    const scale   = Annotation.getConfig().scale || 1;
    const fontSize = Math.round(12 * scale);
    ctx.save();
    ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
    const tw  = ctx.measureText(label).width;
    const padX = 8 * scale, padY = 4 * scale;
    const bw  = tw + padX * 2;
    const bh  = fontSize + padY * 2;
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
  function setTool(t)      { drawState.tool      = t; }
  function setOrtho(v)     { drawState.ortho     = v; }
  function setLineWidth(w) { drawState.lineWidth  = w; renderAnnotations(Annotation.getAll()); }
  function cancelDraw()    {
    drawState.phase = 0; drawState.p1 = null; drawState.previewP2 = null;
    renderAnnotations(Annotation.getAll());
  }
  function getCanvasSize() { return { w: imgW, h: imgH }; }
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

  return {
    init, loadImage, fitToView, renderAnnotations,
    setTool, setOrtho, setLineWidth, cancelDraw,
    getCanvasSize, getCanvas, getImage,
    zoomIn, zoomOut, onAdd, onStateChange, setAfterRender,
  };
})();
