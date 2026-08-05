/* sidebar.js — 사이드바 UI 렌더링 */
'use strict';

const Sidebar = (() => {
  let onSelectNum  = null;
  let onDeleteNum  = null;
  let onMatchPhoto = null;
  let onEditNote   = null;
  let selectedId   = null;

  function init(callbacks) {
    onSelectNum  = callbacks.onSelectNum;
    onDeleteNum  = callbacks.onDeleteNum;
    onMatchPhoto = callbacks.onMatchPhoto;
    onEditNote   = callbacks.onEditNote;
  }

  /* ── 넘버링 목록 렌더 ──
     items    : 현재 페이지 항목 (toolbar 카운터 갱신용)
     allPages : [{ id, name, isActive, items[] }] — 전달 시 전 페이지 통합 표시 */
  function renderNumList(items, allPages) {
    const wrap    = document.getElementById('num-list-wrap');
    const counter = document.getElementById('num-count');
    if (counter) counter.textContent = items.length;
    const cv = document.querySelector('.count-val');
    if (cv)  cv.textContent = items.length;

    const cats = Annotation.getCategories();
    const cfg  = Annotation.getConfig();

    /* 표시할 페이지 그룹 구성 */
    const pagesWithData = allPages
      ? allPages.filter(p => p.items.length > 0)
      : null;

    const totalCount = pagesWithData
      ? pagesWithData.reduce((n, p) => n + p.items.length, 0)
      : items.length;

    if (!totalCount) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>도면을 클릭해 넘버링을 추가하세요</span>
        </div>`;
      return;
    }

    let html = '';

    const COL_HEADER = `
      <div class="num-list-header">
        <span class="nlh-num">결함번호</span>
        <span class="nlh-type">결함종류</span>
        <span class="nlh-photo">매칭번호</span>
      </div>`;

    if (pagesWithData && pagesWithData.length > 1) {
      /* 다중 페이지 — 페이지 헤더 + 열 헤더 + 그룹 */
      html = pagesWithData.map(pg => `
        <div class="page-section-hdr${pg.isActive ? ' active' : ''}" data-page-id="${pg.id}">
          <span class="psh-name">${pg.name}</span>
          <span class="psh-count">${pg.items.length}</span>
        </div>
        ${COL_HEADER}
        ${_sortItems(pg.items).map(item => _renderNumItem(item, cfg, cats, pg.isActive, pg.prefix)).join('')}
      `).join('');
    } else if (pagesWithData && pagesWithData.length === 1) {
      /* 데이터 있는 페이지가 1개뿐 */
      const pg = pagesWithData[0];
      html = COL_HEADER + _sortItems(pg.items).map(item => _renderNumItem(item, cfg, cats, pg.isActive, pg.prefix)).join('');
    } else {
      /* allPages 없음 — 현재 페이지 항목만 */
      html = COL_HEADER + _sortItems(items).map(item => _renderNumItem(item, cfg, cats, true, cfg.prefix)).join('');
    }

    wrap.innerHTML = html;

    /* ── 이벤트 바인딩 (현재 페이지 활성 항목만) ── */
    wrap.querySelectorAll('.num-item[data-active="true"]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.num-del') || e.target.closest('.photo-num-input')) return;
        selectedId = el.dataset.id;
        if (onSelectNum) onSelectNum(Number(el.dataset.id));
        renderNumList(items, allPages);
      });
      /* 더블클릭 → 메모 편집 (캔버스 번호박스 더블클릭과 동일) */
      el.addEventListener('dblclick', e => {
        if (e.target.closest('.num-del') || e.target.closest('.photo-num-input')) return;
        if (onEditNote) onEditNote(Number(el.dataset.id), el.dataset.sub || '');
      });
    });

    wrap.querySelectorAll('.num-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        /* 묶인·합쳐진 번호 행이면 그 번호만 처리 */
        if (onDeleteNum) onDeleteNum(Number(btn.dataset.id), btn.dataset.sub || '');
      });
    });

    wrap.querySelectorAll('.photo-num-input').forEach((input, _i, arr) => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('dblclick', e => e.stopPropagation());
      input.addEventListener('blur', e => {
        const id     = Number(e.target.dataset.id);
        const subKey = e.target.dataset.sub || '';
        const val    = e.target.value.trim();
        Annotation.updateSub(id, subKey, { customPhotoNum: val !== '' ? Number(val) : null });
      });
      /* Tab 키 순차 이동 — blur로 DOM 재구성 후 포커스 복구 */
      input.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const inputs = Array.from(wrap.querySelectorAll('.photo-num-input'));
        const idx  = inputs.indexOf(e.target);
        const next = inputs[idx + (e.shiftKey ? -1 : 1)];
        if (!next) return;
        const nextRow = next.dataset.row;
        next.focus(); // blur 발생 → updateItem → renderNumList(DOM 재구성)
        // DOM 재구성 완료 후 해당 행의 input에 포커스 복구
        setTimeout(() => {
          const restored = wrap.querySelector(`.photo-num-input[data-row="${nextRow}"]`);
          if (restored) restored.focus();
        }, 0);
      });
    });

    wrap.querySelectorAll('.num-cat-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id  = Number(btn.dataset.id);
        const cat = btn.dataset.cat;
        Annotation.updateItem(id, { category: cat });
        renderNumList(items, allPages);
      });
    });
  }

  /* 목록 표시 순서 — 장비별로 묶어 번호순 (삭제 후 재마킹해도 번호 자리에 표시) */
  function _sortItems(list) {
    const order = {};
    if (typeof Equipment !== 'undefined') {
      Equipment.getList().forEach((e, i) => { order[e.key] = i; });
    }
    return [...list].sort((a, b) => {
      const ea = a.equipment ? (order[a.equipment] ?? 99) : -1;
      const eb = b.equipment ? (order[b.equipment] ?? 99) : -1;
      return ea !== eb ? ea - eb : (a.num || 0) - (b.num || 0);
    });
  }

  /* 번호 엔트리(본체·묶인 번호·합쳐진 번호)의 표시 속성 */
  function _entryStyle(entry, cfg, cats, pagePrefix) {
    if (entry.equipment && typeof Equipment !== 'undefined') {
      const eq = Equipment.get(entry.equipment);
      return {
        isEquip:  true,
        label:    ((eq && eq.prefix) ? eq.prefix + '-' : '') + String(entry.num).padStart(2, '0'),
        color:    (eq && eq.color) || entry.color || 'var(--accent)',
        catLabel: eq ? eq.label : (entry.equipment || '장비'),
      };
    }
    const prefix  = (pagePrefix !== undefined ? pagePrefix : cfg.prefix);
    const catInfo = cats[entry.category];
    return {
      isEquip:  false,
      label:    (prefix ? prefix + '-' : '') + String(entry.num).padStart(2, '0'),
      color:    catInfo?.color || entry.color || 'var(--accent)',
      catLabel: catInfo?.label || entry.category || '신규',
    };
  }

  /* ── 넘버 항목 HTML 생성 ──
     한 지시선에 여러 번호(묶음·합침)가 딸려 있으면 각 번호를 개별 행으로 펼쳐
     번호마다 삭제·메모·매칭번호 수정이 가능하게 한다. */
  function _renderNumItem(item, cfg, cats, isActive, pagePrefix) {
    const typeLabel = (item.shape === 'tilt'   || item.shape === 'triangle') ? '기울기'
                    : (item.shape === 'settle' || item.shape === 'polygon')  ? '부동침하'
                    : (item.type === 'none' ? '없음' : item.type === 'arrow' ? '화살표' : '점');

    /* 기본(지시선 소유) 행 */
    const st = _entryStyle(item, cfg, cats, pagePrefix);
    const mergedCount = (item.merged || []).length;

    let html = _renderNumRow({
      item, cfg, cats, isActive, isEquipItem: st.isEquip, sub: false, subKey: '',
      label: st.label, color: st.color, catLabel: st.catLabel,
      typeLabel: mergedCount ? typeLabel + ' · 합침 ' + (mergedCount + 1) : typeLabel,
      num: item.num, note: item.note,
      customPhotoNum: item.customPhotoNum, photoName: item.photoName,
    });

    /* 합쳐진 번호 행 — 같은 번호박스에 표기되는 번호들 */
    (item.merged || []).forEach(m => {
      const ms = _entryStyle(m, cfg, cats, pagePrefix);
      html += _renderNumRow({
        item, cfg, cats, isActive, isEquipItem: ms.isEquip, sub: true, subKey: 'M' + m.mid,
        label: ms.label, color: ms.color, catLabel: ms.catLabel, typeLabel: '합침',
        num: m.num, note: m.note,
        customPhotoNum: m.customPhotoNum, photoName: m.photoName,
      });
    });

    /* 묶인 장비 번호 행 — 별도 번호박스로 쌓이는 번호들 */
    (item.labels || []).forEach(l => {
      const ls = _entryStyle(l, cfg, cats, pagePrefix);
      html += _renderNumRow({
        item, cfg, cats, isActive, isEquipItem: ls.isEquip, sub: true, subKey: 'L' + l.lid,
        label: ls.label, color: ls.color, catLabel: ls.catLabel, typeLabel: '묶음',
        num: l.num, note: l.note,
        customPhotoNum: l.customPhotoNum, photoName: l.photoName,
      });
    });
    return html;
  }

  /* 넘버 목록의 행 하나 (기본 행 / 묶인·합쳐진 번호 행 공용) */
  function _renderNumRow(r) {
    const { item, cats, isActive, isEquipItem, sub, subKey, label, color, catLabel, typeLabel, num } = r;
    const rowKey    = item.id + (subKey ? ':' + subKey : '');
    const noteHtml  = r.note ? `<span class="num-note" title="${r.note}">${r.note}</span>` : '';
    const customVal = (r.customPhotoNum !== null && r.customPhotoNum !== undefined) ? r.customPhotoNum : '';
    const photoStr  = r.photoName ? r.photoName
                    : '<span style="color:var(--text-placeholder)">미매칭</span>';
    const badge = `<div class="num-badge" style="background:${color};color:#fff;">${label}</div>`;
    const info  = `
      <div class="num-info">
        <div class="num-type">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          ${catLabel} · ${typeLabel}${noteHtml}
        </div>
        <div class="num-photo">${photoStr}</div>
      </div>`;

    if (!isActive) {
      return `
        <div class="num-item num-item-readonly${sub ? ' num-item-sub' : ''}" data-id="${item.id}" data-active="false">
          ${badge}${info}
          <span class="photo-num-display">${customVal || '-'}</span>
        </div>`;
    }

    const isSelected = String(item.id) === String(selectedId);
    const catBtns = (isSelected && !isEquipItem && !sub) ? `
      <div class="num-category-selector">
        ${Object.entries(cats).map(([key, info2]) => {
          const active = item.category === key;
          const style = active
            ? `background:${info2.color};color:#fff;border-color:${info2.color};`
            : `color:${info2.color};border-color:${info2.color};`;
          return `<button class="num-cat-btn${active ? ' active' : ''}" data-id="${item.id}" data-cat="${key}" style="${style}">${info2.label}</button>`;
        }).join('')}
      </div>` : '';

    const delTitle = subKey[0] === 'M' ? '합치기 해제'
                   : subKey[0] === 'L' ? '이 장비 번호만 삭제'
                   : '삭제';

    return `
      <div class="num-item ${isSelected ? 'selected' : ''}${sub ? ' num-item-sub' : ''}"
           data-id="${item.id}" data-sub="${subKey}" data-active="true"
           title="더블클릭: 메모 편집">
        ${badge}${info}
        ${catBtns}
        <input type="number" class="photo-num-input" value="${customVal}"
          placeholder="${num}" data-id="${item.id}" data-sub="${subKey}"
          data-row="${rowKey}" title="사진 매칭 번호 (빈칸: 기본)">
        <button class="num-del" data-id="${item.id}" data-sub="${subKey}"
          title="${delTitle}">✕</button>
      </div>`;
  }

  /* ── 파일명 변환 미리보기 렌더 ── */
  function renderRenamePreview(preview) {
    const wrap  = document.getElementById('rename-preview-list');
    const btnAll = document.getElementById('btn-rename-all');
    if (!wrap) return;

    if (!preview || !preview.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <span>넘버링을 추가하거나 폴더를 선택하세요</span>
        </div>`;
      if (btnAll) btnAll.disabled = true;
      return;
    }

    const hasReady = preview.some(r => r.status === 'ready');
    if (btnAll) btnAll.disabled = !hasReady;

    wrap.innerHTML = preview.map(row => {
      const { label, oldName, newName, status } = row;
      const cls = { ready:'rp-ready', same:'rp-same', nomatch:'rp-nomatch', ok:'rp-ok', error:'rp-error' }[status] || '';
      const statusText = { ready:'▶', same:'=', nomatch:'−', ok:'✓', error:'✗' }[status] || '';
      return `
        <div class="rename-preview-row ${cls}">
          <span class="rp-label">${label}</span>
          <span class="rp-old">${oldName || '미매칭'}</span>
          <span class="rp-arrow">→</span>
          <span class="rp-new">${newName || row.newBaseName}</span>
          <span class="rp-status">${statusText}</span>
        </div>`;
    }).join('');
  }

  /* ── 카테고리 버튼 상태 갱신 ── */
  function updateCategoryUI(activeKey) {
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === activeKey);
    });
  }

  function setFolderPath(name) {
    const el = document.getElementById('folder-path');
    if (!el) return;
    if (name) { el.textContent = '📁 ' + name; el.classList.add('has-path'); }
    else       { el.textContent = '폴더를 선택하지 않았습니다'; el.classList.remove('has-path'); }
  }

  function setSaveState(state) {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.className = 'save-indicator ' + state;
    el.textContent = state === 'saved' ? '● 저장됨' : '● 미저장';
  }

  /* 사이드바 선택 해제 (캔버스 클릭 시 호출) */
  function clearSelection() {
    selectedId = null;
  }

  return { init, renderNumList, renderRenamePreview, updateCategoryUI, setFolderPath, setSaveState, clearSelection };
})();
