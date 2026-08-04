/* equipment.js — 장비시험망도 장비 구분 (탄산화/슈미트/부재치수/부재변위/철근탐사/기울기/부동침하)
   각 장비 = { key, label, prefix, color, kind, desc, start }
   kind: 'leader'(지시선) | 'tilt'(수직기준선+경사선+화살표) | 'settle'(측정점+바운딩 사각형)
   desc: 도면 범례표에 표기되는 설명 문구
   start: 장비별 시작 번호 (사용자 지정, 기본 1) */
'use strict';

const Equipment = (() => {
  const DEFAULTS = [
    { key: 'carbon',  label: '탄산화',   prefix: 'CT', color: '#4a9eff', kind: 'leader', desc: '콘크리트 탄산화 측정', start: 1 },
    { key: 'schmidt', label: '슈미트',   prefix: 'R',  color: '#e05555', kind: 'leader', desc: '콘크리트 강도 측정',   start: 1 },
    { key: 'member',  label: '부재치수', prefix: 'SZ', color: '#2d9e6b', kind: 'leader', desc: '부재단면 측정',        start: 1 },
    { key: 'disp',    label: '부재변위', prefix: 'TT', color: '#00a3a3', kind: 'leader', desc: '부재변위 측정',        start: 1 },
    { key: 'rebar',   label: '철근탐사', prefix: 'SC', color: '#5b5bd6', kind: 'leader', desc: '철근배근 탐사',        start: 1 },
    { key: 'tilt',    label: '기울기',   prefix: 'TR', color: '#e08a2d', kind: 'tilt',   desc: '기울기 측정',          start: 1 },
    { key: 'settle',  label: '부동침하', prefix: 'ST', color: '#9b59b6', kind: 'settle', desc: '부동침하 측정',        start: 1 },
  ];

  let list      = DEFAULTS.map(e => ({ ...e }));
  let activeKey = 'carbon';
  let onChange  = null;

  function init(cb) { onChange = cb; }

  function getList()      { return list; }
  function get(key)       { return list.find(e => e.key === key); }
  function getActive()    { return get(activeKey); }
  function getActiveKey() { return activeKey; }

  function setActive(key) { if (get(key)) activeKey = key; }

  function setPrefix(key, v) {
    const e = get(key);
    if (e) { e.prefix = v; if (onChange) onChange('prefix', key); }
  }
  function setColor(key, v) {
    const e = get(key);
    if (e) { e.color = v; if (onChange) onChange('color', key); }
  }
  /* 장비별 시작 번호 — 1 미만·빈값은 1로 보정 */
  function setStart(key, v) {
    const e = get(key);
    if (!e) return;
    const n = parseInt(v, 10);
    e.start = (isNaN(n) || n < 1) ? 1 : n;
    if (onChange) onChange('start', key);
  }
  function getStart(key) {
    const e = get(key);
    return (e && e.start) || 1;
  }
  /* 페이지 전환용 일괄 적용 — onChange를 발생시키지 않는다(재정렬·저장 트리거 방지) */
  function setStarts(map) {
    if (!map) return;
    list.forEach(e => {
      const n = parseInt(map[e.key], 10);
      e.start = (isNaN(n) || n < 1) ? 1 : n;
    });
  }
  function getStarts() {
    const m = {};
    list.forEach(e => { m[e.key] = e.start || 1; });
    return m;
  }

  /* ── 직렬화 ── */
  function toJSON() { return { list: list.map(e => ({ ...e })), activeKey }; }

  function fromJSON(d) {
    if (!d) return;
    if (Array.isArray(d.list)) {
      /* 저장된 값(prefix/color)을 key 기준으로 기본 정의에 병합 — 순서·kind는 기본값 유지 */
      list = DEFAULTS.map(def => {
        const saved = d.list.find(s => s.key === def.key);
        return saved
          ? { ...def, prefix: saved.prefix ?? def.prefix, color: saved.color ?? def.color,
                      start:  saved.start  ?? def.start }
          : { ...def };
      });
    }
    if (d.activeKey && get(d.activeKey)) activeKey = d.activeKey;
  }

  /* 전체 초기화 (새 작업공간) */
  function reset() {
    list      = DEFAULTS.map(e => ({ ...e }));
    activeKey = 'carbon';
  }

  return {
    init, getList, get, getActive, getActiveKey, setActive,
    setPrefix, setColor, setStart, getStart, setStarts, getStarts,
    toJSON, fromJSON, reset,
  };
})();
