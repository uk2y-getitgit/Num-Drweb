/* equipment.js — 장비시험망도 장비 구분 (탄산화/슈미트/부재치수/부재변위/철근탐사/기울기/부동침하)
   각 장비 = { key, label, prefix, color, kind, desc }
   kind: 'leader'(지시선) | 'tilt'(수직기준선+경사선+화살표) | 'settle'(측정점+바운딩 사각형)
   desc: 도면 범례표에 표기되는 설명 문구 */
'use strict';

const Equipment = (() => {
  const DEFAULTS = [
    { key: 'carbon',  label: '탄산화',   prefix: 'CT', color: '#4a9eff', kind: 'leader', desc: '콘크리트 탄산화 측정' },
    { key: 'schmidt', label: '슈미트',   prefix: 'R',  color: '#e05555', kind: 'leader', desc: '콘크리트 강도 측정'   },
    { key: 'member',  label: '부재치수', prefix: 'SZ', color: '#2d9e6b', kind: 'leader', desc: '부재단면 측정'        },
    { key: 'disp',    label: '부재변위', prefix: 'TT', color: '#00a3a3', kind: 'leader', desc: '부재변위 측정'        },
    { key: 'rebar',   label: '철근탐사', prefix: 'SC', color: '#5b5bd6', kind: 'leader', desc: '철근배근 탐사'        },
    { key: 'tilt',    label: '기울기',   prefix: 'TR', color: '#e08a2d', kind: 'tilt',   desc: '기울기 측정'          },
    { key: 'settle',  label: '부동침하', prefix: 'ST', color: '#9b59b6', kind: 'settle', desc: '부동침하 측정'        },
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

  /* ── 직렬화 ── */
  function toJSON() { return { list: list.map(e => ({ ...e })), activeKey }; }

  function fromJSON(d) {
    if (!d) return;
    if (Array.isArray(d.list)) {
      /* 저장된 값(prefix/color)을 key 기준으로 기본 정의에 병합 — 순서·kind는 기본값 유지 */
      list = DEFAULTS.map(def => {
        const saved = d.list.find(s => s.key === def.key);
        return saved ? { ...def, prefix: saved.prefix ?? def.prefix, color: saved.color ?? def.color } : { ...def };
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
    setPrefix, setColor, toJSON, fromJSON, reset,
  };
})();
