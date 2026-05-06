/* pageManager.js — 다중 페이지(도면) 관리 */
'use strict';

const PageManager = (() => {
  /* 페이지 구조: { id, name, imgSrc, imgW, imgH, annJSON } */
  let pages       = [];
  let activeId    = null;
  let onSwitch    = null;
  let onListChange = null;
  let nextPageId  = 1;

  /* A4 기준 치수 (150dpi) — 이미지 배치 영역 계산용 */
  const A4 = {
    portrait:  { w: 1240, h: 1754 },
    landscape: { w: 1754, h: 1240 },
    imgMargin: 30,   // 이미지와 A4 외곽 사이 여백(px)
    tbReserve: 80,   // 하단 도곽 예약 영역 높이(px)
  };

  function init(switchCb, listCb) {
    onSwitch     = switchCb;
    onListChange = listCb;
  }

  /* ── 단일 이미지 페이지 생성 ── */
  function addImagePage(imgSrc, imgW, imgH, name) {
    _saveCurrentAnnotations();
    const page = _createPage(name || ('도면 ' + (pages.length + 1)), imgSrc, imgW, imgH);
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
        const { dataURL, w, h } = _fitImageToA4(img, img.naturalWidth, img.naturalHeight);
        addImagePage(dataURL, w, h, file.name);
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

    for (let i = 1; i <= total; i++) {
      if (progressCb) progressCb(i, total);
      const { dataURL, w, h } = await _renderPDFPage(pdfDoc, i);
      const defaultName = total === 1 ? '도면' : `P${i}`;
      pages.push(_createPage(defaultName, dataURL, w, h));
    }

    if (pages.length) _activate(pages[firstNew].id);
  }

  /* ── 전체 초기화 ── */
  function clearAll() {
    pages      = [];
    nextPageId = 1;
    activeId   = null;
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
      const targetId = d.activeId || (pages[0] && pages[0].id);
      if (targetId) _activate(targetId, true /* skipSave */);
      if (onListChange) onListChange();
    } catch (e) { console.error('PageManager.fromJSON 실패', e); }
  }

  /* ── 내부 헬퍼 ── */
  function _createPage(name, imgSrc, imgW, imgH) {
    return { id: nextPageId++, name, imgSrc, imgW, imgH, annJSON: null, drawingName: null, prefix: '' };
  }

  function _getById(id) { return pages.find(p => p.id === id); }

  function _saveCurrentAnnotations() {
    const p = _getById(activeId);
    if (p) p.annJSON = Annotation.toJSON();
  }

  function _activate(id, skipSave = false) {
    if (!skipSave) _saveCurrentAnnotations();
    activeId = id;
    const p  = _getById(id);
    if (!p) return;

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

  /* Image 객체 → A4 캔버스 */
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
    return { dataURL: out.toDataURL('image/png'), w: a4w, h: a4h };
  }

  /* Canvas 소스 → A4 캔버스 */
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
    return { dataURL: out.toDataURL('image/png'), w: a4w, h: a4h };
  }

  /* 이미지를 A4 내부 여백 영역(Contain)에 배치하는 좌표 계산 */
  function _calcFitRect(natW, natH, a4w, a4h) {
    const M   = A4.imgMargin;
    const TB  = A4.tbReserve;
    const avW = a4w - M * 2;
    const avH = a4h - M * 2 - TB;
    const scl = Math.min(avW / natW, avH / natH);
    const w   = Math.round(natW * scl);
    const h   = Math.round(natH * scl);
    const x   = Math.round((a4w - w) / 2);
    const y   = Math.round(M + (avH - h) / 2);
    return { x, y, w, h };
  }

  /* PDF 저장 전 현재 페이지 상태 수동 저장 */
  function saveCurrentPageState() { _saveCurrentAnnotations(); }

  return {
    init, addImagePage, addPageFromFile, loadPDFPages, clearAll,
    switchTo, renamePage, removePage,
    getPages, getActivePage, getActiveId, hasPages,
    toJSON, fromJSON,
    saveCurrentPageState,
  };
})();
