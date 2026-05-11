/* app.js — 메인 진입점 & 이벤트 연결 */
'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  /* ── DOM 참조 ── */
  const wrap           = document.getElementById('canvas-wrap');   // 드래그앤드롭용
  const canvasArea     = document.getElementById('canvas-area');   // CanvasManager용 (D)
  const container      = document.getElementById('canvas-container');
  const imgEl          = document.getElementById('drawing-img');
  const drawCanvas     = document.getElementById('drawing-canvas');
  const interactionLayer = document.getElementById('interaction-layer');
  const dropzone       = document.getElementById('dropzone');
  const statusMsg      = document.getElementById('status-msg');
  const orthoToggle    = document.getElementById('ortho-toggle');

  /* ── CanvasManager 초기화 (canvas-area 전달 — D) ── */
  CanvasManager.init(canvasArea, container, imgEl, drawCanvas, interactionLayer);

  CanvasManager.setAfterRender((ctx, w, h) => {
    if (TitleBlock.isEnabled() && w) TitleBlock.render(ctx, w, h);
  });

  /* ── Annotation 초기화 ── */
  Annotation.init(() => {
    const items = Annotation.getAll();
    FileManager.autoMatch(items, Annotation.getConfig().prefix);
    CanvasManager.renderAnnotations(items);
    Sidebar.renderNumList(items, _collectAllPagesData());
    const cv = document.querySelector('.count-val');
    if (cv) cv.textContent = items.length;
    _updateNextNumDisplay();
    _renderPageList();
    if (!_isRestoring) StorageManager.markDirty();
  });

  /* ── Sidebar 초기화 ── */
  Sidebar.init({
    onSelectNum:  () => { CanvasManager.cancelDraw(); },
    onDeleteNum:  (id) => { Annotation.remove(id); showMsg('넘버링 삭제됨', 'warn'); },
    onMatchPhoto: () => {},
  });

  /* ── 캔버스 선택 해제 시 사이드바 선택도 해제 ── */
  CanvasManager.onSelect(() => {
    Sidebar.clearSelection();
    Sidebar.renderNumList(Annotation.getAll(), _collectAllPagesData());
  });

  /* ── 캔버스 외부(사이드바/툴바/페이지패널) 클릭 시 재진입 대기 ── */
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#canvas-area')) {
      CanvasManager.deactivate();
    }
  }, true);

  /* ── FileManager 초기화 ── */
  FileManager.init((photos) => {
    FileManager.autoMatch(Annotation.getAll(), Annotation.getConfig().prefix);
    Sidebar.renderNumList(Annotation.getAll(), _collectAllPagesData());
    _refreshRenamePreview();
  });

  CanvasManager.onAdd((p1, p2, type) => {
    Annotation.add(p1, p2, type);
    showMsg('넘버 ' + (Annotation.getNextNum() - 1) + ' 추가', 'success');
  });

  CanvasManager.onStateChange((state) => {
    _updateCursorHint(state);
  });

  /* ── PageManager 초기화 ── */
  PageManager.init(
    /* onSwitch */ (page) => {
      CanvasManager.loadImage(page.imgSrc, page.imgW, page.imgH, page.imgLayout || null);
      dropzone.classList.add('has-file');
      document.getElementById('file-name').textContent = page.name;
      /* 페이지별 접두어 복원 */
      Annotation.setConfig({ prefix: page.prefix || '' });
      _syncSettingsUI();
      /* B: 페이지별 Drawing Name 적용 */
      TitleBlock.applySettings({ drawingName: page.drawingName || '' });
    },
    /* onListChange */ () => { _renderPageList(); }
  );

  /* ── TitleBlock 초기화 ── */
  TitleBlock.init();

  /* ── 페이지 패널 추가(+) / 삭제(−) ── */
  const pageAddInput = document.getElementById('page-add-input');

  document.getElementById('btn-page-add').addEventListener('click', () => pageAddInput.click());

  pageAddInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      if (!window.pdfjsLib) { showMsg('PDF.js 로드 대기 중', 'warn'); return; }
      const loading  = document.getElementById('page-panel-loading');
      const loadText = document.getElementById('page-loading-text');
      loading.classList.remove('hidden');
      const buf    = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      await PageManager.loadPDFPages(pdfDoc, (cur, total) => {
        if (loadText) loadText.textContent = `추가 중 ${cur}/${total}`;
      }, true);
      loading.classList.add('hidden');
      showMsg(file.name + ' 페이지 추가 완료', 'success');
    } else {
      PageManager.addPageFromFile(file, status => {
        if (status === 'ok') showMsg(file.name + ' 페이지 추가됨', 'success');
        else showMsg('지원하지 않는 파일 형식입니다', 'warn');
      });
    }
  });

  document.getElementById('btn-page-del').addEventListener('click', () => {
    if (!PageManager.hasPages()) { showMsg('페이지가 없습니다', 'warn'); return; }
    if (PageManager.getPages().length <= 1) { showMsg('마지막 페이지는 삭제할 수 없습니다', 'warn'); return; }
    const active = PageManager.getActivePage();
    if (!active) return;
    if (!confirm(`"${active.name}" 페이지를 삭제하시겠습니까?`)) return;
    PageManager.removePage(active.id);
    showMsg('페이지 삭제됨', 'warn');
  });

  /* ── 파일 불러오기 (도면 열기 버튼) ── */
  document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) _loadFile(file, false);
    e.target.value = '';
  });

  /* ── 드래그앤드롭: wrap 단일 핸들러 ── */
  wrap.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  wrap.addEventListener('dragleave', e => {
    if (!wrap.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
  });
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    const file   = e.dataTransfer.files[0];
    const append = PageManager.hasPages();
    if (file) _loadFile(file, append);
  });

  async function _loadFile(file, append = false) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      await _loadPDF(file, append);
    } else if (['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) {
      _loadImageFile(file, append);
    } else {
      showMsg('PDF 또는 이미지 파일만 지원합니다', 'warn');
    }
  }

  function _loadImageFile(file, append = false) {
    if (!append) PageManager.clearAll();
    PageManager.addPageFromFile(file, status => {
      if (status === 'ok') showMsg(file.name + (append ? ' 페이지 추가됨' : ' 불러오기 완료'), 'success');
      else showMsg('지원하지 않는 파일 형식입니다', 'warn');
    });
  }

  async function _loadPDF(file, append = false) {
    if (!window.pdfjsLib) { showMsg('PDF.js 로드 중입니다. 잠시 후 다시 시도해주세요', 'warn'); return; }
    const loading  = document.getElementById('page-panel-loading');
    const loadText = document.getElementById('page-loading-text');
    loading.classList.remove('hidden');

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc      = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    await PageManager.loadPDFPages(pdfDoc, (cur, total) => {
      if (loadText) loadText.textContent = `${cur} / ${total} 페이지`;
    }, append);

    loading.classList.add('hidden');
    document.getElementById('file-name').textContent = file.name;
    showMsg(file.name + ' ' + pdfDoc.numPages + '페이지 ' + (append ? '추가됨' : '불러오기 완료'), 'success');
  }

  /* ── 지시점 도구 ── */
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CanvasManager.setTool(btn.dataset.tool);
      showMsg(btn.dataset.tool === 'arrow' ? '화살표 모드' : '점 모드', 'info');
    });
  });

  /* ── 선 스타일 ── */
  document.querySelectorAll('.line-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.line-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Annotation.setConfig({ lineStyle: btn.dataset.line });
      const labels = { straight:'직선', 'elbow-h':'ㄱ자', 'elbow-v':'ㄴ자', zigzag:'번개' };
      showMsg(labels[btn.dataset.line] + ' 선 선택', 'info');
    });
  });

  /* ── 직교모드 ── */
  orthoToggle.addEventListener('change', () => {
    CanvasManager.setOrtho(orthoToggle.checked);
    showMsg('직교모드 ' + (orthoToggle.checked ? 'ON' : 'OFF'), 'info');
  });

  /* ── 카테고리 ── */
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.classList.contains('cat-color-picker')) return;
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Annotation.setActiveCategory(btn.dataset.cat);
      const labels = { defect:'결함', repair:'보수', other:'기타' };
      showMsg(labels[btn.dataset.cat] || '기타', 'info');
    });
  });

  ['defect','repair','other'].forEach(key => {
    const picker = document.getElementById('cat-color-' + key);
    if (!picker) return;
    picker.addEventListener('input', e => {
      Annotation.setCategoryColor(key, e.target.value);
      const btn = document.querySelector('.cat-btn[data-cat="' + key + '"]');
      if (btn) {
        btn.style.setProperty('--cat-c', e.target.value);
        const dot = btn.querySelector('.cat-dot-lg');
        if (dot) dot.style.background = e.target.value;
      }
      if (!_isRestoring) StorageManager.markDirty();
    });
  });

  /* ── 화살표 방향 반전 ── */
  const flipToggle = document.getElementById('arrow-flip-toggle');
  flipToggle.checked = true; // 기본값 반전 상태
  flipToggle.addEventListener('change', e => {
    Annotation.setConfig({ arrowFlip: e.target.checked });
    CanvasManager.renderAnnotations(Annotation.getAll());
    showMsg('화살표 방향 ' + (e.target.checked ? '반전' : '기본'), 'info');
  });

  /* ── 접두어 ── */
  document.getElementById('prefix-num').addEventListener('input', e => {
    const v = e.target.value.trim();
    Annotation.setConfig({ prefix: v });
    /* 현재 페이지에도 prefix 저장 */
    const activePage = PageManager.getActivePage();
    if (activePage) activePage.prefix = v;
    CanvasManager.renderAnnotations(Annotation.getAll());
    Sidebar.renderNumList(Annotation.getAll(), _collectAllPagesData());
    if (!_isRestoring) StorageManager.markDirty();
  });

  /* ── 글씨 색상 ── */
  document.getElementById('color-text').addEventListener('input', e => {
    Annotation.setConfig({ textColor: e.target.value });
    CanvasManager.renderAnnotations(Annotation.getAll());
  });

  /* ── 선 두께 ── */
  document.getElementById('line-width').addEventListener('input', e => {
    document.getElementById('line-width-val').textContent = e.target.value;
    CanvasManager.setLineWidth(parseFloat(e.target.value));
  });

  /* ── 넘버링 크기 배율 슬라이더 ── */
  document.getElementById('annotation-scale').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('annotation-scale-val').textContent = v.toFixed(1);
    Annotation.setConfig({ scale: v });
    CanvasManager.renderAnnotations(Annotation.getAll());
    _renderTitleBlock();
  });

  /* ── 자동정렬 ── */
  document.getElementById('btn-auto-layout').addEventListener('click', () => {
    const { w, h } = CanvasManager.getCanvasSize();
    if (!w) { showMsg('먼저 도면을 불러오세요', 'warn'); return; }
    Annotation.autoLayout(w, h);
    showMsg('자동정렬 적용됨', 'success');
  });

  /* ── 시작 번호 ── */
  document.getElementById('start-num').addEventListener('change', e => {
    const v = parseInt(e.target.value, 10);
    if (v >= 1) Annotation.setNextNum(v);
    _updateNextNumDisplay();
  });

  /* ── 전체 삭제 ── */
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (!Annotation.getAll().length) return;
    if (confirm('현재 페이지의 모든 넘버링을 삭제하시겠습니까?')) {
      Annotation.clear();
      showMsg('전체 삭제됨', 'warn');
    }
  });

  /* ── 키보드 단축키 ── */
  const LINE_STYLES = ['straight', 'elbow-h', 'elbow-v', 'zigzag'];
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (e.key === 'Escape') {
      CanvasManager.cancelDraw();
      CanvasManager.clearSelection();
      return;
    }
    if (e.key === 'F5')     { e.preventDefault(); CanvasManager.fitToView(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _undo(); return; }

    if (isInput) return; // 이하 단축키: 입력 필드에서는 무시

    /* A: 화살표 도구 선택 또는 선택된 항목 타입 변경 */
    if (e.key === 'a' || e.key === 'A') {
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        Annotation.updateItem(sid, { type: 'arrow' });
        showMsg('화살표로 변경', 'info');
      } else {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('.tool-btn[data-tool="arrow"]');
        if (btn) btn.classList.add('active');
        CanvasManager.setTool('arrow');
        showMsg('화살표 모드', 'info');
      }
    }

    /* D: 점 도구 선택 또는 선택된 항목 타입 변경 */
    if (e.key === 'd' || e.key === 'D') {
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        Annotation.updateItem(sid, { type: 'dot' });
        showMsg('점으로 변경', 'info');
      } else {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('.tool-btn[data-tool="dot"]');
        if (btn) btn.classList.add('active');
        CanvasManager.setTool('dot');
        showMsg('점 모드', 'info');
      }
    }

    /* 1~4: 선 스타일 직접 선택 또는 선택된 항목 스타일 변경 */
    const lineMap = { '1': 'straight', '2': 'elbow-h', '3': 'elbow-v', '4': 'zigzag' };
    const lineLabels = { straight:'직선', 'elbow-h':'ㄱ자', 'elbow-v':'ㄴ자', zigzag:'번개' };
    if (!e.shiftKey && lineMap[e.key]) {
      const style = lineMap[e.key];
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        Annotation.updateItem(sid, { lineStyle: style });
        showMsg(lineLabels[style] + ' 선으로 변경', 'info');
      } else {
        document.querySelectorAll('.line-btn').forEach(b => b.classList.toggle('active', b.dataset.line === style));
        Annotation.setConfig({ lineStyle: style });
        showMsg(lineLabels[style] + ' 선 선택', 'info');
      }
    }

    /* Q: 직교모드 */
    if (e.key === 'q' || e.key === 'Q') {
      orthoToggle.checked = !orthoToggle.checked;
      orthoToggle.dispatchEvent(new Event('change'));
    }

    /* R: 화살표 반전 (A-3) */
    if (e.key === 'r' || e.key === 'R') {
      const flipToggle = document.getElementById('arrow-flip-toggle');
      if (flipToggle) {
        flipToggle.checked = !flipToggle.checked;
        flipToggle.dispatchEvent(new Event('change'));
      }
    }

    /* W: 선 스타일 로테이션 또는 선택된 항목 스타일 순환 */
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      const labels = { straight:'직선', 'elbow-h':'ㄱ자', 'elbow-v':'ㄴ자', zigzag:'번개' };
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        const item = Annotation.getAll().find(i => i.id === sid);
        if (item) {
          const cur  = LINE_STYLES.indexOf(item.lineStyle || 'straight');
          const next = LINE_STYLES[(cur + 1) % LINE_STYLES.length];
          Annotation.updateItem(sid, { lineStyle: next });
          showMsg(labels[next] + ' 선으로 변경', 'info');
        }
      } else {
        const cfg  = Annotation.getConfig();
        const cur  = LINE_STYLES.indexOf(cfg.lineStyle || 'straight');
        const next = LINE_STYLES[(cur + 1) % LINE_STYLES.length];
        Annotation.setConfig({ lineStyle: next });
        document.querySelectorAll('.line-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.line === next);
        });
        showMsg(labels[next] + ' 선 선택', 'info');
      }
    }
  });

  /* ── 줌 ── */
  document.getElementById('btn-zoom-in').addEventListener('click',  () => CanvasManager.zoomIn());
  document.getElementById('btn-zoom-out').addEventListener('click', () => CanvasManager.zoomOut());
  document.getElementById('btn-fit').addEventListener('click',      () => CanvasManager.fitToView());

  /* ── 폴더 선택 ── */
  document.getElementById('btn-select-folder').addEventListener('click', async () => {
    const name = await FileManager.selectFolder();
    if (name) { Sidebar.setFolderPath(name); showMsg(name + ' 폴더 로드됨', 'success'); }
  });

  /* ── 파일명 미리보기 새로고침 (C-3) ── */
  document.getElementById('btn-preview-refresh').addEventListener('click', () => {
    _refreshRenamePreview();
    showMsg('미리보기 갱신', 'info');
  });

  /* ── 파일명 일괄 변경 (C-3) ── */
  document.getElementById('btn-rename-all').addEventListener('click', async () => {
    /* 전체 페이지 항목 수집 (페이지별 접두어 포함) */
    const pagesData = _collectAllPagesData();
    const allItemsWithPrefix = pagesData.flatMap(p =>
      p.items.map(item => ({ ...item, _pagePrefix: p.prefix }))
    );

    if (!allItemsWithPrefix.length) { showMsg('넘버링이 없습니다', 'warn'); return; }

    /* 미매칭 항목 확인 팝업 */
    const nomatchItems = allItemsWithPrefix.filter(item => !item.photoName);
    if (nomatchItems.length > 0) {
      const nomatchLabels = nomatchItems.map(item => {
        const pfx = item._pagePrefix ? item._pagePrefix + '-' : '';
        return pfx + String(item.num).padStart(2, '0');
      }).join(', ');
      const proceed = confirm(
        `매칭되지 않은 넘버링 ${nomatchItems.length}건이 있습니다.\n` +
        `[${nomatchLabels}]\n\n` +
        `해당 항목은 변경에서 제외됩니다. 계속 진행하시겠습니까?`
      );
      if (!proceed) return;
    } else {
      if (!confirm('미리보기의 [▶ 준비] 항목을 모두 파일명 변경하시겠습니까?')) return;
    }

    showMsg('파일명 변경 중...', 'info');
    try {
      const results = await FileManager.renameAll(allItemsWithPrefix);
      const ok   = results.filter(r => r.status === 'ok').length;
      const err  = results.filter(r => r.status === 'error').length;
      const skip = results.filter(r => r.status === 'skip').length;

      /* 전체 페이지 autoMatch 갱신 */
      pagesData.forEach(p => FileManager.autoMatch(p.items, p.prefix || ''));
      Sidebar.renderNumList(Annotation.getAll(), _collectAllPagesData());
      _refreshRenamePreview();

      const msg = `변경 완료: ${ok}건 성공` +
                  (skip ? `, ${skip}건 건너뜀` : '') +
                  (err  ? `, ${err}건 오류`    : '');
      showMsg(msg, ok ? 'success' : 'warn');

      // 변환 완료 안내 영역 표시
      if (ok > 0) {
        const notice = document.getElementById('rename-done-notice');
        const folderEl = document.getElementById('rename-done-folder');
        if (notice && folderEl) {
          folderEl.textContent = FileManager.getFolderName() || '선택된 폴더';
          notice.style.display = 'block';
        }
      }
    } catch (e) {
      showMsg('변경 실패: ' + e.message, 'warn');
    }
  });

  /* ── 도곽 설정 모달 열기 ── */
  document.getElementById('btn-titleblock').addEventListener('click', () => {
    const s   = TitleBlock.getSettings();
    const cfg = Annotation.getConfig();

    document.getElementById('tb-project-title').value = s.projectTitle;

    /* B: 현재 페이지의 drawingName 로드 */
    const activePage = PageManager.getActivePage();
    document.getElementById('tb-drawing-name').value = activePage?.drawingName || s.drawingName || '';

    document.getElementById('tb-scale').value = s.scale || 'NONE';

    /* 도곽 배율 */
    const cur = cfg.tbScale || 1.0;
    const tbSlider = document.getElementById('tb-scale-slider');
    const tbLabel  = document.getElementById('tb-scale-val');
    if (tbSlider) tbSlider.value = cur;
    if (tbLabel)  tbLabel.textContent = cur.toFixed(1);

    /* 열 비율 */
    _setTbColUI(s.col0, s.col1);

    /* 글씨 크기 슬라이더 (A-2) */
    const lSz    = document.getElementById('tb-label-sz');
    const vSz    = document.getElementById('tb-value-sz');
    const lSzVal = document.getElementById('tb-label-sz-val');
    const vSzVal = document.getElementById('tb-value-sz-val');
    if (lSz) lSz.value = s.labelFontSz;
    if (vSz) vSz.value = s.valueFontSz;
    if (lSzVal) lSzVal.textContent = s.labelFontSz;
    if (vSzVal) vSzVal.textContent = s.valueFontSz;

    /* 표제란 높이 */
    const bhSlider = document.getElementById('tb-blockh');
    const bhLabel  = document.getElementById('tb-blockh-val');
    if (bhSlider) bhSlider.value = s.blockH;
    if (bhLabel)  bhLabel.textContent = s.blockH;

    document.getElementById('modal-titleblock').classList.remove('hidden');
  });

  /* ── 도곽 배율 슬라이더 실시간 미리보기 ── */
  document.getElementById('tb-scale-slider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('tb-scale-val').textContent = v.toFixed(1);
    Annotation.setConfig({ tbScale: v });
    _renderTitleBlock();
  });

  /* ── 열 비율 슬라이더 실시간 미리보기 (A-1) ── */
  document.getElementById('tb-col0').addEventListener('input', e => {
    const c0 = parseInt(e.target.value, 10) / 100;
    const c1 = TitleBlock.getSettings().col1;
    _setTbColUI(c0, c1);
    TitleBlock.applySettings({ col0: c0, col1: Math.min(c1, 0.90 - c0) });
    _renderTitleBlock();
  });
  document.getElementById('tb-col1').addEventListener('input', e => {
    const c0 = TitleBlock.getSettings().col0;
    const c1 = parseInt(e.target.value, 10) / 100;
    _setTbColUI(c0, c1);
    TitleBlock.applySettings({ col0: c0, col1: Math.min(c1, 0.90 - c0) });
    _renderTitleBlock();
  });

  function _setTbColUI(c0, c1) {
    const clampedC1 = Math.min(c1, 0.90 - c0);
    const c2        = Math.max(0.05, 1 - c0 - clampedC1);
    document.getElementById('tb-col0').value      = Math.round(c0 * 100);
    document.getElementById('tb-col0-val').textContent = Math.round(c0 * 100);
    document.getElementById('tb-col1').value      = Math.round(clampedC1 * 100);
    document.getElementById('tb-col1-val').textContent = Math.round(clampedC1 * 100);
    document.getElementById('tb-col2-val').textContent = Math.round(c2 * 100);
  }

  /* ── 표제란 높이 슬라이더 실시간 미리보기 (A-1) ── */
  document.getElementById('tb-blockh').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('tb-blockh-val').textContent = v;
    TitleBlock.applySettings({ blockH: v });
    _renderTitleBlock();
  });

  /* ── 글씨 크기 슬라이더 실시간 미리보기 (A-2) ── */
  document.getElementById('tb-label-sz').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('tb-label-sz-val').textContent = v;
    TitleBlock.applySettings({ labelFontSz: v });
    _renderTitleBlock();
  });
  document.getElementById('tb-value-sz').addEventListener('input', e => {
    const v = parseInt(e.target.value, 10);
    document.getElementById('tb-value-sz-val').textContent = v;
    TitleBlock.applySettings({ valueFontSz: v });
    _renderTitleBlock();
  });

  /* ── 모달 닫기 ── */
  ['modal-tb-close','modal-tb-cancel'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      document.getElementById('modal-titleblock').classList.add('hidden');
    });
  });

  document.getElementById('modal-titleblock').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  /* ── 도곽 설정 적용 ── */
  document.getElementById('modal-tb-apply').addEventListener('click', () => {
    const c0 = parseInt(document.getElementById('tb-col0').value, 10) / 100;
    const c1 = parseInt(document.getElementById('tb-col1').value, 10) / 100;

    /* B: drawingName은 현재 페이지에만 저장 */
    const drawingNameInput = document.getElementById('tb-drawing-name').value;
    const activePage = PageManager.getActivePage();
    if (activePage) activePage.drawingName = drawingNameInput;

    /* 나머지는 전체 공통 적용 */
    TitleBlock.applySettings({
      projectTitle: document.getElementById('tb-project-title').value,
      drawingName:  drawingNameInput,  // 현재 페이지에 즉시 반영
      scale:        document.getElementById('tb-scale').value || 'NONE',
      col0:         c0,
      col1:         c1,
      labelFontSz:  parseInt(document.getElementById('tb-label-sz').value, 10) || 10,
      valueFontSz:  parseInt(document.getElementById('tb-value-sz').value, 10) || 14,
      blockH:       parseInt(document.getElementById('tb-blockh').value, 10)   || 68,
    });
    document.getElementById('modal-titleblock').classList.add('hidden');
    _renderTitleBlock();
    if (!_isRestoring) StorageManager.markDirty();
    showMsg('도곽 설정 적용됨', 'success');
  });

  /* ── 도곽 ON/OFF ── */
  document.getElementById('titleblock-toggle').addEventListener('change', e => {
    TitleBlock.setEnabled(e.target.checked);
    _renderTitleBlock();
    if (!_isRestoring) StorageManager.markDirty();
    showMsg('도곽 ' + (e.target.checked ? 'ON' : 'OFF'), 'info');
  });

  /* ── 프로젝트 저장 (.numdraw) ── */
  document.getElementById('btn-save-project').addEventListener('click', async () => {
    try {
      const saved = await StorageManager.exportFile();
      if (saved !== false) showMsg('프로젝트 저장 완료', 'success');
    } catch (e) {
      showMsg('저장 실패: ' + e.message, 'warn');
    }
  });

  /* ── 프로젝트 불러오기 (.numdraw) ── */
  document.getElementById('btn-load-project').addEventListener('click', () => {
    document.getElementById('numdraw-file-input').click();
  });

  document.getElementById('numdraw-file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      showMsg('프로젝트 불러오는 중...', 'info');
      const data = await StorageManager.importFile(file);
      if (!confirm('현재 작업을 지우고 저장된 프로젝트를 불러오시겠습니까?')) return;
      await _restoreFromData(data);
      await StorageManager.saveSession();
      showMsg('프로젝트 불러오기 완료', 'success');
    } catch (e) {
      showMsg('불러오기 실패: ' + e.message, 'warn');
    }
  });

  /* ── PDF 저장 ── */
  document.getElementById('btn-export-pdf').addEventListener('click', _exportPDF);

  async function _exportPDF() {
    if (!window.jspdf) { showMsg('jsPDF 로드 중입니다. 잠시 후 다시 시도해주세요', 'warn'); return; }
    if (!PageManager.hasPages()) { showMsg('먼저 도면을 불러오세요', 'warn'); return; }

    /* PDF 저장 전 현재 페이지 어노테이션 상태를 PageManager에 반영 */
    PageManager.saveCurrentPageState();

    showMsg('PDF 생성 중...', 'info');

    const { jsPDF } = window.jspdf;
    const allPages = PageManager.getPages();
    const savedDrawingName = TitleBlock.getSettings().drawingName;

    let pdf = null;

    for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
      const page = allPages[pageIdx];

      /* 페이지별 도곽 이름 적용 후 createPageExport 호출
         — page.imgLayout을 전달하여 화면 표시와 동일한 고정 좌표로 렌더링 (지시점 위치 픽셀 일치) */
      TitleBlock.applySettings({ drawingName: page.drawingName || '' });
      const { canvas: off, w, h } = await CanvasManager.createPageExport(
        page.imgSrc, page.imgW, page.imgH, page.annJSON, page.imgLayout || null
      );

      const orient  = w >= h ? 'landscape' : 'portrait';
      const imgData = off.toDataURL('image/jpeg', 0.95);

      if (pageIdx === 0) {
        pdf = new jsPDF({ orientation: orient, unit: 'px', format: [w, h] });
      } else {
        pdf.addPage([w, h], orient);
      }
      pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
    }

    /* 원래 도곽 이름 복원 */
    TitleBlock.applySettings({ drawingName: savedDrawingName });

    if (pdf) {
      const s     = TitleBlock.getSettings();
      const fname = (s.projectTitle || 'numdraw') + '_' + (s.drawingName || 'drawing') + '.pdf';
      pdf.save(fname.replace(/[\\/:*?"<>|]/g, '_'));
      showMsg('PDF 저장 완료', 'success');
    }
  }

  /* ── Undo ── */
  function _undo() {
    const items = Annotation.getAll();
    if (!items.length) return;
    Annotation.remove(items[items.length - 1].id);
    showMsg('되돌리기', 'info');
  }

  /* ── 탭 전환 ── */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  /* ── 페이지 목록 렌더 ── */
  function _renderPageList() {
    const list   = document.getElementById('page-list');
    const badge  = document.getElementById('page-count-badge');
    const pages  = PageManager.getPages();
    const active = PageManager.getActiveId();

    if (badge) badge.textContent = pages.length;

    list.innerHTML = '';
    pages.forEach(page => {
      const card = document.createElement('div');
      card.className = 'page-card' + (page.id === active ? ' active' : '');
      card.dataset.id = page.id;

      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      const tImg = document.createElement('img');
      tImg.src = page.imgSrc;
      tImg.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);max-width:100%;max-height:100%;width:auto;height:auto;display:block;';
      thumb.appendChild(tImg);

      const delBtn = document.createElement('button');
      delBtn.className = 'page-del-btn';
      delBtn.textContent = '✕';
      delBtn.title = '페이지 삭제';
      delBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pages.length <= 1) { showMsg('마지막 페이지는 삭제할 수 없습니다', 'warn'); return; }
        if (!confirm(`"${page.name}" 페이지를 삭제하시겠습니까?`)) return;
        PageManager.removePage(page.id);
        showMsg('페이지 삭제됨', 'warn');
      });
      thumb.appendChild(delBtn);

      const info = document.createElement('div');
      info.className = 'page-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'page-name';
      nameEl.textContent = page.name;
      nameEl.title = '더블클릭으로 이름 변경';

      const numBadge = document.createElement('div');
      numBadge.className = 'page-num-badge';
      let annCount = 0;
      if (page.id === active) {
        annCount = Annotation.getAll().length;
      } else if (page.annJSON) {
        try { annCount = JSON.parse(page.annJSON).items?.length || 0; } catch {}
      }
      numBadge.textContent = annCount + '개';

      /* 이름 + 개수를 묶는 래퍼 (flex 레이아웃에서 좌측 영역) */
      const infoContent = document.createElement('div');
      infoContent.className = 'page-info-content';
      infoContent.appendChild(nameEl);
      infoContent.appendChild(numBadge);

      /* ── 위아래 이동 버튼 ── */
      const pageIdx = pages.indexOf(page);
      const moveBtns = document.createElement('div');
      moveBtns.className = 'page-move-btns';

      const upBtn = document.createElement('button');
      upBtn.className = 'page-move-btn';
      upBtn.textContent = '▲';
      upBtn.title = '위로 이동';
      upBtn.disabled = pageIdx === 0;
      upBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pageIdx <= 0) return;
        /* 인접한 이전 페이지와 교환: 이전 페이지를 현재 자리로 내림 */
        PageManager.movePage(pages[pageIdx - 1].id, pages[pageIdx].id);
        StorageManager.markDirty();
      });

      const downBtn = document.createElement('button');
      downBtn.className = 'page-move-btn';
      downBtn.textContent = '▼';
      downBtn.title = '아래로 이동';
      downBtn.disabled = pageIdx === pages.length - 1;
      downBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (pageIdx >= pages.length - 1) return;
        /* 인접한 다음 페이지와 교환: 다음 페이지를 현재 자리로 올림 */
        PageManager.movePage(pages[pageIdx + 1].id, pages[pageIdx].id);
        StorageManager.markDirty();
      });

      moveBtns.appendChild(upBtn);
      moveBtns.appendChild(downBtn);

      info.appendChild(infoContent);
      info.appendChild(moveBtns);
      card.appendChild(thumb);
      card.appendChild(info);

      card.addEventListener('click', () => PageManager.switchTo(page.id));

      /* ── 드래그 앤드롭 페이지 순서 교체 ── */
      card.draggable = true;
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('numdraw/page-id', String(page.id));
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', e => {
        if (!card.contains(e.relatedTarget)) card.classList.remove('drag-over');
      });
      card.addEventListener('drop', e => {
        e.preventDefault();
        card.classList.remove('drag-over');
        const fromId = Number(e.dataTransfer.getData('numdraw/page-id'));
        if (fromId && fromId !== page.id) {
          PageManager.movePage(fromId, page.id);
          StorageManager.markDirty();
        }
      });

      nameEl.addEventListener('dblclick', e => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'page-name-input';
        input.value = page.name;
        nameEl.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          const newName = input.value.trim() || page.name;
          PageManager.renamePage(page.id, newName);
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') input.blur();
          if (e.key === 'Escape') { input.value = page.name; input.blur(); }
        });
      });

      list.appendChild(card);
    });
  }

  /* ── 도곽 렌더 ── */
  function _renderTitleBlock() {
    CanvasManager.renderAnnotations(Annotation.getAll());
  }

  /* ── 설정 UI 동기화 ── */
  function _syncSettingsUI() {
    const cfg = Annotation.getConfig();
    const el  = document.getElementById('prefix-num');
    if (el) el.value = cfg.prefix || '';
    const tc = document.getElementById('color-text');
    if (tc) tc.value = cfg.textColor || '#ffffff';
    const scSlider = document.getElementById('annotation-scale');
    const scLabel  = document.getElementById('annotation-scale-val');
    if (scSlider) scSlider.value = cfg.scale || 1.0;
    if (scLabel)  scLabel.textContent = (cfg.scale || 1.0).toFixed(1);
    const tbSlider = document.getElementById('tb-scale-slider');
    const tbLabel  = document.getElementById('tb-scale-val');
    if (tbSlider) tbSlider.value = cfg.tbScale || 1.0;
    if (tbLabel)  tbLabel.textContent = (cfg.tbScale || 1.0).toFixed(1);
  }

  /* ── 전체 페이지 넘버링 데이터 수집 ── */
  function _collectAllPagesData() {
    const pages    = PageManager.getPages();
    const activeId = PageManager.getActiveId();
    return pages.map(page => {
      let pageItems;
      if (page.id === activeId) {
        pageItems = Annotation.getAll();
      } else if (page.annJSON) {
        try {
          const parsed = JSON.parse(page.annJSON);
          pageItems = parsed.items || [];
          FileManager.autoMatch(pageItems, page.prefix || '');
        } catch { pageItems = []; }
      } else {
        pageItems = [];
      }
      return { id: page.id, name: page.name, isActive: page.id === activeId, items: pageItems, prefix: page.prefix || '' };
    });
  }

  /* ── 파일명 미리보기 헬퍼 (전 페이지 항목 사용 + 각 항목의 pagePrefix 포함) ── */
  function _refreshRenamePreview() {
    const pagesWithPrefix = _collectAllPagesData();
    const allItemsWithPrefix = pagesWithPrefix.flatMap(p =>
      p.items.map(item => ({ ...item, _pagePrefix: p.prefix }))
    );
    const preview  = FileManager.buildRenamePreview(allItemsWithPrefix);
    Sidebar.renderRenamePreview(preview);
  }

  function _updateNextNumDisplay() {
    const el = document.getElementById('next-num-display');
    if (el) el.textContent = Annotation.getNextNum();
  }

  function _updateCursorHint(state) {
    const el = document.getElementById('cursor-hint');
    if (!el) return;
    el.textContent = state.phase === 0 ? '클릭: 지시점 지정' : '클릭: 번호 위치 지정 | ESC: 취소';
  }

  let msgTimer = null;
  function showMsg(text, type = 'info') {
    statusMsg.textContent = text;
    statusMsg.className   = 'show ' + type;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { statusMsg.className = ''; }, 2500);
  }

  /* ── 저장 기능 ── */
  let _isRestoring = false;

  function _onSaveStatusChange(state) {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    const dot = el.querySelector('.save-dot');
    const txt = el.querySelector('.save-text');

    el.className = 'save-indicator';

    if (state === 'unsaved') {
      el.classList.add('unsaved');
      if (dot) dot.textContent = '●';
      if (txt) txt.textContent = '미저장';
    } else if (state === 'saving') {
      if (dot) dot.textContent = '○';
      if (txt) txt.textContent = '저장 중...';
    } else if (state === 'saved') {
      el.classList.add('saved');
      if (dot) dot.textContent = '✓';
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      if (txt) txt.textContent = time + ' 저장됨';
    }
  }

  async function _restoreFromData(data) {
    _isRestoring = true;
    try {
      // 1. 전체 초기화
      PageManager.clearAll();
      dropzone.classList.remove('has-file');

      // 2. globalConfig 복원 (scale, tbScale, categories)
      if (data.globalConfig) {
        const { scale, tbScale, categories } = data.globalConfig;
        Annotation.setConfig({ scale: scale || 1.0, tbScale: tbScale || 1.0 });
        if (categories) {
          ['defect', 'repair', 'other'].forEach(key => {
            if (categories[key]) {
              Annotation.setCategoryColor(key, categories[key].color);
              const picker = document.getElementById('cat-color-' + key);
              const btn    = document.querySelector('.cat-btn[data-cat="' + key + '"]');
              if (picker) picker.value = categories[key].color;
              if (btn) {
                btn.style.setProperty('--cat-c', categories[key].color);
                const dot = btn.querySelector('.cat-dot-lg');
                if (dot) dot.style.background = categories[key].color;
              }
            }
          });
        }
        _syncSettingsUI();
      }

      // 3. 페이지 복원
      PageManager.fromJSON(data.pages);

      // 4. TitleBlock 복원
      if (data.titleBlock) {
        TitleBlock.setEnabled(data.titleBlock.enabled || false);
        TitleBlock.applySettings(data.titleBlock.settings || {});
        const tbToggle = document.getElementById('titleblock-toggle');
        if (tbToggle) tbToggle.checked = data.titleBlock.enabled || false;
      }

      // 5. 화면 갱신
      const activePage = PageManager.getActivePage();
      if (activePage) {
        dropzone.classList.add('has-file');
        document.getElementById('file-name').textContent = activePage.name;
        CanvasManager.loadImage(activePage.imgSrc, activePage.imgW, activePage.imgH, activePage.imgLayout || null);
      }
      _renderPageList();
      CanvasManager.renderAnnotations(Annotation.getAll());
      _updateNextNumDisplay();
    } finally {
      _isRestoring = false;
    }
  }

  /* ── StorageManager 초기화 & 세션 복원 ── */
  await StorageManager.init(_onSaveStatusChange);

  const savedSession = await StorageManager.loadSession();
  if (savedSession) {
    const restored = confirm(
      `저장된 작업이 있습니다.\n마지막 저장: ${new Date(savedSession.updatedAt).toLocaleString()}\n\n불러오시겠습니까?`
    );
    if (restored) {
      await _restoreFromData(savedSession);
      showMsg('이전 작업을 불러왔습니다', 'success');
    }
  }

  /* ── beforeunload 경고 ── */
  window.addEventListener('beforeunload', e => {
    if (StorageManager.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ── 초기 상태 ── */
  document.querySelector('.tool-btn[data-tool="arrow"]').classList.add('active');
  _updateNextNumDisplay();
});
