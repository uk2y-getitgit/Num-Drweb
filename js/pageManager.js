/* pageManager.js — 다중 페이지(도면) 관리 */
'use strict';

const PageManager = (() => {
  /* 페이지 구조: { id, name, imgSrc, imgW, imgH, annJSON, nextNum, nextId } */
  let pages       = [];
  let activeId    = null;
  let onSwitch    = null;   // (page) 콜백 — 캔버스 전환 시 호출
  let onListChange = null;  // () 콜백 — 목록 UI 갱신 시 호출
  let nextPageId  = 1;

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

  /* ── 페이지 추가 (파일 선택 후 호출) ── */
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
        addImagePage(e.target.result, img.naturalWidth, img.naturalHeight, file.name);
        if (callback) callback('ok');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  /* ── PDF 전 페이지 일괄 추가 ──
     append=true : 기존 페이지 유지 후 끝에 추가
     append=false: 기존 페이지 초기화 후 새로 시작 (기본) */
  async function loadPDFPages(pdfDoc, progressCb, append = false) {
    _saveCurrentAnnotations();

    if (!append) {
      pages = [];
      nextPageId = 1;
    }

    const total     = pdfDoc.numPages;
    const firstNew  = pages.length; // append 모드에서 첫 신규 페이지 인덱스

    for (let i = 1; i <= total; i++) {
      if (progressCb) progressCb(i, total);
      const { dataURL, w, h } = await _renderPDFPage(pdfDoc, i);
      const defaultName = total === 1 ? '도면' : `P${i}`;
      pages.push(_createPage(defaultName, dataURL, w, h));
    }

    /* append 시 첫 번째 신규 페이지로 이동, 신규 시 첫 페이지로 이동 */
    if (pages.length) _activate(pages[firstNew].id);
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
    if (pages.length <= 1) return false; // 마지막 페이지 삭제 불가
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
      pages      = d.pages       || [];
      nextPageId = d.nextPageId  || pages.length + 1;
      const targetId = d.activeId || (pages[0] && pages[0].id);
      if (targetId) _activate(targetId, true /* skipSave */);
      if (onListChange) onListChange();
    } catch (e) { console.error('PageManager.fromJSON 실패', e); }
  }

  /* ── 내부 헬퍼 ── */
  function _createPage(name, imgSrc, imgW, imgH) {
    return { id: nextPageId++, name, imgSrc, imgW, imgH, annJSON: null };
  }

  function _getById(id) { return pages.find(p => p.id === id); }

  function _saveCurrentAnnotations() {
    const p = _getById(activeId);
    if (p) p.annJSON = Annotation.toJSON();
  }

  function _activate(id, skipSave = false) {
    if (!skipSave) _saveCurrentAnnotations();
    activeId = id;
    const p = _getById(id);
    if (!p) return;

    /* ① 이미지 먼저 로드 — loadImage()가 drawCanvas.width를 재설정해 캔버스를 초기화하므로
          반드시 Annotation 복원보다 앞서야 한다 */
    if (onSwitch) onSwitch(p);

    /* ② 캔버스 크기 확정 후 Annotation 복원 → onChange → renderAnnotations() */
    if (p.annJSON) {
      Annotation.fromJSON(p.annJSON);
    } else {
      Annotation.clear();
    }

    if (onListChange) onListChange();
  }

  /* PDF 페이지를 dataURL로 렌더 */
  async function _renderPDFPage(pdfDoc, pageNum) {
    const page     = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { dataURL: canvas.toDataURL('image/png'), w: viewport.width, h: viewport.height };
  }

  return {
    init, addImagePage, addPageFromFile, loadPDFPages,
    switchTo, renamePage, removePage,
    getPages, getActivePage, getActiveId, hasPages,
    toJSON, fromJSON,
  };
})();
