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
        ${pg.items.map(item => _renderNumItem(item, cfg, cats, pg.isActive, pg.prefix)).join('')}
      `).join('');
    } else if (pagesWithData && pagesWithData.length === 1) {
      /* 데이터 있는 페이지가 1개뿐 */
      const pg = pagesWithData[0];
      html = COL_HEADER + pg.items.map(item => _renderNumItem(item, cfg, cats, pg.isActive, pg.prefix)).join('');
    } else {
      /* allPages 없음 — 현재 페이지 항목만 */
      html = COL_HEADER + items.map(item => _renderNumItem(item, cfg, cats, true, cfg.prefix)).join('');
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
        if (onDeleteNum) onDeleteNum(Number(btn.dataset.id));
      });
    });

    wrap.querySelectorAll('.photo-num-input').forEach((input, _i, arr) => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('blur', e => {
        const id  = Number(e.target.dataset.id);
        const val = e.target.value.trim();
        Annotation.updateItem(id, { customPhotoNum: val !== '' ? Number(val) : null });
      });
      /* Tab 키 순차 이동 — blur로 DOM 재구성 후 포커스 복구 */
      input.addEventListener('keydown', e => {
        if (e.key !== 'Tab') return;
        e.preventDefault();
        const inputs = Array.from(wrap.querySelectorAll('.photo-num-input'));
        const idx  = inputs.indexOf(e.target);
        const next = inputs[idx + (e.shiftKey ? -1 : 1)];
        if (!next) return;
        const nextId = next.dataset.id;
        next.focus(); // blur 발생 → updateItem → renderNumList(DOM 재구성)
        // DOM 재구성 완료 후 해당 id의 input에 포커스 복구
        setTimeout(() => {
          const restored = wrap.querySelector(`.photo-num-input[data-id="${nextId}"]`);
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

  /* ── 넘버 항목 HTML 생성 ── */
  function _renderNumItem(item, cfg, cats, isActive, pagePrefix) {
    const prefix   = (pagePrefix !== undefined ? pagePrefix : cfg.prefix);
    const prefixStr = prefix ? prefix + '-' : '';
    const numStr   = String(item.num).padStart(2, '0');
    const label    = prefixStr + numStr;
    const catInfo  = cats[item.category];
    const catColor = catInfo?.color || item.color || 'var(--accent)';
    const catLabel = catInfo?.label || item.category || '신규';
    const isSelected = isActive && String(item.id) === String(selectedId);
    const customVal  = (item.customPhotoNum !== null && item.customPhotoNum !== undefined)
                       ? item.customPhotoNum : '';
    const photoStr   = item.photoName
      ? item.photoName
      : '<span style="color:var(--text-placeholder)">미매칭</span>';

    if (!isActive) {
      const displayNum = item.customPhotoNum !== null && item.customPhotoNum !== undefined
                         ? item.customPhotoNum
                         : '';
      return `
        <div class="num-item num-item-readonly" data-id="${item.id}" data-active="false">
          <div class="num-badge" style="background:${catColor};color:#fff;">${label}</div>
          <div class="num-info">
            <div class="num-type">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0;"></span>
              ${catLabel} · ${item.type === 'arrow' ? '화살표' : '점'}
            </div>
            <div class="num-photo">${photoStr}</div>
          </div>
          <span class="photo-num-display">${displayNum || '-'}</span>
        </div>`;
    }

    const catBtns = isSelected ? `
      <div class="num-category-selector">
        ${Object.entries(cats).map(([key, info]) => {
          const active = item.category === key;
          const style = active
            ? `background:${info.color};color:#fff;border-color:${info.color};`
            : `color:${info.color};border-color:${info.color};`;
          return `<button class="num-cat-btn${active ? ' active' : ''}" data-id="${item.id}" data-cat="${key}" style="${style}">${info.label}</button>`;
        }).join('')}
      </div>` : '';

    return `
      <div class="num-item ${isSelected ? 'selected' : ''}" data-id="${item.id}" data-active="true">
        <div class="num-badge" style="background:${catColor};color:#fff;">${label}</div>
        <div class="num-info">
          <div class="num-type">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0;"></span>
            ${catLabel} · ${item.type === 'arrow' ? '화살표' : '점'}
          </div>
          <div class="num-photo">${photoStr}</div>
        </div>
        ${catBtns}
        <input type="number" class="photo-num-input" value="${customVal}"
          placeholder="${item.num}" data-id="${item.id}" title="사진 매칭 번호 (빈칸: 기본)">
        <button class="num-del" data-id="${item.id}" title="삭제">✕</button>
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
