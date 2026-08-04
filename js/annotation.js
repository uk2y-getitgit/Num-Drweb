/* annotation.js — 지시선 & 넘버링 관리 */
'use strict';

const Annotation = (() => {
  let items = [];
  let nextNum = 1;
  let nextId  = 1;
  let onChange = null;

  /* 전역 설정 */
  let config = {
    prefix:     '',         // 접두어 (예: '1F', 'RF')
    textColor:  '#ffffff',  // 번호 박스 글씨 색상
    lineStyle:  'straight', // 'straight'|'elbow-h'|'elbow-v'|'zigzag'
    arrowFlip:  true,       // false=지시선 향함, true=지시선 반대 방향
    tiltAxis:   'y',        // 기울기 도형 기준축 — 'y'=세로 기준선 | 'x'=가로 기준선
    scale:      1.0,        // 넘버링(화살표·번호박스) 크기 배율 (0.5 ~ 3.0)
    tbScale:    1.0,        // 도곽 전용 배율 (0.5 ~ 3.0)
    lgScale:    1.0,        // 범례 전용 배율 (0.5 ~ 3.0)
  };

  /* 카테고리 정의 — 색상은 사용자 편집 가능 */
  let categories = {
    defect:  { label: '결함',  color: '#e05555' },
    repair:  { label: '보수',  color: '#4a9eff' },
    other:   { label: '신규',  color: '#9b59b6' },
  };

  /* 현재 선택된 카테고리 */
  let activeCategory = 'defect';

  /* ── 공개 API ── */
  function init(callback) { onChange = callback; }

  /* equip: 장비 모드에서 전달되는 { key, color } — 있으면 장비별 독립 순번 부여 */
  function add(p1, p2, type, equip) {
    const cat = activeCategory;
    const item = {
      id:        nextId++,
      num:       equip ? _nextNumForEquipment(equip.key) : nextNum++,
      type,
      lineStyle:  config.lineStyle,
      arrowFlip:  config.arrowFlip,
      category:   equip ? undefined : cat,
      equipment:  equip ? equip.key : undefined,
      color:      equip ? equip.color : categories[cat].color,
      textColor:  config.textColor,
      p1: { ...p1 },
      p2: { ...p2 },
      photoName:      null,
      customPhotoNum: null,
    };
    items.push(item);
    if (onChange) onChange();
    return item;
  }

  /* 장비별 다음 번호 (primary + 추가 라벨 모두 스캔) */
  function _nextNumForEquipment(key) {
    let max = 0;
    items.forEach(i => {
      if (i.equipment === key && i.num > max) max = i.num;
      if (i.labels) i.labels.forEach(l => { if (l.equipment === key && l.num > max) max = l.num; });
    });
    return max + 1;
  }
  function getNextNumForEquipment(key) { return _nextNumForEquipment(key); }

  /* 기존 지시선에 다른 장비 넘버 추가 (item 2·3) — equip: { key, color } */
  function addLabelToItem(id, equip) {
    const item = items.find(i => i.id === Number(id));
    if (!item || !equip) return null;
    /* 이미 같은 장비가 있으면 중복 추가 금지 */
    if (item.equipment === equip.key) return null;
    if (!item.labels) item.labels = [];
    if (item.labels.some(l => l.equipment === equip.key)) return null;
    const label = { equipment: equip.key, num: _nextNumForEquipment(equip.key), color: equip.color };
    item.labels.push(label);
    if (onChange) onChange();
    return label;
  }

  /* 도형 추가 (item 4) — kind: 'tilt'{p1,p2} | 'settle'{points}, equip: {key,color} */
  function addShape(kind, geom, equip) {
    const item = {
      id:        nextId++,
      num:       equip ? _nextNumForEquipment(equip.key) : nextNum++,
      equipment: equip ? equip.key : undefined,
      category:  equip ? undefined : activeCategory,
      color:     equip ? equip.color : categories[activeCategory].color,
      textColor: config.textColor,
      shape:     kind,
      ...geom,
      photoName:      null,
      customPhotoNum: null,
    };
    items.push(item);
    if (onChange) onChange();
    return item;
  }

  function remove(id) {
    const numId = Number(id);
    const idx = items.findIndex(i => i.id === numId);
    if (idx === -1) return;
    items.splice(idx, 1);
    _resequence();
    if (onChange) onChange();
  }

  function clear() {
    items = [];
    nextNum = 1;
    nextId  = 1;
    if (onChange) onChange();
  }

  function updateItem(id, patch) {
    const numId = Number(id);
    const item = items.find(i => i.id === numId);
    if (!item) return;
    Object.assign(item, patch);
    /* category 변경 시 해당 카테고리 색상으로 color 자동 갱신 */
    if (patch.category !== undefined && categories[patch.category]) {
      item.color = categories[patch.category].color;
    }
    if (onChange) onChange();
  }

  function getAll() { return items; }

  function setNextNum(n) { nextNum = n; }
  function getNextNum() { return nextNum; }

  /* ── 카테고리 ── */
  function setActiveCategory(key) { activeCategory = key; }
  function getActiveCategory()    { return activeCategory; }
  function getCategories()        { return categories; }
  function setCategoryColor(key, color) {
    if (categories[key]) {
      categories[key].color = color;
      /* 기존 항목 중 같은 카테고리의 색상 일괄 갱신 */
      items.filter(i => i.category === key).forEach(i => { i.color = color; });
      if (onChange) onChange();
    }
  }

  /* ── 전역 설정 ── */
  function setConfig(patch) {
    Object.assign(config, patch);
    /* textColor → 기존 항목 일괄 적용 */
    if (patch.textColor !== undefined) {
      items.forEach(i => { i.textColor = patch.textColor; });
    }
    /* scale·tbScale·arrowFlip 변경 시 재렌더 필요 */
    if (patch.scale !== undefined || patch.tbScale !== undefined ||
        patch.textColor !== undefined || patch.arrowFlip !== undefined ||
        patch.tiltAxis !== undefined) {
      if (onChange) onChange();
    }
  }
  function getConfig()      { return config; }

  /* ── 사진 매칭 ── */
  function matchPhoto(id, photoName) {
    const numId = Number(id);
    const item = items.find(i => i.id === numId);
    if (item) { item.photoName = photoName; if (onChange) onChange(); }
  }

  /* ── 직렬화 ── */
  function toJSON() { return JSON.stringify({ items, nextNum, nextId, config, categories }); }

  function fromJSON(json) {
    try {
      const d = JSON.parse(json);
      items   = d.items  || [];
      nextNum = d.nextNum || 1;
      nextId  = d.nextId  || (items.reduce((m, i) => Math.max(m, i.id || 0), 0) + 1);
      if (d.config) {
        /* scale·tbScale은 전 페이지 공통 전역값 — 페이지 복원 시 덮어쓰지 않는다 */
        const { scale, tbScale, ...pageConfig } = d.config;
        Object.assign(config, pageConfig);
      }
      if (d.categories) Object.assign(categories, d.categories);
      if (onChange) onChange();
    } catch (e) { console.error('fromJSON 실패', e); }
  }

  /* ── 번호 재정렬 ──
     장비 항목은 장비별 독립 순번, 일반(외관) 항목은 전역 순번으로 재정렬 */
  function _resequence() {
    const perEquip = {};
    let globalC = 0;
    items.forEach(item => {
      if (item.equipment) {
        perEquip[item.equipment] = (perEquip[item.equipment] || 0) + 1;
        item.num = perEquip[item.equipment];
        if (item.labels) item.labels.forEach(l => {
          perEquip[l.equipment] = (perEquip[l.equipment] || 0) + 1;
          l.num = perEquip[l.equipment];
        });
      } else {
        globalC++;
        item.num = globalC;
      }
    });
    nextNum = globalC + 1;
  }

  /* ── 겹침 방지 자동정렬 ── */
  function autoLayout(canvasW, canvasH) {
    const BOX_W = 40, BOX_H = 24, MARGIN = 6;
    /* 번호박스를 가진 지시선만 대상 — 도형(기울기·부동침하)은 제외 */
    const targets = items.filter(i => !i.shape && i.p2);
    for (let iter = 0; iter < 100; iter++) {
      let moved = false;
      for (let a = 0; a < targets.length; a++) {
        for (let b = a + 1; b < targets.length; b++) {
          const A = targets[a].p2, B = targets[b].p2;
          const dx = B.x - A.x, dy = B.y - A.y;
          const overX = (BOX_W + MARGIN) - Math.abs(dx);
          const overY = (BOX_H + MARGIN) - Math.abs(dy);
          if (overX > 0 && overY > 0) {
            const pushX = (overX / 2 + 1) * Math.sign(dx || 1);
            const pushY = (overY / 2 + 1) * Math.sign(dy || 1);
            if (overX < overY) { A.x -= pushX; B.x += pushX; }
            else               { A.y -= pushY; B.y += pushY; }
            moved = true;
          }
        }
        const p = targets[a].p2;
        p.x = Math.max(BOX_W / 2, Math.min(canvasW - BOX_W / 2, p.x));
        p.y = Math.max(BOX_H / 2, Math.min(canvasH - BOX_H / 2, p.y));
      }
      if (!moved) break;
    }
    if (onChange) onChange();
  }

  return {
    init, add, remove, clear, updateItem, getAll,
    setNextNum, getNextNum, getNextNumForEquipment, addLabelToItem, addShape,
    setActiveCategory, getActiveCategory, getCategories, setCategoryColor,
    setConfig, getConfig,
    matchPhoto, toJSON, fromJSON, autoLayout,
  };
})();
