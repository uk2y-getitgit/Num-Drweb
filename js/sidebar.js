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

  /* ── 넘버링 목록 렌더 ── */
  function renderNumList(items) {
    const wrap    = document.getElementById('num-list-wrap');
    const counter = document.getElementById('num-count');
    if (counter) counter.textContent = items.length;
    const cv = document.querySelector('.count-val');
    if (cv)  cv.textContent = items.length;

    if (!items.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>도면을 클릭해 넘버링을 추가하세요</span>
        </div>`;
      return;
    }

    const cats = Annotation.getCategories();
    const cfg  = Annotation.getConfig();

    wrap.innerHTML = items.map(item => {
      const prefix  = cfg.prefix ? cfg.prefix + '-' : '';
      const numStr  = String(item.num).padStart(2, '0');
      const label   = prefix + numStr;
      const catInfo = cats[item.category];
      const catColor = catInfo?.color || item.color || 'var(--accent)';
      const catLabel = catInfo?.label || item.category || '기타';
      const isSelected = String(item.id) === String(selectedId);

      return `
        <div class="num-item ${isSelected ? 'selected' : ''}" data-id="${item.id}">
          <div class="num-badge" style="background:${catColor};color:#fff;">${label}</div>
          <div class="num-info">
            <div class="num-type">
              <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${catColor};flex-shrink:0;"></span>
              ${catLabel} · ${item.type === 'arrow' ? '화살표' : '점'}
            </div>
            <div class="num-photo">${item.photoName || '<span style="color:var(--text-placeholder)">미매칭</span>'}</div>
          </div>
          <button class="num-del" data-id="${item.id}" title="삭제">✕</button>
        </div>`;
    }).join('');

    /* 이벤트 — 삭제 버튼은 Number(dataset.id) 로 전달 */
    wrap.querySelectorAll('.num-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.num-del')) return;
        selectedId = el.dataset.id;
        if (onSelectNum) onSelectNum(Number(el.dataset.id));
        renderNumList(items);
      });
    });

    wrap.querySelectorAll('.num-del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (onDeleteNum) onDeleteNum(Number(btn.dataset.id));
      });
    });
  }

  /* ── 사진 목록 렌더 ── */
  function renderPhotoList(photos, annotations) {
    const wrap = document.getElementById('photo-list-wrap');

    if (!photos.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>폴더를 선택해 사진을 불러오세요</span>
        </div>`;
      return;
    }

    const countEl = document.getElementById('photo-count');
    if (countEl) countEl.textContent = photos.length;

    wrap.innerHTML = photos.map(p => {
      const isMatched = annotations.some(a => a.photoName === p.name);
      return `
        <div class="photo-item ${isMatched ? 'matched' : ''}" data-name="${p.name}" data-num="${p.num ?? ''}">
          <div class="photo-num">${p.num !== null && p.num !== undefined ? p.num : '?'}</div>
          <div class="photo-name" title="${p.name}">${p.name}</div>
          ${isMatched ? '<span class="photo-match-badge">✓</span>' : ''}
        </div>`;
    }).join('');

    wrap.querySelectorAll('.photo-item').forEach(el => {
      el.addEventListener('click', () => {
        wrap.querySelectorAll('.photo-item').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        if (onMatchPhoto) onMatchPhoto(el.dataset.name, el.dataset.num);
      });
    });
  }

  /* ── 카테고리 버튼 상태 갱신 ── */
  function updateCategoryUI(activeKey) {
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === activeKey);
    });
  }

  /* ── 카테고리 색상 피커 값 갱신 ── */
  function updateCategoryColorPicker(key, color) {
    const picker = document.getElementById(`cat-color-${key}`);
    if (picker) picker.value = color;
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

  return { init, renderNumList, renderPhotoList, updateCategoryUI, updateCategoryColorPicker, setFolderPath, setSaveState };
})();
