// 도면 배율 검증 — scaledLayout 기하 + 넘버링 좌표 동반 이동
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/Num-Drweb';

globalThis.Equipment = undefined;
globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect(){}, drawImage(){}, }), toDataURL: () => 'data:,scaled' }) };
globalThis.Image = class { set src(_) { setTimeout(() => this.onload && this.onload(), 0); } };

(0, eval)(fs.readFileSync(path.join(ROOT, 'js/annotation.js'), 'utf8') + '\nglobalThis.Annotation = Annotation;');
(0, eval)(fs.readFileSync(path.join(ROOT, 'js/pageManager.js'), 'utf8') + '\nglobalThis.PageManager = PageManager;');

let fail = 0;
const eq = (a, b, msg, tol = 0.51) => {
  if (Math.abs(a - b) > tol) { console.log(`  ✗ ${msg}: ${a} ≠ ${b}`); fail++; }
};

PageManager.init(() => {}, () => {});
// A4 세로 1240×1754, 도면은 10mm 여백 + 하단 도곽 20mm 안에 배치된 상태
PageManager.addImagePage('data:,base', 1240, 1754, '1층', { offX: 59, offY: 59, dW: 1122, dH: 1518 });
const page = PageManager.getActivePage();

// 도면 중앙에 지시점, 좌상단 모서리에 도형 하나
const cx = 59 + 1122 / 2, cy = 59 + 1518 / 2;
Annotation.add({ x: cx, y: cy }, { x: cx + 100, y: cy + 100 }, 'arrow');
Annotation.add({ x: 59, y: 59 }, { x: 200, y: 200 }, 'dot');

console.log('기본 배율:', PageManager.getImageScale());

// ── 1.5배 확대 ──
const r1 = PageManager.setImageScale(page.id, 1.5);
const L1 = r1.layout;
eq(L1.dW, 1122 * 1.5, '확대 후 너비');
eq(L1.dH, 1518 * 1.5, '확대 후 높이');
eq(L1.offX + L1.dW / 2, cx, '확대 후 중심 X 유지');
eq(L1.offY + L1.dH / 2, cy, '확대 후 중심 Y 유지');

const items = Annotation.getAll();
eq(items[0].p1.x, cx, '중앙 지시점은 제자리 (X)');
eq(items[0].p1.y, cy, '중앙 지시점은 제자리 (Y)');
// 모서리 점은 도면 좌상단에 계속 붙어 있어야 한다
eq(items[1].p1.x, L1.offX, '모서리 지시점이 도면 좌상단 추종 (X)');
eq(items[1].p1.y, L1.offY, '모서리 지시점이 도면 좌상단 추종 (Y)');
console.log(`✓ 1.5배: 배치 ${L1.dW}×${L1.dH}, 모서리 지시점 (${Math.round(items[1].p1.x)}, ${Math.round(items[1].p1.y)})`);

// ── 0.6배로 축소 (연속 변경) ──
PageManager.setImageScale(page.id, 0.6);
const L2 = PageManager.scaledLayout(page);
eq(L2.dW, 1122 * 0.6, '축소 후 너비 (원본 기준, 누적 아님)');
eq(items[1].p1.x, L2.offX, '축소 후에도 모서리 추종 (X)');
eq(items[1].p1.y, L2.offY, '축소 후에도 모서리 추종 (Y)');
console.log(`✓ 0.6배: 배치 ${L2.dW}×${L2.dH} — 원본 기준 재계산 (누적 열화 없음)`);

// ── 1.0배 복귀 → 원래 좌표로 정확히 돌아오는가 ──
PageManager.setImageScale(page.id, 1.0);
eq(items[1].p1.x, 59, '1.0 복귀 시 원좌표 (X)');
eq(items[1].p1.y, 59, '1.0 복귀 시 원좌표 (Y)');
eq(items[0].p1.x, cx, '1.0 복귀 시 중앙 (X)');
console.log('✓ 1.0배 복귀: 좌표 왕복 오차 없음');

// ── 범위 제한 ──
eq(PageManager.clampScale(9),    2.5, '상한 클램프');
eq(PageManager.clampScale(0.01), 0.3, '하한 클램프');
console.log('✓ 배율 범위 0.3 ~ 2.5 클램프');

// ── 원본 보존 확인 ──
eq(page.imgLayout.dW, 1122, '원본 배치는 불변');
if (page.imgSrc !== 'data:,base') { console.log('  ✗ 원본 imgSrc가 덮어써졌다'); fail++; }
console.log('✓ 원본 imgSrc·imgLayout 불변 (저장 용량 증가 없음)');

console.log(fail === 0 ? '\n✓ 도면 배율 검증 전부 통과' : `\n✗ 실패 ${fail}건`);
process.exit(fail ? 1 : 0);
