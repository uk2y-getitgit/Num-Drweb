/* app.js — 메인 진입점 & 이벤트 연결 */
'use strict';

document.addEventListener('DOMContentLoaded', () => {
  /* ── DOM 참조 ── */
  const wrap             = document.getElementById('canvas-wrap');
  const container        = document.getElementById('canvas-container');
  const imgEl            = document.getElementById('drawing-img');
  const drawCanvas       = document.getElementById('drawing-canvas');
  const interactionLayer = document.getElementById('interaction-layer');
  const dropzone         = document.getElementById('dropzone');
  const statusMsg        = document.getElementById('status-msg');
  const orthoToggle      = document.getElementById('ortho-toggle');

  /* ── CanvasManager 초기화 (Annotation보다 먼저) ── */
  CanvasManager.init(wrap, container, imgEl, drawCanvas, interactionLayer);

  /* afterRender 콜백 — renderAnnotations 완료 후 항상 도곽 오버레이 */
  CanvasManager.setAfterRender((ctx, w, h) => {
    if (TitleBlock.isEnabled() && w) TitleBlock.render(ctx, w, h);
  });

  /* ── Annotation 초기화 ── */
  Annotation.init(() => {
    const items = Annotation.getAll();
    /* renderAnnotations → afterRender(도곽) 자동 포함 */
    CanvasManager.renderAnnotations(items);
    Sidebar.renderNumList(items);
    Sidebar.renderPhotoList(FileManager.getPhotos(), items);
    const cv = document.querySelector('.count-val');
    if (cv) cv.textContent = items.length;
    _updateNextNumDisplay();
    _renderPageList();
  });

  /* ── Sidebar 초기화 ── */
  Sidebar.init({
    onSelectNum:  () => {},
    onDeleteNum:  (id) => { Annotation.remove(id); showMsg('넘버링 삭제됨', 'warn'); },
    onMatchPhoto: (name) => { showMsg(name + ' 선택됨', 'info'); },
  });

  /* ── FileManager 초기화 ── */
  FileManager.init((photos) => {
    Sidebar.renderPhotoList(photos, Annotation.getAll());
    FileManager.autoMatch(Annotation.getAll());
    Sidebar.renderNumList(Annotation.getAll());
  });

  CanvasManager.onAdd((p1, p2, type) => {
    Annotation.add(p1, p2, type);
    _autoMatchAndRender();
    showMsg('넘버 ' + (Annotation.getNextNum() - 1) + ' 추가', 'success');
  });

  CanvasManager.onStateChange((state) => {
    _updateCursorHint(state);
  });

  /* ── PageManager 초기화 ── */
  PageManager.init(
    /* onSwitch */ (page) => {
      CanvasManager.loadImage(page.imgSrc, page.imgW, page.imgH);
      dropzone.classList.add('has-file');
      document.getElementById('file-name').textContent = page.name;
      /* 페이지별 설정 동기화 */
      _syncSettingsUI();
    },
    /* onListChange */ () => { _renderPageList(); }
  );

  /* ── TitleBlock 초기화 ── */
  TitleBlock.init();

  /* ── 페이지 추가 / 삭제 ── */
  const pageAddInput = document.getElementById('page-add-input');

  document.getElementById('btn-page-add').addEventListener('click', () => pageAddInput.click());

  pageAddInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'pdf') {
      /* PDF → 각 페이지를 별도 페이지로 추가 */
      if (!window.pdfjsLib) { showMsg('PDF.js 로드 대기 중', 'warn'); return; }
      const loading = document.getElementById('page-panel-loading');
      const loadText = document.getElementById('page-loading-text');
      loading.classList.remove('hidden');
      const buf = await file.arrayBuffer();
      const pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (loadText) loadText.textContent = `추가 중 ${i}/${pdfDoc.numPages}`;
        const page  = await pdfDoc.getPage(i);
        const vp    = page.getViewport({ scale: 2 });
        const off   = document.createElement('canvas');
        off.width = vp.width; off.height = vp.height;
        await page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise;
        PageManager.addImagePage(off.toDataURL('image/png'), vp.width, vp.height,
          file.name.replace(/\.[^.]+$/, '') + (pdfDoc.numPages > 1 ? `-P${i}` : ''));
      }
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

  /* ── 파일 불러오기 ── */
  document.getElementById('btn-open').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) _loadFile(file);
    e.target.value = '';
  });

  /* dragover/dragleave 는 양쪽에서 시각 효과 처리 */
  [wrap, dropzone].forEach(el => {
    el.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  });
  /* drop 핸들러는 wrap 에만 — dropzone 이 wrap 내부에 있어 이벤트 버블링으로 중복 실행 방지 */
  wrap.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    const file   = e.dataTransfer.files[0];
    const append = PageManager.hasPages();
    if (file) _loadFile(file, append);
  });

  /* append=true이면 기존 페이지 유지 후 끝에 추가 */
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
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        if (!append) Annotation.clear();
        PageManager.addImagePage(e.target.result, img.naturalWidth, img.naturalHeight, file.name);
        showMsg(file.name + (append ? ' 페이지 추가됨' : ' 불러오기 완료'), 'success');
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function _loadPDF(file, append = false) {
    if (!window.pdfjsLib) { showMsg('PDF.js 로드 중입니다. 잠시 후 다시 시도해주세요', 'warn'); return; }
    const loading  = document.getElementById('page-panel-loading');
    const loadText = document.getElementById('page-loading-text');
    loading.classList.remove('hidden');

    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

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
    });
  });

  /* ── 화살표 방향 반전 ── */
  document.getElementById('arrow-flip-toggle').addEventListener('change', e => {
    Annotation.setConfig({ arrowFlip: e.target.checked });
    CanvasManager.renderAnnotations(Annotation.getAll());
    showMsg('화살표 방향 ' + (e.target.checked ? '반전' : '기본'), 'info');
  });

  /* ── 접두어 ── */
  document.getElementById('prefix-num').addEventListener('input', e => {
    Annotation.setConfig({ prefix: e.target.value.trim() });
    CanvasManager.renderAnnotations(Annotation.getAll());
    Sidebar.renderNumList(Annotation.getAll());
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

  /* ── 크기 축척 슬라이더 ── */
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
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape')                           CanvasManager.cancelDraw();
    if (e.key === 'F5')                             { e.preventDefault(); CanvasManager.fitToView(); }
    if ((e.ctrlKey||e.metaKey) && e.key === 'z')   { e.preventDefault(); _undo(); }
    if (e.key === 'q' || e.key === 'Q') {
      orthoToggle.checked = !orthoToggle.checked;
      orthoToggle.dispatchEvent(new Event('change'));
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
  document.getElementById('prefix-filter').addEventListener('input', e => FileManager.filterByPrefix(e.target.value));
  document.getElementById('btn-auto-match').addEventListener('click', () => {
    FileManager.autoMatch(Annotation.getAll());
    const items = Annotation.getAll();
    Sidebar.renderNumList(items);
    Sidebar.renderPhotoList(FileManager.getPhotos(), items);
    showMsg('자동매칭 완료', 'success');
  });

  /* ── 도곽 설정 모달 ── */
  document.getElementById('btn-titleblock').addEventListener('click', () => {
    const s    = TitleBlock.getSettings();
    const cfg  = Annotation.getConfig();
    document.getElementById('tb-project-title').value = s.projectTitle;
    document.getElementById('tb-drawing-name').value  = s.drawingName;
    document.getElementById('tb-scale').value         = s.scale || 'NONE';
    /* 도곽 배율 슬라이더 현재값 반영 */
    const tbSlider = document.getElementById('tb-scale-slider');
    const tbLabel  = document.getElementById('tb-scale-val');
    const cur = cfg.tbScale || 1.0;
    if (tbSlider) tbSlider.value = cur;
    if (tbLabel)  tbLabel.textContent = cur.toFixed(1);
    document.getElementById('modal-titleblock').classList.remove('hidden');
  });

  /* 도곽 배율 슬라이더 — 실시간 미리보기 */
  document.getElementById('tb-scale-slider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('tb-scale-val').textContent = v.toFixed(1);
    Annotation.setConfig({ tbScale: v }); // onChange → _renderTitleBlock 자동 호출
  });

  ['modal-tb-close','modal-tb-cancel'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      document.getElementById('modal-titleblock').classList.add('hidden');
    });
  });

  document.getElementById('modal-titleblock').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  document.getElementById('modal-tb-apply').addEventListener('click', () => {
    TitleBlock.applySettings({
      projectTitle: document.getElementById('tb-project-title').value,
      drawingName:  document.getElementById('tb-drawing-name').value,
      scale:        document.getElementById('tb-scale').value || 'NONE',
    });
    document.getElementById('modal-titleblock').classList.add('hidden');
    _renderTitleBlock();
    showMsg('도곽 설정 적용됨', 'success');
  });

  /* 도곽 ON/OFF 토글 */
  document.getElementById('titleblock-toggle').addEventListener('change', e => {
    TitleBlock.setEnabled(e.target.checked);
    _renderTitleBlock();
    showMsg('도곽 ' + (e.target.checked ? 'ON' : 'OFF'), 'info');
  });

  /* ── PDF 저장 ── */
  document.getElementById('btn-export-pdf').addEventListener('click', _exportPDF);

  async function _exportPDF() {
    if (!window.jspdf) { showMsg('jsPDF 로드 중입니다. 잠시 후 다시 시도해주세요', 'warn'); return; }
    const { w, h } = CanvasManager.getCanvasSize();
    if (!w) { showMsg('먼저 도면을 불러오세요', 'warn'); return; }

    showMsg('PDF 생성 중...', 'info');

    /* 현재 페이지 — drawCanvas 에 배경+이미지+넘버링+도곽이 이미 합성되어 있음 */
    const { jsPDF } = window.jspdf;
    const orient = w >= h ? 'landscape' : 'portrait';
    const pdf    = new jsPDF({ orientation: orient, unit: 'px', format: [w, h] });
    pdf.addImage(CanvasManager.getCanvas().toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, w, h);

    /* 다중 페이지 처리 */
    if (PageManager.hasPages() && PageManager.getPages().length > 1) {
      const pages    = PageManager.getPages();
      const activeId = PageManager.getActiveId();

      for (const page of pages) {
        if (page.id === Number(activeId)) continue;
        const { canvas: pc, w: pw, h: ph } = await CanvasManager.createPageExport(
          page.imgSrc, page.imgW, page.imgH, page.annJSON
        );
        pdf.addPage([pw, ph], pw >= ph ? 'landscape' : 'portrait');
        pdf.addImage(pc.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph);
      }
    }

    const s = TitleBlock.getSettings();
    const fname = (s.projectTitle || 'numdraw') + '_' + (s.drawingName || 'drawing') + '.pdf';
    pdf.save(fname.replace(/[\\/:*?"<>|]/g, '_'));
    showMsg('PDF 저장 완료', 'success');
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

  /* ── 섹션 접기/펼치기 ── */
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const body = header.nextElementSibling;
      if (body) body.classList.toggle('collapsed');
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

      /* 썸네일 */
      const thumb = document.createElement('div');
      thumb.className = 'page-thumb';
      const tImg = document.createElement('img');
      tImg.src = page.imgSrc;
      tImg.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;';
      thumb.appendChild(tImg);

      /* 삭제 버튼 (썸네일 위) */
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

      /* 정보 */
      const info = document.createElement('div');
      info.className = 'page-info';

      const nameEl = document.createElement('span');
      nameEl.className = 'page-name';
      nameEl.textContent = page.name;
      nameEl.title = '더블클릭으로 이름 변경';

      const numBadge = document.createElement('div');
      numBadge.className = 'page-num-badge';
      /* 해당 페이지 넘버링 개수 계산 */
      let annCount = 0;
      if (page.id === active) {
        annCount = Annotation.getAll().length;
      } else if (page.annJSON) {
        try { annCount = JSON.parse(page.annJSON).items?.length || 0; } catch {}
      }
      numBadge.textContent = annCount + '개';

      info.appendChild(nameEl);
      info.appendChild(numBadge);
      card.appendChild(thumb);
      card.appendChild(info);

      /* 클릭: 페이지 전환 */
      card.addEventListener('click', () => PageManager.switchTo(page.id));

      /* 더블클릭: 이름 편집 */
      nameEl.addEventListener('dblclick', e => {
        e.stopPropagation();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'page-name-input';
        input.value = page.name;
        nameEl.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim() || page.name;
          PageManager.renamePage(page.id, newName);
        };
        input.addEventListener('blur',   commit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = page.name; input.blur(); } });
      });

      list.appendChild(card);
    });
  }

  /* ── 도곽 렌더 (도면 위에 오버레이) ── */
  function _renderTitleBlock() {
    /* renderAnnotations → afterRenderCb(도곽) 이 자동으로 실행됨 */
    CanvasManager.renderAnnotations(Annotation.getAll());
  }

  /* ── 설정 UI 동기화 ── */
  function _syncSettingsUI() {
    const cfg = Annotation.getConfig();
    const el = document.getElementById('prefix-num');
    if (el) el.value = cfg.prefix || '';
    const tc = document.getElementById('color-text');
    if (tc) tc.value = cfg.textColor || '#ffffff';
    /* 넘버링 배율 */
    const scSlider = document.getElementById('annotation-scale');
    const scLabel  = document.getElementById('annotation-scale-val');
    if (scSlider) scSlider.value = cfg.scale || 1.0;
    if (scLabel)  scLabel.textContent = (cfg.scale || 1.0).toFixed(1);
    /* 도곽 배율 */
    const tbSlider = document.getElementById('tb-scale-slider');
    const tbLabel  = document.getElementById('tb-scale-val');
    if (tbSlider) tbSlider.value = cfg.tbScale || 1.0;
    if (tbLabel)  tbLabel.textContent = (cfg.tbScale || 1.0).toFixed(1);
  }

  /* ── 헬퍼 ── */
  function _autoMatchAndRender() {
    FileManager.autoMatch(Annotation.getAll());
    Sidebar.renderNumList(Annotation.getAll());
    Sidebar.renderPhotoList(FileManager.getPhotos(), Annotation.getAll());
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

  /* ── 초기 상태 ── */
  document.querySelector('.tool-btn[data-tool="arrow"]').classList.add('active');
  _updateNextNumDisplay();
});
