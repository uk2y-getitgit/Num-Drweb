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
  let onAddLabelCb      = null;   // 장비 모드: 기존 지시선에 다른 장비 넘버 추가
  let onAddShapeCb      = null;   // 장비 모드: 도형(기울기/부동침하) 추가
  let onEditNoteCb      = null;   // 번호박스 더블클릭 → 메모 편집
  let onMergeSelCb      = null;   // 합치기 모드 선택 변경

  /* 합치기 모드 — ON이면 클릭이 그리기/선택 대신 병합 대상 토글로 동작 */
  let mergeMode = false;
  let mergeSel  = [];             // 선택 순서 유지 (첫 항목이 대표가 된다)

  /* 직전 클릭으로 자동 추가된 장비 넘버 — 더블클릭(메모 편집) 시 되돌리기용 */
  let lastAutoLabel = null;

  /* 부동침하: 클릭으로 측정점 수집, Enter로 확정 */
  let shapeState = { collecting: false, points: [], cursor: null };

  /* 현재 활성 장비의 작업 종류 (leader|tilt|settle) — 장비 모드에서만 */
  function _activeEquipKind() {
    if (typeof AppMode === 'undefined' || AppMode.get() !== AppMode.MODES.EQUIP) return null;
    if (typeof Equipment === 'undefined') return null;
    const eq = Equipment.getActive();
    return eq ? eq.kind : null;
  }

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

    /* 레거시 폴백: 동적 계산 — 도곽 예약 포함, 가용 영역 중앙 배치 */
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
    wrap.addEventListener('dblclick',    _onDblClick);
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

    /* 합치기 모드: 클릭은 병합 대상 토글만 — 새 넘버링·드래그·묶음 추가 모두 차단 */
    if (mergeMode) {
      const hit = _hitTestBox(cp) || _hitTest(cp);
      if (hit) _toggleMergeSel(hit.item.id);
      return;
    }

    /* 부동침하: 클릭으로 측정점 수집 (Enter로 확정)
       직교모드 ON이면 직전 점 기준으로 수평·수직 정렬 */
    if (drawState.phase === 0 && _activeEquipKind() === 'settle') {
      const pt = _settlePoint(cp);
      shapeState.collecting = true;
      shapeState.points.push({ x: pt.x, y: pt.y });
      shapeState.cursor = { x: pt.x, y: pt.y };
      if (onDrawStateChange) onDrawStateChange({ phase: 1 });
      renderAnnotations(Annotation.getAll());
      return;
    }

    /* 드로잉 대기 상태일 때만 드래그 히트 테스트 */
    if (drawState.phase === 0) {
      const hit = _hitTest(cp);
      if (hit) {
        dragState.active  = true;
        dragState.item    = hit.item;
        dragState.handle  = hit.handle;
        dragState.sub     = hit.sub || null;
        if (hit.handle === 'mergedP1') {
          /* 합쳐진(유지된) 지시선의 지시점 개별 이동 */
          dragState.offsetX = cp.x - hit.sub.p1.x;
          dragState.offsetY = cp.y - hit.sub.p1.y;
        } else if (hit.handle === 'poly' || hit.handle === 'shape' || hit.handle === 'label') {
          dragState.lastCp = { x: cp.x, y: cp.y };   // 도형 전체 / 번호박스 이동
        } else {
          dragState.offsetX = cp.x - hit.item[hit.handle].x;
          dragState.offsetY = cp.y - hit.item[hit.handle].y;
        }
        mousedownPos = { x: e.clientX, y: e.clientY };
        wrap.style.cursor = 'grabbing';
        return; /* 새 넘버링 시작 차단 */
      }
      /* 빈 공간 클릭 시 선택 해제 */
      selectedItemId = null;
      if (onSelectItem) onSelectItem(null);
      renderAnnotations(Annotation.getAll());

      /* 지시선 없음: 1클릭으로 번호박스만 추가 (p1=p2)
         기울기·부동침하 장비는 도형 작업이므로 제외 */
      const ek = _activeEquipKind();
      if (drawState.tool === 'none' && (ek === null || ek === 'leader')) {
        if (onAnnotationAdd) onAnnotationAdd({ x: cp.x, y: cp.y }, { x: cp.x, y: cp.y }, 'none');
        return;
      }

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
    if (shapeState.collecting) {
      shapeState.cursor = _settlePoint(_toCanvasPos(e.clientX, e.clientY));
      renderAnnotations(Annotation.getAll());
      return;
    }
    if (dragState.active) {
      const cp = _toCanvasPos(e.clientX, e.clientY);
      if (dragState.handle === 'mergedP1' && dragState.sub) {
        dragState.sub.p1 = { x: cp.x - dragState.offsetX, y: cp.y - dragState.offsetY };
        renderAnnotations(Annotation.getAll());
        return;
      }
      if (dragState.handle === 'label') {
        _translateLabel(dragState.item, cp);
        renderAnnotations(Annotation.getAll());
        return;
      }
      if (dragState.handle === 'poly' || dragState.handle === 'shape') {
        _translateShape(dragState.item, cp);
        renderAnnotations(Annotation.getAll());
        return;
      }
      const newPos = {
        x: cp.x - dragState.offsetX,
        y: cp.y - dragState.offsetY,
      };
      const patch = { [dragState.handle]: newPos };
      /* 지시선 없음 항목은 p1·p2가 같은 점 — 함께 이동 */
      if (dragState.item.type === 'none') { patch.p1 = { ...newPos }; patch.p2 = { ...newPos }; }
      Annotation.updateItem(dragState.item.id, patch);
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
      const clickedHandle = dragState.handle;
      dragState.item = null;
      dragState.handle = null;
      dragState.sub = null;
      mousedownPos = null;

      if (wasClick && e.detail >= 2) {
        /* 더블클릭의 두 번째 클릭 — 메모 편집이므로 넘버 추가·선택 토글을 하지 않는다 */
        wrap.style.cursor = 'crosshair';
        return;
      }
      if (wasClick) {
        /* 장비 모드: 다른 장비 활성 상태로 기존 지시선 클릭 → 그 지시선에 넘버 추가 */
        if (_tryAddEquipLabel(clickedItem)) {
          wrap.style.cursor = 'crosshair';
          return;
        }
        selectedItemId = (selectedItemId === clickedItem.id) ? null : clickedItem.id;
        if (onSelectItem) onSelectItem(selectedItemId);
        renderAnnotations(Annotation.getAll());
      } else if (clickedHandle === 'poly' || clickedHandle === 'shape' ||
                 clickedHandle === 'label' || clickedHandle === 'mergedP1') {
        Annotation.updateItem(clickedItem.id, {});   // 도형·번호박스 이동 저장(markDirty)
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

  /* 장비 모드에서 기존 지시선에 활성 장비 넘버 추가 가능 여부 판단 후 실행 */
  function _tryAddEquipLabel(item) {
    if (typeof AppMode === 'undefined' || AppMode.get() !== AppMode.MODES.EQUIP) return false;
    if (typeof Equipment === 'undefined') return false;
    const eq = Equipment.getActive();
    if (!eq || eq.kind !== 'leader') return false;
    if (item.shape) return false;                      // 도형에는 라벨 추가 안 함
    if (!item.equipment) return false;                 // 외관 항목은 제외
    if (item.equipment === eq.key) return false;       // 같은 장비면 선택 동작 유지
    /* 이미 같은 장비가 묶여 있어도 계속 쌓을 수 있다 (SZ-01 위에 SZ-02 …) */
    if (!onAddLabelCb) return false;
    const label = onAddLabelCb(item.id, { key: eq.key, color: eq.color });
    if (!label) return false;
    /* 더블클릭(메모 편집)의 첫 클릭으로 추가된 것이면 되돌릴 수 있게 기록해 둔다 */
    lastAutoLabel = { itemId: item.id, lid: label.lid, t: performance.now() };
    return true;
  }

  function _hitTest(cp) {
    const items = Annotation.getAll();
    const scale = Annotation.getConfig().scale || 1;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const sk = _shapeKind(item.shape);
      /* 도형 번호박스 — 도형 본체보다 먼저 판정해 드래그 이동 가능하게 */
      if (sk === 'tilt' || sk === 'settle') {
        const lr = _shapeLabelRect(item, scale);
        if (lr && cp.x >= lr.x && cp.x <= lr.x + lr.w && cp.y >= lr.y && cp.y <= lr.y + lr.h)
          return { item, handle: 'label' };
      }
      if (sk === 'settle') {
        const pts = item.points || [];
        for (const p of pts) if (Math.hypot(cp.x - p.x, cp.y - p.y) < 9 * scale) return { item, handle: 'poly' };
        const r = pts.length ? _settleRect(pts, scale) : null;
        if (r && cp.x >= r.x1 && cp.x <= r.x2 && cp.y >= r.y1 && cp.y <= r.y2) return { item, handle: 'poly' };
        continue;
      }
      if (sk === 'tilt') {
        if (Math.hypot(cp.x - item.p1.x, cp.y - item.p1.y) < 10 * scale) return { item, handle: 'p1' };
        if (Math.hypot(cp.x - item.p2.x, cp.y - item.p2.y) < 10 * scale) return { item, handle: 'p2' };
        if (_pointInPolygon(cp, _tiltVerts(item.p1, item.p2, _tiltAxisOf(item))))
          return { item, handle: 'shape' };
        continue;
      }
      if (item.shape) continue;
      if (Math.hypot(cp.x - item.p2.x, cp.y - item.p2.y) < 14 * scale)
        return { item, handle: 'p2' };
      /* 스택된 번호박스 전체를 p2 핸들로 취급 — 박스가 여러 개여도 아래쪽까지 잡힌다 */
      for (const r of _leaderBoxRects(item, scale)) {
        if (cp.x >= r.x && cp.x <= r.x + r.w && cp.y >= r.y && cp.y <= r.y + r.h)
          return { item, handle: 'p2' };
      }
      if (Math.hypot(cp.x - item.p1.x, cp.y - item.p1.y) < 10 * scale)
        return { item, handle: 'p1' };
      /* 유지된 병합 지시선의 지시점 */
      if (item.merged && item.mergeKeepLeaders) {
        for (const m of item.merged) {
          if (m.p1 && Math.hypot(cp.x - m.p1.x, cp.y - m.p1.y) < 10 * scale)
            return { item, handle: 'mergedP1', sub: m };
        }
      }
    }
    return null;
  }

  /* 번호박스 사각형 단위 히트 테스트 — 세로로 쌓인 박스 중 어느 것인지 구분한다.
     반환 ref: '' = 본체 | 'L<lid>' = 묶인 장비 번호 */
  function _hitTestBox(cp) {
    const items = Annotation.getAll();
    const scale = Annotation.getConfig().scale || 1;
    const inside = (r) => cp.x >= r.x && cp.x <= r.x + r.w && cp.y >= r.y && cp.y <= r.y + r.h;
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (item.shape) {
        const lr = _shapeLabelRect(item, scale);
        if (lr && inside(lr)) return { item, ref: '' };
        continue;
      }
      const rects = _leaderBoxRects(item, scale);
      for (const r of rects) if (inside(r)) return { item, ref: r.ref };
    }
    return null;
  }

  /* 지시선 항목의 번호박스들 (스택 순서대로) — 그리기와 같은 치수·간격을 사용 */
  function _leaderBoxRects(item, scale) {
    if (!item.p2) return [];
    const boxes = _buildBoxList(item, Annotation.getConfig().prefix);
    const stepY = _stackStepY(scale);
    return boxes.map((b, i) => {
      const m  = _measureNumBox(b.text, scale);
      const cx = item.p2.x, cy = item.p2.y + i * stepY;
      return { x: cx - m.bw / 2, y: cy - m.bh / 2, w: m.bw, h: m.bh, ref: b.ref };
    });
  }

  /* 번호박스 더블클릭 → 메모 편집 */
  function _onDblClick(e) {
    if (e.button !== 0 || !paperW) return;
    if (mergeMode || drawState.phase !== 0) return;
    const hit = _hitTestBox(_toCanvasPos(e.clientX, e.clientY));
    if (!hit) return;
    /* 첫 클릭이 장비 넘버를 쌓아 버렸다면 되돌린다 — 더블클릭은 메모 편집 의도 */
    if (lastAutoLabel && lastAutoLabel.itemId === hit.item.id &&
        performance.now() - lastAutoLabel.t < 600) {
      Annotation.removeSub(lastAutoLabel.itemId, 'L' + lastAutoLabel.lid);
      lastAutoLabel = null;
    }
    dragState.active = false;
    dragState.item   = null;
    dragState.sub    = null;
    mousedownPos     = null;
    if (onEditNoteCb) onEditNoteCb(hit.item.id, hit.ref);
  }

  /* ── 합치기 모드 ── */
  function setMergeMode(on) {
    mergeMode = !!on;
    if (!mergeMode) mergeSel = [];
    else {
      selectedItemId = null;
      cancelDraw();
      /* 툴바 버튼 클릭으로 켜지므로 재진입 대기가 걸려 있다 — 첫 선택 클릭이 먹히지 않게 해제 */
      needsReactivation = false;
    }
    wrap.style.cursor = mergeMode ? 'pointer' : 'crosshair';
    if (onMergeSelCb) onMergeSelCb(mergeSel.slice());
    renderAnnotations(Annotation.getAll());
  }
  function isMergeMode()  { return mergeMode; }
  function getMergeSel()  { return mergeSel.slice(); }

  function _toggleMergeSel(id) {
    const idx = mergeSel.indexOf(id);
    if (idx === -1) mergeSel.push(id);
    else            mergeSel.splice(idx, 1);
    if (onMergeSelCb) onMergeSelCb(mergeSel.slice());
    renderAnnotations(Annotation.getAll());
  }

  /* 도형 번호박스만 이동 — 기본 위치 대비 오프셋으로 저장 */
  function _translateLabel(item, cp) {
    const dx = cp.x - dragState.lastCp.x;
    const dy = cp.y - dragState.lastCp.y;
    dragState.lastCp = { x: cp.x, y: cp.y };
    const off = item.labelOff || { x: 0, y: 0 };
    item.labelOff = { x: off.x + dx, y: off.y + dy };
  }

  /* 도형 전체 이동 (직전 커서 대비 delta 만큼 평행이동) */
  function _translateShape(item, cp) {
    const dx = cp.x - dragState.lastCp.x;
    const dy = cp.y - dragState.lastCp.y;
    dragState.lastCp = { x: cp.x, y: cp.y };
    if (item.points) {
      item.points.forEach(p => { p.x += dx; p.y += dy; });
    } else {
      if (item.p1) { item.p1.x += dx; item.p1.y += dy; }
      if (item.p2) { item.p2.x += dx; item.p2.y += dy; }
    }
  }

  function _pointInPolygon(pt, poly) {
    if (!poly || poly.length < 3) return false;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /* 부동침하 측정점 좌표 — 직교모드면 직전 점과 수평·수직 정렬 (첫 점은 그대로) */
  function _settlePoint(cp) {
    const last = shapeState.points[shapeState.points.length - 1];
    return last ? _applyOrtho(last, cp) : { x: cp.x, y: cp.y };
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

      /* 이미지 배치 — imgLayout은 어노테이션 경계 판정에만 사용, 실제 이미지는 캔버스 전체에 표시 */
      const L = _computeImageLayout();
      if (L) {
        drawOffX = L.offX; drawOffY = L.offY;
        drawW    = L.dW;   drawH    = L.dH;
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          ctx.drawImage(imgEl, 0, 0, paperW, paperH);
        }
      }
    }

    /* 미리보기 */
    const activeKind = _activeEquipKind();
    const _preColor = () => {
      const cats = Annotation.getCategories();
      const cat  = Annotation.getActiveCategory();
      return (activeKind && typeof Equipment !== 'undefined')
        ? (Equipment.getActive()?.color || '#888')
        : (cats[cat]?.color || '#888');
    };

    if (shapeState.collecting) {
      /* 부동침하 미리보기: 측정점 + 바운딩 사각형 (커서 위치 포함) */
      _drawSettlePreview(shapeState.points, shapeState.cursor, _preColor());
    } else if (drawState.phase === 1 && drawState.p1 && drawState.previewP2) {
      const cfg = Annotation.getConfig();
      if (activeKind === 'tilt') {
        _drawTilt(drawState.p1, drawState.previewP2, cfg.tiltAxis || 'y', _preColor(), true);
      } else {
        _drawLeader({
          p1: drawState.p1, p2: drawState.previewP2,
          type: drawState.tool, lineStyle: cfg.lineStyle, arrowFlip: cfg.arrowFlip,
          color: _preColor(), textColor: cfg.textColor,
          num: 0, preview: true,
        });
      }
    }

    items.forEach(item => {
      const isSelected = (item.id === selectedItemId);
      const boxList = _buildBoxList(item, Annotation.getConfig().prefix);
      if (item.shape) _drawShape({ ...item, boxList, selected: isSelected });
      else            _drawLeader({ ...item, boxList, preview: false, selected: isSelected });
      if (mergeMode) {
        const k = mergeSel.indexOf(item.id);
        if (k !== -1) _drawMergeMark(item, k);
      }
    });

    if (afterRenderCb) afterRenderCb(ctx, drawCanvas.width, drawCanvas.height);
  }

  /* 합치기 대상 표시 — 번호박스를 감싸는 파선 + 선택 순서 (1 = 대표 번호) */
  function _drawMergeMark(item, order) {
    const scale = Annotation.getConfig().scale || 1;
    let r = null;
    if (item.shape) {
      const lr = _shapeLabelRect(item, scale);
      if (lr) r = { x: lr.x, y: lr.y, w: lr.w, h: lr.h };
    } else {
      const rects = _leaderBoxRects(item, scale);
      if (rects.length) {
        const x1 = Math.min(...rects.map(v => v.x));
        const y1 = Math.min(...rects.map(v => v.y));
        const x2 = Math.max(...rects.map(v => v.x + v.w));
        const y2 = Math.max(...rects.map(v => v.y + v.h));
        r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
    }
    if (!r) return;

    const pad = 5 * scale;
    ctx.save();
    ctx.strokeStyle = '#C7830A';
    ctx.lineWidth   = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(r.x - pad, r.y - pad, 8 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#C7830A';
    ctx.fill();
    ctx.fillStyle    = '#fff';
    ctx.font         = `bold ${Math.round(10 * scale)}px "Segoe UI", sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(order + 1), r.x - pad, r.y - pad);
    ctx.restore();
  }

  function _buildLabel(item) {
    return _labelFor(item, Annotation.getConfig().prefix);
  }

  /* 지시선 하나에 표시할 번호박스 목록 (primary + 추가 장비 라벨).
     ref = 더블클릭 메모 편집 대상 식별자 ('' = 본체, 'L<lid>' = 묶인 장비 번호) */
  function _buildBoxList(item, fallbackPrefix) {
    let text = _mergedLabel(item, fallbackPrefix);
    /* 기울기 도형: 측정값이 있으면 둘째 줄에 (2mm) 형태로 표기 */
    if (_shapeKind(item.shape) === 'tilt' && item.measure) text += '\n(' + item.measure + ')';
    const list = [{ text, color: item.color, ref: '' }];
    if (item.labels && item.labels.length) {
      item.labels.forEach(l => {
        list.push({
          text:  _labelFor(l, '') + _noteSuffix(l),
          color: l.color,
          ref:   'L' + l.lid,
        });
      });
    }
    return list;
  }

  /* 합쳐진 번호까지 결합한 본체 레이블 — 접두어가 모두 같으면 접두어 1회 (R-01,02),
     섞여 있으면 각각 표기 (R-01,SZ-01). 메모는 대표 번호의 것만 붙인다. */
  function _mergedLabel(item, fallbackPrefix) {
    const merged = item.merged || [];
    if (!merged.length) return _labelFor(item, fallbackPrefix) + _noteSuffix(item);
    const entries = [item, ...merged];
    const pfx     = _prefixOf(item, fallbackPrefix);
    const same    = entries.every(e => _prefixOf(e, fallbackPrefix) === pfx);
    const body = same
      ? (pfx ? pfx + '-' : '') + entries.map(e => String(e.num).padStart(2, '0')).join(',')
      : entries.map(e => _labelFor(e, fallbackPrefix)).join(',');
    return body + _noteSuffix(item);
  }

  /* 사용자 메모 — 번호 뒤에 한 칸 띄고 같은 줄에 표기 (R-01 중앙부) */
  function _noteSuffix(entry) {
    return entry && entry.note ? ' ' + entry.note : '';
  }

  /* 장비 항목은 장비 접두어, 일반 항목은 페이지 접두어(fallback) 사용 */
  function _prefixOf(entry, fallbackPrefix) {
    if (entry.equipment && typeof Equipment !== 'undefined') {
      const eq = Equipment.get(entry.equipment);
      if (eq) return eq.prefix || '';
    }
    return fallbackPrefix || '';
  }

  /* 레이블 생성 (번호만) */
  function _labelFor(item, fallbackPrefix) {
    const prefix = _prefixOf(item, fallbackPrefix);
    const pfx = prefix ? prefix + '-' : '';
    return pfx + String(item.num).padStart(2, '0');
  }

  function _drawLeader({ p1, p2, type, lineStyle, arrowFlip, color, textColor, num, label, boxList,
                         merged, mergeKeepLeaders, preview, selected }) {
    const scale = preview ? 1 : (Annotation.getConfig().scale || 1);
    ctx.save();
    ctx.globalAlpha  = preview ? 0.5 : 1;
    ctx.strokeStyle  = preview ? '#aaa' : color;
    ctx.fillStyle    = preview ? '#aaa' : color;
    ctx.lineWidth    = drawState.lineWidth * (preview ? 1 : scale);
    ctx.setLineDash(preview ? [5, 4] : []);

    const style = lineStyle || 'straight';
    const nBox  = (!preview && boxList && boxList.length) ? boxList.length : 1;
    const stepY = _stackStepY(scale);

    /* 번호박스가 여러 개일 때 지시선이 닿는 박스
       - 직선: 최하단 박스 | 꺾임(ㄱ·ㄴ·번개): 스택 중간 */
    const anchorK  = nBox > 1 ? (style === 'straight' ? nBox - 1 : (nBox - 1) / 2) : 0;
    const p2Anchor = anchorK ? { x: p2.x, y: p2.y + anchorK * stepY } : p2;

    /* 지시선 없음: 선·지시점 없이 번호박스만 표기 */
    const noLeader = (type === 'none');
    const path = _buildPath(p1, p2Anchor, style);

    if (!noLeader) {
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    /* 스택된 번호박스들을 세로선으로 연결 */
    if (nBox > 1) {
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x, p2.y + (nBox - 1) * stepY);
      ctx.stroke();
    }

    const fwd = path.length >= 2
      ? { x: path[1].x - path[0].x, y: path[1].y - path[0].y }
      : { x: 1, y: 0 };
    const flipActive = arrowFlip ?? Annotation.getConfig().arrowFlip;
    const lineDir    = flipActive ? { x: -fwd.x, y: -fwd.y } : fwd;

    if (noLeader) {
      /* 지시점 표시 없음 */
    } else if (type === 'arrow') {
      _drawArrowHead(p1, lineDir, preview ? '#aaa' : color);
    } else {
      ctx.beginPath();
      ctx.arc(p1.x, p1.y, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 합쳐진 번호의 지시선 유지 — 각자의 지시점에서 이 번호박스까지 그린다 */
    if (!preview && merged && mergeKeepLeaders) {
      merged.forEach(m => {
        if (!m.p1) return;
        const mType = m.type || type;
        if (mType === 'none') return;
        const mPath = _buildPath(m.p1, p2Anchor, m.lineStyle || style);
        const mCol  = m.color || color;
        ctx.save();
        ctx.strokeStyle = mCol;
        ctx.fillStyle   = mCol;
        ctx.lineWidth   = drawState.lineWidth * scale;
        ctx.beginPath();
        ctx.moveTo(mPath[0].x, mPath[0].y);
        for (let i = 1; i < mPath.length; i++) ctx.lineTo(mPath[i].x, mPath[i].y);
        ctx.stroke();
        const mFwd = mPath.length >= 2
          ? { x: mPath[1].x - mPath[0].x, y: mPath[1].y - mPath[0].y }
          : { x: 1, y: 0 };
        const mFlip = m.arrowFlip ?? flipActive;
        const mDir  = mFlip ? { x: -mFwd.x, y: -mFwd.y } : mFwd;
        if (mType === 'arrow') {
          _drawArrowHead(m.p1, mDir, mCol);
        } else {
          ctx.beginPath();
          ctx.arc(m.p1.x, m.p1.y, 4 * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });
    }

    if (!preview) {
      /* 번호박스 목록 — 장비별 개별 박스를 세로로 스택 */
      let boxes = boxList;
      if (!boxes) boxes = (num > 0) ? [{ text: label || String(num), color }] : [];
      boxes.forEach((b, i) => {
        _drawNumBox({ x: p2.x, y: p2.y + i * stepY }, b.text, b.color, textColor || '#fff');
      });
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
      if (!noLeader) {
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 12 * scale, 0, Math.PI * 2);
        ctx.stroke();
      }
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

  /* ── 도형 (item 4) ── */
  /* 도형 종류 정규화 — 구버전 저장 데이터(triangle/polygon)도 새 도형으로 렌더 */
  function _shapeKind(shape) {
    if (shape === 'triangle') return 'tilt';
    if (shape === 'polygon')  return 'settle';
    return shape;
  }

  /* 기울기 — p1=기준점, p2=기울어진(변위) 끝점, axis='y'|'x'
       y축: 수직 기준선(p1→corner) + 아랫변 변위(corner→p2, 좌/우 화살표)
       x축: 수평 기준선(p1→corner) + 오른변 변위(corner→p2, 상/하 화살표)
     corner = 직각 꼭짓점 */
  function _tiltAxisOf(item) { return item.axis === 'x' ? 'x' : 'y'; }

  function _tiltCorner(p1, p2, axis) {
    return axis === 'x' ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
  }
  function _tiltVerts(p1, p2, axis) {
    return [ { x: p1.x, y: p1.y }, _tiltCorner(p1, p2, axis), { x: p2.x, y: p2.y } ];
  }
  function _tiltBounds(p1, p2) {
    return {
      x1: Math.min(p1.x, p2.x), y1: Math.min(p1.y, p2.y),
      x2: Math.max(p1.x, p2.x), y2: Math.max(p1.y, p2.y),
    };
  }

  function _drawTilt(p1, p2, axis, color, preview) {
    const scale  = preview ? 1 : (Annotation.getConfig().scale || 1);
    const corner = _tiltCorner(p1, p2, axis);
    const c      = preview ? '#888' : color;
    ctx.save();
    ctx.strokeStyle = c;
    ctx.fillStyle   = c;
    ctx.lineWidth   = drawState.lineWidth * (preview ? 1 : scale);
    ctx.globalAlpha = preview ? 0.6 : 1;
    ctx.setLineDash(preview ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);         ctx.lineTo(corner.x, corner.y);   // 기준선
    ctx.moveTo(p1.x, p1.y);         ctx.lineTo(p2.x, p2.y);           // 빗변(경사선)
    ctx.moveTo(corner.x, corner.y); ctx.lineTo(p2.x, p2.y);           // 변위변
    ctx.stroke();
    ctx.setLineDash([]);
    /* 화살표는 변위변 끝(p2)에 — 직각 꼭짓점에서 바깥을 향함 */
    const dir = axis === 'x'
      ? { x: 0, y: (p2.y - corner.y) || 1 }
      : { x: (p2.x - corner.x) || 1, y: 0 };
    _drawArrowHead(p2, dir, c);
    ctx.restore();
  }

  /* 부동침하 — 측정점들을 감싸는 사각 테두리 영역 */
  function _settleRect(pts, scale) {
    /* 측정점이 테두리보다 살짝 크게 걸치도록 pad < dotR */
    const dotR = 6 * scale;
    const pad  = 5 * scale;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    pts.forEach(p => {
      if (p.x < x1) x1 = p.x;
      if (p.x > x2) x2 = p.x;
      if (p.y < y1) y1 = p.y;
      if (p.y > y2) y2 = p.y;
    });
    return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad, dotR };
  }

  /* 측정점(채워진 원) + 바운딩 사각 테두리 — 점끼리 연결선은 그리지 않음 */
  function _drawSettle(pts, color, scale, preview) {
    if (!pts || !pts.length) return null;
    const r = _settleRect(pts, scale);
    const c = preview ? '#888' : color;
    ctx.save();
    ctx.strokeStyle = c;
    ctx.fillStyle   = preview ? color : c;
    ctx.lineWidth   = drawState.lineWidth * (preview ? 1 : scale);
    ctx.globalAlpha = preview ? 0.6 : 1;
    ctx.setLineDash(preview ? [5, 4] : []);
    ctx.strokeRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
    ctx.setLineDash([]);
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, r.dotR, 0, Math.PI * 2); ctx.fill(); });
    ctx.restore();
    return r;
  }

  function _drawSettlePreview(points, cursor, color) {
    if (!points.length) return;
    _drawSettle(cursor ? points.concat([cursor]) : points, color, 1, true);
  }

  /* 도형 번호박스의 기준점과 정렬 방향
       hx/hy = 기준점 대비 박스가 놓이는 방향 (-1: 기준점 왼/위, 0: 중앙, 1: 오른/아래)
     기울기는 직각 꼭짓점 바깥쪽, 부동침하는 사각 테두리 위쪽에 둔다. */
  function _shapeLabelAnchor(item, scale) {
    const gap  = 8 * scale;
    const kind = _shapeKind(item.shape);
    if (kind === 'tilt') {
      const axis   = _tiltAxisOf(item);
      const corner = _tiltCorner(item.p1, item.p2, axis);
      /* 삼각형 내부의 반대 방향 = 두 변이 뻗어나가는 방향의 반대 */
      const ox = -Math.sign(item.p2.x - corner.x || item.p1.x - corner.x) || 1;
      const oy = -Math.sign(item.p1.y - corner.y || item.p2.y - corner.y) || 1;
      return { p: { x: corner.x + ox * gap, y: corner.y + oy * gap }, hx: ox, hy: oy };
    }
    if (kind === 'settle' && item.points && item.points.length) {
      const r = _settleRect(item.points, scale);
      return { p: { x: (r.x1 + r.x2) / 2, y: r.y1 - gap }, hx: 0, hy: -1 };
    }
    return null;
  }

  /* 사용자가 드래그로 옮긴 오프셋(labelOff)까지 반영한 최종 박스 사각형 */
  function _shapeLabelRect(item, scale) {
    const a = _shapeLabelAnchor(item, scale);
    if (!a) return null;
    const text = _buildBoxList(item, Annotation.getConfig().prefix)[0].text;
    const m    = _measureNumBox(text, scale);
    const off  = item.labelOff || { x: 0, y: 0 };
    const cx   = a.p.x + a.hx * m.bw / 2 + off.x;
    const cy   = a.p.y + a.hy * m.bh / 2 + off.y;
    return { x: cx - m.bw / 2, y: cy - m.bh / 2, w: m.bw, h: m.bh, cx, cy, text };
  }

  function _drawShape(item) {
    const { color, textColor, boxList, selected } = item;
    const scale = Annotation.getConfig().scale || 1;
    const kind  = _shapeKind(item.shape);
    let bounds  = null;

    if (kind === 'tilt') {
      _drawTilt(item.p1, item.p2, _tiltAxisOf(item), color, false);
      bounds = _tiltBounds(item.p1, item.p2);
    } else if (kind === 'settle') {
      const r = _drawSettle(item.points, color, scale, false);
      if (r) bounds = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 };
    }
    if (!bounds) return;

    if (boxList && boxList.length) {
      const rect = _shapeLabelRect(item, scale);
      if (rect) _drawNumBox({ x: rect.cx, y: rect.cy }, boxList[0].text,
                            boxList[0].color || color, textColor || '#fff');
    }
    if (selected) {
      const m = 6 * scale;
      ctx.save();
      ctx.strokeStyle = '#5B5BD6'; ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]); ctx.globalAlpha = 0.9;
      ctx.strokeRect(bounds.x1 - m, bounds.y1 - m,
                     (bounds.x2 - bounds.x1) + 2 * m, (bounds.y2 - bounds.y1) + 2 * m);
      ctx.restore();
    }
  }

  /* 스택 번호박스 세로 간격 (박스 높이 + 여백) */
  function _stackStepY(scale) {
    return Math.round(12 * scale) + 8 * scale + 5 * scale;
  }

  /* 번호박스 치수 계산 — 그리기와 히트 테스트가 같은 값을 쓰도록 분리.
     label에 '\n'이 있으면 여러 줄 (예: 기울기 "TR-01\n(2mm)") */
  function _measureNumBox(label, scale) {
    const fontSize = Math.round(12 * scale);
    const lines    = String(label).split('\n');
    const font     = `bold ${fontSize}px "Segoe UI", sans-serif`;
    ctx.save();
    ctx.font = font;
    let tw = 0;
    lines.forEach(l => { const w = ctx.measureText(l).width; if (w > tw) tw = w; });
    ctx.restore();
    const padX  = 8 * scale, padY = 4 * scale;
    const lineH = lines.length > 1 ? fontSize + 3 * scale : fontSize;
    return { bw: tw + padX * 2, bh: lines.length * lineH + padY * 2, lines, lineH, padY, font };
  }

  /* p = 박스 중심 */
  function _drawNumBox(p, label, bgColor, textColor) {
    const scale = Annotation.getConfig().scale || 1;
    const m     = _measureNumBox(label, scale);
    const bx    = p.x - m.bw / 2, by = p.y - m.bh / 2;
    const r     = Math.max(3, 4 * scale);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle   = bgColor;
    _roundRect(bx, by, m.bw, m.bh, r);
    ctx.fill();

    ctx.font         = m.font;
    ctx.fillStyle    = textColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    m.lines.forEach((l, i) => ctx.fillText(l, p.x, by + m.padY + m.lineH * i + m.lineH / 2));
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
  function getTool()       { return drawState.tool; }
  function setOrtho(v)     { drawState.ortho    = v; }
  function setLineWidth(w) { drawState.lineWidth = w; renderAnnotations(Annotation.getAll()); }
  function cancelDraw()    {
    drawState.phase = 0; drawState.p1 = null; drawState.previewP2 = null;
    shapeState.collecting = false; shapeState.points = []; shapeState.cursor = null;
    renderAnnotations(Annotation.getAll());
  }

  /* 부동침하 확정 (Enter) — 측정점 2개 이상이면 도형 생성 */
  function finishShape() {
    if (!shapeState.collecting) return;
    const pts = shapeState.points.slice();
    shapeState.collecting = false; shapeState.points = []; shapeState.cursor = null;
    if (pts.length >= 2 && onAddShapeCb) {
      onAddShapeCb('settle', { points: pts });
    } else {
      renderAnnotations(Annotation.getAll());
    }
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
  function onAddLabel(cb)     { onAddLabelCb      = cb; }
  function onAddShape(cb)     { onAddShapeCb      = cb; }

  /* ── 오프스크린 페이지 렌더 (다중 페이지 PDF 내보내기용) ──
     imgLayout이 있으면 화면 표시와 동일한 고정 좌표 사용 → 지시점 위치 픽셀 일치 보장.
     없으면(레거시 데이터) 동적 계산 폴백. */
  async function createPageExport(imgSrc, origW, origH, annJSON, imgLayout, legendEquip) {
    const landscape = origW >= origH;
    const pW = Math.round((landscape ? 297 : 210) * A4_PX_MM);
    const pH = Math.round((landscape ? 210 : 297) * A4_PX_MM);

    let offX, offY, dW, dH;

    if (imgLayout) {
      /* 신규 데이터: pageManager가 저장한 고정 좌표 그대로 사용 */
      offX = imgLayout.offX; offY = imgLayout.offY;
      dW   = imgLayout.dW;   dH   = imgLayout.dH;
    } else {
      /* 레거시 폴백: 동적 계산 — 도곽 예약 포함, 가용 영역 중앙 배치 */
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
        /* imgSrc는 A4 캔버스 dataURL — 캔버스 전체에 그대로 표시 */
        offCtx.drawImage(tmp, 0, 0, pW, pH);
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
        const boxList = _buildBoxList(item, annPrefix);
        if (item.shape) _drawShape({ ...item, boxList });
        else            _drawLeader({ ...item, boxList, preview: false });
      });

      ctx = savedCtx;
      paperW = savedPW; paperH = savedPH;
      drawW  = savedDW; drawH  = savedDH;
      drawOffX = savedOX; drawOffY = savedOY;
    }

    if (typeof TitleBlock !== 'undefined' && TitleBlock.isEnabled()) {
      TitleBlock.render(offCtx, pW, pH);
    }
    if (typeof Legend !== 'undefined' && Legend.isEnabled()) {
      Legend.render(offCtx, pW, pH, legendEquip);
    }

    return { canvas: off, w: pW, h: pH };
  }

  function getSelectedId() { return selectedItemId; }
  function clearSelection() {
    selectedItemId = null;
    renderAnnotations(Annotation.getAll());
  }
  /* 사이드바 목록에서 선택 — onSelectItem 콜백은 호출하지 않는다(사이드바 선택이 되돌려 지워짐 방지) */
  function selectItem(id) {
    if (mergeMode) return;
    selectedItemId = (id === null || id === undefined) ? null : Number(id);
    renderAnnotations(Annotation.getAll());
  }

  /* ── 캔버스 비우기 (작업공간 전환 시 이전 도면 제거) ── */
  function clear() {
    imgW = imgH = paperW = paperH = 0;
    _imgLayout = null;
    drawState.phase = 0; drawState.p1 = null; drawState.previewP2 = null;
    selectedItemId = null;
    if (imgEl) { imgEl.onload = null; imgEl.src = ''; imgEl.style.display = 'none'; }
    if (drawCanvas) { drawCanvas.width = 0; drawCanvas.height = 0; }
    if (container) { container.style.width = '0px'; container.style.height = '0px'; }
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
      const boxList = _buildBoxList(item, annCfg.prefix);
      if (item.shape) _drawShape({ ...item, boxList });
      else            _drawLeader({ ...item, boxList, preview: false, selected: false });
    });

    ctx    = savedCtx;
    paperW = savedPW;
    paperH = savedPH;
  }

  function onEditNote(cb)   { onEditNoteCb = cb; }
  function onMergeSel(cb)   { onMergeSelCb = cb; }

  return {
    init, loadImage, fitToView, renderAnnotations,
    setTool, getTool, setOrtho, setLineWidth, cancelDraw, deactivate,
    getCanvasSize, getCanvas, getImage,
    zoomIn, zoomOut, onAdd, onStateChange, setAfterRender, onAddLabel, onAddShape, finishShape,
    createPageExport, renderAnnotationsTo,
    getSelectedId, clearSelection, selectItem, clear, onSelect,
    onEditNote, onMergeSel, setMergeMode, isMergeMode, getMergeSel,
  };
})();
