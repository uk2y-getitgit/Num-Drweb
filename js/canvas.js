/* canvas.js — 도면 렌더링 & 지시선 그리기 */
'use strict';

const CanvasManager = (() => {
  let wrap, container, imgEl, drawCanvas, ctx, interactionLayer;
  let zoom = 1, panX = 0, panY = 0;
  let imgW = 0, imgH = 0;
  let paperW = 0, paperH = 0;
  /* 이미지 배치 좌표 — renderAnnotations 에서 매번 갱신 */
  let drawOffX = 0, drawOffY = 0, drawW = 0, drawH = 0;

  let isPanning = false, panStart = null;

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
     이미지는 renderAnnotations 에서 tbScale 반영해 동적으로 배치됨.
  */
  function loadImage(src, w, h) {
    imgW = w; imgH = h;

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

  /* ── 이미지 배치 동적 계산 ──
     tbScale 변경 시 캔버스 크기는 유지하면서 표제란 높이와 이미지 위치만 재산출.
  */
  function _computeImageLayout() {
    if (!paperW || !imgW) return null;

    const tbScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().tbScale || 1) : 1;

    const landscape = paperW >= paperH;
    const a4W  = landscape ? 297 : 210;
    const pxMm = paperW / a4W;

    const mPx  = Math.round(10 * pxMm);
    const tbPx = Math.round(20 * pxMm * tbScale);

    const cW = paperW - 2 * mPx;
    const cH = Math.max(10, paperH - 2 * mPx - tbPx);

    /* 비율 유지하며 내용 영역에 최대로 맞춤 */
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

  function _toCanvasPos(cx, cy) {
    const rect = wrap.getBoundingClientRect();
    return { x: (cx - rect.left - panX) / zoom, y: (cy - rect.top - panY) / zoom };
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
        type: drawState.tool, lineStyle: cfg.lineStyle,
        color: preColor, textColor: cfg.textColor,
        num: 0, preview: true,
      });
    }

    items.forEach(item => {
      const label = _buildLabel(item);
      _drawLeader({ ...item, label, preview: false });
    });

    if (afterRenderCb) afterRenderCb(ctx, drawCanvas.width, drawCanvas.height);
  }

  function _buildLabel(item) {
    const cfg    = Annotation.getConfig();
    const prefix = cfg.prefix ? cfg.prefix + '-' : '';
    return prefix + String(item.num).padStart(2, '0');
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

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);

    const fwd = path.length >= 2
      ? { x: path[1].x - path[0].x, y: path[1].y - path[0].y }
      : { x: 1, y: 0 };
    const flipActive = preview ? false : (arrowFlip ?? Annotation.getConfig().arrowFlip);
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

  /* ── 오프스크린 페이지 렌더 (다중 페이지 PDF 내보내기용) ── */
  async function createPageExport(imgSrc, origW, origH, annJSON) {
    const landscape = origW >= origH;
    const pW = Math.round((landscape ? 297 : 210) * A4_PX_MM);
    const pH = Math.round((landscape ? 210 : 297) * A4_PX_MM);

    const tbScale = (typeof Annotation !== 'undefined')
      ? (Annotation.getConfig().tbScale || 1) : 1;
    const a4W  = landscape ? 297 : 210;
    const pxMm = pW / a4W;
    const mPx  = Math.round(10 * pxMm);
    const tbPx = Math.round(20 * pxMm * tbScale);
    const cW   = pW - 2 * mPx;
    const cH   = Math.max(10, pH - 2 * mPx - tbPx);
    const sc   = Math.min(cW / origW, cH / origH);
    const dW   = Math.round(origW * sc);
    const dH   = Math.round(origH * sc);
    const offX = mPx + Math.round((cW - dW) / 2);
    const offY = mPx + Math.round((cH - dH) / 2);

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

  return {
    init, loadImage, fitToView, renderAnnotations,
    setTool, setOrtho, setLineWidth, cancelDraw,
    getCanvasSize, getCanvas, getImage,
    zoomIn, zoomOut, onAdd, onStateChange, setAfterRender,
    createPageExport,
  };
})();
