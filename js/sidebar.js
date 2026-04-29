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
      const prefix   = cfg.prefix ? cfg.prefix + '-' : '';
      const numStr   = String(item.num).padStart(2, '0');
      const label    = prefix + numStr;
      const catInfo  = cats[item.category];
      const catColor = catInfo?.color || item.color || 'var(--accent)';
      const catLabel = catInfo?.label || item.category || '기타';
      const isSelected = String(item.id) === String(selectedId);
      const customVal  = (item.customPhotoNum !== null && item.customPhotoNum !== undefined)
                         ? item.customPhotoNum : '';

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
          <input type="number" class="photo-num-input" value="${customVal}"
            placeholder="${item.num}" data-id="${item.id}" title="사진 매칭 번호 (빈칸: 기본)">
          <button class="num-del" data-id="${item.id}" title="삭제">✕</button>
        </div>`;
    }).join('');

    /* 이벤트 */
    wrap.querySelectorAll('.num-item').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('.num-del') || e.target.closest('.photo-num-input')) return;
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

    wrap.querySelectorAll('.photo-num-input').forEach(input => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('change', e => {
        e.stopPropagation();
        const id  = Number(e.target.dataset.id);
        const val = e.target.value.trim();
        Annotation.updateItem(id, { customPhotoNum: val !== '' ? Number(val) : null });
      });
    });
  }

  /* ── 파일명 변환 미리보기 렌더 (C-3) ── */
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

  return { init, renderNumList, renderRenamePreview, updateCategoryUI, setFolderPath, setSaveState };
})();
