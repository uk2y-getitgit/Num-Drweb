# Quickspect 코드 작업 가이드

> 작업 분야별로 확인해야 할 파일·함수·라인을 정리한 문서.  
> 전체 코드를 읽지 않고 해당 섹션만 열어서 빠르게 수정할 수 있도록 한다.

---

## 1. 도곽 자료 변경

### 1-1. 도곽 데이터 구조 / 렌더링 로직
**파일:** `js/titleBlock.js`

| 위치 | 내용 |
|------|------|
| L7–23 `settings` 객체 | 도곽 기본값 (projectTitle, drawingName, col0/col1, labelFontSz, valueFontSz, blockH) |
| L30 `applySettings(patch)` | 설정값 변경 — 외부에서 항상 이 함수로 변경 |
| L40 `getSettings()` | 현재 설정 읽기 |
| L43 `render(ctx, imgW, imgH)` | 도곽 전체 렌더링 진입점 |
| L56–84 | 외곽선 · 표제란 · 세로 구분선 그리기 |
| L87–89 | 각 셀 렌더 호출 (`_renderCell` × 2 + `_renderScaleCell`) |
| L95 `_renderCell` | PROJECT TITLE / DRAWING NAME 셀 (라벨 + 내용 텍스트) |
| L121 `_renderScaleCell` | SCALE 셀 |
| L160 `compositeCanvas` | PDF 저장 시 이미지+넘버링+도곽 합성 |

> **셀 레이아웃·폰트 크기·여백 수정** → `_renderCell` / `_renderScaleCell` 내부  
> **열 비율 로직 수정** → `applySettings` + `render` 내 `col0/col1/c2` 계산부  
> **새 셀 추가** → `render` L87–89에 새 `_renderCell` 호출 추가

---

### 1-2. 도곽 설정 모달 (UI 이벤트)
**파일:** `js/app.js`

| 라인 | 내용 |
|------|------|
| L366 | `btn-titleblock` 클릭 → 모달 열기, 현재 페이지 drawingName 로드 |
| L372–374 | **B: 페이지별 drawingName** — activePage.drawingName 읽어서 입력칸에 반영 |
| L408–412 | `tb-scale-slider` input → 배율 실시간 미리보기 |
| L416–428 | `tb-col0` / `tb-col1` input → 열 너비 실시간 미리보기 |
| L431–438 | `_setTbColUI(c0, c1)` — 열 비율 UI 동기화 (col2 자동 계산) |
| L442–446 | `tb-blockh` input → 표제란 높이 실시간 미리보기 |
| L450–460 | `tb-label-sz` / `tb-value-sz` input → 글씨 크기 실시간 미리보기 |
| L475–495 | `modal-tb-apply` 클릭 → drawingName은 activePage에만 저장, 나머지 전역 적용 |
| L498–501 | 도곽 ON/OFF 토글 |
| L666 | `_renderTitleBlock()` — `renderAnnotations` 재호출로 도곽 포함 전체 재렌더 |

> **모달에 새 입력 항목 추가** → L366(열기), L475(적용) 양쪽에 추가  
> **실시간 미리보기 추가** → input 이벤트에서 `TitleBlock.applySettings()` + `_renderTitleBlock()` 패턴 적용

---

### 1-3. 도곽 설정 모달 HTML
**파일:** `index.html`

| 라인 | 내용 |
|------|------|
| L338–407 | `#modal-titleblock` 전체 모달 블록 |
| L349–362 | 기본 정보 입력 (projectTitle, drawingName, scale) |
| L364–374 | 도곽 배율/표제란 높이 슬라이더 |
| L376–388 | 열 너비 비율 슬라이더 |
| L390–406 | 글씨 크기 슬라이더 |

---

### 1-4. 페이지별 drawingName 저장
**파일:** `js/pageManager.js`

| 라인 | 내용 |
|------|------|
| L136 `_createPage()` | `drawingName: null` 필드 포함 — 페이지 생성 시 초기화 |
| L147 `_activate(id)` | `onSwitch(p)` 콜백으로 page 객체 전달 → app.js에서 drawingName 적용 |

**파일:** `js/app.js` (onSwitch 콜백)

| 라인 | 내용 |
|------|------|
| L64–67 | PageManager.init onSwitch 콜백 — `TitleBlock.applySettings({ drawingName: page.drawingName })` |

---

## 2. UI 변경

### 2-1. 색상·간격·폰트 (CSS 변수)
**파일:** `css/style.css` L10–66 `:root`

```
--accent, --bg-panel, --bg-card, --border, --success, --danger, --warning
--sidebar-w (현재 220px)  --toolbar-h (현재 48px)  --page-panel-w (현재 90px)
```

> 레이아웃 너비/높이 변경은 여기 변수만 수정하면 전체 적용됨

---

### 2-2. 툴바 (상단)
**파일:** `index.html` L14–87 `#toolbar`  
**파일:** `css/style.css` L81–193 `#toolbar` · `.toolbar-group` · `.btn`

| 수정 목표 | 위치 |
|-----------|------|
| 버튼 추가 | index.html에 `.toolbar-group` 내부에 `.btn` 추가 + app.js에 이벤트 |
| 버튼 스타일 | css/style.css L129 `.btn` · `.btn-accent` · `.btn-danger` |
| 넘버 카운터 | index.html L80–86 `#num-counter` / css L195–216 |

---

### 2-3. 페이지 패널 (좌측)
**파일:** `index.html` L93–108 `#page-panel`  
**파일:** `css/style.css` L270–444 `#page-panel` 전체 블록  
**파일:** `js/app.js` L583–661 `_renderPageList()` — 카드 동적 생성 로직

| 수정 목표 | 위치 |
|-----------|------|
| 카드 디자인 | css L346–424 `.page-card` · `.page-thumb` · `.page-info` |
| 카드에 정보 추가 | app.js `_renderPageList()` 내 DOM 생성 코드 |
| 패널 너비 | css `:root` `--page-panel-w` |

---

### 2-4. 사이드바 (우측)
**파일:** `index.html` L259–330 `#sidebar`  
**파일:** `css/style.css` L629–957 `#sidebar` 전체 블록

| 구성 요소 | CSS 라인 |
|-----------|----------|
| 사이드바 외형 | L632–641 `#sidebar` |
| 탭 바 | L860–885 `.tab-bar` · `.tab-btn` · `.tab-panel` |
| 넘버링 목록 | L887–957 `.num-item` · `.num-badge` · `.num-info` · `.num-del` |
| 사진 매칭 번호 입력 | L1018–1031 `.photo-num-input` |
| 빈 상태 표시 | L959–968 `.empty-state` |

**파일:** `js/sidebar.js`

| 함수 | 내용 |
|------|------|
| L17 `renderNumList(items)` | 넘버링 목록 전체 렌더 (innerHTML) |
| L56–58 | 각 `.num-item` HTML 템플릿 — 배지·카테고리·사진명·입력칸 |
| L84 `renderRenamePreview(preview)` | 사진탭 파일명 미리보기 목록 렌더 |

> **넘버링 항목에 새 정보 추가** → sidebar.js `renderNumList` 내 템플릿 수정

---

### 2-5. 모달 공통
**파일:** `css/style.css` L1038–1133 `.modal-overlay` · `.modal-box` · `.field-row` · `.field-input`

---

### 2-6. 상태 메시지
**파일:** `css/style.css` L1136–1159 `#status-msg`  
**파일:** `js/app.js` L705 `showMsg(text, type)` — `info` / `success` / `warn`

---

## 3. 사진 매칭 관련 변경

### 3-1. 매칭 데이터 흐름 요약

```
폴더 선택 → FileManager.selectFolder()
  → photos[] 배열 구성 (name, num, handle)

넘버링 추가/변경 → Annotation.onChange 콜백
  → FileManager.autoMatch(items)     ← customPhotoNum 우선, 없으면 num
  → item.photoName 갱신
  → Sidebar.renderNumList(items)     ← num-item에 photoName 표시

미리보기 버튼 → FileManager.buildRenamePreview(items)
  → extractPhotoName(label) 적용
  → Sidebar.renderRenamePreview(preview)

일괄 변경 버튼 → FileManager.renameAll(items)
  → 내부에서 buildRenamePreview() 재호출
  → 파일 read → 새 파일 write → 원본 삭제
```

---

### 3-2. 파일별 수정 포인트

**파일:** `js/fileManager.js`

| 라인 | 함수 | 수정 시나리오 |
|------|------|---------------|
| L12 `selectFolder()` | 폴더 선택·photos 배열 구성 | 지원 확장자 추가, 정렬 방식 변경 |
| L33 `_extractNum(name)` | 파일명에서 숫자 추출 (뒤쪽 숫자) | 추출 규칙 변경 |
| L45 `extractPhotoName(label)` | 레이블 → 파일명 변환 규칙 | 새 층 패턴 추가 (예: PH-, RF2- 등) |
| L60 `autoMatch(annotations)` | customPhotoNum 우선 매칭 | 매칭 로직 변경 |
| L69 `buildRenamePreview(annotations)` | 파일 변경 없이 미리보기 계산 | 미리보기 표시 정보 추가 |
| L97 `renameAll(annotations)` | 일괄 파일명 변경 | 변경 전 백업, 중복 처리 등 |

**extractPhotoName 변환 규칙 (현재):**

```
1F-01   → 101       (nF-nn → n + nn)
10F-05  → 1005      (10F-nn → 10 + nn)
B1F-01  → B101      (BnF-nn → Bn + nn)
RF-01   → R101      (RF-nn → R1 + nn)
PH-01   → PH01      (기타 → PREFIX + nn, fallback)
```

규칙 추가 시 L45–57 `extractPhotoName` 내부에 새 `if` 분기 추가.

---

**파일:** `js/annotation.js`

| 라인 | 내용 |
|------|------|
| L33–50 `add()` | `customPhotoNum: null` 포함 — 새 항목에 추가할 필드는 여기 |
| L69 `updateItem(id, patch)` | customPhotoNum 등 개별 항목 업데이트 |
| L118 `toJSON()` / L120 `fromJSON()` | 직렬화 — 새 필드는 자동 포함됨 |

---

**파일:** `js/sidebar.js`

| 라인 | 내용 |
|------|------|
| L56 | `photo-num-input` HTML — 각 넘버링 항목의 사진 매칭 번호 입력칸 |
| L76–83 | `photo-num-input` change 이벤트 — `Annotation.updateItem` 호출 |
| L84 `renderRenamePreview(preview)` | 미리보기 행 렌더 |
| L95–110 | 각 `.rename-preview-row` HTML 템플릿 (label/oldName/newName/status) |

---

**파일:** `js/app.js`

| 라인 | 내용 |
|------|------|
| L24–29 | `Annotation.init` onChange 콜백 — `FileManager.autoMatch` 호출 위치 |
| L40–47 | `FileManager.init` 콜백 — 폴더 로드 완료 시 autoMatch + 미리보기 갱신 |
| L334–338 | `btn-select-folder` 클릭 이벤트 |
| L340–343 | `btn-preview-refresh` 클릭 → `_refreshRenamePreview()` |
| L346–359 | `btn-rename-all` 클릭 → `FileManager.renameAll()` → 결과 표시 |
| L688–691 | `_refreshRenamePreview()` — buildRenamePreview + renderRenamePreview 조합 |

---

**파일:** `css/style.css` (미리보기 스타일)

| 라인 | 내용 |
|------|------|
| L1199–1243 | `#rename-preview-list` · `.rename-preview-row` · `.rp-*` 클래스 전체 |
| L1210 | 미리보기 행 그리드 비율 (`grid-template-columns: 52px 1fr 14px 1fr 16px`) |
| L1214–1221 | 상태별 색상 (ready=파란, nomatch=주황, ok=초록, error=빨강) |

---

## 4. 도구바 내용 변경 (캔버스 상단 컨트롤 바)

### 4-1. HTML 구조
**파일:** `index.html` L114–214 `#canvas-control-bar`

컨트롤 바는 `<div class="ctrl-group">` 단위로 구분, 그 사이에 `<div class="ctrl-sep">` 구분선.

| 라인 | 그룹 내용 |
|------|----------|
| L117–127 | 지시점 (화살표 / 점) |
| L131–149 | 선 스타일 (직/ㄱ/ㄴ/번) |
| L153–170 | 직교 토글 + 반전 토글 |
| L174–188 | 카테고리 (결함/보수/기타 + 색상 피커) |
| L192–199 | 번호 설정 (접두어 input / 시작번호 input / 글씨 색상) |
| L203–212 | 슬라이더 (선 두께 / 넘버링 배율) |

> **그룹 추가:** `<div class="ctrl-sep"></div>` 뒤에 새 `<div class="ctrl-group">` 추가  
> **그룹 제거:** 해당 `ctrl-group`과 인접 `ctrl-sep` 함께 제거

---

### 4-2. 이벤트 바인딩
**파일:** `js/app.js`

| 라인 | 대상 | 내용 |
|------|------|------|
| L175–183 | `.tool-btn[data-tool]` | 지시점 선택 → `CanvasManager.setTool()` |
| L185–193 | `.line-btn` | 선 스타일 → `Annotation.setConfig({ lineStyle })` |
| L196–199 | `ortho-toggle` | 직교모드 → `CanvasManager.setOrtho()` |
| L202–226 | `.cat-btn` / `cat-color-*` | 카테고리 선택 + 색상 변경 |
| L228–232 | `arrow-flip-toggle` | 화살표 반전 → `Annotation.setConfig({ arrowFlip })` |
| L235–239 | `prefix-num` | 접두어 → `Annotation.setConfig({ prefix })` |
| L242–245 | `color-text` | 글씨 색상 → `Annotation.setConfig({ textColor })` |
| L248–250 | `line-width` | 선 두께 → `CanvasManager.setLineWidth()` |
| L254–260 | `annotation-scale` | 넘버링 배율 → `Annotation.setConfig({ scale })` |
| L271–274 | `start-num` | 시작 번호 → `Annotation.setNextNum()` |
| L287–325 | keydown | Q(직교), R(반전), Tab(선 스타일 순환) 단축키 |

> **새 도구 추가 절차:**
> 1. index.html: 컨트롤 바에 버튼 HTML 추가
> 2. app.js: 해당 버튼에 addEventListener 추가
> 3. 필요 시 `Annotation.setConfig()` 또는 `CanvasManager.setXxx()` 연결

---

### 4-3. CSS 스타일
**파일:** `css/style.css`

| 라인 | 내용 |
|------|------|
| L457–533 | `#canvas-control-bar` 전체 + `.ctrl-group` · `.ctrl-sep` · `.ctrl-label` · `.ctrl-toggle-row` · `.ctrl-slider-row` |
| L515–520 | 컨트롤 바 내 `.tool-btn` 오버라이드 (가로 배치, height 28px) |
| L522–526 | 컨트롤 바 내 `.line-btn` 오버라이드 |
| L528–532 | 컨트롤 바 내 `.cat-btn` 오버라이드 |

> **버튼 크기 조정:** L515–532 height/padding  
> **컨트롤 바 높이:** `flex-wrap: wrap` 이므로 항목이 많으면 자동 2줄  
> **구분선 스타일:** L487–493 `.ctrl-sep`

---

### 4-4. 렌더링 엔진 (캔버스 드로잉)
**파일:** `js/canvas.js`

수정 빈도가 낮은 파일. 도구바 동작 변경보다 렌더링 방식 변경 시에만 확인.

| 라인 | 내용 |
|------|------|
| L24 `init()` | wrap(canvas-area), container, imgEl, drawCanvas, interactEl 초기화 |
| L190 `renderAnnotations(items)` | 전체 재렌더 진입점 (afterRenderCb로 도곽 포함) |
| L224 `_drawLeader()` | 지시선 + P1표시 + 번호박스 그리기 |
| L273 `_drawArrowHead()` | 화살표 머리 그리기 |
| L288 `_drawNumBox()` | 번호 박스 그리기 (라운드 사각형 + 텍스트) |
| L166 `_buildPath()` | 선 스타일별 경로 계산 (straight/elbow-h/elbow-v/zigzag) |

---

## 빠른 참조 — 파일별 역할 요약

| 파일 | 주 역할 |
|------|---------|
| `js/titleBlock.js` | 도곽 렌더링 로직 (설정값 → canvas 그리기) |
| `js/annotation.js` | 넘버링 데이터 모델, autoLayout, 직렬화 |
| `js/canvas.js` | 캔버스 렌더링, 마우스 이벤트, 줌/팬 |
| `js/fileManager.js` | 폴더 I/O, 파일명 변환 규칙, 일괄 rename |
| `js/sidebar.js` | 넘버링 목록 렌더, 미리보기 목록 렌더 |
| `js/pageManager.js` | 다중 페이지 관리, drawingName 페이지별 보관 |
| `js/app.js` | 모든 이벤트 바인딩 + 모듈 간 연결 |
| `index.html` | HTML 구조 (툴바, 컨트롤 바, 사이드바, 모달) |
| `css/style.css` | 전체 스타일 (CSS 변수 → 컴포넌트 순) |
