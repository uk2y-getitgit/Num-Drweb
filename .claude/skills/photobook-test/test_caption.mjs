// 문구 줄바꿈 규칙 검증 — 치수 있음 / 치수 없음 + (보수완료) / 둘 다 없음
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/Num-Drweb';

const ops = [];
function makeCtx() {
  const st = { font: '', fillStyle: '', textAlign: '', textBaseline: '', lineWidth: 1, strokeStyle: '' };
  return new Proxy(st, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s) => {
        const px = parseFloat((t.font.match(/(\d+(?:\.\d+)?)px/) || [0, 12])[1]);
        return { width: [...s].reduce((a, c) => a + (/[\u3131-\uD79D]/.test(c) ? px : px * 0.55), 0) };
      };
      return (...args) => ops.push({ op: k, args, font: t.font, fill: t.fillStyle });
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }) };
globalThis.createImageBitmap = async () => ({ close() {} });
globalThis.FileManager = { getPhotos: () => [], extractPhotoName: l => l };
globalThis.PageManager = { saveCurrentPageState() {}, getPages: () => [] };
globalThis.TitleBlock = { getSettings: () => ({ projectTitle: 'T' }) };

(0, eval)(fs.readFileSync(path.join(ROOT, 'js/photoBook.js'), 'utf8') + '\nglobalThis.__PB = PhotoBook;');
const PB = globalThis.__PB;

const cases = [
  ['지상1층 벽체 수평 및 수직균열 (0.2x2)',            ['지상1층 벽체 수평 및 수직균열', '(0.2x2)']],
  ['지상1층 벽체 도장박리 (보수완료)',                  ['지상1층 벽체 도장박리', '(보수완료)']],
  ['(신규) 옥상층 처마 도장박리 (보수완료)',            ['(신규) 옥상층 처마 도장박리', '(보수완료)']],
  ['지상2층 천장 누수흔적',                             ['지상2층 천장 누수흔적']],
  ['지상1층 천장 보 수직균열 (0.1x0.5) (보수완료)',    ['지상1층 천장 보 수직균열', '(0.1x0.5) (보수완료)']],
];

let fail = 0;
for (const [caption, expect] of cases) {
  ops.length = 0;
  await PB.renderPage([{ label: 'X-01', caption, photo: null }], 0, 'T', 1);
  const caps = ops.filter(o => o.op === 'fillText' && (o.fill === '#111111' || o.fill === '#0000ff'));
  const byY = new Map();
  caps.forEach(o => {
    const k = Math.round(o.args[2]);
    byY.set(k, (byY.get(k) || '') + o.args[0]);
  });
  const got = [...byY.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
  const ok = JSON.stringify(got) === JSON.stringify(expect);
  if (!ok) { fail++; console.log(`  ✗ "${caption}"\n     결과 ${JSON.stringify(got)}\n     기대 ${JSON.stringify(expect)}`); }
  else console.log(`  ✓ ${got.join('  ⏎  ')}`);

  // (보수완료) 는 파란색으로 찍혔는가
  if (caption.includes('보수완료')) {
    const blue = caps.filter(o => o.fill === '#0000ff').map(o => o.args[0]).join('');
    if (blue !== '(보수완료)') { fail++; console.log(`  ✗ 파란글씨 = "${blue}"`); }
  }
}
console.log(fail === 0 ? '\n✓ 문구 줄바꿈 5/5 통과' : `\n✗ 실패 ${fail}건`);
process.exit(fail ? 1 : 0);
