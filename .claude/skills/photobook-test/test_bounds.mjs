// 작업범위 안내선 검증 — 화면(renderAnnotations)에는 그리고, PDF(createPageExport)에는 절대 안 그린다
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/Num-Drweb';

let ops = [];
function makeCtx(tag) {
  const st = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: '', textBaseline: '', globalAlpha: 1 };
  return new Proxy(st, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'measureText') return () => ({ width: 10 });
      return (...args) => ops.push({ tag, op: k, args, stroke: t.strokeStyle });
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const mkCanvas = (tag) => ({
  width: 0, height: 0, style: {},
  getContext: () => makeCtx(tag),
  toDataURL: () => 'data:,x',
});
globalThis.document = {
  createElement: () => mkCanvas('export'),
  getElementById: () => null,
};
globalThis.Image = class {
  constructor() { this.complete = true; this.naturalWidth = 100; }
  set src(_) { setTimeout(() => this.onload && this.onload(), 0); }
};
globalThis.TitleBlock = { isEnabled: () => false };
globalThis.Legend     = { isEnabled: () => false };
globalThis.AppMode    = { get: () => 'appearance', MODES: { EQUIP: 'equip' } };
globalThis.Equipment  = undefined;

(0, eval)(fs.readFileSync(path.join(ROOT, 'js/annotation.js'), 'utf8') + '\nglobalThis.Annotation = Annotation;');
(0, eval)(fs.readFileSync(path.join(ROOT, 'js/canvas.js'), 'utf8') + '\nglobalThis.CanvasManager = CanvasManager;');

let fail = 0;
const isDashCall = o => o.op === 'setLineDash' && o.args[0] && o.args[0].length;
const isBoundsStroke = o => o.op === 'strokeRect' && /rgba\(91, 91, 214/.test(String(o.stroke));

// ── 1) 화면 렌더에는 안내선이 있어야 한다 ──
const handlers = {};
const wrap = {
  addEventListener(type, fn) { handlers[type] = fn; },
  style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
};
const container = { style: {} };
const imgEl = { style: {}, complete: true, naturalWidth: 100, set src(_) {}, set onload(_) {} };
const drawCanvas = mkCanvas('screen');
CanvasManager.init(wrap, container, imgEl, drawCanvas, { style: {} });

Annotation.add({ x: 100, y: 100 }, { x: 200, y: 200 }, 'arrow');
CanvasManager.loadImage('data:,a', 1240, 1754, { offX: 59, offY: 59, dW: 1122, dH: 1518 });

ops = [];
CanvasManager.renderAnnotations(Annotation.getAll());
const screenBounds = ops.filter(isBoundsStroke);
if (!screenBounds.length) { console.log('  ✗ 화면에 안내선이 그려지지 않았다'); fail++; }
else console.log(`  ✓ 화면: 안내선 1개 — (${screenBounds[0].args[0] | 0}, ${screenBounds[0].args[1] | 0}) ${screenBounds[0].args[2]}×${screenBounds[0].args[3]}`);

// 클릭 판정 영역과 같은 사각형인가
const b = screenBounds[0];
if (b && (Math.round(b.args[2]) !== 1122 || Math.round(b.args[3]) !== 1518)) {
  console.log('  ✗ 안내선이 클릭 가능 영역과 다르다'); fail++;
}

// ── 2) 토글 OFF ──
ops = [];
CanvasManager.setShowBounds(false);
if (ops.filter(isBoundsStroke).length) { console.log('  ✗ 토글 OFF인데 안내선이 그려졌다'); fail++; }
else console.log('  ✓ 토글 OFF: 안내선 없음');
CanvasManager.setShowBounds(true);

// ── 3) PDF 내보내기에는 절대 없어야 한다 ──
const annJSON = JSON.stringify({ items: Annotation.getAll(), config: { prefix: '1F' } });
ops = [];
await CanvasManager.createPageExport('data:,a', 1240, 1754, annJSON, { offX: 59, offY: 59, dW: 1122, dH: 1518 }, null);
const exportOps    = ops.filter(o => o.tag === 'export');
const exportBounds = exportOps.filter(isBoundsStroke);
const exportDash   = exportOps.filter(isDashCall);

if (exportBounds.length) { console.log(`  ✗ PDF에 안내선이 ${exportBounds.length}개 그려졌다`); fail++; }
else console.log('  ✓ PDF: 안내선 없음');
if (exportDash.length)   { console.log(`  ✗ PDF에 점선(setLineDash) 호출 ${exportDash.length}건`); fail++; }
else console.log('  ✓ PDF: 점선 호출 없음');

// 넘버링 자체는 정상적으로 그려졌는가 (안내선만 빠지고 나머지는 멀쩡한지)
const drew = exportOps.filter(o => ['stroke', 'fill', 'fillText', 'lineTo'].includes(o.op)).length;
if (drew === 0) { console.log('  ✗ PDF에 넘버링이 하나도 안 그려졌다'); fail++; }
else console.log(`  ✓ PDF: 넘버링 렌더 호출 ${drew}건 (정상 동작 확인)`);

// ── 4) Ctrl+휠 = 도면 배율 (화면 줌이 아니다) ──
let scaleDeltas = [], prevented = 0;
CanvasManager.onImageScale(d => scaleDeltas.push(d));
const wheel = (opts) => handlers.wheel({ preventDefault: () => prevented++, deltaY: 0, clientX: 400, clientY: 300, ...opts });

wheel({ ctrlKey: true, deltaY: -100 });   // 확대
wheel({ ctrlKey: true, deltaY:  100 });   // 축소
wheel({ metaKey: true, deltaY: -100 });   // macOS
if (JSON.stringify(scaleDeltas) !== JSON.stringify([0.05, -0.05, 0.05])) {
  console.log(`  ✗ Ctrl+휠 델타 ${JSON.stringify(scaleDeltas)}`); fail++;
} else console.log('  ✓ Ctrl+휠: 확대 +0.05 / 축소 −0.05 (Cmd 포함)');

if (prevented !== 3) { console.log(`  ✗ preventDefault ${prevented}/3 — 브라우저 확대가 같이 일어난다`); fail++; }
else console.log('  ✓ Ctrl+휠: 브라우저 기본 확대 차단');

// 수식어 없는 휠은 여전히 화면 줌이어야 한다
scaleDeltas = [];
wheel({ deltaY: -100 });
if (scaleDeltas.length) { console.log('  ✗ 일반 휠이 도면 배율을 건드렸다'); fail++; }
else console.log('  ✓ 일반 휠: 화면 줌 유지 (도면 배율 영향 없음)');

// Shift+휠은 넘버링 배율이어야 한다
const before = Annotation.getConfig().scale;
wheel({ shiftKey: true, deltaY: -100 });
if (Annotation.getConfig().scale === before) { console.log('  ✗ Shift+휠 넘버링 배율이 안 바뀐다'); fail++; }
else console.log(`  ✓ Shift+휠: 넘버링 배율 ${before} → ${Annotation.getConfig().scale}`);

console.log(fail === 0 ? '\n✓ 작업범위 안내선 + Ctrl+휠 검증 전부 통과' : `\n✗ 실패 ${fail}건`);
process.exit(fail ? 1 : 0);
