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

> 아래 표는 2026-08-07 `license-auditor` 검수 결과를 반영해 **실제 확인된 내용으로 정정**했다.
> 최초 작성 시의 낙관적 표기(모두 ✅)는 사실이 아니었다. 운영자가 실제보다 강한 방어를 믿는 것이 코드 결함보다 위험하므로, 막지 못하는 것을 명확히 적는다.

| 공격 | 방어 여부 |
|---|---|
| 활성화된 PC의 증서 파일을 다른 PC로 **단순 복사** | ✅ 기기지문이 서명에 묶여 있어 실패 |
| 가짜 서버로 응답 위조 | ✅ 증서 서명 검증 |
| 로컬에서 키 위조 (체크섬만 맞춘 키) | ✅ 오프라인 폴백 없음 — 반드시 서버 조회 |
| `license.json` 손으로 편집 | ✅ `edition`·`features`는 서명 검증 결과에서만 읽음 |
| 키 무작위 추측 | ✅ **80비트 난수 + 체크섬**(통과율 1/2²⁰). ⚠️ rate limit은 실질 기여 없음 — 아래 참조 |
| 키 하나를 여러 명이 돌려쓰기 | ⚠️ 서버 좌석 카운트로 2대 제한. **동시 요청 경쟁 조건(H-1) 수정 후에만 유효** |
| 증서 복사 + **MachineGuid 조작** | ❌ 막지 못함 — 관리자 권한으로 레지스트리의 MachineGuid를 원본값으로 바꾸면 지문이 그대로 재현된다. 지문 salt·입력 포맷이 평문 JS에 노출되어 있다 |
| **키 정지(revoke) 후 이미 활성화된 PC** | ❌ 막지 못함 — 증서에 만료가 없고 앱이 활성화 후 서버에 재접속하지 않는다. revoke는 **신규 활성화만** 차단한다 |
| **설치 폴더 JS 직접 수정** | ❌ 막지 못함 — 후속 과제(asar 전환·난독화) |

세 가지를 일부러 막지 않기로 한 이유:

- **MachineGuid 조작** — 메인보드·디스크 시리얼을 쓰면 막을 수 있지만, 포맷·부품 교체 때마다 정품이 풀려 지원 문의가 폭증한다(4장 결정). MachineGuid 변경은 OS 전역 부작용이 있어 자연스러운 억지력도 있다.
- **revoke 후에도 동작** — 막으려면 주기적 온라인 재검증이 필요한데, 이는 현장 오프라인 점검 환경이라는 제품 전제를 깬다.
- **rate limit 실효성** — Workers는 요청을 여러 isolate에 분산하고 유휴 isolate를 수시로 파기하므로, isolate 로컬 메모리 기반 카운터는 "IP당 · isolate당 · isolate 수명당" 제한이 된다. 다만 80비트 난수 + 체크섬만으로 무차별 대입이 불가능하므로 실제 손실은 D1 쿼터 방어뿐이다.

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
- [x] 클라이언트 인증 모듈 — `electron/license/` 6개 모듈 + `js/license.js` + 체험판 게이트 완료.
      앱 실행 검증(체험판/정품/위조/타기기/오프라인 재실행/모의서버 활성화) 통과. 공개키는 자리표시자 상태
- [x] 활성화 서버 — 코드 완성·로컬 시나리오 검증 완료 (`server/`). 실제 Cloudflare 배포는 미실행 (계정 없음, 사용자 작업)
- [x] 보안 검수 — `license-auditor` 완료 (2026-08-07). **높음 2건 · 보통 6건 · 낮음 8건** 검출 → 12장 참조
- [ ] 검수 지적사항 수정 (진행 중)
- [ ] 빌드 검증
- [ ] Cloudflare 계정 생성 및 배포 (사용자 작업 필요)
- [ ] **배포 후 원격 D1로 실환경 재검증** (아래 11-3) ← 생략 금지

### 11-1. 운영자가 배포 전에 반드시 해야 할 일

1. `cd server && npm run genkeys` 실행
2. 출력된 **공개키**를 `electron/license/pubkey.js` 의 `PUBLIC_KEY` 에 붙여넣기
   (교체 전까지 앱은 항상 체험판으로 동작하고 콘솔에 경고 배너가 뜬다)
3. 출력된 **개인키**를 Cloudflare Workers Secret `CERT_PRIVATE_KEY` 에 등록 (저장소에 절대 커밋 금지)
4. `electron/license/config.json` 의 `activationUrl` 에 배포된 활성화 엔드포인트 주소,
   `supportContact` 에 문의처 입력 (환경변수 `NUMDRAW_ACTIVATION_URL` / `NUMDRAW_SUPPORT_CONTACT` 로도 주입 가능)

### 11-2. 클라이언트 ↔ 서버 계약 확정 사항 (양쪽 코드로 상호 검증 완료)

| 항목 | 확정값 |
|---|---|
| 증서 서명 대상 | payload JSON 원문 바이트 (`server/src/core/cert.js`). 클라이언트는 JWS 방식(base64url 세그먼트)도 함께 허용 |
| 공개키 인코딩 | raw 32바이트 **base64url** (`genkeys.mjs` 출력 형식). PEM·SPKI DER 도 자동 인식 |
| 키 체크섬 | 위치 가중 다항식 해시 mod 32⁴ — `server/src/core/keygen.js` 와 동일 구현, 무작위 키 300개 교차 검증 일치 |
| 클라이언트 전송 키 형식 | `ND2-XXXXX-XXXXX-XXXXX-XXXXX` (하이픈 포함). 서버 `parseAndValidate` 통과 확인 |

### 11-3. 배포 후 실환경 재검증 (필수 — 생략 금지)

보안 검수에서 **서버 코드가 이 PC에서 단 한 번도 실제 Cloudflare 런타임으로 실행된 적이 없다**는 점이 지적됐다. 이 개발 PC에서는 `wrangler dev`가 workerd access violation(0xc0000005)으로 기동하지 않아, 검증을 Node `node:sqlite` 기반 D1 호환 어댑터로 대체했다. **실제 workerd·실제 D1·실제 HTTP 계층은 검증되지 않았다.**

검출된 높음 2건 모두 "정상 시나리오를 실환경에서 한 번씩만 돌려봤으면 잡혔을" 결함이었다. 배포 직후 아래 4개를 반드시 손으로 확인한다.

| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 신규 키로 PC 1대 활성화 | 200, 증서 발급, 앱이 정품 전환 |
| 2 | 같은 키 · 같은 기기 재요청 | 200, **좌석 안 늘고** 증서 재발급 |
| 3 | 같은 키 · 3대째 기기 | 409 `SEAT_LIMIT` |
| 4 | **좌석 반납 후 같은 기기 재활성화** | 200 (500 `INTERNAL_ERROR` 가 뜨면 H-2 미수정) |

추가로 H-1(경쟁 조건) 확인: 서로 다른 기기 5건을 **동시** 발사해 정확히 2건만 성공하는지 본다.

---

## 12. 보안 검수 결과 (2026-08-07, `license-auditor`)

### 이상 없음으로 실제 확인된 것

증서 검증 핵심부는 정확하게 구현됐다. 검수자가 실제 Ed25519 키쌍으로 서버 서명 → 클라이언트 검증을 교차 실행해 확인했다.

- 서명 대상 바이트가 서버·클라이언트 양쪽에서 일치 (계약 실제로 맞음)
- 서명 검증 **전에** payload를 신뢰하는 경로 없음
- `features` 폴백이 6개 경로 전부 **제한 있는 쪽**으로 떨어짐
- 자리표시자 공개키 상태에서 "통과"로 처리되는 경로 **0건**
- `license.json` 손편집·단순 복사로는 통과 불가
- 시크릿 유출 **0건** (전체 커밋 이력 대상 검사)
- 서버 전송 데이터에 개인정보 없음 — 키·기기지문 해시·제품명·버전 4개뿐

### 조치 대상

| ID | 심각도 | 내용 | 조치 |
|---|---|---|---|
| H-1 | 높음 | 좌석 카운트 경쟁 조건 — 동시 요청으로 2대 제한 붕괴 | ✅ **수정됨** (원자적 조건부 INSERT). ⚠️ 실행 검증 미실시 |
| H-2 | 높음 | 좌석 반납 후 같은 기기 영구 차단 (UNIQUE 위반 → 500) | ✅ **수정됨** (부분 유니크 인덱스). ⚠️ 실행 검증 미실시 |
| M-1 | 보통 | revoke가 이미 활성화된 PC에 무효한데 README가 반대로 안내 | ❌ 미수정 — `server/README.md:141` |
| M-2 | 보통 | `/admin/*` 에 rate limit·토큰 길이 검사 없음 | ❌ 미수정 |
| M-3 | 보통 | rate limit이 Workers isolate 구조상 실효성 낮음 | 9장 문구 정정 (완료) |
| M-4 | 보통 | MachineGuid 조작 시 지문 복제 가능 — 9장이 과장 | 9장 문구 정정 (완료) |
| M-5 | 보통 | 서버 코드 실행 검증 공백 | 11-3 실환경 재검증으로 대응 |
| M-6 | 보통 | 자리표시자 상태로 빌드가 성공 → 전 구매자 활성화 실패 위험 | ❌ 미수정 — `prebuild` 스크립트 없음 |
| L-2 | 낮음 | `reg.exe` 절대경로 미지정 (CWD 하이재킹) | ✅ **수정됨** |
| L-3 | 낮음 | 서명 대상 이중 허용 — 불필요한 공격 표면 | ✅ **수정됨**. ⚠️ 서버 증서 통과 재확인 필요 |
| L-5 | 낮음 | `/api/activate` CORS `*` 불필요 | ❌ 미수정 — `server/src/index.js:15` |
| L-8 | 낮음 | `admin.js` 키 검증 결과 미확인 사용 | ❌ 미수정 |

> 🔴 **2026-08-07 사용 한도로 작업 중단.** 재개 절차와 정확한 잔여 작업은 `유료화_작업재개_인수인계.md` 참조.
> 코드 변경분은 **미커밋 상태**이므로 `git checkout .` / `git reset --hard` 금지.
| L-1 | 낮음 | 체험판 1장 제한이 작업공간별 적용 (외관+장비 = 실질 2장) | **조치 안 함** — 워터마크는 양쪽 다 찍혀 라이선스 우회 아님 |
| L-4 | 낮음 | 관리자 화면 CSRF (쓰레기 키 행 생성 가능, 키 탈취 불가) | 보류 |
| L-6 | 낮음 | `activationUrl` https 강제 없음 | 보류 |
| L-7 | 낮음 | `sidebar.js` innerHTML 이스케이프 누락 (기존 코드 이슈) | 별도 과제 |
