/* electron/license/store.js — 활성화 증서 로컬 보관
   위치: <userData>/license.json
   저장 내용: 증서, 마스킹된 키(운영 지원용), 활성화 시각
   ⚠ 평문 라이선스 키는 저장하지 않는다.
*/
'use strict';

const fs   = require('fs');
const path = require('path');
const { app } = require('electron');

function _file() {
  return path.join(app.getPath('userData'), 'license.json');
}

function read() {
  try {
    const raw = fs.readFileSync(_file(), 'utf8');
    const d   = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    return d;
  } catch {
    return null;
  }
}

function write(data) {
  try {
    const dir = path.dirname(_file());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(_file(), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[license] 증서 저장 실패:', e.message);
    return false;
  }
}

function clear() {
  try { fs.unlinkSync(_file()); } catch { /* 없으면 무시 */ }
}

/* 'ND2-A7K3M-XXXXX-XXXXX-9QX2' → 'ND2-A7K3M-*****-*****-9QX2' */
function maskKey(normalizedKey) {
  if (typeof normalizedKey !== 'string' || normalizedKey.length < 8) return '';
  const g = normalizedKey.split('-');
  if (g.length !== 5) return normalizedKey.slice(0, 4) + '****';
  return [g[0], g[1], '*****', '*****', g[4]].join('-');
}

module.exports = { read, write, clear, maskKey, filePath: _file };
