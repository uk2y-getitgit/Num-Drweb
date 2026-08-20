// renderPage 검증 — 캔버스 2D 컨텍스트를 기록 스텁으로 대체해 호출 경로와 좌표를 확인한다
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/Num-Drweb';
const DATA = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/NumDraw_테스트데이터';
const require = createRequire(import.meta.url);
globalThis.XLSX = require(path.join(ROOT, 'lib/xlsx.full.min.js'));

const photoFiles = fs.readdirSync(path.join(DATA, '사진'));
globalThis.FileManager = {
  getPhotos: () => photoFiles.map(n => ({ name: n, handle: { getFile: async () => ({ name: n }) } })),
  extractPhotoName: (label) => {
    const m = label.match(/^([A-Za-z0-9]+)-(\d+)$/); if (!m) return label;
    const p = m[1].toUpperCase(), num = m[2];
    if (/^RF$/i.test(p)) return 'R' + num;
    const bf = p.match(/^B(\d+)F$/i); if (bf) return 'B' + bf[1] + num;
    const f = p.match(/^(\d+)F$/i);   if (f)  return f[1] + num;
    return p + num;
  },
};
const mk = ns => JSON.stringify({ items: ns.map((n, i) => ({ id: i + 1, num: n })) });
globalThis.PageManager = { saveCurrentPageState() {}, getPages: () => [
  { name: '옥상', prefix: 'RF',  annJSON: mk([1,2,3,4,5]) },
  { name: '2층',  prefix: '2F',  annJSON: mk([...Array(15).keys()].map(i=>i+1)) },
  { name: '1층',  prefix: '1F',  annJSON: mk([...Array(13).keys()].map(i=>i+1)) },
  { name: '지하', prefix: 'B1F', annJSON: mk([1,2,3,4]) },
  { name: '외부', prefix: 'W',   annJSON: mk([1,2,3]) },
]};
globalThis.TitleBlock = { getSettings: () => ({ projectTitle: '2026년 상반기 정기안전점검 용역 - ○○중학교 교사동' }) };

// ── 캔버스 기록 스텁 ──
const ops = [];
function makeCtx() {
  const st = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '' };
  return new Proxy(st, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => {
        const px = parseFloat((t.font.match(/(\d+(?:\.\d+)?)px/) || [0, 12])[1]);
        // 한글은 전각, 영문/숫자는 반각으로 근사
        const w = [...s].reduce((a, c) => a + (/[\u3131-\uD79D]/.test(c) ? px : px * 0.55), 0);
        return { width: w };
      };
      return (...args) => { ops.push({ op: k, args, font: t.font, fill: t.fillStyle }); };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }) };
globalThis.createImageBitmap = async () => ({ __bitmap: true, close() { ops.push({ op: 'close', args: [] }); } });

(0, eval)(fs.readFileSync(path.join(ROOT, 'js/photoBook.js'), 'utf8') + '\nglobalThis.__PB = PhotoBook;');
const PB = globalThis.__PB;

const buf = fs.readFileSync(path.join(DATA, '외관집계표_테스트.xlsx'));
await PB.loadSummary({ name: 'x.xlsx', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
const { entries } = PB.collectEntries();
const total = PB.pageCount(entries.length);
const title = PB.getTitle();

let fail = 0;
const A4 = PB.A4;

for (let p = 0; p < total; p++) {
  ops.length = 0;
  await PB.renderPage(entries, p, title, 1);

  const rects  = ops.filter(o => o.op === 'strokeRect');
  const images = ops.filter(o => o.op === 'drawImage');
  const texts  = ops.filter(o => o.op === 'fillText');
  const closes = ops.filter(o => o.op === 'close');
  const n = Math.min(PB.PER_PAGE, entries.length - p * PB.PER_PAGE);

  // 표제 1 + 칸당 3개(번호·사진·문구)
  const expRects = 1 + n * 3;
  if (rects.length !== expRects) { console.log(`  ✗ p${p+1} 테두리 ${rects.length}, 기대 ${expRects}`); fail++; }

  // 사진 있는 항목 수만큼 drawImage + 같은 수의 close (메모리 해제 확인)
  const withPhoto = entries.slice(p * PB.PER_PAGE, (p+1) * PB.PER_PAGE).filter(e => e.photo).length;
  if (images.length !== withPhoto) { console.log(`  ✗ p${p+1} drawImage ${images.length}, 기대 ${withPhoto}`); fail++; }
  if (closes.length !== withPhoto) { console.log(`  ✗ p${p+1} bitmap.close ${closes.length}, 기대 ${withPhoto}`); fail++; }

  // 모든 도형이 A4 안에 있는가
  const out = rects.filter(r => r.args[0] < 0 || r.args[1] < 0 ||
                                r.args[0] + r.args[2] > A4.w + 1 || r.args[1] + r.args[3] > A4.h + 1);
  if (out.length) { console.log(`  ✗ p${p+1} 페이지 밖 도형 ${out.length}개`); fail++; }

  const noPhotoTxt = texts.filter(t => t.args[0] === '사진 없음').length;
  if (p === 0) {
    console.log(`  p1: 테두리 ${rects.length} · 사진 ${images.length} · 사진없음 ${noPhotoTxt} · 텍스트 ${texts.length}`);
  }
}
console.log(fail === 0 ? `✓ 렌더 검증 ${total}장 전부 통과` : `✗ 렌더 검증 실패 ${fail}건`);

// 마지막 장은 4건만 (40 = 6*6 + 4)
ops.length = 0;
await PB.renderPage(entries, total - 1, title, 1);
const lastRects = ops.filter(o => o.op === 'strokeRect').length;
console.log(`✓ 마지막 장 부분 채움: 테두리 ${lastRects}개 (표제1 + ${(lastRects-1)/3}칸)`);

// ── 문구 줄바꿈 진단 ──
// 캡션 글자(검정/파랑)만 골라 y좌표로 줄을 세고, 줄별 내용을 복원한다
let worst = null;
for (let p = 0; p < total; p++) {
  ops.length = 0;
  await PB.renderPage(entries, p, title, 1);
  const caps = ops.filter(o => o.op === 'fillText' && (o.fill === '#111111' || o.fill === '#0000ff'));
  // 칸 구분: x가 크게 되돌아가면 새 칸
  const cells = new Map();
  caps.forEach(o => {
    const key = Math.round(o.args[2] / 5) * 5;          // y 기준 줄
    const cellKey = o.args[1] < 620 ? 'L' : 'R';
    const k = cellKey + ':' + Math.floor(o.args[2] / 200);
    if (!cells.has(k)) cells.set(k, new Map());
    const rows = cells.get(k);
    if (!rows.has(key)) rows.set(key, { s: '', font: o.font });
    rows.get(key).s += o.args[0];
  });
  cells.forEach(rows => {
    const px = parseFloat((([...rows.values()][0] || {}).font || '0px').match(/(\d+(?:\.\d+)?)px/)[1]);
    if (!worst || rows.size > worst.n || (rows.size === worst.n && px < worst.px)) {
      worst = { n: rows.size, px, lines: [...rows.values()].map(v => v.s) };
    }
  });
}
console.log(`✓ 문구 최대 ${worst.n}줄 · 최소 글자 ${worst.px}px`);
worst.lines.forEach((l, i) => console.log(`    ${i + 1}줄: ${l}`));

// 치수 줄바꿈이 실제로 적용됐는지 — 치수를 가진 항목 3개 확인
ops.length = 0;
await PB.renderPage(entries, 0, title, 1);
const caps0 = ops.filter(o => o.op === 'fillText' && (o.fill === '#111111' || o.fill === '#0000ff'));
const byY = new Map();
caps0.forEach(o => {
  const k = (o.args[1] < 620 ? 'L' : 'R') + ':' + Math.round(o.args[2]);
  byY.set(k, (byY.get(k) || '') + o.args[0]);
});
const dimLines = [...byY.values()].filter(s => /^\([0-9]/.test(s));
console.log(`✓ 치수만 따로 있는 줄 ${dimLines.length}개: ${dimLines.slice(0, 4).join(' / ')}`);
