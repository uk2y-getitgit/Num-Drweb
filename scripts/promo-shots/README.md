# 홍보용 화면 촬영기

`docs/archive/Quickspect_홍보자료.html` 에 들어가는 실행 화면을 **실제 앱을 띄워** 찍는다.
목업을 그리지 않는다 — UI 가 바뀌면 여기서 다시 찍어 갈아 끼운다.

## 왜 있나

2026-08-21 점검에서 홍보자료의 스크린샷이 전부 구버전(v1.2.4 이전 흰색 UI)이었다.
손으로 다시 찍으면 다음에 또 같은 일이 생기므로, 재현 가능한 방식으로 만들어 두었다.

## 준비물 (저장소 밖)

촬영에는 실제 도면과 사진이 필요하다. 개인정보·현장 자료라 커밋하지 않는다.

| 임시 파일 | 원본 위치 (예시) |
|---|---|
| `_shot_sample.png` (저장소 루트) | `Test폴더/사용법 가이드 제작/샘플도면/강당-지상1층.png` |
| `_shot_photos/*.jpg` (저장소 루트) | `Test폴더/사용법 가이드 제작/샘플사진/` (101·102·103·301~305) |

```bash
cp "<샘플도면>/강당-지상1층.png" _shot_sample.png
mkdir -p _shot_photos && cp "<샘플사진>/"*.jpg _shot_photos/
```

**촬영이 끝나면 반드시 지운다.** `rm -f _shot_sample.png && rm -rf _shot_photos`

## 실행

```bash
SHOT_TARGET="$PWD/index.html" SHOT_OUT=out.png \
SHOT_W=1920 SHOT_H=1032 SHOT_WAIT=3000 SHOT_AFTER=3400 \
SHOT_JS="$(sed 's/__MODE__/after/' scripts/promo-shots/sc_outline.js)" \
  ./node_modules/.bin/electron scripts/promo-shots/shot.js
```

| 시나리오 | MODE | 나오는 것 |
|---|---|---|
| `sc_outline.js` | `before` / `after` | 외관조사망도 — 도면만 / 넘버링 6건 |
| `sc_equip.js` | `screen` / `export` / `drawer` | 장비시험망도 화면 / A4 출력 결과 / 도곽 서랍 |
| `sc_photobook.js` | `empty` / `filled` | 사진첩 A4 — 사진 없음 / 자동 삽입 |

`SHOT_JS` 가 `data:image` 문자열을 반환하면 그 이미지를 저장하고, 아니면 창을 캡처한다.
`export` · `empty` · `filled` 는 캔버스를 직접 뽑으므로 창 크기와 무관하게 A4 원본 해상도로 나온다.

## 알아둘 것

- **창 크기는 화면(작업 영역)을 넘지 못한다.** 1920×1080 모니터에서 최대 1920×1032 다.
  `force-device-scale-factor` 로 2배를 시도하면 렌더러가 멈춘다 — 쓰지 말 것.
- **장비시험망도로 모드를 바꾸면 불러온 도면이 초기화된다.** 그래서 `sc_equip.js` 는
  모드를 먼저 바꾸고 도면을 나중에 올린다. 순서를 뒤집으면 빈 화면이 찍힌다.
- 모듈(`Annotation` · `PageManager` · `CanvasManager` …)은 `const` 선언이라
  `window.PageManager` 로는 못 잡는다. 식별자로 바로 쓴다.
- 캡처 직전에 `#status-msg` 를 지운다. 안 그러면 "도곽 ON" 토스트가 화면에 남는다.
- `webSecurity:false` 로 띄운다 — `file://` 에서 샘플 파일을 `fetch` 하기 위한 것이고,
  촬영 전용이다. 앱 본체와는 무관하다.

## 삽입

찍은 PNG 를 WebP 로 줄여 `Quickspect_홍보자료.html` 의 `<img src="data:image/webp;base64,…">`
자리에 넣는다. **`width` · `height` 속성도 새 크기로 같이 고친다.**

`img{ max-width:100%; height:auto; }` 의 `height:auto` 를 지우면 모든 이미지가
세로로 늘어난다. 2026-08-21 이전에 실제로 그 상태였다.
