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
    hatchColor: '#e05555',  // 해치 도형 색상 — 그리는 시점의 값이 도형에 고정 저장된다
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
      num:       equip ? _nextNumForEquipment(equip.key) : _nextNumGlobal(),
      type,
      lineStyle:  config.lineStyle,
      arrowFlip:  config.arrowFlip,
      category:   equip ? undefined : cat,
      equipment:  equip ? equip.key : undefined,
      color:      equip ? equip.color : categories[cat].color,
      textColor:  config.textColor,
      p1: { ...p1 },
      p2: { ...p2 },
      note:           null,
      photoName:      null,
      customPhotoNum: null,
    };
    items.push(item);
    if (onChange) onChange();
    return item;
  }

  /* 장비별 사용자 지정 시작 번호 */
  function _equipStart(key) {
    return (typeof Equipment !== 'undefined') ? Equipment.getStart(key) : 1;
  }

  /* 시작 번호부터 훑어 비어 있는 가장 작은 번호 (없으면 마지막 다음 번호).
     삭제로 생긴 빈 번호를 다음 마킹이 채우도록 하는 규칙 */
  function _firstFreeNum(used, start) {
    let n = Math.max(1, start || 1);
    while (used.has(n)) n++;
    return n;
  }

  /* 한 항목이 점유한 모든 번호 엔트리 (본체 + 묶은 라벨 + 합쳐진 번호).
     합쳐진 번호도 '사용 중'이어야 다음 마킹이 같은 번호를 재발급하지 않는다. */
  function _entriesOf(item) {
    if (item.noNum) return [];   // 해치 도형 등 번호 없는 순수 그래픽은 번호를 점유하지 않는다
    const out = [item];
    /* 합쳐진 번호는 같은 박스에 표기되므로 라벨보다 앞에 둔다 (재정렬 시 연속 번호 유지) */
    if (item.merged) out.push(...item.merged);
    if (item.labels) out.push(...item.labels);
    return out;
  }

  /* 장비별 다음 번호 (primary + 묶인 라벨 + 합쳐진 번호 모두 스캔) */
  function _nextNumForEquipment(key) {
    const used = new Set();
    items.forEach(i => _entriesOf(i).forEach(e => {
      if (e.equipment === key) used.add(e.num);
    }));
    return _firstFreeNum(used, _equipStart(key));
  }

  /* 외관(비장비) 항목의 다음 전역 번호 — nextNum은 사용자가 지정한 기준 시작번호 */
  function _nextNumGlobal() {
    const used = new Set();
    items.forEach(i => _entriesOf(i).forEach(e => {
      if (!e.equipment) used.add(e.num);
    }));
    return _firstFreeNum(used, nextNum);
  }
  function getNextNumForEquipment(key) { return _nextNumForEquipment(key); }

  /* 기존 지시선에 다른 장비 넘버 추가 (item 2·3) — equip: { key, color }
     같은 장비를 여러 번 묶는 것도 허용 (SZ-01 위에 SZ-02 …).
     단, 본체와 같은 장비면 선택·드래그 동작을 살리기 위해 추가하지 않는다. */
  function addLabelToItem(id, equip) {
    const item = items.find(i => i.id === Number(id));
    if (!item || !equip) return null;
    if (item.equipment === equip.key) return null;
    if (!item.labels) item.labels = [];
    const label = {
      lid:       nextId++,
      equipment: equip.key,
      num:       _nextNumForEquipment(equip.key),
      color:     equip.color,
      note:           null,
      photoName:      null,
      customPhotoNum: null,
    };
    item.labels.push(label);
    if (onChange) onChange();
    return label;
  }

  /* 도형 추가 (item 4) — kind: 'tilt'{p1,p2} | 'settle'{points}, equip: {key,color} */
  function addShape(kind, geom, equip) {
    const item = {
      id:        nextId++,
      num:       equip ? _nextNumForEquipment(equip.key) : _nextNumGlobal(),
      equipment: equip ? equip.key : undefined,
      category:  equip ? undefined : activeCategory,
      color:     equip ? equip.color : categories[activeCategory].color,
      textColor: config.textColor,
      shape:     kind,
      ...geom,
      note:           null,
      photoName:      null,
      customPhotoNum: null,
    };
    items.push(item);
    if (onChange) onChange();
    return item;
  }

  /* 해치 도형 추가 (외관 모드) — kind: 'hatch-rect' | 'hatch-ellipse'
     번호를 붙이지 않는 순수 그래픽. color는 그리는 시점 값을 고정 저장하므로
     이후 색상 선택기를 바꿔도 기존 도형은 그대로 유지된다. */
  function addHatch(kind, geom, color) {
    const item = {
      id:    nextId++,
      shape: kind,
      noNum: true,
      color: color || config.hatchColor,
      p1: { ...geom.p1 },
      p2: { ...geom.p2 },
    };
    items.push(item);
    if (onChange) onChange();
    return item;
  }

  /* 기본 넘버 삭제 — 합쳐진 번호나 묶인 장비 번호가 남아 있으면 그 중 첫 번호가 지시선을 이어받는다.
     합쳐진 번호(같은 박스)를 묶음 라벨(별도 박스)보다 먼저 승계시킨다 — R-01,02 에서 01을 지우면 R-02 */
  function remove(id) {
    const numId = Number(id);
    const idx = items.findIndex(i => i.id === numId);
    if (idx === -1) return;
    const item = items[idx];
    if (item.merged && item.merged.length) {
      _promoteInto(item, item.merged.shift());
      if (!item.merged.length) delete item.merged;
    } else if (item.labels && item.labels.length) {
      _promoteInto(item, item.labels.shift());
    } else {
      items.splice(idx, 1);
    }
    /* 남은 번호는 그대로 유지 — 삭제된 번호는 빈 자리로 남아 다음 마킹이 채운다 */
    if (onChange) onChange();
  }

  /* 하위 번호(라벨·합쳐진 번호)를 항목 본체 번호로 승계 — 좌표(p1/p2)는 본체 것을 유지 */
  function _promoteInto(item, next) {
    item.equipment      = next.equipment;
    item.num            = next.num;
    item.color          = next.color;
    item.note           = next.note ?? null;
    item.customPhotoNum = next.customPhotoNum ?? null;
    item.photoName      = next.photoName ?? null;
    if (next.category !== undefined) item.category = next.category;
  }

  /* ── 하위 번호 참조 ──
     subKey: '' = 본체 | 'L<lid>' = 묶인 장비 번호 | 'M<mid>' = 합쳐진 번호 */
  function _findSub(item, subKey) {
    if (!item || !subKey) return item || null;
    const n = Number(subKey.slice(1));
    if (subKey[0] === 'L') return (item.labels || []).find(l => l.lid === n) || null;
    if (subKey[0] === 'M') return (item.merged || []).find(m => m.mid === n) || null;
    return null;
  }

  /* 하위 번호 속성 수정 — 사진 매칭번호·메모 등. subKey 없으면 본체 */
  function updateSub(id, subKey, patch) {
    const item = items.find(i => i.id === Number(id));
    const sub  = _findSub(item, subKey);
    if (!sub) return;
    Object.assign(sub, patch);
    if (sub === item && patch.category !== undefined && categories[patch.category]) {
      item.color = categories[patch.category].color;
    }
    if (onChange) onChange();
  }

  /* 하위 번호 제거 — 라벨은 삭제, 합쳐진 번호는 별도 항목으로 해제(복원) */
  function removeSub(id, subKey) {
    const item = items.find(i => i.id === Number(id));
    if (!item || !subKey) return;
    if (subKey[0] === 'M') { unmerge(id, Number(subKey.slice(1))); return; }
    const lid = Number(subKey.slice(1));
    const idx = (item.labels || []).findIndex(l => l.lid === lid);
    if (idx === -1) return;
    item.labels.splice(idx, 1);
    /* 번호 유지 — 빈 번호는 다음 마킹이 채운다 */
    if (onChange) onChange();
  }

  /* 메모 설정 — 빈 문자열이면 메모 제거 */
  function setNote(id, subKey, note) {
    const v = (note && String(note).trim()) ? String(note).trim() : null;
    updateSub(id, subKey, { note: v });
  }

  /* ── 넘버링 합치기 ──
     ids 첫 번째 항목이 대표가 되고 나머지는 대표의 merged 배열로 흡수된다.
     흡수된 항목은 좌표·도구까지 통째로 보관하므로 해제하면 원래대로 복원된다.
     keepLeaders: true = 흡수된 지시선도 대표 번호박스까지 그대로 표시 */
  function mergeItems(ids, keepLeaders) {
    const list = (ids || []).map(v => items.find(x => x.id === Number(v))).filter(Boolean);
    if (list.length < 2)         return { ok: false, reason: 'count' };
    if (list.some(i => i.shape)) return { ok: false, reason: 'shape' };

    const primary = list[0];
    if (!primary.labels) primary.labels = [];
    if (!primary.merged) primary.merged = [];

    list.slice(1).forEach(src => {
      const idx = items.indexOf(src);
      if (idx !== -1) items.splice(idx, 1);

      const clone     = JSON.parse(JSON.stringify(src));
      const subLabels = clone.labels || [];
      const subMerged = clone.merged || [];
      delete clone.labels; delete clone.merged; delete clone.mergeKeepLeaders;
      clone.mid = clone.id;
      primary.merged.push(clone);

      /* 흡수된 항목이 이미 합쳐진 번호를 갖고 있으면 함께 승계 (해제 대비 출처 표시) */
      subMerged.forEach(m => { m.fromMid = clone.mid; primary.merged.push(m); });
      /* 흡수된 항목의 묶음 라벨은 대표의 박스 스택으로 이동 */
      subLabels.forEach(l => { l.fromMid = clone.mid; primary.labels.push(l); });
    });

    primary.mergeKeepLeaders = !!keepLeaders;
    if (!primary.labels.length) delete primary.labels;
    if (onChange) onChange();
    return { ok: true, item: primary };
  }

  /* 합치기 해제 — 흡수된 번호를 원래 항목으로 복원 */
  function unmerge(id, mid) {
    const item = items.find(i => i.id === Number(id));
    if (!item || !item.merged) return null;
    const target = Number(mid);
    const idx = item.merged.findIndex(m => m.mid === target);
    if (idx === -1) return null;

    const clone = item.merged.splice(idx, 1)[0];
    /* 이 번호에 딸려 들어왔던 하위 번호들을 함께 되돌린다 */
    const backMerged = item.merged.filter(m => m.fromMid === target);
    item.merged      = item.merged.filter(m => m.fromMid !== target);
    const backLabels = (item.labels || []).filter(l => l.fromMid === target);
    if (item.labels) item.labels = item.labels.filter(l => l.fromMid !== target);
    backMerged.forEach(m => { delete m.fromMid; });
    backLabels.forEach(l => { delete l.fromMid; });

    delete clone.mid;
    delete clone.fromMid;
    if (backLabels.length) clone.labels = backLabels;
    if (backMerged.length) {
      clone.merged = backMerged;
      clone.mergeKeepLeaders = !!item.mergeKeepLeaders;
    }
    /* id 충돌 방지 — 원래 id가 이미 쓰이고 있으면 새 id 발급 */
    if (items.some(i => i.id === clone.id)) clone.id = nextId++;
    items.push(clone);

    if (!item.merged.length) { delete item.merged; delete item.mergeKeepLeaders; }
    if (item.labels && !item.labels.length) delete item.labels;
    if (onChange) onChange();
    return clone;
  }

  /* 합쳐진 항목의 지시선 표시 방식 전환 */
  function setMergeKeepLeaders(id, keep) {
    const item = items.find(i => i.id === Number(id));
    if (!item || !item.merged) return;
    item.mergeKeepLeaders = !!keep;
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

  /* ── 좌표 일괄 변환 ──
     도면 크기를 바꿀 때 지시점이 도면의 같은 위치를 계속 가리키도록
     모든 좌표(p1·p2·points)를 같은 변환으로 옮긴다.
     합쳐진 번호(merged)도 자기 좌표를 갖고 있으므로 함께 변환한다. */
  function transformCoords(fn) {
    const move = o => { if (!o) return; const p = fn(o.x, o.y); o.x = p.x; o.y = p.y; };
    const each = i => {
      move(i.p1); move(i.p2);
      if (i.points) i.points.forEach(move);
    };
    items.forEach(i => {
      each(i);
      if (i.merged) i.merged.forEach(each);
    });
    if (onChange) onChange();
  }

  /* nextNum = 외관 넘버링의 기준 시작번호. 실제 부여 번호는 빈 자리 우선 */
  function setNextNum(n) { nextNum = Math.max(1, Number(n) || 1); }
  function getNextNum()  { return _nextNumGlobal(); }

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

  /* 구버전 데이터 보정 — 라벨에 고유 lid 부여. 반환값 = 안전한 다음 id */
  function _migrateIds() {
    let maxId = 0;
    items.forEach(i => {
      maxId = Math.max(maxId, i.id || 0);
      if (i.merged) i.merged.forEach(m => {
        if (m.mid === undefined) m.mid = m.id;
        maxId = Math.max(maxId, m.id || 0, m.mid || 0);
      });
      if (i.labels) i.labels.forEach(l => { maxId = Math.max(maxId, l.lid || 0); });
    });
    items.forEach(i => {
      if (i.labels) i.labels.forEach(l => { if (l.lid === undefined) l.lid = ++maxId; });
    });
    return maxId + 1;
  }

  function fromJSON(json) {
    try {
      const d = JSON.parse(json);
      items   = d.items  || [];
      nextNum = d.nextNum || 1;
      nextId  = Math.max(d.nextId || 1, _migrateIds());
      if (d.config) {
        /* scale·tbScale은 전 페이지 공통 전역값 — 페이지 복원 시 덮어쓰지 않는다 */
        const { scale, tbScale, ...pageConfig } = d.config;
        Object.assign(config, pageConfig);
      }
      if (d.categories) Object.assign(categories, d.categories);
      if (onChange) onChange();
    } catch (e) { console.error('fromJSON 실패', e); }
  }

  /* ── 번호 일괄 재정렬 ──
     시작번호를 바꿀 때만 호출된다(삭제 시에는 호출하지 않음).
     장비 항목은 장비별 시작번호부터, 일반(외관) 항목은 기준 시작번호부터 연속 부여 */
  function _resequence() {
    const perEquip = {};
    let globalC = nextNum - 1;
    /* 장비별 시작 번호부터 연속 부여 */
    const nextOf = k => (perEquip[k] === undefined ? _equipStart(k) : perEquip[k] + 1);
    items.forEach(item => {
      _entriesOf(item).forEach(e => {
        if (e.equipment) {
          perEquip[e.equipment] = nextOf(e.equipment);
          e.num = perEquip[e.equipment];
        } else {
          globalC++;
          e.num = globalC;
        }
      });
    });
    /* nextNum(기준 시작번호)은 사용자 지정값이므로 유지 */
  }

  /* 외부 호출용 재정렬 (장비 시작 번호 변경 시) */
  function resequence() {
    _resequence();
    if (onChange) onChange();
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
    init, add, remove, removeSub, updateSub, setNote, clear, updateItem, getAll, transformCoords,
    setNextNum, getNextNum, getNextNumForEquipment, addLabelToItem, addShape, addHatch,
    mergeItems, unmerge, setMergeKeepLeaders,
    resequence,
    setActiveCategory, getActiveCategory, getCategories, setCategoryColor,
    setConfig, getConfig,
    matchPhoto, toJSON, fromJSON, autoLayout,
  };
})();
