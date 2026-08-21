(async () => {
  const MODE = "__MODE__";          // 'before' | 'after'
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* 도면 불러오기 — 실제 드롭 경로를 그대로 탄다 */
  const blob = await (await fetch('_shot_sample.png')).blob();
  const file = new File([blob], '강당-지상1층.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  document.getElementById('canvas-wrap')
    .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await wait(2600);

  /* 도곽 */
  TitleBlock.setEnabled(true);
  const tbToggle = document.getElementById('titleblock-toggle');
  if (tbToggle && !tbToggle.checked) { tbToggle.checked = true; tbToggle.dispatchEvent(new Event('change', { bubbles: true })); }
  TitleBlock.applySettings({
    projectTitle: '○○고등학교 강당 정밀안전점검',
    drawingName:  '외관조사망도 — 지상1층',
    scale:        'NONE',
  });

  /* 홍보용이라 작업범위 안내 점선은 끈다 */
  CanvasManager.setShowBounds(false);

  if (MODE === 'after') {
    const L = PageManager.getPages()[0].imgLayout;
    const X = f => L.offX + f * L.dW;
    const Y = f => L.offY + f * L.dH;

    Annotation.setConfig({ prefix: '1F-' });
    const pf = document.getElementById('prefix-num');
    if (pf) pf.value = '1F-';

    const put = (cat, a, b, c, d) => {
      Annotation.setActiveCategory(cat);
      Annotation.add({ x: X(a), y: Y(b) }, { x: X(c), y: Y(d) }, 'arrow');
    };

    /* p1 은 건물 도면 안, p2 는 여백으로 — 지시선이 도면을 가리지 않게 */
    put('defect', 0.15, 0.45, 0.03, 0.32);
    put('defect', 0.31, 0.36, 0.27, 0.19);
    put('defect', 0.49, 0.44, 0.64, 0.29);
    put('defect', 0.56, 0.72, 0.73, 0.81);
    put('repair', 0.23, 0.80, 0.08, 0.91);
    put('other',  0.38, 0.58, 0.30, 0.69);

    Annotation.setActiveCategory('defect');
    CanvasManager.renderAnnotations(Annotation.getAll());
  }

  /* 상태 토스트가 화면에 남지 않게 지운다 */
  await wait(1200);
  const sm = document.getElementById('status-msg');
  if (sm) { sm.className = ''; sm.textContent = ''; }
  await wait(300);
  return null;
})()
