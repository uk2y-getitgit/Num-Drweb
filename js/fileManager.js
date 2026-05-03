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
        photos.push({ name, num, handle });
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

  /* ── 레이블 → 파일명 변환 (C-2)
     1F-01  → 101
     10F-05 → 1005
     B1F-01 → B101
     RF-01  → R101
     기타   → PREFIX + num (fallback) */
  function extractPhotoName(label) {
    const m = label.match(/^([A-Za-z0-9]+)-(\d+)$/);
    if (!m) return label;
    const prefix = m[1].toUpperCase();
    const num    = m[2];

    if (/^RF$/i.test(prefix)) return 'R1' + num;
    const bf = prefix.match(/^B(\d+)F$/i);
    if (bf) return 'B' + bf[1] + num;
    const f = prefix.match(/^(\d+)F$/i);
    if (f) return f[1] + num;
    return prefix + num;
  }

  /* ── 자동 매칭 (customPhotoNum 우선) ── */
  function autoMatch(annotations) {
    if (!photos.length) return; /* 폴더 미선택 시 기존 photoName 유지 */
    annotations.forEach(item => {
      const matchNum = item.customPhotoNum != null ? item.customPhotoNum : item.num;
      const matched  = photos.find(p => p.num === Number(matchNum));
      item.photoName = matched ? matched.name : null;
    });
  }

  /* ── 파일명 변환 미리보기 (순수 함수, 파일 조작 없음) ── */
  function buildRenamePreview(annotations) {
    return annotations.map(item => {
      /* 각 item의 _pagePrefix 사용 (페이지별로 다른 접두어 지원) */
      const itemPrefix = item._pagePrefix !== undefined ? item._pagePrefix : '';
      const prefix     = itemPrefix ? itemPrefix + '-' : '';
      const matchNum   = item.customPhotoNum != null ? item.customPhotoNum : item.num;
      const photo      = photos.find(p => p.num === Number(matchNum));
      const numStr     = String(item.num).padStart(2, '0');
      const label      = prefix + numStr;
      const newBaseName = extractPhotoName(label);

      if (!photo) {
        return { label, oldName: null, newBaseName, newName: newBaseName, status: 'nomatch' };
      }

      const ext     = photo.name.split('.').pop().toLowerCase();
      const newName = newBaseName + '.' + ext;
      return {
        label,
        oldName:     photo.name,
        newBaseName,
        newName,
        status: photo.name === newName ? 'same' : 'ready',
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
