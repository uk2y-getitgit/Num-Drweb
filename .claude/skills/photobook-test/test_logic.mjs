// photoBook.js 로직 검증 (파싱·층키 역변환·3자 대조·레이아웃)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/Num-Drweb';
const DATA = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/NumDraw_테스트데이터';

const require = createRequire(import.meta.url);
const ctx = globalThis;
ctx.XLSX = require(path.join(ROOT, 'lib/xlsx.full.min.js'));

// 사진 목록 스텁 (FileManager)
const photoFiles = fs.readdirSync(path.join(DATA, '사진'));
ctx.FileManager = {
  getPhotos: () => photoFiles.map(n => ({ name: n, num: null, handle: null })),
  extractPhotoName: (label) => {
    const m = label.match(/^([A-Za-z0-9]+)-(\d+)$/);
    if (!m) return label;
    const prefix = m[1].toUpperCase(), num = m[2];
    if (/^RF$/i.test(prefix)) return 'R' + num;
    const bf = prefix.match(/^B(\d+)F$/i); if (bf) return 'B' + bf[1] + num;
    const f = prefix.match(/^(\d+)F$/i);   if (f)  return f[1] + num;
    return prefix + num;
  },
};

// 도면 넘버링 스텁 — 3개 페이지, 일부러 집계표와 어긋나게 구성
const mk = (nums) => JSON.stringify({ items: nums.map((n, i) => ({ id: i + 1, num: n })) });
ctx.PageManager = {
  saveCurrentPageState() {},
  getPages: () => [
    { name: '옥상층 평면도', prefix: 'RF', annJSON: mk([1, 2, 3, 4, 5]) },
    { name: '2층 평면도',   prefix: '2F', annJSON: mk([...Array(15).keys()].map(i => i + 1)) },
    { name: '1층 평면도',   prefix: '1F', annJSON: mk([...Array(12).keys()].map(i => i + 1)) }, // 1F-13 누락
    { name: '외부',         prefix: 'W',  annJSON: mk([1, 2, 3, 4]) },                          // W-04 는 집계표에 없음
  ],
};
ctx.TitleBlock = { getSettings: () => ({ projectTitle: '2026년 상반기 정기안전점검 용역' }) };
ctx.document = { createElement: () => { throw new Error('canvas 미지원 (Node)'); } };

// const 선언은 전역 객체에 붙지 않으므로 마지막에 노출시킨다
(0, eval)(fs.readFileSync(path.join(ROOT, 'js/photoBook.js'), 'utf8')
  + '\nglobalThis.__PB = PhotoBook;');
const PB = ctx.__PB;

// ── 층키 역변환 ──
const cases = [['옥상층','RF'],['지붕층','RF'],['지상1층','1F'],['지상10층','10F'],
               ['지하1층','B1F'],['외부','W'],['1층','1F'],['지상 2층','2F'],['알수없음',null]];
let ok = true;
for (const [inp, exp] of cases) {
  const got = PB.floorKeyOf(inp);
  if (got !== exp) { console.log(`  ✗ floorKeyOf('${inp}') = ${got}, 기대 ${exp}`); ok = false; }
}
console.log(ok ? '✓ 층키 역변환 9/9 통과' : '✗ 층키 역변환 실패');

// ── 집계표 파싱 ──
const buf = fs.readFileSync(path.join(DATA, '외관집계표_테스트.xlsx'));
const file = { name: '외관집계표_테스트.xlsx', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };

const info = await PB.loadSummary(file);
console.log('✓ 집계표 파싱:', JSON.stringify(info));

const rows = PB.getSummary();
console.log('  첫 행 :', rows[0].label, '|', rows[0].caption);
console.log('  마지막:', rows[rows.length-1].label, '|', rows[rows.length-1].caption);
console.log('  순서  :', [...new Set(rows.map(r => r.floorKey))].join(' → '));

// ── 3자 대조 ──
const { entries, report } = PB.collectEntries();
console.log(`✓ 항목 ${entries.length}건 / ${PB.pageCount(entries.length)}장`);
console.log('  사진 없음      :', report.noPhoto.join(', ') || '없음');
console.log('  집계표에만 있음:', report.noNumbering.join(', ') || '없음');
console.log('  도면에만 있음  :', report.orphan.join(', ') || '없음');

// 매칭된 사진 파일명 몇 개 확인
console.log('  매칭 예시:', entries.slice(0,3).map(e => `${e.label}→${e.photo ? e.photo.name : '없음'}`).join(', '));
const bad = entries.filter(e => e.photo && !e.photo.name.startsWith(e.fileBase));
console.log(bad.length ? `  ✗ 잘못 매칭 ${bad.length}건` : '  ✓ 파일명 매칭 규칙 일치');

// ── 레이아웃 ──
const L = PB.layout();
const r = L.photoW / L.photoH;
console.log('✓ 레이아웃: 사진칸', Math.round(L.photoW) + '×' + Math.round(L.photoH),
            'px, 비율', r.toFixed(3), '(엑셀 실측 1.017)');
console.log('  격자 폭', Math.round(L.gridW), '/ A4 1240 · 하단 여백',
            Math.round(1754 - (L.y0 + L.titleH + L.blockH * 3)), 'px');
