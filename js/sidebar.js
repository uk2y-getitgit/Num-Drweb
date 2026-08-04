/* sidebar.js — 사이드바 UI 렌더링 */
'use strict';

const Sidebar = (() => {
  let onSelectNum  = null;
  let onDeleteNum  = null;
  let onMatchPhoto = null;
  let selectedId   = null;

  function init(callbacks) {
    onSelectNum  = callbacks.onSelectNum;
    onDeleteNum  = callbacks.onDeleteNum;
    onMatchPhoto = callbacks.onMatchPhoto;
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
    });

    wrap.querySelectorAll('.num-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        /* 묶인 장비 번호 행이면 그 번호만 삭제 */
        if (onDeleteNum) onDeleteNum(Number(btn.dataset.id), btn.dataset.labelKey || null);
      });
    });

    wrap.querySelectorAll('.photo-num-input').forEach((input, _i, arr) => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('blur', e => {
        const id       = Number(e.target.dataset.id);
        const labelKey = e.target.dataset.labelKey || null;
        const val      = e.target.value.trim();
        const patch    = { customPhotoNum: val !== '' ? Number(val) : null };
        if (labelKey) Annotation.updateLabel(id, labelKey, patch);
        else          Annotation.updateItem(id, patch);
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

  /* ── 넘버 항목 HTML 생성 ──
     한 지시선에 여러 장비 번호가 묶여 있으면 각 번호를 개별 행으로 펼쳐
     번호마다 삭제·매칭번호 수정이 가능하게 한다. */
  function _renderNumItem(item, cfg, cats, isActive, pagePrefix) {
    const isEquipItem = !!item.equipment && typeof Equipment !== 'undefined';
    const typeLabel = (item.shape === 'tilt'   || item.shape === 'triangle') ? '기울기'
                    : (item.shape === 'settle' || item.shape === 'polygon')  ? '부동침하'
                    : (item.type === 'none' ? '없음' : item.type === 'arrow' ? '화살표' : '점');

    /* 기본(지시선 소유) 행 */
    let prefix, color, catLabel;
    if (isEquipItem) {
      const eq = Equipment.get(item.equipment);
      prefix   = eq ? eq.prefix : '';
      color    = (eq && eq.color) || item.color || 'var(--accent)';
      catLabel = eq ? eq.label : (item.equipment || '장비');
    } else {
      prefix   = (pagePrefix !== undefined ? pagePrefix : cfg.prefix);
      const catInfo = cats[item.category];
      color    = catInfo?.color || item.color || 'var(--accent)';
      catLabel = catInfo?.label || item.category || '신규';
    }

    let html = _renderNumRow({
      item, cfg, cats, isActive, isEquipItem, sub: false, labelKey: '',
      label: (prefix ? prefix + '-' : '') + String(item.num).padStart(2, '0'),
      color, catLabel, typeLabel,
      num: item.num, customPhotoNum: item.customPhotoNum, photoName: item.photoName,
    });

    /* 묶인 장비 번호 행 */
    if (isEquipItem && item.labels && item.labels.length) {
      item.labels.forEach(l => {
        const eq = Equipment.get(l.equipment);
        html += _renderNumRow({
          item, cfg, cats, isActive, isEquipItem: true, sub: true, labelKey: l.equipment,
          label: ((eq && eq.prefix) ? eq.prefix + '-' : '') + String(l.num).padStart(2, '0'),
          color: (eq && eq.color) || l.color || 'var(--accent)',
          catLabel: eq ? eq.label : (l.equipment || '장비'),
          typeLabel: '묶음',
          num: l.num, customPhotoNum: l.customPhotoNum, photoName: l.photoName,
        });
      });
    }
    return html;
  }

  /* 넘버 목록의 행 하나 (기본 행 / 묶인 장비 번호 행 공용) */
  function _renderNumRow(r) {
    const { item, cats, isActive, isEquipItem, sub, labelKey, label, color, catLabel, typeLabel, num } = r;
    const rowKey    = item.id + (labelKey ? ':' + labelKey : '');
    const customVal = (r.customPhotoNum !== null && r.customPhotoNum !== undefined) ? r.customPhotoNum : '';
    const photoStr  = r.photoName ? r.photoName
                    : '<span style="color:var(--text-placeholder)">미매칭</span>';
    const badge = `<div class="num-badge" style="background:${color};color:#fff;">${label}</div>`;
    const info  = `
      <div class="num-info">
        <div class="num-type">
          <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          ${catLabel} · ${typeLabel}
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

    return `
      <div class="num-item ${isSelected ? 'selected' : ''}${sub ? ' num-item-sub' : ''}"
           data-id="${item.id}" data-label-key="${labelKey}" data-active="true">
        ${badge}${info}
        ${catBtns}
        <input type="number" class="photo-num-input" value="${customVal}"
          placeholder="${num}" data-id="${item.id}" data-label-key="${labelKey}"
          data-row="${rowKey}" title="사진 매칭 번호 (빈칸: 기본)">
        <button class="num-del" data-id="${item.id}" data-label-key="${labelKey}"
          title="${labelKey ? '이 장비 번호만 삭제' : '삭제'}">✕</button>
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
