// 자동 저장 및 파일 입출력을 담당하는 모듈
// IndexedDB(이미지)와 LocalStorage(메타)를 분리 저장하여 용량 효율성 확보

const StorageManager = (() => {
  // ── 상태 관리
  let _isDirty = false;
  let _debounceTimer = null;
  let _onStatusChange = null;
  let _getProject = null;   // app.js가 등록하는 전체 프로젝트(두 작업공간) 빌더

  // ── 탭 고유 ID (sessionStorage 기반 — F5 새로고침 후 유지, 탭 닫으면 소멸)
  let _tabId = sessionStorage.getItem('numdraw_tabId');
  if (!_tabId) {
    _tabId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    sessionStorage.setItem('numdraw_tabId', _tabId);
  }

  const _sessionKey = 'numdraw_session_' + _tabId;

  // ── 초기화
  async function init(onStatusChangeCb) {
    _onStatusChange = onStatusChangeCb;
    _cleanupOldSessions();
  }

  // ── 전체 프로젝트 빌더 등록 (두 작업공간 내보내기용)
  function setProjectProvider(fn) { _getProject = fn; }

  // ── 30일 이상 된 세션 정리 (다른 탭이 닫힌 뒤 남은 잔류 데이터 제거)
  function _cleanupOldSessions() {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('numdraw_session_')) continue;
      if (key === _sessionKey) continue; // 현재 탭 세션은 건드리지 않음
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (data && data.updatedAt && new Date(data.updatedAt).getTime() < threshold) {
          keysToRemove.push(key);
        }
      } catch {}
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
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

      req.onerror = () => {
        console.warn('IndexedDB 접근 불가 — Private Browsing일 수 있습니다');
        resolve(null);
      };
    });
  }

  // ── 탭별 고유 pageId 생성 (탭 간 충돌 방지)
  function _imgKey(pageId) {
    return _tabId + '_' + pageId;
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
          store.put({ pageId: _imgKey(page.id), imgSrc: page.imgSrc });
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
        const req = db.transaction('images').objectStore('images').get(_imgKey(page.id));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

      if (result && result.imgSrc) {
        page.imgSrc = result.imgSrc;
      }
    }
  }

  // ── IndexedDB에서 현재 탭 이미지 전체 삭제
  async function _clearTabImages() {
    const db = await _openDB();
    if (!db) return;

    const all = await new Promise((resolve) => {
      const req = db.transaction('images').objectStore('images').getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const tabKeys = all.filter(k => typeof k === 'string' && k.startsWith(_tabId + '_'));
    if (!tabKeys.length) return;

    return new Promise((resolve) => {
      const tx = db.transaction('images', 'readwrite');
      const store = tx.objectStore('images');
      tabKeys.forEach(k => store.delete(k));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
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
        appMode: AppMode.get(),
        pages: JSON.stringify(lightData),
        titleBlock: {
          enabled: TitleBlock.isEnabled(),
          settings: TitleBlock.getSettings(),
        },
        legend: {
          enabled: Legend.isEnabled(),
        },
        globalConfig: {
          scale:   cfg.scale,
          tbScale: cfg.tbScale,
          lgScale: cfg.lgScale,
          categories: cats,
        },
      };

      // 6. 탭별 고유 키로 LocalStorage에 저장
      localStorage.setItem(_sessionKey, JSON.stringify(session));
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
    const raw = localStorage.getItem(_sessionKey);
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

  // ── .qspec 파일로 내보내기
  async function exportFile() {
    try {
      // 1. 전체 프로젝트 데이터 구성 (provider가 있으면 두 작업공간 + 이미지 인라인)
      let data;
      if (_getProject) {
        data = _getProject();
      } else {
        const pagesData = JSON.parse(PageManager.toJSON());
        await _loadImages(pagesData.pages);
        const cfg = Annotation.getConfig();
        data = {
          version: 1,
          updatedAt: new Date().toISOString(),
          appMode: AppMode.get(),
          pages: JSON.stringify(pagesData),
          titleBlock: { enabled: TitleBlock.isEnabled(), settings: TitleBlock.getSettings() },
          legend: { enabled: Legend.isEnabled() },
          globalConfig: { scale: cfg.scale, tbScale: cfg.tbScale, lgScale: cfg.lgScale, categories: Annotation.getCategories() },
        };
      }

      const jsonString = JSON.stringify(data, null, 2);
      const projectTitle = TitleBlock.getSettings().projectTitle || 'quickspect';
      const suggestedName = projectTitle + '.qspec';

      // 5. showSaveFilePicker 시도 (Chrome/Edge)
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: suggestedName,
            types: [
              {
                description: '퀵스도면 프로젝트 파일',
                accept: { 'application/json': ['.qspec', '.numdraw'] },
              },
            ],
          });

          const writable = await handle.createWritable();
          await writable.write(jsonString);
          await writable.close();

          _isDirty = false;
          return;
        } catch (e) {
          if (e.name === 'AbortError') {
            return false;
          }
          console.warn('showSaveFilePicker 실패, 다운로드로 진행:', e);
        }
      }

      // 6. Fallback: Blob 다운로드
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);

      _isDirty = false;
    } catch (e) {
      throw new Error('파일 저장 실패: ' + e.message);
    }
  }

  // ── 프로젝트 파일 가져오기 (.qspec · 구 .numdraw 모두 허용)
  async function importFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);

          if (!data.version || (!data.pages && !data.workspaces)) {
            throw new Error('유효하지 않은 프로젝트 파일 형식입니다');
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

  // ── 전체 세션 삭제 (현재 탭 데이터만)
  async function clearSession() {
    localStorage.removeItem(_sessionKey);
    await _clearTabImages();
    _isDirty = false;
  }

  // ── 공개 API
  return {
    init,
    setProjectProvider,
    markDirty,
    saveSession,
    loadSession,
    exportFile,
    importFile,
    isDirty,
    clearSession,
  };
})();;
