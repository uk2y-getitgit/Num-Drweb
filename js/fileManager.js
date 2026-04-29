/* fileManager.js — 로컬 폴더 & 사진 파일 관리 */
'use strict';

const FileManager = (() => {
  let photos       = [];
  let folderHandle = null;
  let prefixFilter = '';
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

  /* ── 파일명 변경 ──
     targetNum  : 매칭 번호 (정수)
     newBaseName: 새 파일명 (확장자 제외)
     반환: { oldName, newName } */
  async function renamePhoto(targetNum, newBaseName) {
    if (!folderHandle) throw new Error('폴더가 선택되지 않았습니다');

    const photo = photos.find(p => p.num === Number(targetNum));
    if (!photo) throw new Error(`번호 ${targetNum}에 매칭된 사진이 없습니다`);

    const trimmed = newBaseName.trim();
    if (!trimmed) throw new Error('새 파일명을 입력하세요');

    const ext     = photo.name.split('.').pop().toLowerCase();
    const newName = trimmed + '.' + ext;

    if (newName === photo.name) throw new Error('현재 파일명과 동일합니다');

    /* 원본 파일 읽기 → 새 파일 생성 → 원본 삭제 */
    const file      = await photo.handle.getFile();
    const buf       = await file.arrayBuffer();
    const newHandle = await folderHandle.getFileHandle(newName, { create: true });
    const writable  = await newHandle.createWritable();
    await writable.write(buf);
    await writable.close();
    await folderHandle.removeEntry(photo.name);

    /* 내부 상태 갱신 */
    const oldName = photo.name;
    photo.name    = newName;
    photo.handle  = newHandle;
    photo.num     = _extractNum(newName);

    if (onPhotoLoad) onPhotoLoad(photos);
    return { oldName, newName };
  }

  /* 파일명에서 뒤쪽 숫자 추출 */
  function _extractNum(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const m    = base.match(/(\d+)\D*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* 접두어 필터 */
  function filterByPrefix(prefix) {
    prefixFilter = prefix.toLowerCase();
    const filtered = prefixFilter
      ? photos.filter(p => p.name.toLowerCase().startsWith(prefixFilter))
      : photos;
    if (onPhotoLoad) onPhotoLoad(filtered);
  }

  /* 미리보기 ObjectURL */
  async function getPhotoURL(photoHandle) {
    try {
      const file = await photoHandle.getFile();
      return URL.createObjectURL(file);
    } catch { return null; }
  }

  /* 자동 매칭 */
  function autoMatch(annotations) {
    annotations.forEach(item => {
      const matched  = photos.find(p => p.num === item.num);
      item.photoName = matched ? matched.name : null;
    });
  }

  function getPhotos()    { return photos; }
  function getFolderName() { return folderHandle ? folderHandle.name : null; }

  return { init, selectFolder, renamePhoto, filterByPrefix, getPhotoURL, autoMatch, getPhotos, getFolderName };
})();
