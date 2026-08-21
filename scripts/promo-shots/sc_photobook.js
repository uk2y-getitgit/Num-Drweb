(async () => {
  const MODE = "__MODE__";        // 'empty' | 'filled'

  const rows = [
    ['1F-01', '지상1층 벽체 수평 및 수직균열 (0.2x2.1)',        '101.jpg'],
    ['1F-02', '지상1층 벽체 수직균열 (0.3x1.4)',                '102.jpg'],
    ['1F-03', '지상1층 천장 마감재 들뜸 및 박리 (0.4x0.6)',      '103.jpg'],
    ['3F-01', '지상3층 벽체 마감재 오염 및 백화 (0.5x1.2)',      '301.jpg'],
    ['3F-02', '지상3층 창호 주변 실링재 노후 (보수완료)',        '302.jpg'],
    ['3F-03', '지상3층 바닥 마감재 균열 (0.2x0.8) (신규)',       '303.jpg'],
  ];

  const entries = [];
  for (const [label, caption, fname] of rows) {
    let photo = null;
    if (MODE === 'filled') {
      const blob = await (await fetch('_shot_photos/' + fname)).blob();
      const f = new File([blob], fname, { type: 'image/jpeg' });
      photo = { name: fname, handle: { getFile: async () => f } };
    }
    entries.push({
      label, caption, photo,
      fileBase: label.replace(/[^0-9]/g, ''),
      inDrawing: true,
    });
  }

  const canvas = await PhotoBook.renderPage(entries, 0, '○○고등학교 강당 정밀안전점검', 1);
  return canvas.toDataURL('image/png');
})()
