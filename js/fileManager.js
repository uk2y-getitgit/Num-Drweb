/* fileManager.js — 로컬 폴더 & 사진 파일 관리 */
'use strict';

const FileManager = (() => {
  let photos = [];       // { name, num, handle }
  let folderHandle = null;
  let prefixFilter = '';
  let onPhotoLoad = null;

  function init(callback) { onPhotoLoad = callback; }

  /* ── 폴더 선택 (File System Access API) ── */
  async function selectFolder() {
    try {
      folderHandle = await window.showDirectoryPicker({ mode: 'read' });
      photos = [];
      for await (const [name, handle] of folderHandle.entries()) {
        if (handle.kind !== 'file') continue;
        const ext = name.split('.').pop().toLowerCase();
        if (!['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) continue;
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

  /* 파일명에서 뒤쪽 숫자 추출 */
  function _extractNum(name) {
    const base = name.replace(/\.[^.]+$/, '');
    const m = base.match(/(\d+)\D*$/);
    return m ? parseInt(m[1], 10) : null;
  }

  /* 접두어 필터 적용 */
  function filterByPrefix(prefix) {
    prefixFilter = prefix.toLowerCase();
    const filtered = prefixFilter
      ? photos.filter(p => p.name.toLowerCase().startsWith(prefixFilter))
      : photos;
    if (onPhotoLoad) onPhotoLoad(filtered);
  }

  /* 특정 사진의 ObjectURL 반환 (미리보기용) */
  async function getPhotoURL(photoHandle) {
    try {
      const file = await photoHandle.getFile();
      return URL.createObjectURL(file);
    } catch { return null; }
  }

  /* 넘버링 번호와 사진 번호 자동 매칭 */
  function autoMatch(annotations) {
    annotations.forEach(item => {
      const matched = photos.find(p => p.num === item.num);
      item.photoName = matched ? matched.name : null;
    });
  }

  function getPhotos() { return photos; }
  function getFolderName() { return folderHandle ? folderHandle.name : null; }

  return { init, selectFolder, filterByPrefix, getPhotoURL, autoMatch, getPhotos, getFolderName };
})();
