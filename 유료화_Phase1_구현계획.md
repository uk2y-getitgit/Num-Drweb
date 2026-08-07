# NumDraw Phase 1 — 라이선스 인증 시스템 구현 계획

- 작성일: 2026-08-07
- 범위: 앱 내부 인증(클라이언트) + 활성화 서버(Cloudflare) + 수동 발급 도구
- 제외: 결제 자동화(무통장입금 수동 처리), 홈페이지(Phase 2)

---

## 0. 확정 결정 사항

| 항목 | 결정값 |
|---|---|
| 판매 모델 | 1회성 라이선스 구매 |
| 결제 | 무통장입금 **수동 처리** (운영자가 입금 확인 후 키 발급) |
| 인증 | **하이브리드** — 최초 1회 온라인 활성화 → 이후 오프라인 |
| 활성화 가능 PC | **2대** / 라이선스 |
| 체험판 | **기능 제한** — PDF 워터마크 + 페이지 1장 제한 (기간 무제한) |
| 인프라 | **Cloudflare Workers + D1 + Pages** |
| 대상 | Windows x64, Electron |

---

## 1. 현재 코드 구조 (변경 대상 파악 완료)

```
electron/main.js       107줄  app:// 프로토콜, 단일 인스턴스, 창 상태, ipcMain
electron/preload.js     14줄  contextBridge('electronAPI') — 확장 지점
js/app.js            1820줄  전체가 DOMContentLoaded 콜백 1개 (4행부터)
                             _exportPDF()는 1124행 — 반복 버그 이력 있음, 주의
js/pageManager.js     271줄  페이지 추가/삭제 — 체험판 페이지 제한 적용 지점
index.html            617줄  108행에 "PDF 저장" 버튼
```

보안 관점 기존 상태:
- ✅ `contextIsolation: true`, `nodeIntegration: false` — preload 브리지 구조가 이미 올바름
- ⚠️ `asar: false` — **설치 폴더의 JS가 평문 노출·수정 가능**. `app://` 프로토콜 핸들러가 `net.fetch('file://')`로 실제 파일을 읽기 때문에 걸린 제약으로 보인다. 이번 Phase에서 건드리지 않고 후속 과제로 남긴다.

---

## 2. 키 포맷

```
ND2-XXXXX-XXXXX-XXXXX-XXXXX
```

- 문자 집합: Crockford Base32에서 혼동 문자 제외 → `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
- 앞 16자 = 80비트 난수, 뒤 4자 = 체크섬 → **오타를 서버에 묻지 않고 입력 화면에서 즉시 감지**
- 정규화: 대문자 변환, 하이픈·공백 제거 후 처리 (사용자가 소문자로 붙여넣어도 통과)

**키 자체에는 서명을 넣지 않는다.** 하이브리드 방식에서 키는 서버 조회용 비밀값이고, 실제 서명 대상은 아래의 활성화 증서다. 키를 짧게 유지해서 이메일로 받아 손으로 옮겨 적기 쉽게 하는 것이 목적이다.

---

## 3. 활성화 증서 (Activation Certificate)

서버가 **Ed25519**로 서명하고, 앱은 내장 공개키로 검증한다.

```
cert = base64url(payload JSON) + "." + base64url(Ed25519 서명)
```

payload:

```json
{
  "v": 1,
  "product": "numdraw",
  "edition": "full",
  "device": "<기기지문 해시 64자>",
  "key_id": "<key_hash 앞 12자>",
  "issued_at": "2026-08-07T00:00:00Z",
  "features": { "watermark": false, "maxPages": 0 }
}
```

- `maxPages: 0` = 무제한
- `device`가 payload에 들어가고 그 위에 서명하므로, **증서 파일을 다른 PC로 복사해도 기기지문이 달라 검증 실패**한다
- 개인키는 Cloudflare Workers Secret에만 존재. 저장소·앱·`dist/` 어디에도 넣지 않는다

---

## 4. 기기 지문 (Device Fingerprint)

1순위: Windows 레지스트리 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`
2순위(실패 시): `hostname + CPU 모델 + 총 메모리` 조합

두 경우 모두 고정 salt로 **HMAC-SHA256 → hex 64자**로 변환해 원본 값이 서버에 그대로 가지 않게 한다.

- 개인정보(사용자명·이메일·파일경로)를 **절대 포함하지 않는다** → 개인정보처리방침과 일관성 유지
- 메인보드/디스크 시리얼은 쓰지 않는다. 포맷·부품 교체 시 정품이 풀려서 지원 문의가 폭증한다

---

## 5. 파일 구조 (신규)

### 클라이언트 — `license-core` 담당

```
electron/license/
  fingerprint.js   기기지문 생성
  verify.js        Ed25519 증서 검증 (Node 내장 crypto)
  store.js         userData/license.json 읽기·쓰기
  activate.js      서버 활성화 요청
  pubkey.js        내장 공개키 상수
  index.js         상태 판정 → { edition, features } 반환
electron/preload.js  (수정) contextBridge에 license API 추가
electron/main.js     (수정) ipcMain 핸들러 등록
js/license.js        (신규) 활성화 모달 UI + 체험판 배지
js/app.js            (수정) 시작 시 게이트, _exportPDF 워터마크
js/pageManager.js    (수정) maxPages 제한
index.html           (수정) 활성화 모달 마크업, 체험판 배지
css/style.css        (수정) 관련 스타일 — CSS 변수만 사용
```

### 서버 — `activation-server` 담당

```
server/
  src/index.js       Workers 진입점 (라우팅)
  src/core/keygen.js 키 생성·정규화·체크섬  ← 플랫폼 비의존 순수 JS
  src/core/cert.js   증서 서명              ← 플랫폼 비의존 순수 JS
  src/routes/        activate / admin
  schema.sql         D1 스키마
  wrangler.toml      설정 (시크릿은 여기 넣지 않음)
```

`core/`를 순수 JS로 분리하는 이유: 나중에 Cloudflare를 떠나도 핵심 로직을 그대로 옮길 수 있게 하기 위함.

---

## 6. D1 스키마

```sql
CREATE TABLE licenses (
  key_hash    TEXT PRIMARY KEY,              -- sha256(정규화 키). 평문 키는 저장하지 않음
  key_masked  TEXT NOT NULL,                 -- 'ND2-A7K3M-****-****-9QX2' 운영자 식별용
  buyer_name  TEXT,
  buyer_email TEXT,
  memo        TEXT,                          -- 입금일·금액 등 운영 메모
  max_seats   INTEGER NOT NULL DEFAULT 2,
  status      TEXT NOT NULL DEFAULT 'active',-- active | revoked
  issued_at   TEXT NOT NULL
);

CREATE TABLE activations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash     TEXT NOT NULL,
  device_hash  TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  released_at  TEXT,                          -- 좌석 반납(PC 교체) 시각
  UNIQUE(key_hash, device_hash)
);
```

키 평문을 저장하지 않으므로 DB가 통째로 유출돼도 유효한 키를 만들 수 없다. 대신 **키 분실 시 재발급(새 키 발급 + 기존 키 revoke)** 으로 대응한다.

---

## 7. API 계약 (양쪽 에이전트가 동일하게 구현해야 하는 부분)

### `POST /api/activate`

요청:
```json
{ "key": "ND2-...", "device": "<hex 64>", "product": "numdraw", "app_version": "1.3.0" }
```

성공 200:
```json
{ "ok": true, "cert": "<payload>.<sig>", "seats_used": 1, "max_seats": 2 }
```

실패 4xx:
```json
{ "ok": false, "code": "SEAT_LIMIT", "message": "이 라이선스는 이미 2대에서 사용 중입니다." }
```

| code | 상황 | 앱이 사용자에게 보여줄 안내 |
|---|---|---|
| `INVALID_KEY` | 키 없음/오타 | 키를 다시 확인해 주세요 |
| `REVOKED` | 운영자가 정지 | 판매자에게 문의해 주세요 |
| `SEAT_LIMIT` | 2대 초과 | 기존 PC 해제 후 사용 / 문의 안내 |
| `RATE_LIMITED` | 무차별 대입 방어 | 잠시 후 다시 시도 |

**같은 키 + 같은 기기로 재요청하면 좌석을 추가로 쓰지 않고 증서를 다시 발급한다.** (재설치 대응)

### 관리자 엔드포인트 (토큰 인증)
- `POST /admin/issue` — 키 발급 (구매자명·이메일·메모 입력, 평문 키 1회 반환)
- `GET  /admin/list` — 발급 대장 조회 화면
- `POST /admin/revoke` — 키 정지
- `POST /admin/release` — 특정 기기 좌석 반납

---

## 8. 체험판 게이트 적용 지점

| 제한 | 적용 위치 | 구현 |
|---|---|---|
| PDF 워터마크 | `js/app.js` `_exportPDF()` (1124행) | 각 페이지 렌더 후 대각선 반투명 "체험판 NumDraw TRIAL" 텍스트 |
| 페이지 1장 | `js/pageManager.js` 페이지 추가 경로 | 2번째 추가 시 차단 + 구매 안내 |
| 체험판 배지 | 툴바 | "체험판 · 정품 인증" 버튼 |

`_exportPDF`는 **3회 이상 반복 수정된 위험 함수**다. 수정 전 함수 전체를 읽고, 다중 페이지 PDF에서 모든 페이지에 첫 페이지 이미지가 덮어써지지 않는지 반드시 재확인한다.

---

## 9. 보안 한계 — 솔직하게 기록

`asar: false`라 **설치 폴더의 JS를 메모장으로 열어 검증 코드를 지울 수 있다.** Electron 앱에서 완벽한 복제 방지는 불가능하며, 이번 구현의 목표는 다음 선까지다:

> **정직한 구매자가 불편하지 않으면서, 캐주얼한 복제(키 돌려쓰기·증서 파일 복사)는 막는다.**

달성되는 것 / 안 되는 것:

| 공격 | 방어 여부 |
|---|---|
| 키 하나를 여러 명이 돌려쓰기 | ✅ 서버 좌석 카운트로 2대 제한 |
| 활성화된 PC의 증서 파일 복사 | ✅ 기기지문이 서명에 묶여 있어 실패 |
| 키 무작위 추측 | ✅ 80비트 난수 + rate limit |
| 가짜 서버로 응답 위조 | ✅ 증서 서명 검증 |
| **설치 폴더 JS 직접 수정** | ❌ 막지 못함 — 후속 과제(asar 전환·난독화) |

후속 과제로 남길 것: `asar: true` 전환 가능 여부 검토(`app://` 프로토콜 핸들러 수정 필요), 코드 서명 인증서 구매.

---

## 10. 작업 순서와 담당

| 순서 | 작업 | 담당 에이전트 | 모델 |
|---|---|---|---|
| 1 | 클라이언트 인증 모듈 + 체험판 게이트 | `license-core` | opus |
| 1 | 활성화 서버 + 발급 백오피스 (병렬) | `activation-server` | sonnet |
| 2 | 우회·위조·시크릿 유출 검수 | `license-auditor` | opus |
| 3 | 빌드·설치·회귀 검증 | `release-qa` | sonnet |

1번 두 작업은 파일이 겹치지 않아(`electron/`+`js/` vs `server/`) 병렬 진행한다. 두 에이전트는 **7장의 API 계약과 3장의 증서 포맷을 공유**한다.

---

## 11. 진행 상태

- [x] 결정 사항 확정 (호스팅·좌석수·체험판)
- [x] 구현 계획 수립
- [ ] 클라이언트 인증 모듈
- [ ] 활성화 서버
- [ ] 보안 검수
- [ ] 빌드 검증
- [ ] Cloudflare 계정 생성 및 배포 (사용자 작업 필요)
