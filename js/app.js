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

  /* ── 라이선스 게이트 ──
     증서가 없거나 무효면 체험판으로 계속 사용할 수 있다(앱을 막지 않는다).
     기능 제한값(워터마크·최대 페이지)은 LicenseUI 를 통해서만 조회한다. */
  let _licReady = false;   // 시작 시 콜백에서는 안내를 띄우지 않는다
  await LicenseUI.init((st) => {
    if (_licReady && st.edition === 'full') showMsg('정품 인증되었습니다', 'success');
  });
  _licReady = true;

  /* ── CanvasManager 초기화 (canvas-area 전달 — D) ── */
  CanvasManager.init(canvasArea, container, imgEl, drawCanvas, interactionLayer);

  CanvasManager.setAfterRender((ctx, w, h) => {
    if (TitleBlock.isEnabled() && w) TitleBlock.render(ctx, w, h);
    if (Legend.isEnabled() && w) {
      const ap = PageManager.getActivePage();
      Legend.render(ctx, w, h, ap && ap.legendEquip);
    }
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
    onSelectNum:  (id) => { CanvasManager.cancelDraw(); CanvasManager.selectItem(id); },
    onDeleteNum:  (id, subKey) => {
      if (subKey && subKey[0] === 'M') {
        Annotation.unmerge(id, Number(subKey.slice(1)));
        showMsg('합치기 해제됨', 'warn');
      } else if (subKey) {
        Annotation.removeSub(id, subKey);
        showMsg('장비 번호 삭제됨', 'warn');
      } else {
        Annotation.remove(id);
        showMsg('넘버링 삭제됨', 'warn');
      }
    },
    onEditNote:   (id, subKey) => _editNote(id, subKey),
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
    if (AppMode.get() === AppMode.MODES.EQUIP) {
      const eq = Equipment.getActive();
      if (!eq) return;
      const pfx = eq.prefix ? eq.prefix + '-' : '';
      if (eq.kind === 'tilt') {
        const axis = Annotation.getConfig().tiltAxis || 'y';
        const item = Annotation.addShape('tilt', { p1, p2, axis }, { key: eq.key, color: eq.color });
        showMsg(eq.label + ' ' + pfx + String(item.num).padStart(2, '0') + ' 추가', 'success');
        /* 측정값 입력 — 취소하면 번호만 표기 */
        _askTiltMeasure(v => { if (v) Annotation.updateItem(item.id, { measure: v }); });
        return;
      }
      if (eq.kind !== 'leader') { showMsg(eq.label + ' 은(는) 클릭으로 점을 찍고 Enter로 완료하세요', 'info'); return; }
      const item = Annotation.add(p1, p2, type, { key: eq.key, color: eq.color });
      showMsg(eq.label + ' ' + pfx + String(item.num).padStart(2, '0') + ' 추가', 'success');
    } else {
      const item = Annotation.add(p1, p2, type);
      showMsg('넘버 ' + item.num + ' 추가', 'success');
    }
  });

  /* 도형 확정 — 해치 도형(외관) / 부동침하 측정점 확정(Enter, 장비) */
  CanvasManager.onAddShape((kind, geom) => {
    if (kind === 'hatch-rect' || kind === 'hatch-ellipse') {
      Annotation.addHatch(kind, geom, Annotation.getConfig().hatchColor);
      showMsg((kind === 'hatch-rect' ? '사각' : '원형') + ' 해치 도형 추가', 'success');
      return true;
    }
    const eq = Equipment.getActive();
    if (!eq) return false;
    const item = Annotation.addShape(kind, geom, { key: eq.key, color: eq.color });
    const pfx  = eq.prefix ? eq.prefix + '-' : '';
    showMsg(eq.label + ' ' + pfx + String(item.num).padStart(2, '0') + ' 추가', 'success');
    return true;
  });

  CanvasManager.onStateChange((state) => {
    _updateCursorHint(state);
  });

  /* 번호박스 더블클릭 → 메모 편집 */
  CanvasManager.onEditNote((id, subKey) => _editNote(id, subKey));

  /* 합치기 모드 선택 변경 → 안내 문구 갱신 */
  CanvasManager.onMergeSel((sel) => _updateMergeHint(sel));

  /* 장비 모드: 기존 지시선 클릭 → 활성 장비 넘버 추가 (item 2·3) */
  CanvasManager.onAddLabel((itemId, equip) => {
    const label = Annotation.addLabelToItem(itemId, equip);
    if (!label) return false;
    const eq  = Equipment.get(equip.key);
    const pfx = eq && eq.prefix ? eq.prefix + '-' : '';
    showMsg((eq ? eq.label : '') + ' ' + pfx + String(label.num).padStart(2, '0') + ' 추가', 'success');
    return label;   // canvas가 더블클릭 시 되돌릴 수 있도록 생성된 라벨을 반환
  });

  /* ── PageManager 초기화 ── */
  PageManager.init(
    /* onSwitch */ (page) => {
      _loadPageImage(page);
      dropzone.classList.add('has-file');
      document.getElementById('file-name').textContent = page.name;
      /* 페이지별 접두어 복원 */
      Annotation.setConfig({ prefix: page.prefix || '' });
      _syncSettingsUI();
      /* B: 페이지별 Drawing Name 적용 */
      TitleBlock.applySettings({ drawingName: page.drawingName || '' });
      /* 페이지별 범례 표시 장비 체크박스 + 장비별 시작번호 갱신 */
      if (AppMode.get() === AppMode.MODES.EQUIP) _renderLegendEquip();
      _renderEquipToolbar();
    },
    /* onListChange */ () => { _renderPageList(); }
  );

  /* ── 도면 이미지 로드 (배율 반영) ──
     imgScale이 1이 아니면 표시용 합성본을 만들어 넣는다. 합성은 비동기라
     완료 전 페이지가 또 바뀔 수 있으므로 요청 시점의 페이지 id를 확인한다. */
  async function _loadPageImage(page) {
    const scale  = page.imgScale || 1;
    const layout = PageManager.scaledLayout(page) || page.imgLayout || null;
    _syncImageScaleUI(scale);

    if (Math.abs(scale - 1) < 0.001) {
      CanvasManager.loadImage(page.imgSrc, page.imgW, page.imgH, layout);
      return;
    }
    const src = await PageManager.getDisplaySrc(page);
    if (PageManager.getActiveId() !== page.id) return;   // 그 사이 페이지가 바뀌었다
    CanvasManager.loadImage(src, page.imgW, page.imgH, layout);
  }

  function _syncImageScaleUI(scale) {
    const slider = document.getElementById('image-scale');
    const label  = document.getElementById('image-scale-val');
    if (slider) slider.value = scale;
    if (label)  label.textContent = Number(scale).toFixed(2).replace(/0$/, '');
  }

  /* ── 도면 크기 조절 (슬라이더 · Ctrl+휠 공용) ──
     넘버링 좌표도 같은 비율로 옮겨져 도면 위 지시 위치가 유지된다.
     좌표 변환은 즉시, 이미지 재합성은 무거우므로 조작이 멈춘 뒤에 한 번만 한다. */
  let _imgScaleTimer = null;

  function _applyImageScale(next) {
    const page = PageManager.getActivePage();
    if (!page || !page.imgLayout) { showMsg('먼저 도면을 불러오세요', 'warn'); return; }

    const res = PageManager.setImageScale(page.id, next);
    _syncImageScaleUI(page.imgScale || 1);
    if (!res) return;

    StorageManager.markDirty();
    clearTimeout(_imgScaleTimer);
    _imgScaleTimer = setTimeout(() => {
      _loadPageImage(page);
      /* 자동 맞춤이 이미 여백 안에서 최대이므로, 키우면 용지 밖으로 나갈 수 있다 */
      const L = res.layout;
      if (L.offX < 0 || L.offY < 0 || L.offX + L.dW > page.imgW || L.offY + L.dH > page.imgH) {
        showMsg('도면이 용지 밖으로 나갑니다 — 벗어난 부분은 저장되지 않습니다', 'warn');
      }
    }, 120);
  }

  document.getElementById('image-scale').addEventListener('input', e => _applyImageScale(e.target.value));

  /* Ctrl+휠 — 화면 확대(줌)가 아니라 도면 자체 크기를 바꾼다 */
  CanvasManager.onImageScale(delta => {
    _applyImageScale(PageManager.getImageScale() + delta);
  });

  /* 넘버링 가능 영역 안내선 토글 (화면 전용 — PDF에는 나오지 않는다) */
  const boundsToggle = document.getElementById('bounds-toggle');
  if (boundsToggle) {
    boundsToggle.checked = CanvasManager.getShowBounds();
    boundsToggle.addEventListener('change', e => CanvasManager.setShowBounds(e.target.checked));
  }

  /* ── TitleBlock 초기화 ── */
  TitleBlock.init();

  /* ── 작업 모드 & 장비 (외관조사망도 / 장비시험망도) ── */
  let _wsMode = AppMode.get();                 // 현재 작업공간 모드
  const _workspaces = { exterior: null, equip: null };  // 비활성 작업공간 스냅샷 보관

  /* 모드에 따른 UI 토글 (작업공간 전환 없음) */
  function _applyModeUI(mode) {
    const isEquip = mode === AppMode.MODES.EQUIP;
    document.querySelectorAll('.mode-seg-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode));
    const catG = document.getElementById('cat-ctrl-group');
    const eqG  = document.getElementById('equip-ctrl-group');
    const lgG  = document.getElementById('legend-equip-group');
    if (catG) catG.style.display = isEquip ? 'none' : 'flex';
    /* 해치 도형은 외관조사망도 전용 — 장비 모드로 가면 도구도 함께 해제 */
    const htG = document.getElementById('hatch-ctrl-group');
    if (htG) htG.style.display = isEquip ? 'none' : 'flex';
    if (isEquip) {
      document.querySelectorAll('.hatch-btn').forEach(b => b.classList.remove('active'));
      CanvasManager.setShapeTool(null);
    }
    if (eqG)  eqG.style.display  = isEquip ? 'flex' : 'none';
    if (lgG)  lgG.style.display  = isEquip ? 'flex' : 'none';
    const hint = document.getElementById('mode-bar-hint');
    if (hint) hint.textContent = isEquip ? '장비시험망도 — 장비별 넘버링' : '';
    /* 장비 모드에서는 전역 접두어·시작번호가 무의미 — 장비별 설정으로 대체.
       입력칸만 숨기면 이름표만 남은 빈 칸이 되므로 칸(bay) 통째로 숨긴다. */
    const pfxBay = document.getElementById('bay-prefix');
    const stBay  = document.getElementById('bay-start');
    if (pfxBay) pfxBay.style.display = isEquip ? 'none' : 'flex';
    if (stBay)  stBay.style.display  = isEquip ? 'none' : 'flex';
    if (isEquip) _renderLegendEquip();
    _syncTiltAxisUI();
  }

  /* ── 범례 표시 장비 체크박스 (페이지별) ── */
  function _renderLegendEquip() {
    const box = document.getElementById('legend-equip-checks');
    if (!box) return;
    const page = PageManager.getActivePage();
    const sel  = (page && Array.isArray(page.legendEquip)) ? page.legendEquip : null; // null = 전체
    box.innerHTML = '';
    Equipment.getList().forEach(eq => {
      const checked = sel ? sel.includes(eq.key) : true;
      const lab = document.createElement('label');
      lab.className = 'legend-eq-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = checked; cb.dataset.key = eq.key;
      cb.addEventListener('change', _onLegendEquipChange);
      const dot = document.createElement('span');
      dot.className = 'legend-eq-dot'; dot.style.background = eq.color;
      const txt = document.createElement('span'); txt.textContent = eq.label;
      lab.append(cb, dot, txt);
      box.appendChild(lab);
    });
  }

  function _onLegendEquipChange() {
    const page = PageManager.getActivePage();
    if (!page) return;
    const checks = [...document.querySelectorAll('#legend-equip-checks input[type="checkbox"]')];
    const selected = checks.filter(c => c.checked).map(c => c.dataset.key);
    /* 전체 선택이면 null(전체 표기)로 저장 */
    page.legendEquip = (selected.length === Equipment.getList().length) ? null : selected;
    CanvasManager.renderAnnotations(Annotation.getAll());
    if (!_isRestoring) StorageManager.markDirty();
  }

  /* 장비 툴바(버튼 + 접두어 입력 + 색상 피커) 렌더 */
  function _renderEquipToolbar() {
    const box = document.getElementById('equip-btns');
    if (!box) return;
    box.innerHTML = '';
    const activeKey = Equipment.getActiveKey();
    Equipment.getList().forEach(eq => {
      const btn = document.createElement('button');
      btn.className = 'equip-btn' + (eq.key === activeKey ? ' active' : '');
      btn.dataset.key = eq.key;
      btn.style.setProperty('--cat-c', eq.color);
      btn.title = eq.kind === 'leader' ? '지시선'
                : (eq.kind === 'tilt' ? '도형: 수직기준선 + 경사선' : '도형: 측정점 + 사각 테두리');

      const dot = document.createElement('span');
      dot.className = 'cat-dot-lg';
      dot.style.background = eq.color;

      const lab = document.createElement('span');
      lab.className = 'equip-label';
      lab.textContent = eq.label;
      if (eq.kind !== 'leader') lab.textContent += eq.kind === 'tilt' ? ' ∠' : ' ▭';

      const pfx = document.createElement('input');
      pfx.type = 'text'; pfx.className = 'equip-prefix';
      pfx.value = eq.prefix; pfx.maxLength = 4; pfx.title = '접두어 편집';
      pfx.addEventListener('click', e => e.stopPropagation());
      pfx.addEventListener('input', e => Equipment.setPrefix(eq.key, e.target.value.trim()));

      /* 장비별 시작 번호 — 변경 시 해당 장비 기존 넘버링도 새 시작번호부터 재정렬 */
      const st = document.createElement('input');
      st.type = 'number'; st.className = 'equip-start';
      st.min = 1; st.value = eq.start || 1; st.title = '시작 번호';
      st.addEventListener('click', e => e.stopPropagation());
      st.addEventListener('change', e => {
        Equipment.setStart(eq.key, e.target.value);    // 재정렬·렌더는 Equipment.init 콜백에서 처리
        e.target.value = Equipment.getStart(eq.key);   // 보정값 반영
        /* 이 페이지의 지정값으로 고정 저장 — 다른 페이지에 번지지 않는다 */
        const page = PageManager.getActivePage();
        if (page) page.equipStart = Equipment.getStarts();
        showMsg(eq.label + ' 시작 번호 ' + Equipment.getStart(eq.key), 'info');
      });

      const col = document.createElement('input');
      col.type = 'color'; col.className = 'cat-color-picker';
      col.value = eq.color; col.title = '색상 변경';
      col.addEventListener('click', e => e.stopPropagation());
      col.addEventListener('input', e => Equipment.setColor(eq.key, e.target.value));

      btn.append(dot, lab, pfx, st, col);
      btn.addEventListener('click', () => {
        Equipment.setActive(eq.key);
        CanvasManager.cancelDraw();
        _renderEquipToolbar();
        _updateNextNumDisplay();
        _updateCursorHint({ phase: 0 });
      });
      box.appendChild(btn);
    });
    _syncTiltAxisUI();
  }

  /* 기울기 기준축 토글 — 기울기 장비가 선택됐을 때만 노출 */
  function _syncTiltAxisUI() {
    const grp = document.getElementById('tilt-axis-group');
    if (!grp) return;
    const eq = Equipment.getActive();
    const on = AppMode.get() === AppMode.MODES.EQUIP && eq && eq.kind === 'tilt';
    grp.style.display = on ? 'flex' : 'none';
    const axis = Annotation.getConfig().tiltAxis || 'y';
    grp.querySelectorAll('.tilt-axis-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.axis === axis));
  }

  document.querySelectorAll('.tilt-axis-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      Annotation.setConfig({ tiltAxis: btn.dataset.axis });
      CanvasManager.cancelDraw();
      _syncTiltAxisUI();
      _updateCursorHint({ phase: 0 });
      showMsg(btn.dataset.axis === 'x' ? '기울기 기준축: x축(가로)' : '기울기 기준축: y축(세로)', 'info');
    });
  });

  /* 장비 접두어/색상/시작번호 변경 시 */
  Equipment.init((what, key) => {
    /* 시작 번호 변경 — 기존 넘버링도 새 시작번호부터 다시 매김 */
    if (what === 'start') Annotation.resequence();
    if (what === 'color' && key) {
      const eq = Equipment.get(key);
      Annotation.getAll().forEach(i => {
        if (i.equipment === key) i.color = eq.color;
        if (i.labels) i.labels.forEach(l => { if (l.equipment === key) l.color = eq.color; });
      });
      const btn = document.querySelector('.equip-btn[data-key="' + key + '"]');
      if (btn) {
        btn.style.setProperty('--cat-c', eq.color);
        const d = btn.querySelector('.cat-dot-lg'); if (d) d.style.background = eq.color;
      }
    }
    CanvasManager.renderAnnotations(Annotation.getAll());
    Sidebar.renderNumList(Annotation.getAll(), _collectAllPagesData());
    _updateNextNumDisplay();
    if (AppMode.get() === AppMode.MODES.EQUIP) _renderLegendEquip();
    if (!_isRestoring) StorageManager.markDirty();
  });

  AppMode.init(() => {});  // 상태만 보관 (전환은 _switchMode가 담당)

  /* ── 현재 작업공간 스냅샷 ── */
  function _snapshotWorkspace() {
    PageManager.saveCurrentPageState();
    const cfg = Annotation.getConfig();
    return {
      version: 2,
      pages: PageManager.toJSON(),
      titleBlock: { enabled: TitleBlock.isEnabled(), settings: TitleBlock.getSettings() },
      legend: { enabled: Legend.isEnabled() },
      globalConfig: { scale: cfg.scale, tbScale: cfg.tbScale, lgScale: cfg.lgScale, categories: Annotation.getCategories() },
      equipment: Equipment.toJSON(),
    };
  }

  /* ── 빈 작업공간으로 초기화 ── */
  async function _clearWorkspace() {
    _isRestoring = true;
    try {
      PageManager.clearAll();
      Equipment.reset();
      CanvasManager.clear();
      dropzone.classList.remove('has-file');
      document.getElementById('file-name').textContent = '';
      _renderPageList();
      _renderEquipToolbar();
      CanvasManager.renderAnnotations(Annotation.getAll());
      _updateNextNumDisplay();
    } finally { _isRestoring = false; }
  }

  /* ── 모드(작업공간) 전환 ── */
  async function _switchMode(newMode) {
    if (newMode === _wsMode) return;
    CanvasManager.cancelDraw();
    _workspaces[_wsMode] = _snapshotWorkspace();   // 현재 작업공간 저장
    _wsMode = newMode;
    AppMode.set(newMode, { force: true, silent: true });
    _applyModeUI(newMode);
    if (_workspaces[newMode]) {
      await _restoreFromData(_workspaces[newMode]);
    } else {
      await _clearWorkspace();
    }
    _updateNextNumDisplay();
    StorageManager.markDirty();
    showMsg(newMode === AppMode.MODES.EQUIP ? '장비시험망도 모드' : '외관조사망도 모드', 'info');
  }

  document.querySelectorAll('.mode-seg-btn').forEach(btn => {
    btn.addEventListener('click', () => _switchMode(btn.dataset.mode));
  });

  /* 초기 렌더 */
  _renderEquipToolbar();
  _applyModeUI(_wsMode);

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
      _clearHatchTool();                   // 지시점 도구와 해치 도형 도구는 배타적
      CanvasManager.setTool(btn.dataset.tool);
      CanvasManager.cancelDraw();          // 도구 전환 시 진행 중인 2클릭 취소
      const names = { arrow: '화살표 모드', dot: '점 모드', none: '지시선 없음 모드' };
      showMsg(names[btn.dataset.tool] || '', 'info');
      _updateCursorHint({ phase: 0 });
    });
  });

  /* ── 해치 도형 도구 (외관 모드) ──
     버튼 토글 방식 — ON이면 클릭 2번으로 도형 생성, OFF면 기존 지시선 그리기로 복귀 */
  function _clearHatchTool() {
    document.querySelectorAll('.hatch-btn').forEach(b => b.classList.remove('active'));
    CanvasManager.setShapeTool(null);
  }

  document.querySelectorAll('.hatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind   = btn.dataset.hatch;
      const isOn   = btn.classList.contains('active');
      document.querySelectorAll('.hatch-btn').forEach(b => b.classList.remove('active'));
      if (isOn) {
        /* 같은 버튼 재클릭 → 해제하고 지시선 도구로 복귀 */
        CanvasManager.setShapeTool(null);
        showMsg('도형 그리기 해제', 'info');
      } else {
        btn.classList.add('active');
        CanvasManager.setShapeTool(kind);
        showMsg((kind === 'hatch-rect' ? '사각' : '원형') + ' 해치 도형 모드', 'info');
      }
      _updateCursorHint({ phase: 0 });
    });
  });

  /* ── 도형 색상 선택 팝업 ──
     구분(결함·보수·신규) 색상 프리셋 + 직접 선택. 고른 색은 '다음에 그릴 도형'에만 적용된다. */
  const hatchColorBtn = document.getElementById('hatch-color-btn');
  const hatchColorPop = document.getElementById('hatch-color-pop');
  const hatchColorInp = document.getElementById('hatch-color');

  function _setHatchColor(v) {
    Annotation.setConfig({ hatchColor: v });
    hatchColorInp.value = v;
    _syncHatchColorUI();
    if (!_isRestoring) StorageManager.markDirty();
  }

  /* 스와치 버튼·HEX 표기·프리셋 선택 상태를 현재 색에 맞춘다 */
  function _syncHatchColorUI() {
    const cur = (Annotation.getConfig().hatchColor || '#e05555').toLowerCase();
    if (hatchColorBtn) hatchColorBtn.style.background = cur;
    const hex = document.getElementById('hatch-color-hex');
    if (hex) hex.textContent = cur.toUpperCase();
    hatchColorPop.querySelectorAll('.color-pop-item').forEach(b =>
      b.classList.toggle('active', (b.dataset.color || '').toLowerCase() === cur));
  }

  /* 프리셋 목록은 열 때마다 다시 그린다 — 구분 색상은 사용자가 바꿀 수 있다 */
  function _renderHatchPresets() {
    const box = document.getElementById('hatch-color-presets');
    if (!box) return;
    const cats = Annotation.getCategories();
    box.innerHTML = '';
    Object.entries(cats).forEach(([key, info]) => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'color-pop-item';
      btn.dataset.color = info.color;
      btn.innerHTML = `<span class="cp-dot" style="background:${info.color}"></span>` +
                      `<span>${info.label}</span>` +
                      `<span class="cp-hex">${info.color.toUpperCase()}</span>`;
      btn.addEventListener('click', () => {
        _setHatchColor(info.color);
        _closeHatchPop();
        showMsg('도형 색상: ' + info.label, 'info');
      });
      box.appendChild(btn);
    });
    _syncHatchColorUI();
  }

  function _closeHatchPop() { hatchColorPop.classList.add('hidden'); }

  hatchColorBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (!hatchColorPop.classList.contains('hidden')) { _closeHatchPop(); return; }
    _renderHatchPresets();
    /* 컨트롤 바 바깥으로 잘리지 않도록 버튼 기준 고정 좌표로 띄운다 */
    const r = hatchColorBtn.getBoundingClientRect();
    hatchColorPop.classList.remove('hidden');
    const w = hatchColorPop.offsetWidth;
    hatchColorPop.style.top  = (r.bottom + 6) + 'px';
    hatchColorPop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
  });

  /* 팝업 바깥 클릭 시 닫기 (색상 입력창 조작 중에는 유지) */
  document.addEventListener('mousedown', e => {
    if (hatchColorPop.classList.contains('hidden')) return;
    if (e.target.closest('#hatch-color-pop') || e.target.closest('#hatch-color-btn')) return;
    _closeHatchPop();
  });

  hatchColorInp.addEventListener('input', e => {
    /* 새로 그리는 도형에만 적용 — 기존 도형은 생성 시점 색상을 유지한다 */
    _setHatchColor(e.target.value);
    CanvasManager.renderAnnotations(Annotation.getAll());
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

  /* ── 범례 배율 슬라이더 ── */
  document.getElementById('legend-scale').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    document.getElementById('legend-scale-val').textContent = v.toFixed(1);
    Annotation.setConfig({ lgScale: v });
    CanvasManager.renderAnnotations(Annotation.getAll());
    if (!_isRestoring) StorageManager.markDirty();
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
      /* 합치기 모드가 켜져 있으면 모드 해제가 우선 */
      if (CanvasManager.isMergeMode()) { _setMergeMode(false); showMsg('합치기 취소', 'info'); return; }
      CanvasManager.cancelDraw();
      CanvasManager.clearSelection();
      return;
    }
    if (e.key === 'F5')     { e.preventDefault(); CanvasManager.fitToView(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _undo(); return; }

    if (isInput) return; // 이하 단축키: 입력 필드에서는 무시

    /* Delete: 선택된 항목 삭제 — 해치 도형은 사이드바 목록에 없으므로 이 경로로 지운다 */
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        e.preventDefault();
        Annotation.remove(sid);
        CanvasManager.clearSelection();
        showMsg('삭제됨', 'warn');
      }
      return;
    }

    /* Enter: 합치기 확정(모드 ON일 때) | 부동침하 다각형 확정 */
    if (e.key === 'Enter') {
      e.preventDefault();
      if (CanvasManager.isMergeMode()) _commitMerge();
      else                             CanvasManager.finishShape();
      return;
    }

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

    /* S: 지시선 없음 도구 선택 또는 선택된 항목 타입 변경 */
    if (e.key === 's' || e.key === 'S') {
      const sid = CanvasManager.getSelectedId();
      if (sid !== null) {
        Annotation.updateItem(sid, { type: 'none' });
        showMsg('지시선 없음으로 변경', 'info');
      } else {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('.tool-btn[data-tool="none"]');
        if (btn) btn.classList.add('active');
        CanvasManager.setTool('none');
        CanvasManager.cancelDraw();
        showMsg('지시선 없음 모드', 'info');
      }
      _updateCursorHint({ phase: 0 });
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
      p.items.filter(item => !item.noNum).map(item => ({ ...item, _pagePrefix: p.prefix }))
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

  /* ── 범례 ON/OFF ── */
  document.getElementById('legend-toggle').addEventListener('change', e => {
    Legend.setEnabled(e.target.checked);
    CanvasManager.renderAnnotations(Annotation.getAll());
    if (!_isRestoring) StorageManager.markDirty();
    showMsg('범례 ' + (e.target.checked ? 'ON' : 'OFF'), 'info');
  });

  /* ── 프로젝트 저장 (.qspec) ── */
  document.getElementById('btn-save-project').addEventListener('click', async () => {
    try {
      const saved = await StorageManager.exportFile();
      if (saved !== false) showMsg('프로젝트 저장 완료', 'success');
    } catch (e) {
      showMsg('저장 실패: ' + e.message, 'warn');
    }
  });

  /* ── 프로젝트 불러오기 (.qspec · 구 .numdraw) ── */
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
      await _restoreProject(data);
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

    /* ── 체험판 게이트 ──
       편집·불러오기는 제한하지 않는다. 저장만 maxPages 장으로 막는다(0 = 무제한).
       잘라낼 때는 첫 페이지가 아니라 **지금 보고 있는 페이지**부터 담는다 —
       어느 페이지든 결과물을 확인해 보고 구매를 판단할 수 있어야 하기 때문. */
    const _maxOut  = PageManager.getMaxPages();
    const _all     = PageManager.getPages();
    let   allPages = _all;
    let   trimmed  = 0;
    if (_maxOut > 0 && _all.length > _maxOut) {
      const from = Math.max(0, _all.findIndex(p => p.id === PageManager.getActiveId()));
      allPages   = _all.slice(from, from + _maxOut);
      trimmed    = _all.length - allPages.length;
    }

    showMsg('PDF 생성 중...', 'info');

    const { jsPDF } = window.jspdf;
    const savedDrawingName = TitleBlock.getSettings().drawingName;

    let pdf = null;

    for (let pageIdx = 0; pageIdx < allPages.length; pageIdx++) {
      const page = allPages[pageIdx];

      /* 페이지별 도곽 이름 적용 후 createPageExport 호출
         — 도면 배율이 반영된 소스·배치를 넘겨 화면 표시와 픽셀 단위로 일치시킨다 */
      TitleBlock.applySettings({ drawingName: page.drawingName || '' });
      const src    = await PageManager.getDisplaySrc(page);
      const layout = PageManager.scaledLayout(page) || page.imgLayout || null;
      const { canvas: off, w, h } = await CanvasManager.createPageExport(
        src, page.imgW, page.imgH, page.annJSON, layout, page.legendEquip
      );

      /* 체험판 워터마크 — 페이지 순회 구조는 건드리지 않고 이 페이지 캔버스에만 덧그린다.
         off 는 createPageExport 가 매 페이지 새로 만든 캔버스라 다음 페이지에 남지 않는다. */
      if (LicenseUI.hasWatermark()) _drawTrialWatermark(off, w, h);

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
      const fname = (s.projectTitle || 'quickspect') + '_' + (s.drawingName || 'drawing') + '.pdf';
      pdf.save(fname.replace(/[\\/:*?"<>|]/g, '_'));

      if (trimmed > 0) {
        showMsg('체험판은 ' + _maxOut + '장까지만 저장됩니다 — ' + trimmed + '장이 빠졌습니다', 'warn');
        LicenseUI.promptUpgrade(
          '체험판은 PDF를 ' + _maxOut + '장까지만 저장할 수 있어 나머지 ' + trimmed + '장이 저장되지 않았습니다. ' +
          '도면 작업은 몇 장이든 자유롭게 하실 수 있고, 정품 인증하시면 전체가 워터마크 없이 저장됩니다.'
        );
      } else {
        showMsg('PDF 저장 완료', 'success');
      }
    }
  }

  /* ── 체험판 워터마크 ── */
  function _drawTrialWatermark(canvas, w, h) {
    const c = canvas.getContext('2d');
    c.save();

    /* 대각선 큰 문구 1개 */
    const diag = Math.sqrt(w * w + h * h);
    c.translate(w / 2, h / 2);
    c.rotate(-Math.atan2(h, w));
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.font         = '700 ' + Math.round(diag * 0.075) + 'px Inter, sans-serif';
    c.fillStyle    = 'rgba(120,120,140,0.20)';
    c.fillText('Quickspect TRIAL — 체험판', 0, 0);
    c.restore();

    /* 반복 타일 문구 — 잘라내기 어렵게 전면에 옅게 깐다 */
    c.save();
    c.globalAlpha = 0.10;
    c.fillStyle   = '#5A5A6E';
    c.font        = '600 ' + Math.round(diag * 0.018) + 'px Inter, sans-serif';
    c.textAlign   = 'center';
    c.textBaseline = 'middle';
    const stepX = w / 3, stepY = h / 6;
    for (let ry = 0; ry < 6; ry++) {
      for (let rx = 0; rx < 3; rx++) {
        c.save();
        c.translate(stepX * (rx + 0.5), stepY * (ry + 0.5));
        c.rotate(-Math.PI / 9);
        c.fillText('체험판 Quickspect TRIAL', 0, 0);
        c.restore();
      }
    }
    c.restore();
  }

  /* ═══════════════ 사진첩 (Phase 3-e) ═══════════════ */

  const pbBtnPreview = document.getElementById('btn-photobook-preview');
  const pbBtnPdf     = document.getElementById('btn-photobook-pdf');
  const pbInfo       = document.getElementById('summary-info');
  const pbModal      = document.getElementById('modal-photobook');
  const pbReport     = document.getElementById('modal-pb-report');

  function _pbSyncButtons() {
    const ok = PhotoBook.hasSummary();
    pbBtnPreview.disabled = !ok;
    pbBtnPdf.disabled     = !ok;
  }

  /* 집계표 불러오기 */
  document.getElementById('btn-load-summary').addEventListener('click', () => {
    document.getElementById('summary-input').click();
  });

  document.getElementById('summary-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const info = await PhotoBook.loadSummary(file);
      pbInfo.textContent = `✓ ${info.count}건 · ${info.sheet} · 문구 ${info.captionCol}열`;
      pbInfo.style.color = 'var(--success)';
      showMsg(`집계표 ${info.count}건을 읽었습니다`, 'success');
      if (info.composed) showMsg('P열이 비어 있어 조사위치·손상내용으로 문구를 조합했습니다', 'warn');
      _pbSyncButtons();
    } catch (err) {
      pbInfo.textContent = '불러오기 실패: ' + err.message;
      pbInfo.style.color = 'var(--danger)';
      showMsg('집계표 불러오기 실패: ' + err.message, 'warn');
    }
  });

  /* 미매칭 검사 → 문제 없으면 즉시 진행, 있으면 확인 팝업 */
  function _pbCheck(next) {
    if (!FileManager.getFolderName()) {
      showMsg('먼저 사진 폴더를 선택하세요', 'warn');
      return;
    }
    const { entries, report } = PhotoBook.collectEntries();
    if (!entries.length) { showMsg('사진첩에 넣을 항목이 없습니다', 'warn'); return; }

    const total = report.noPhoto.length + report.noNumbering.length + report.orphan.length;
    if (!total) { next(entries); return; }

    const line = (title, arr, color) => arr.length
      ? `<div class="field-row"><label style="color:${color};font-weight:700;">${title} (${arr.length}건)</label>
         <div style="font-size:11px;line-height:1.7;word-break:break-all;">${arr.join(', ')}</div></div>`
      : '';

    document.getElementById('pb-report-body').innerHTML =
      line('사진 없음', report.noPhoto, 'var(--danger)') +
      line('집계표에만 있음 (도면 미표기)', report.noNumbering, 'var(--warning)') +
      line('도면에만 있음 (집계표 누락)', report.orphan, 'var(--warning)') +
      `<div style="margin-top:8px;font-size:11px;color:var(--text-secondary);line-height:1.6;">
         사진 없는 칸은 "사진 없음"으로 표기되고, 집계표에 없는 번호는 사진첩에서 빠집니다.</div>`;

    pbReport.classList.remove('hidden');
    pbReport._next = () => next(entries);
  }

  document.getElementById('modal-pbr-go').addEventListener('click', () => {
    pbReport.classList.add('hidden');
    if (pbReport._next) pbReport._next();
  });
  ['modal-pbr-close', 'modal-pbr-cancel'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => pbReport.classList.add('hidden'));
  });

  /* 미리보기 — 메모리 절약을 위해 0.5배로 렌더 */
  pbBtnPreview.addEventListener('click', () => _pbCheck(async entries => {
    const body  = document.getElementById('pb-preview-body');
    const total = PhotoBook.pageCount(entries.length);
    body.innerHTML = '';
    document.getElementById('pb-page-info').textContent = `${entries.length}건 · ${total}장`;
    pbModal.classList.remove('hidden');
    showMsg('사진첩 미리보기 생성 중...', 'info');

    const title = PhotoBook.getTitle();
    for (let i = 0; i < total; i++) {
      const cv = await PhotoBook.renderPage(entries, i, title, 0.5);
      cv.style.cssText = 'width:100%;max-width:620px;margin:8px auto;display:block;box-shadow:0 2px 8px rgba(0,0,0,.18);';
      body.appendChild(cv);
    }
    showMsg('미리보기 완료', 'success');
  }));

  ['modal-pb-close', 'modal-pb-close2'].forEach(id => {
    document.getElementById(id).addEventListener('click', () => {
      pbModal.classList.add('hidden');
      document.getElementById('pb-preview-body').innerHTML = '';   // 캔버스 메모리 해제
    });
  });

  document.getElementById('modal-pb-save').addEventListener('click', () => {
    pbModal.classList.add('hidden');
    document.getElementById('pb-preview-body').innerHTML = '';
    _pbCheck(_pbExportPDF);
  });

  pbBtnPdf.addEventListener('click', () => _pbCheck(_pbExportPDF));

  /* 사진첩 PDF 저장 — 도면 PDF와 같은 캔버스→JPEG→jsPDF 경로 */
  async function _pbExportPDF(entries) {
    if (!window.jspdf) { showMsg('jsPDF 로드 중입니다. 잠시 후 다시 시도해주세요', 'warn'); return; }

    const { jsPDF } = window.jspdf;
    const { w, h }  = PhotoBook.A4;
    const title     = PhotoBook.getTitle();
    let   total     = PhotoBook.pageCount(entries.length);

    /* 체험판 게이트 — 도면 PDF와 동일 기준 (0 = 무제한) */
    const maxOut  = PageManager.getMaxPages();
    let   trimmed = 0;
    if (maxOut > 0 && total > maxOut) { trimmed = total - maxOut; total = maxOut; }

    let pdf = null;
    for (let i = 0; i < total; i++) {
      showMsg(`사진첩 생성 중... ${i + 1}/${total}`, 'info');
      const cv = await PhotoBook.renderPage(entries, i, title, 1);
      if (LicenseUI.hasWatermark()) _drawTrialWatermark(cv, w, h);

      if (i === 0) pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [w, h] });
      else         pdf.addPage([w, h], 'portrait');
      pdf.addImage(cv.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, w, h);
      cv.width = cv.height = 0;   // 캔버스 즉시 해제
    }

    if (!pdf) return;
    const fname = ((title || 'quickspect') + '_사진첩.pdf').replace(/[\\/:*?"<>|]/g, '_');
    pdf.save(fname);

    if (trimmed > 0) {
      showMsg(`체험판은 ${maxOut}장까지만 저장됩니다 — ${trimmed}장이 빠졌습니다`, 'warn');
      LicenseUI.promptUpgrade(
        `체험판은 사진첩을 ${maxOut}장까지만 저장할 수 있어 나머지 ${trimmed}장이 저장되지 않았습니다.`
      );
    } else {
      showMsg('사진첩 PDF 저장 완료', 'success');
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
    const hcv = cfg.hatchColor || '#e05555';
    const hc  = document.getElementById('hatch-color');
    if (hc) hc.value = hcv;
    const hcb = document.getElementById('hatch-color-btn');
    if (hcb) hcb.style.background = hcv;
    const hch = document.getElementById('hatch-color-hex');
    if (hch) hch.textContent = hcv.toUpperCase();
    const scSlider = document.getElementById('annotation-scale');
    const scLabel  = document.getElementById('annotation-scale-val');
    if (scSlider) scSlider.value = cfg.scale || 1.0;
    if (scLabel)  scLabel.textContent = (cfg.scale || 1.0).toFixed(1);
    const tbSlider = document.getElementById('tb-scale-slider');
    const tbLabel  = document.getElementById('tb-scale-val');
    if (tbSlider) tbSlider.value = cfg.tbScale || 1.0;
    if (tbLabel)  tbLabel.textContent = (cfg.tbScale || 1.0).toFixed(1);
    const lgSlider = document.getElementById('legend-scale');
    const lgLabel  = document.getElementById('legend-scale-val');
    if (lgSlider) lgSlider.value = cfg.lgScale || 1.0;
    if (lgLabel)  lgLabel.textContent = (cfg.lgScale || 1.0).toFixed(1);
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
    /* 묶인·합쳐진 번호도 개별 행으로 펼쳐 파일명 변경 대상에 포함 */
    const allItemsWithPrefix = pagesWithPrefix.flatMap(p =>
      p.items.flatMap(item => [
        { ...item, _pagePrefix: p.prefix },
        ...(item.merged || []).map(m => ({ ...m, _pagePrefix: p.prefix })),
        ...(item.labels || []).map(l => ({ ...l, _pagePrefix: p.prefix })),
      ])
    );
    const preview  = FileManager.buildRenamePreview(allItemsWithPrefix);
    Sidebar.renderRenamePreview(preview);
  }

  function _updateNextNumDisplay() {
    const el = document.getElementById('next-num-display');
    if (!el) return;
    if (AppMode.get() === AppMode.MODES.EQUIP) {
      const eq = Equipment.getActive();
      if (eq) {
        const pfx = eq.prefix ? eq.prefix + '-' : '';
        /* 실제 번호박스와 같은 2자리 표기 */
        el.textContent = pfx + String(Annotation.getNextNumForEquipment(eq.key)).padStart(2, '0');
        return;
      }
    }
    el.textContent = String(Annotation.getNextNum()).padStart(2, '0');
  }

  /* ── 넘버링 메모 ── */

  /* 번호 엔트리(본체·묶음·합침) 하나의 표시 라벨 — 모달 제목용 */
  function _entryLabelOf(id, subKey) {
    const item = Annotation.getAll().find(i => i.id === Number(id));
    if (!item) return '';
    let entry = item;
    if (subKey && subKey[0] === 'L') entry = (item.labels || []).find(l => l.lid === Number(subKey.slice(1)));
    if (subKey && subKey[0] === 'M') entry = (item.merged || []).find(m => m.mid === Number(subKey.slice(1)));
    if (!entry) return '';
    let prefix = Annotation.getConfig().prefix || '';
    if (entry.equipment) {
      const eq = Equipment.get(entry.equipment);
      if (eq) prefix = eq.prefix || '';
    }
    return (prefix ? prefix + '-' : '') + String(entry.num).padStart(2, '0');
  }

  function _currentNoteOf(id, subKey) {
    const item = Annotation.getAll().find(i => i.id === Number(id));
    if (!item) return '';
    if (subKey && subKey[0] === 'L') {
      const l = (item.labels || []).find(x => x.lid === Number(subKey.slice(1)));
      return (l && l.note) || '';
    }
    if (subKey && subKey[0] === 'M') {
      const m = (item.merged || []).find(x => x.mid === Number(subKey.slice(1)));
      return (m && m.note) || '';
    }
    return item.note || '';
  }

  function _editNote(id, subKey) {
    const label = _entryLabelOf(id, subKey);
    if (!label) return;
    _askNote(label, _currentNoteOf(id, subKey), (val) => {
      if (val === null) return;                      // 취소
      Annotation.setNote(id, subKey || '', val);
      showMsg(val ? label + ' 메모: ' + val : label + ' 메모 삭제', 'info');
    });
  }

  /* 메모 입력 모달 — cb(문자열 | null). null = 취소, '' = 메모 삭제 */
  function _askNote(label, current, cb) {
    const modal = document.getElementById('modal-note');
    const input = document.getElementById('note-text');
    const title = document.getElementById('modal-note-target');
    if (!modal || !input) { cb(null); return; }

    const done = (val) => { modal.classList.add('hidden'); input.onkeydown = null; cb(val); };

    if (title) title.textContent = label;
    input.value = current || '';
    modal.classList.remove('hidden');
    input.focus();
    input.select();

    document.getElementById('modal-note-apply').onclick  = () => done(input.value);
    document.getElementById('modal-note-cancel').onclick = () => done(null);
    document.getElementById('modal-note-close').onclick  = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter')       { e.preventDefault(); done(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      e.stopPropagation();   // 전역 단축키(Enter=도형확정, ESC=그리기취소) 차단
    };
  }

  /* ── 넘버링 합치기 ── */

  function _setMergeMode(on) {
    CanvasManager.setMergeMode(on);
    const btn = document.getElementById('btn-merge');
    if (btn) btn.classList.toggle('merging', on);
    if (on) showMsg('합칠 넘버링을 클릭한 뒤 Enter (ESC: 취소)', 'info');
    _updateMergeHint(CanvasManager.getMergeSel());
  }

  function _updateMergeHint(sel) {
    const el = document.getElementById('cursor-hint');
    if (!el) return;
    if (!CanvasManager.isMergeMode()) { _updateCursorHint({ phase: 0 }); return; }
    el.textContent = sel.length
      ? `합치기: ${sel.length}개 선택 (${_mergePreviewText(sel)}) | Enter: 합치기 | ESC: 취소`
      : '합치기: 합칠 넘버링을 클릭하세요 | ESC: 취소';
  }

  /* 합쳐졌을 때의 라벨 미리보기 — 접두어가 모두 같으면 접두어 1회 */
  function _mergePreviewText(sel) {
    const items = sel.map(id => Annotation.getAll().find(i => i.id === id)).filter(Boolean);
    if (!items.length) return '';
    const pfxOf = (it) => {
      if (it.equipment) { const eq = Equipment.get(it.equipment); return eq ? (eq.prefix || '') : ''; }
      return Annotation.getConfig().prefix || '';
    };
    const entries = [];
    items.forEach(it => { entries.push(it); (it.merged || []).forEach(m => entries.push(m)); });
    const pfx  = pfxOf(entries[0]);
    const same = entries.every(e => pfxOf(e) === pfx);
    return same
      ? (pfx ? pfx + '-' : '') + entries.map(e => String(e.num).padStart(2, '0')).join(',')
      : entries.map(e => (pfxOf(e) ? pfxOf(e) + '-' : '') + String(e.num).padStart(2, '0')).join(',');
  }

  function _commitMerge() {
    const sel = CanvasManager.getMergeSel();
    if (sel.length < 2) { showMsg('2개 이상 선택해야 합칠 수 있습니다', 'warn'); return; }
    const items  = Annotation.getAll();
    const chosen = sel.map(id => items.find(i => i.id === id)).filter(Boolean);
    if (chosen.some(i => i.shape)) {
      showMsg('기울기·부동침하 도형은 합칠 수 없습니다', 'warn');
      return;
    }
    _askMergeStyle(_mergePreviewText(sel), (keepLeaders) => {
      if (keepLeaders === null) return;              // 취소 — 선택 유지
      const res = Annotation.mergeItems(sel, keepLeaders);
      if (!res.ok) {
        showMsg(res.reason === 'shape' ? '도형은 합칠 수 없습니다' : '합칠 수 없습니다', 'warn');
        return;
      }
      _setMergeMode(false);
      showMsg('넘버링 합침', 'success');
    });
  }

  /* 합치기 방식 모달 — cb(true=지시선 유지 | false=하나로 병합 | null=취소) */
  function _askMergeStyle(previewText, cb) {
    const modal = document.getElementById('modal-merge');
    if (!modal) { cb(null); return; }
    const done = (val) => { modal.classList.add('hidden'); cb(val); };

    const pv = document.getElementById('modal-merge-preview');
    if (pv) pv.textContent = previewText;
    modal.classList.remove('hidden');

    document.getElementById('modal-merge-keep').onclick   = () => done(true);
    document.getElementById('modal-merge-one').onclick    = () => done(false);
    document.getElementById('modal-merge-cancel').onclick = () => done(null);
    document.getElementById('modal-merge-close').onclick  = () => done(null);
  }

  const btnMerge = document.getElementById('btn-merge');
  if (btnMerge) btnMerge.addEventListener('click', () => _setMergeMode(!CanvasManager.isMergeMode()));

  /* 기울기 측정값 입력 모달 — cb(값 | null). Electron에서 prompt()가 막히므로 자체 모달 사용 */
  function _askTiltMeasure(cb) {
    const modal = document.getElementById('modal-tilt');
    const input = document.getElementById('tilt-measure');
    if (!modal || !input) { cb(null); return; }

    const done  = (val) => { modal.classList.add('hidden'); input.onkeydown = null; cb(val); };
    const apply = () => {
      const raw = input.value.trim();
      done(raw ? (/mm\s*$/i.test(raw) ? raw : raw + 'mm') : null);
    };

    input.value = '';
    modal.classList.remove('hidden');
    input.focus();

    document.getElementById('modal-tilt-apply').onclick  = apply;
    document.getElementById('modal-tilt-cancel').onclick = () => done(null);
    document.getElementById('modal-tilt-close').onclick  = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter')       { e.preventDefault(); apply(); }
      else if (e.key === 'Escape') { e.preventDefault(); done(null); }
      e.stopPropagation();   // 전역 단축키(Enter=도형확정, ESC=그리기취소) 차단
    };
  }

  function _updateCursorHint(state) {
    const el = document.getElementById('cursor-hint');
    if (!el) return;
    /* 합치기 모드 중에는 합치기 안내를 유지 */
    if (CanvasManager.isMergeMode()) { _updateMergeHint(CanvasManager.getMergeSel()); return; }
    if (AppMode.get() === AppMode.MODES.EQUIP) {
      const eq = Equipment.getActive();
      if (eq && eq.kind === 'tilt') {
        const isX = (Annotation.getConfig().tiltAxis || 'y') === 'x';
        el.textContent = state.phase === 0
          ? (isX ? '클릭: 좌측 기준점 지정' : '클릭: 상단 기준점 지정')
          : '클릭: 기울어진(변위) 끝점 지정 | ESC: 취소';
        return;
      }
      if (eq && eq.kind === 'settle') {
        el.textContent = '클릭: 측정점 추가 | Enter: 완료 | Q: 직교 | ESC: 취소';
        return;
      }
    }
    const st = CanvasManager.getShapeTool();
    if (st) {
      const nm = st === 'hatch-rect' ? '사각' : '원형';
      el.textContent = state.phase === 0
        ? `클릭: ${nm} 도형 첫 모서리 지정`
        : `클릭: 반대 모서리 지정 | ESC: 취소`;
      return;
    }
    if (CanvasManager.getTool() === 'none') {
      el.textContent = '클릭: 번호 위치 지정 (지시선 없음)';
      return;
    }
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

      // 2. globalConfig 복원 (scale, tbScale, lgScale, categories)
      if (data.globalConfig) {
        const { scale, tbScale, lgScale, categories } = data.globalConfig;
        Annotation.setConfig({ scale: scale || 1.0, tbScale: tbScale || 1.0, lgScale: lgScale || 1.0 });
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

      // 3. 페이지 복원 — 체험판도 전 페이지를 그대로 복원한다(게이트는 PDF 저장에만 있다)
      PageManager.fromJSON(data.pages);

      // 4. TitleBlock 복원
      if (data.titleBlock) {
        TitleBlock.setEnabled(data.titleBlock.enabled || false);
        TitleBlock.applySettings(data.titleBlock.settings || {});
        const tbToggle = document.getElementById('titleblock-toggle');
        if (tbToggle) tbToggle.checked = data.titleBlock.enabled || false;
      }

      // 4-b. 범례 복원
      if (data.legend !== undefined) {
        const legendOn = data.legend.enabled !== false;
        Legend.setEnabled(legendOn);
        const lgToggle = document.getElementById('legend-toggle');
        if (lgToggle) lgToggle.checked = legendOn;
      }

      // 4-c. 장비 구분 복원
      if (data.equipment) Equipment.fromJSON(data.equipment); else Equipment.reset();
      _renderEquipToolbar();

      // 4-d. 작업 모드 복원 (있을 때만 — 작업공간 스냅샷에는 없음)
      if (data.appMode) {
        AppMode.set(data.appMode, { force: true, silent: true });
        _applyModeUI(AppMode.get());
      }

      // 5. 화면 갱신
      const activePage = PageManager.getActivePage();
      if (activePage) {
        dropzone.classList.add('has-file');
        document.getElementById('file-name').textContent = activePage.name;
        await _loadPageImage(activePage);   // 저장된 도면 배율까지 복원
      }
      _renderPageList();
      CanvasManager.renderAnnotations(Annotation.getAll());
      _updateNextNumDisplay();
    } finally {
      _isRestoring = false;
    }
  }

  /* ── 프로젝트 전체 복원 (두 작업공간 지원) ──
     v2: { workspaces:{exterior,equip}, activeMode } / 레거시(v1)·자동저장: 단일 작업공간 */
  async function _restoreProject(project) {
    if (project && project.workspaces) {
      _workspaces.exterior = project.workspaces.exterior || null;
      _workspaces.equip    = project.workspaces.equip || null;
      const active = project.activeMode || (project.workspaces.exterior ? 'exterior' : 'equip');
      _wsMode = active;
      const activeData = _workspaces[active];
      _workspaces[active] = null;   // 활성 작업공간은 라이브로 전환
      AppMode.set(active, { force: true, silent: true });
      _applyModeUI(active);
      if (activeData) await _restoreFromData({ ...activeData, appMode: active });
      else            await _clearWorkspace();
    } else if (project) {
      const active = project.appMode || project.activeMode || 'exterior';
      _workspaces.exterior = null; _workspaces.equip = null;
      _wsMode = active;
      AppMode.set(active, { force: true, silent: true });
      _applyModeUI(active);
      await _restoreFromData({ ...project, appMode: active });
    }
    _updateNextNumDisplay();
  }

  /* ── 내보내기용 프로젝트 데이터 (두 작업공간 + 이미지 인라인) ── */
  function _buildProjectData() {
    const other  = _wsMode === 'exterior' ? 'equip' : 'exterior';
    const workspaces = {};
    workspaces[_wsMode] = _snapshotWorkspace();       // 활성 작업공간(이미지 인라인)
    if (_workspaces[other]) workspaces[other] = _workspaces[other];
    return { version: 2, updatedAt: new Date().toISOString(), activeMode: _wsMode, workspaces };
  }

  /* ── StorageManager 초기화 & 세션 복원 ── */
  await StorageManager.init(_onSaveStatusChange);
  StorageManager.setProjectProvider(_buildProjectData);

  /* Electron: 프로젝트 파일(.qspec·.numdraw) 더블클릭으로 실행된 경우 우선 로드 */
  const startupContent = window.electronAPI ? await window.electronAPI.getStartupFile() : null;

  if (startupContent) {
    try {
      const data = JSON.parse(startupContent);
      await _restoreProject(data);
      showMsg('프로젝트를 열었습니다', 'success');
    } catch (e) {
      showMsg('파일 열기 실패: ' + e.message, 'warn');
    }
  } else {
    /* 일반 실행: 이전 세션 복원 */
    const savedSession = await StorageManager.loadSession();
    if (savedSession) {
      const restored = confirm(
        `저장된 작업이 있습니다.\n마지막 저장: ${new Date(savedSession.updatedAt).toLocaleString()}\n\n불러오시겠습니까?`
      );
      if (restored) {
        await _restoreProject(savedSession);
        showMsg('이전 작업을 불러왔습니다', 'success');
      }
    }
  }

  /* Electron: 앱 실행 중 다른 프로젝트 파일 열기 요청 수신 */
  if (window.electronAPI) {
    window.electronAPI.onOpenFile(async (content) => {
      try {
        if (!confirm('현재 작업을 닫고 선택한 프로젝트를 여시겠습니까?')) return;
        const data = JSON.parse(content);
        await _restoreProject(data);
        showMsg('프로젝트를 열었습니다', 'success');
      } catch (e) {
        showMsg('파일 열기 실패: ' + e.message, 'warn');
      }
    });
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
