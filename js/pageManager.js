/* pageManager.js — 다중 페이지(도면) 관리 */
'use strict';

const PageManager = (() => {
  /* 페이지 구조: { id, name, imgSrc, imgW, imgH, imgLayout, annJSON }
     imgLayout: { offX, offY, dW, dH } — canvas.js와 동일한 파라미터로 계산된 이미지 배치 좌표.
     저장 시 이 값을 그대로 사용하므로 화면 표시와 PDF 저장이 픽셀 단위로 일치. */
  let pages       = [];
  let activeId    = null;
  let onSwitch    = null;
  let onListChange = null;
  let nextPageId  = 1;

  /* A4 기준 치수 (150dpi) */
  const A4 = {
    portrait:  { w: 1240, h: 1754 },
    landscape: { w: 1754, h: 1240 },
  };

  function init(switchCb, listCb) {
    onSwitch     = switchCb;
    onListChange = listCb;
  }

  /* ── PDF 저장 가능 페이지 수 ──
     라이선스 증서의 features.maxPages 에서 온다. 0 = 무제한(정품).
     상태를 알 수 없으면 제한이 걸린 쪽(1장)으로 간다.
     ⚠ 편집(불러오기·페이지 추가)에는 제한을 걸지 않는다 — 체험판도 전체 도면을
       작업해 볼 수 있어야 유료 전환 판단이 가능하다. 게이트는 PDF 저장에만 있다. */
  function _maxPages() {
    if (typeof LicenseUI === 'undefined') return 1;
    return LicenseUI.getMaxPages();
  }

  /* ── 단일 이미지 페이지 생성 ── */
  function addImagePage(imgSrc, imgW, imgH, name, imgLayout) {
    _saveCurrentAnnotations();
    const page = _createPage(name || ('도면 ' + (pages.length + 1)), imgSrc, imgW, imgH, imgLayout);
    pages.push(page);
    _activate(page.id);
  }

  /* ── 파일 객체에서 페이지 추가 (A4 자동 맞춤 포함) ── */
  function addPageFromFile(file, callback) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) {
      if (callback) callback('unsupported');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const { dataURL, w, h, imgLayout } = _fitImageToA4(img, img.naturalWidth, img.naturalHeight);
        addImagePage(dataURL, w, h, file.name, imgLayout);
        if (callback) callback('ok');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── PDF 전 페이지 일괄 추가 ──
     append=true : 기존 페이지 유지 후 끝에 추가
     append=false: 기존 페이지 초기화 후 새로 시작 */
  async function loadPDFPages(pdfDoc, progressCb, append = false) {
    if (!append) {
      pages      = [];
      nextPageId = 1;
      Annotation.clear();
    } else {
      _saveCurrentAnnotations();
    }

    const total    = pdfDoc.numPages;
    const firstNew = pages.length;
    let   added    = 0;

    for (let i = 1; i <= total; i++) {
      if (progressCb) progressCb(i, total);
      const { dataURL, w, h, imgLayout } = await _renderPDFPage(pdfDoc, i);
      const defaultName = total === 1 ? '도면' : `P${i}`;
      pages.push(_createPage(defaultName, dataURL, w, h, imgLayout));
      added++;
    }

    if (pages.length) _activate(pages[Math.min(firstNew, pages.length - 1)].id);
    return { added, total };
  }

  /* ── 전체 초기화 ── */
  function clearAll() {
    pages      = [];
    nextPageId = 1;
    activeId   = null;
    _scaledCache.clear();
    Annotation.clear();
  }

  /* ── 페이지 전환 ── */
  function switchTo(id) {
    if (id === activeId) return;
    _saveCurrentAnnotations();
    _activate(id);
  }

  /* ── 페이지 이름 변경 ── */
  function renamePage(id, name) {
    const p = _getById(id);
    if (p) { p.name = name; if (onListChange) onListChange(); }
  }

  /* ── 페이지 순서 이동 (드래그 앤드롭) ── */
  function movePage(fromId, toId) {
    const fromIdx = pages.findIndex(p => p.id === fromId);
    const toIdx   = pages.findIndex(p => p.id === toId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
    const [moved] = pages.splice(fromIdx, 1);
    pages.splice(toIdx, 0, moved);
    if (onListChange) onListChange();
  }

  /* ── 페이지 삭제 ── */
  function removePage(id) {
    if (pages.length <= 1) return false;
    const idx = pages.findIndex(p => p.id === id);
    if (idx === -1) return false;
    pages.splice(idx, 1);
    if (Number(activeId) === Number(id)) {
      _activate(pages[Math.min(idx, pages.length - 1)].id);
    } else {
      if (onListChange) onListChange();
    }
  }

  /* ── 접근자 ── */
  function getPages()      { return pages; }
  function getActivePage() { return _getById(activeId); }
  function getActiveId()   { return activeId; }
  function hasPages()      { return pages.length > 0; }

  /* ── 직렬화 ── */
  function toJSON() {
    _saveCurrentAnnotations();
    return JSON.stringify({ pages, activeId, nextPageId });
  }

  function fromJSON(json) {
    try {
      const d = JSON.parse(json);
      pages      = d.pages      || [];
      nextPageId = d.nextPageId || pages.length + 1;
      _scaledCache.clear();   // 페이지 id가 재사용되므로 이전 합성본은 버린다

      const targetId = (pages.some(p => p.id === d.activeId) ? d.activeId : null) || (pages[0] && pages[0].id);
      if (targetId) _activate(targetId, true /* skipSave */);
      if (onListChange) onListChange();
    } catch (e) { console.error('PageManager.fromJSON 실패', e); }
  }

  /* ── 내부 헬퍼 ── */
  function _createPage(name, imgSrc, imgW, imgH, imgLayout) {
    /* equipStart: 사용자가 이 페이지에서 시작번호를 직접 지정했을 때만 값이 들어간다.
       null이면 앞 페이지들의 마지막 번호 다음부터 자동 이어받기 */
    /* imgSrc·imgLayout 은 배율 1.0 기준 원본이다. 사용자가 도면 크기를 바꿔도
       이 값은 건드리지 않고 imgScale 만 저장한 뒤 표시용을 매번 다시 합성한다.
       (원본을 덮어쓰면 확대·축소를 반복할 때 화질이 계속 나빠진다) */
    return { id: nextPageId++, name, imgSrc, imgW, imgH, imgLayout: imgLayout || null, imgScale: 1,
             annJSON: null, drawingName: null, prefix: '', legendEquip: null, equipStart: null };
  }

  function _getById(id) { return pages.find(p => p.id === id); }

  function _saveCurrentAnnotations() {
    const p = _getById(activeId);
    if (p) p.annJSON = Annotation.toJSON();
  }

  /* 이 페이지 앞쪽 페이지들에서 장비별로 마지막에 쓴 번호 + 1 (없으면 1) */
  function _autoEquipStart(pageId) {
    if (typeof Equipment === 'undefined') return null;
    const idx = pages.findIndex(p => p.id === pageId);
    const max = {};
    const scan = (list) => (list || []).forEach(i => {
      if (i.equipment) max[i.equipment] = Math.max(max[i.equipment] || 0, i.num || 0);
      if (i.labels) i.labels.forEach(l => {
        max[l.equipment] = Math.max(max[l.equipment] || 0, l.num || 0);
      });
    });
    pages.slice(0, idx < 0 ? pages.length : idx).forEach(p => {
      if (!p.annJSON) return;
      try { scan(JSON.parse(p.annJSON).items); } catch { /* 손상된 페이지는 건너뜀 */ }
    });
    const out = {};
    Equipment.getList().forEach(e => { out[e.key] = (max[e.key] || 0) + 1; });
    return out;
  }

  function _activate(id, skipSave = false) {
    if (!skipSave) _saveCurrentAnnotations();
    activeId = id;
    const p  = _getById(id);
    if (!p) return;

    /* 페이지별 시작번호 적용 — 지정값이 없으면 앞 페이지에서 이어받기 */
    if (typeof Equipment !== 'undefined') {
      Equipment.setStarts(p.equipStart || _autoEquipStart(id));
    }

    if (onSwitch) onSwitch(p);

    if (p.annJSON) {
      Annotation.fromJSON(p.annJSON);
    } else {
      Annotation.clear();
    }

    if (onListChange) onListChange();
  }

  /* PDF 페이지 → A4 캔버스 dataURL */
  async function _renderPDFPage(pdfDoc, pageNum) {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const raw      = document.createElement('canvas');
    raw.width      = viewport.width;
    raw.height     = viewport.height;
    await page.render({ canvasContext: raw.getContext('2d'), viewport }).promise;
    return _fitCanvasToA4(raw, viewport.width, viewport.height);
  }

  /* Image 객체 → A4 캔버스 (imgLayout 포함 반환) */
  function _fitImageToA4(imgEl, natW, natH) {
    const isLandscape = natW > natH;
    const { w: a4w, h: a4h } = isLandscape ? A4.landscape : A4.portrait;
    const out = document.createElement('canvas');
    out.width  = a4w;
    out.height = a4h;
    const ctx  = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, a4w, a4h);
    const { x, y, w, h } = _calcFitRect(natW, natH, a4w, a4h);
    ctx.drawImage(imgEl, x, y, w, h);
    return { dataURL: out.toDataURL('image/png'), w: a4w, h: a4h, imgLayout: { offX: x, offY: y, dW: w, dH: h } };
  }

  /* Canvas 소스 → A4 캔버스 (imgLayout 포함 반환) */
  function _fitCanvasToA4(srcCanvas, natW, natH) {
    const isLandscape = natW > natH;
    const { w: a4w, h: a4h } = isLandscape ? A4.landscape : A4.portrait;
    const out = document.createElement('canvas');
    out.width  = a4w;
    out.height = a4h;
    const ctx  = out.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, a4w, a4h);
    const { x, y, w, h } = _calcFitRect(natW, natH, a4w, a4h);
    ctx.drawImage(srcCanvas, x, y, w, h);
    return { dataURL: out.toDataURL('image/png'), w: a4w, h: a4h, imgLayout: { offX: x, offY: y, dW: w, dH: h } };
  }

  /* 이미지를 A4 캔버스 도곽 위 영역에 Contain 배치하는 좌표 계산
     — 좌우·상단 10mm 여백, 하단은 10mm + 도곽 20mm = 30mm 예약
     — 가용 영역 안에서 중앙 배치, 비율 유지(contain) */
  function _calcFitRect(natW, natH, a4w, a4h) {
    const isLandscape = a4w > a4h;
    const a4Mm = isLandscape ? 297 : 210;
    const pxMm = a4w / a4Mm;
    const mPx  = Math.round(10 * pxMm);   // 10mm 상하좌우 기본 여백
    const tbPx = Math.round(20 * pxMm);   // 20mm 도곽 예약 (하단)
    const avW  = a4w - 2 * mPx;
    const avH  = Math.max(10, a4h - 2 * mPx - tbPx);
    const scl  = Math.min(avW / natW, avH / natH);
    const w    = Math.round(natW * scl);
    const h    = Math.round(natH * scl);
    const x    = mPx + Math.round((avW - w) / 2);
    const y    = mPx + Math.round((avH - h) / 2);
    return { x, y, w, h };
  }

  /* ═══════════ 도면 크기 조절 ═══════════
     표시용 합성 결과는 페이지에 붙이지 않고 별도 캐시에 둔다 —
     페이지 객체는 그대로 직렬화되므로 저장 용량이 늘지 않는다. */
  const _scaledCache = new Map();   // pageId → { scale, src }

  const MIN_SCALE = 0.3, MAX_SCALE = 2.5;

  function clampScale(v) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(v) || 1));
  }

  /* 배율 적용 후의 이미지 배치 — 원본 배치의 중심을 유지한 채 확대·축소 */
  function scaledLayout(page) {
    const base = page.imgLayout;
    if (!base) return null;
    const s  = page.imgScale || 1;
    const cx = base.offX + base.dW / 2;
    const cy = base.offY + base.dH / 2;
    const dW = base.dW * s, dH = base.dH * s;
    return { offX: Math.round(cx - dW / 2), offY: Math.round(cy - dH / 2), dW: Math.round(dW), dH: Math.round(dH) };
  }

  /* 표시·저장에 쓸 이미지 소스 — 배율이 1이면 원본을 그대로 쓴다 */
  async function getDisplaySrc(page) {
    const s = page.imgScale || 1;
    if (!page.imgLayout || Math.abs(s - 1) < 0.001) return page.imgSrc;

    const hit = _scaledCache.get(page.id);
    if (hit && Math.abs(hit.scale - s) < 0.001) return hit.src;

    const src = await _recomposite(page);
    _scaledCache.set(page.id, { scale: s, src });
    return src;
  }

  /* 원본 합성본에서 도면 영역만 오려 새 배율로 다시 앉힌다 */
  function _recomposite(page) {
    return new Promise(resolve => {
      const base = page.imgLayout;
      const out  = scaledLayout(page);
      const img  = new Image();
      img.onload = () => {
        const cv  = document.createElement('canvas');
        cv.width  = page.imgW;
        cv.height = page.imgH;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, base.offX, base.offY, base.dW, base.dH,
                           out.offX,  out.offY,  out.dW,  out.dH);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => resolve(page.imgSrc);
      img.src = page.imgSrc;
    });
  }

  /* 배율 변경 — 넘버링 좌표도 같은 비율로 옮겨 도면 위 위치를 유지한다.
     반환값의 ratio 는 이전 배율 대비 변화량이다. */
  function setImageScale(id, scale) {
    const page = _getById(id);
    if (!page || !page.imgLayout) return null;
    const prev = page.imgScale || 1;
    const next = clampScale(scale);
    if (Math.abs(next - prev) < 0.001) return null;

    page.imgScale = next;
    const base = page.imgLayout;
    const cx = base.offX + base.dW / 2;
    const cy = base.offY + base.dH / 2;
    const r  = next / prev;

    if (typeof Annotation !== 'undefined') {
      Annotation.transformCoords((x, y) => ({ x: cx + (x - cx) * r, y: cy + (y - cy) * r }));
    }
    _saveCurrentAnnotations();
    return { scale: next, ratio: r, layout: scaledLayout(page) };
  }

  function getImageScale(id) {
    const p = _getById(id === undefined ? activeId : id);
    return p ? (p.imgScale || 1) : 1;
  }

  /* PDF 저장 전 현재 페이지 상태 수동 저장 */
  function saveCurrentPageState() { _saveCurrentAnnotations(); }

  return {
    init, addImagePage, addPageFromFile, loadPDFPages, clearAll,
    switchTo, renamePage, removePage, movePage,
    getPages, getActivePage, getActiveId, hasPages,
    toJSON, fromJSON,
    saveCurrentPageState,
    setImageScale, getImageScale, getDisplaySrc, scaledLayout, clampScale,
    getMaxPages: _maxPages,
  };
})();
