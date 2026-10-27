/* fileManager.js — 로컬 폴더 & 사진 파일 관리 */
'use strict';

const FileManager = (() => {
  let photos       = [];
  let folderHandle = null;
  let onPhotoLoad  = null;

  function init(callback) { onPhotoLoad = callback; }

  /* ── 폴더 선택 (readwrite 모드 — 파일명 변경 지원) ── */
  async function selectFolder() {
    try {
      folderHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      photos = [];
      for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind !== 'file') continue;
        const ext = name.split('.').pop().toLowerCase();
        if (!['jpg','jpeg','png','gif','bmp','webp'].includes(ext)) continue;
        const num = _extractNum(name);
        photos.push({ name, num, handle, converted: _isConverted(name) });
      }
      photos.sort((a, b) => (a.num || 0) - (b.num || 0));
      if (onPhotoLoad) onPhotoLoad(photos);
      return folderHandle.name;
    } catch (e) {
      if (e.name !== 'AbortError') console.error('폴더 선택 오류', e);
      return null;
    }
  }

  /* ── 파일명에서 뒤쪽 숫자 추출 ── */
  function _extractNum(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const m    = base.match(/(\d+)\D*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* ── 이미 변환된 사진 판정 ──
     촬영 원본은 'IMG-001'·'DSC_0042'·'001-외벽' 처럼 숫자 앞뒤에 글자가 붙는다.
     본 앱이 만드는 이름(101 · R01 · B101)처럼 숫자만 남은 파일은 변환 완료로 본다 */
  function _isConverted(name) {
    return /^[RB]?\d+$/i.test(_base(name));
  }
  function _base(name) { return String(name).replace(/\.[^.]+$/, ''); }

  /* 변환 완료 사진 중 이 레이블의 결과 이름과 같은 파일 (예: 1F-01 → 101.jpg) */
  function _findConverted(label) {
    const want = extractPhotoName(label).toLowerCase();
    return photos.find(p => p.converted && _base(p.name).toLowerCase() === want) || null;
  }
  /* 매칭 후보 = 아직 변환하지 않은 원본 사진만 */
  function _findRaw(num) {
    return photos.find(p => !p.converted && p.num === num) || null;
  }

  /* ── 레이블 → 파일명 변환 (C-2)
     1F-01  → 101
     10F-05 → 1005
     B1F-01 → B101
     RF-01  → R01
     기타   → PREFIX + num (fallback) */
  function extractPhotoName(label) {
    const m = label.match(/^([A-Za-z0-9]+)-(\d+)$/);
    if (!m) return label;
    const prefix = m[1].toUpperCase();
    const num    = m[2];

    if (/^RF$/i.test(prefix)) return 'R' + num;
    const bf = prefix.match(/^B(\d+)F$/i);
    if (bf) return 'B' + bf[1] + num;
    const f = prefix.match(/^(\d+)F$/i);
    if (f) return f[1] + num;
    return prefix + num;
  }

  /* ── 자동 매칭 (customPhotoNum 우선, 없으면 넘버링 번호) ──
     촬영 원본은 IMG-001·002 처럼 층과 무관하게 번호가 매겨지므로 1F-04 → 사진번호 4.
     파일명 변환 미리보기(buildRenamePreview)와 같은 규칙이다. prefix 는 변환 완료 판정에만 쓴다 */
  function autoMatch(annotations, prefix) {
    if (!photos.length) return;
    const pfx = prefix || '';
    const matchOne = (target) => {
      const matchNum = target.customPhotoNum != null ? Number(target.customPhotoNum) : target.num;
      /* 자기 번호로 이미 변환된 사진이 있으면 그것, 없으면 원본 사진에서 찾는다.
         변환된 다른 번호의 사진(105.jpg 등)이 숫자만 보고 엉뚱하게 잡히지 않게 한다 */
      const label   = (pfx ? pfx + '-' : '') + String(target.num).padStart(2, '0');
      const matched = _findConverted(label) || _findRaw(matchNum);
      target.photoName = matched ? matched.name : null;
    };
    annotations.forEach(item => {
      if (item.noNum) return;   // 번호 없는 도형(해치)은 사진 매칭 대상이 아니다
      matchOne(item);
      /* 한 지시선에 묶인·합쳐진 번호도 각각 매칭 */
      if (item.merged) item.merged.forEach(matchOne);
      if (item.labels) item.labels.forEach(matchOne);
    });
  }

  /* ── 파일명 변환 미리보기 (순수 함수, 파일 조작 없음) ── */
  function buildRenamePreview(annotations) {
    return annotations.filter(item => !item.noNum).map(item => {
      /* 각 item의 _pagePrefix 사용 (페이지별로 다른 접두어 지원) */
      const itemPrefix = item._pagePrefix !== undefined ? item._pagePrefix : '';
      const prefix     = itemPrefix ? itemPrefix + '-' : '';
      const matchNum   = item.customPhotoNum != null ? item.customPhotoNum : item.num;
      const numStr     = String(item.num).padStart(2, '0');
      const label      = prefix + numStr;
      const newBaseName = extractPhotoName(label);

      /* 이미 변환 완료 — 다시 바꾸지 않는다 */
      const done = _findConverted(label);
      if (done) {
        return { label, oldName: done.name, newBaseName, newName: done.name, status: 'same' };
      }

      const photo = _findRaw(Number(matchNum));
      if (!photo) {
        return { label, oldName: null, newBaseName, newName: newBaseName, status: 'nomatch' };
      }

      const ext     = photo.name.split('.').pop().toLowerCase();
      const newName = newBaseName + '.' + ext;
      /* 같은 이름의 파일이 이미 있으면 덮어쓰지 않는다 */
      const taken = photos.some(p => p !== photo && p.name.toLowerCase() === newName.toLowerCase());
      return {
        label,
        oldName:     photo.name,
        newBaseName,
        newName,
        status: taken ? 'conflict' : 'ready',
      };
    });
  }

  /* ── 일괄 파일명 변경 ── */
  async function renameAll(annotations) {
    if (!folderHandle) throw new Error('폴더가 선택되지 않았습니다');
    const preview = buildRenamePreview(annotations);
    const results = [];
    const processedOldNames = new Set(); /* 중복 원본 파일 재처리 방지 */

    for (const row of preview) {
      if (row.status !== 'ready') {
        results.push({ ...row });
        continue;
      }

      /* 이미 이번 배치에서 처리한 원본 파일 → 건너뜀 */
      if (processedOldNames.has(row.oldName)) {
        results.push({ ...row, status: 'skip' });
        continue;
      }

      const photo = photos.find(p => p.name === row.oldName);
      if (!photo) { results.push({ ...row, status: 'error', error: '파일을 찾을 수 없음' }); continue; }

      /* 미리보기 이후 폴더가 바뀌었을 수 있으므로 쓰기 직전에 한 번 더 확인한다 */
      if (await _exists(row.newName)) {
        results.push({ ...row, status: 'conflict', error: '같은 이름의 파일이 이미 있음' });
        continue;
      }

      try {
        const file      = await photo.handle.getFile();
        const buf       = await file.arrayBuffer();
        const newHandle = await folderHandle.getFileHandle(row.newName, { create: true });
        const writable  = await newHandle.createWritable();
        await writable.write(buf);
        await writable.close();
        await folderHandle.removeEntry(photo.name);

        photo.name   = row.newName;
        photo.handle = newHandle;
        photo.num    = _extractNum(row.newName);
        photo.converted = true;
        processedOldNames.add(row.oldName); /* 처리 완료 기록 */
        results.push({ ...row, status: 'ok' });
      } catch (e) {
        /* 개별 파일 오류는 기록 후 다음 항목으로 계속 진행 */
        results.push({ ...row, status: 'error', error: e.message });
      }
    }

    if (onPhotoLoad) onPhotoLoad(photos);
    return results;
  }

  async function _exists(name) {
    try { await folderHandle.getFileHandle(name); return true; }
    catch { return false; }
  }

  /* 미리보기 ObjectURL */
  async function getPhotoURL(photoHandle) {
    try {
      const file = await photoHandle.getFile();
      return URL.createObjectURL(file);
    } catch { return null; }
  }

  function getPhotos()    { return photos; }
  function getFolderName() { return folderHandle ? folderHandle.name : null; }

  return {
    init, selectFolder,
    extractPhotoName, autoMatch, buildRenamePreview, renameAll,
    getPhotoURL, getPhotos, getFolderName,
  };
})();
