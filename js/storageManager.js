// 자동 저장 및 파일 입출력을 담당하는 모듈
// IndexedDB(이미지)와 LocalStorage(메타)를 분리 저장하여 용량 효율성 확보

const StorageManager = (() => {
  // ── 상태 관리
  let _isDirty = false;
  let _debounceTimer = null;
  let _onStatusChange = null;

  // ── 초기화
  async function init(onStatusChangeCb) {
    _onStatusChange = onStatusChangeCb;
  }

  // ── IndexedDB 열기
  function _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('numdraw_db', 1);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'pageId' });
        }
      };

      req.onsuccess = (e) => {
        resolve(e.target.result);
      };

      req.onerror = (e) => {
        console.warn('IndexedDB 접근 불가 — Private Browsing일 수 있습니다');
        resolve(null);
      };
    });
  }

  // ── IndexedDB에 이미지 저장
  async function _saveImages(pages) {
    const db = await _openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');

      for (const page of pages) {
        if (page.imgSrc) {
          store.put({ pageId: page.id, imgSrc: page.imgSrc });
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── IndexedDB에서 이미지 불러오기
  async function _loadImages(pages) {
    const db = await _openDB();
    if (!db) return;

    for (const page of pages) {
      const result = await new Promise((resolve) => {
        const req = db.transaction('images').objectStore('images').get(page.id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (result && result.imgSrc) {
        page.imgSrc = result.imgSrc;
      }
    }
  }

  // ── LocalStorage에 세션 저장
  async function saveSession() {
    try {
      // 1. PageManager 데이터 수집 및 파싱
      const pagesJSON = PageManager.toJSON();
      const pagesData = JSON.parse(pagesJSON);

      // 2. 이미지를 IndexedDB에 저장
      await _saveImages(pagesData.pages);

      // 3. 이미지 제거한 경량 복사본 생성 (LocalStorage용)
      const lightPages = pagesData.pages.map((p) => ({
        ...p,
        imgSrc: '', // 이미지는 IndexedDB에서 분리 저장
      }));
      const lightData = { ...pagesData, pages: lightPages };

      // 4. 전역 설정 수집
      const cfg = Annotation.getConfig();
      const cats = Annotation.getCategories();

      // 5. 세션 데이터 구성
      const session = {
        version: 1,
        updatedAt: new Date().toISOString(),
        pages: JSON.stringify(lightData),
        titleBlock: {
          enabled: TitleBlock.isEnabled(),
          settings: TitleBlock.getSettings(),
        },
        globalConfig: {
          scale: cfg.scale,
          tbScale: cfg.tbScale,
          categories: cats,
        },
      };

      // 6. LocalStorage에 저장
      localStorage.setItem('numdraw_session', JSON.stringify(session));
      _isDirty = false;
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        console.warn('LocalStorage 용량 초과');
        throw new Error('브라우저 저장 용량 초과. 프로젝트를 파일로 저장하세요.');
      }
      throw e;
    }
  }

  // ── LocalStorage에서 세션 복원
  async function loadSession() {
    const raw = localStorage.getItem('numdraw_session');
    if (!raw) return null;

    try {
      const session = JSON.parse(raw);

      if (!session.version || !session.pages) {
        return null;
      }

      const pagesData = JSON.parse(session.pages);

      // 이미지를 IndexedDB에서 보충
      await _loadImages(pagesData.pages);

      // 이미지 없는 페이지는 필터링 (손상된 데이터 방어)
      pagesData.pages = pagesData.pages.filter((p) => p && p.imgSrc);

      if (!pagesData.pages.length) {
        return null;
      }

      // 세션에 복원된 이미지 데이터 반영
      session.pages = JSON.stringify(pagesData);

      return session;
    } catch (e) {
      console.error('세션 로드 실패:', e);
      return null;
    }
  }

  // ── .numdraw 파일로 내보내기
  async function exportFile() {
    try {
      // 1. 현재 앱 상태 수집
      const pagesJSON = PageManager.toJSON();
      const pagesData = JSON.parse(pagesJSON);

      // 2. 이미지 보충 (경량 저장소에는 비어있을 수 있음)
      await _loadImages(pagesData.pages);

      // 3. 전역 설정 수집
      const cfg = Annotation.getConfig();
      const cats = Annotation.getCategories();

      // 4. 완전한 프로젝트 데이터 구성
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        pages: JSON.stringify(pagesData),
        titleBlock: {
          enabled: TitleBlock.isEnabled(),
          settings: TitleBlock.getSettings(),
        },
        globalConfig: {
          scale: cfg.scale,
          tbScale: cfg.tbScale,
          categories: cats,
        },
      };

      const jsonString = JSON.stringify(data, null, 2);
      const projectTitle = TitleBlock.getSettings().projectTitle || 'numdraw';
      const suggestedName = projectTitle + '.numdraw';

      // 5. showSaveFilePicker 시도 (Chrome/Edge)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: suggestedName,
            types: [
              {
                description: 'NumDraw 프로젝트 파일',
                accept: { 'application/json': ['.numdraw'] },
              },
            ],
          });

          // 파일 쓰기
          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();

          _isDirty = false;
          return;
        } catch (e) {
          // AbortError: 사용자가 취소한 경우
          if (e.name === 'AbortError') {
            return false;
          }
          // 다른 오류: fallback으로 진행
          console.warn('showSaveFilePicker 실패, 다운로드로 진행:', e);
        }
      }

      // 6. Fallback: Blob 다운로드 (Firefox 등 미지원 브라우저)
      const blob = new Blob([jsonString], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');

      a.href = url;
      a.download = suggestedName;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      // 리소스 정리 (5초 후)
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      _isDirty = false;
    } catch (e) {
      throw new Error('파일 저장 실패: ' + e.message);
    }
  }

  // ── .numdraw 파일 가져오기
  async function importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);

          if (!data.version || !data.pages) {
            throw new Error('유효하지 않은 .numdraw 파일 형식입니다');
          }

          resolve(data);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => {
        reject(new Error('파일 읽기 실패'));
      };

      reader.readAsText(file);
    });
  }

  // ── 미저장 상태로 변경 + debounce 저장
  function markDirty() {
    _isDirty = true;
    if (_onStatusChange) _onStatusChange('unsaved');

    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(async () => {
      try {
        if (_onStatusChange) _onStatusChange('saving');
        await saveSession();
        _isDirty = false;
        if (_onStatusChange) _onStatusChange('saved');
      } catch (e) {
        console.error('자동 저장 실패:', e);
        if (_onStatusChange) _onStatusChange('unsaved');
      }
    }, 3000);
  }

  // ── 현재 미저장 여부 반환
  function isDirty() {
    return _isDirty;
  }

  // ── 전체 세션 삭제
  async function clearSession() {
    localStorage.removeItem('numdraw_session');

    const db = await _openDB();
    if (db) {
      const tx = db.transaction('images', 'readwrite');
      tx.objectStore('images').clear();
    }

    _isDirty = false;
  }

  // ── 공개 API
  return {
    init,
    markDirty,
    saveSession,
    loadSession,
    exportFile,
    importFile,
    isDirty,
    clearSession,
  };
})();
