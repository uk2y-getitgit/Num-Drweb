(async () => {
  const MODE = "__MODE__";        // 'screen' | 'export' | 'drawer'
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const loadDrawing = async () => {
    const blob = await (await fetch('_shot_sample.png')).blob();
    const file = new File([blob], '강당-지상1층.png', { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('canvas-wrap')
      .dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await wait(2600);
  };

  /* 장비 모드로 바꾸면 페이지가 초기화되므로, 전환을 먼저 하고 도면을 뒤에 올린다 */
  if (MODE !== 'drawer') {
    document.querySelector('.mode-seg-btn[data-mode="equip"]').click();
    await wait(1500);
  }
  await loadDrawing();

  TitleBlock.setEnabled(true);
  const tbToggle = document.getElementById('titleblock-toggle');
  if (tbToggle && !tbToggle.checked) { tbToggle.checked = true; tbToggle.dispatchEvent(new Event('change', { bubbles: true })); }
  CanvasManager.setShowBounds(false);

  let L = PageManager.getPages()[0].imgLayout;
  const X = f => L.offX + f * L.dW;
  const Y = f => L.offY + f * L.dH;

  if (MODE === 'drawer') {
    /* 외관 모드 그대로 두고 도곽 서랍만 연다 */
    TitleBlock.applySettings({
      projectTitle: '○○고등학교 강당 정밀안전점검',
      drawingName:  '외관조사망도 — 지상1층',
      scale:        'NONE',
    });
    Annotation.setConfig({ prefix: '1F-' });
    const pf = document.getElementById('prefix-num'); if (pf) pf.value = '1F-';
    const put = (cat, a, b, c, d) => { Annotation.setActiveCategory(cat); Annotation.add({ x: X(a), y: Y(b) }, { x: X(c), y: Y(d) }, 'arrow'); };
    put('defect', 0.15, 0.45, 0.03, 0.32);
    put('defect', 0.31, 0.36, 0.27, 0.19);
    put('defect', 0.49, 0.44, 0.64, 0.29);
    await wait(500);
    document.getElementById('btn-titleblock').click();
    await wait(1200);
    const sm = document.getElementById('status-msg'); if (sm) { sm.className = ''; sm.textContent = ''; }
    await wait(300);
    return null;
  }

  TitleBlock.applySettings({
    projectTitle: '○○고등학교 강당 정밀안전점검',
    drawingName:  '장비시험망도 — 지상1층',
    scale:        'NONE',
  });

  const put = (key, a, b, c, d) => {
    const eq = Equipment.get(key);
    Equipment.setActive(key);
    Annotation.add({ x: X(a), y: Y(b) }, { x: X(c), y: Y(d) }, 'arrow', eq);
  };

  put('carbon',  0.17, 0.44, 0.05, 0.31);
  put('schmidt', 0.30, 0.37, 0.26, 0.20);
  put('rebar',   0.31, 0.42, 0.26, 0.27);
  put('member',  0.49, 0.45, 0.63, 0.30);
  put('disp',    0.55, 0.70, 0.71, 0.79);
  put('carbon',  0.24, 0.78, 0.09, 0.88);
  put('schmidt', 0.40, 0.58, 0.33, 0.68);

  CanvasManager.renderAnnotations(Annotation.getAll());
  await wait(1200);

  if (MODE === 'export') {
    const p = PageManager.getPages()[0];
    const r = await CanvasManager.createPageExport(
      p.imgSrc, p.imgW, p.imgH, Annotation.toJSON(), p.imgLayout, true);
    return r.canvas.toDataURL('image/png');
  }

  const sm = document.getElementById('status-msg'); if (sm) { sm.className = ''; sm.textContent = ''; }
  await wait(300);
  return null;
})()
