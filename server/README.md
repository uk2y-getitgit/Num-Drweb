# NumDraw 활성화 서버 — 운영 가이드

이 문서는 **개발자가 아닌 운영자**가 그대로 따라 할 수 있도록 명령어와 화면 흐름을
전부 적어 놓은 문서다. 코드를 이해할 필요는 없다.

- 인프라: Cloudflare Workers + D1 (무료 요금제로 시작 가능)
- 결제: 무통장입금 수동 처리 (이 서버는 결제 자동화를 하지 않는다)
- 좌석: 라이선스 1개당 PC 2대까지 활성화 가능

---

## 0. 최초 1회만 하는 준비 작업

### 0-1. Cloudflare 계정 만들기 (사용자 작업)

1. https://dash.cloudflare.com/sign-up 에서 무료 계정 생성
2. 로그인까지만 하면 된다. 이후 명령어는 터미널에서 로그인 인증을 안내한다.

### 0-2. 이 폴더에서 패키지 설치

터미널(명령 프롬프트/PowerShell)을 열고 `server` 폴더로 이동한 뒤:

```
npm install
```

### 0-3. Cloudflare 로그인

```
npx wrangler login
```

브라우저 창이 뜨면 Cloudflare 계정으로 로그인하고 "Allow"를 누른다.

### 0-4. D1 데이터베이스 생성

```
npx wrangler d1 create numdraw-license
```

실행하면 아래와 비슷한 출력이 나온다:

```
[[d1_databases]]
binding = "DB"
database_name = "numdraw-license"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**`database_id` 값을 복사**해서 `server/wrangler.toml` 파일의 `database_id = "00000000-..."`
부분을 방금 복사한 값으로 바꿔 저장한다. (이 파일은 시크릿이 아니므로 저장소에 커밋해도 안전하다.)

### 0-5. 데이터베이스에 표(스키마) 만들기

```
npx wrangler d1 execute numdraw-license --remote --file=schema.sql
```

### 0-6. 서명 키쌍 생성

```
npm run genkeys
```

화면에 **공개키**와 **개인키**가 출력된다. 화면 안내를 그대로 따라간다:

1. 출력된 **공개키**를 복사해 `electron/license/pubkey.js`(앱 쪽 파일, license-core 담당)에
   붙여넣는다 — 이 값은 유출돼도 안전하다.
2. 아래 명령으로 **개인키**를 Cloudflare 서버에만 등록한다 (저장소에는 절대 넣지 않는다):

   ```
   npx wrangler secret put CERT_PRIVATE_KEY
   ```

   프롬프트가 뜨면 화면에 출력된 개인키 값을 붙여넣고 Enter.

3. 관리자 화면 접속 비밀번호(토큰)도 등록한다:

   ```
   npx wrangler secret put ADMIN_TOKEN
   ```

   > **반드시 24자 이상**의 임의 문자열이어야 한다. 24자 미만이면 서버가 관리자 화면을
   > 열지 않고 `503`을 돌려준다 (약한 비밀번호로 발급 백오피스가 뚫리는 것을 막기 위함).
   > 값이 떠오르지 않으면 PowerShell에서 아래로 만든다:
   >
   > ```
   > [Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))
   > ```

   비밀번호 관리 프로그램에 이 값을 저장해 둔다. 분실하면 `wrangler secret put ADMIN_TOKEN`을
   다시 실행해 새로 정하면 된다.

   로그인을 연속으로 틀리면(IP당 8회) 15분간 잠긴다. 본인이 잠겼다면 15분 기다리거나
   `npm run deploy`로 재배포하면 즉시 풀린다.

4. 터미널 기록(스크롤백)에 개인키가 남아있다. 터미널을 닫거나 화면을 지운다.

### 0-7. 배포

```
npm run deploy
```

배포가 끝나면 `https://numdraw-activation.<계정이름>.workers.dev` 같은 주소가 출력된다.
**이 주소를 적어 둔다** — 이후 모든 작업(키 발급, 대장 조회, 앱 설정)에 사용한다.

이제 서버 준비는 끝났다. 아래부터는 **평상시 운영 절차**다.

---

## 1. 평상시: 입금 확인 후 키 발급하기

1. 브라우저에서 접속: `https://<배포주소>/admin/issue`
2. 브라우저가 로그인 창(아이디/비밀번호)을 띄운다.
   - 아이디: 아무 값이나 입력해도 된다 (검사하지 않음)
   - 비밀번호: 0-6단계에서 등록한 `ADMIN_TOKEN` 값
3. 폼에 구매자 이름 / 이메일 / 메모(입금일·금액) / 최대 대수(기본 2)를 입력하고 "키 발급" 클릭
4. 화면에 뜬 **라이선스 키**(`ND2-XXXXX-XXXXX-XXXXX-XXXXX` 형식)를 복사해 구매자에게 전달한다.
   - **이 화면을 벗어나면 평문 키를 다시 볼 수 없다.** 분실 시 재발급 절차(4장)를 따른다.

## 2. 발급 대장 확인하기

`https://<배포주소>/admin/list` 접속 (같은 로그인 필요).

한 화면에서 다음을 확인할 수 있다:
- 키(마스킹), 구매자, 메모, 좌석 사용 현황(예: 1/2), 상태(사용중/정지됨), 발급일
- 현재 활성화된 기기 목록과 각 기기의 활성화 시각
- 각 행에 **정지** 버튼(이후 활성화 차단 — 5장 참고), 각 기기 옆에 **반납** 버튼(그 기기의 좌석만 반납)

## 3. PC 교체 대응 (좌석 반납)

구매자가 컴퓨터를 바꿔서 좌석이 꽉 찼다고 문의하면:

1. `/admin/list`에서 해당 키를 찾는다.
2. 더 이상 쓰지 않는 기기 옆의 **반납** 버튼을 클릭한다.
3. 구매자에게 새 PC에서 다시 활성화하라고 안내한다 (좌석이 1개 비워졌으므로 성공한다).

> 참고: 같은 키로 **같은 기기**에서 재설치 후 다시 활성화하는 것은 좌석을 소모하지 않는다.
> 좌석 반납은 **다른 기기로 옮길 때만** 필요하다.

## 4. 키 분실 / 유출 시 재발급

이 서버는 평문 키를 저장하지 않으므로(보안 설계), "키 찾아주기"가 불가능하다. 대신:

1. `/admin/list`에서 기존 키를 **정지**한다. (이미 활성화된 PC는 계속 동작한다 — 5장 참고)
2. `/admin/issue`에서 같은 구매자로 **새 키를 발급**한다 (메모에 "재발급, 사유: ..." 기록 권장).
3. 새 키를 구매자에게 전달한다.

## 5. 부정 사용(키 돌려쓰기 등) 의심 시 — ⚠ 정지 버튼의 실제 효과

`/admin/list`의 **정지** 버튼은 그 키의 `status`를 `revoked`로 바꾼다. 그 결과:

| 대상 | 정지 후 동작 |
|---|---|
| **앞으로의** 활성화 요청 (새 PC, 재설치, 좌석 반납 후 재활성화) | 즉시 `REVOKED`로 거부된다 ✅ |
| **이미 활성화를 마친 PC** | **계속 정품으로 동작한다** ❌ |

이미 활성화된 PC가 계속 동작하는 것은 버그가 아니라 **하이브리드 인증 설계의 결과**다.
활성화가 끝나면 그 PC에는 서명된 증서 파일이 저장되고, 이후 실행은 인터넷 없이
증서 서명만 검사한다(= 서버에 물어보지 않는다). 서버가 키를 정지했다는 사실을
그 PC는 알 방법이 없다. 증서에는 만료 시각도 없어서 시간이 지나도 자동으로 풀리지 않는다.

**따라서 정지는 "피해 확산 차단"이지 "이미 나간 사용 회수"가 아니다.**
구매자에게 "정지했으니 이제 못 쓴다"고 안내하면 사실과 다르다.

이미 활성화된 PC까지 막고 싶다면 다음 중 하나가 필요하며, 현재 구현에는 **없다**:
- 증서에 만료일을 넣고 주기적으로 재발급받게 한다 (오프라인 사용성이 나빠진다)
- 앱이 실행할 때마다 서버에 폐기 여부를 확인한다 (인터넷 필수가 되어 하이브리드 인증 전제가 깨진다)

실무 대응은 이렇게 한다:
1. 해당 키를 **정지**해 추가 확산을 막는다.
2. 필요하면 새 키를 발급해 재판매한다.
3. 이미 나간 설치본에 대해서는 **계약·환불 등 계정 외 수단**으로 처리한다.

---

## 6. 앱(Electron) 쪽에 알려줘야 할 정보

license-core 담당 에이전트/개발자에게 아래 2가지를 전달한다:

| 항목 | 값 |
|---|---|
| 활성화 서버 주소 | `https://<배포주소>/api/activate` |
| 공개키 | `npm run genkeys` 출력값 (이미 `electron/license/pubkey.js`에 넣었다면 전달 불필요) |

---

## 7. 파일 구조와 각 파일의 역할

```
server/
  package.json         npm 스크립트 정의 (dev/deploy/genkeys/db:init 등)
  wrangler.toml         Cloudflare Workers 설정 (시크릿 없음, D1 바인딩만 포함)
  schema.sql             D1 테이블 정의 (licenses, activations)
  scripts/
    genkeys.mjs          Ed25519 키쌍 생성 스크립트 (최초 1회 실행)
  src/
    index.js             요청 라우팅만 담당 (URL·메서드 분기)
    util.js               HTML/JSON 응답 헬퍼, 관리자 Basic Auth 검사
    core/
      keygen.js          플랫폼 비의존 순수 JS — 키 생성·정규화·체크섬·해시·마스킹
      cert.js            플랫폼 비의존 순수 JS — Ed25519 증서 서명·검증
    routes/
      activate.js        POST /api/activate — 활성화 처리, 좌석 계산, rate limit
      admin.js           /admin/issue, /admin/list, /admin/revoke, /admin/release
```

`core/` 폴더는 Cloudflare 전용 API를 쓰지 않는 순수 JS다. 나중에 다른 호스팅으로
옮기더라도 이 두 파일은 그대로 재사용할 수 있다.

---

## 8. API 계약 (요약)

전체 스펙은 저장소 루트의 `유료화_Phase1_구현계획.md` 3장·7장 참고. 요약:

**POST /api/activate**
```
요청: { "key": "ND2-...", "device": "<hex 64>", "product": "numdraw", "app_version": "1.3.0" }
성공: { "ok": true, "cert": "<payload>.<sig>", "seats_used": 1, "max_seats": 2 }
실패: { "ok": false, "code": "INVALID_KEY|REVOKED|SEAT_LIMIT|RATE_LIMITED|BAD_REQUEST", "message": "..." }
```

같은 키 + 같은 기기로 재요청하면 좌석을 추가로 쓰지 않고 증서만 재발급한다 (재설치 대응).

**관리자 엔드포인트** (모두 Basic Auth, 비밀번호 = `ADMIN_TOKEN`)
- `GET /admin/issue`, `POST /admin/issue` — 발급 폼/처리
- `GET /admin/list` — 발급 대장 HTML
- `POST /admin/revoke` — 키 정지 (`key_hash` 필드)
- `POST /admin/release` — 좌석 반납 (`key_hash`, `activation_id` 필드)

---

## 9. 로컬 개발(`wrangler dev`) 관련 — 이번 환경에서 확인된 제약

이 프로젝트를 만든 Windows 환경에서는 `npx wrangler dev`(및 `wrangler d1 execute --local`)를
실행하면 workerd 네이티브 바이너리가 **access violation(0xc0000005)** 으로 즉시 죽는 현상이
있었다 — wrangler 3.x, 4.x 모두 동일, 경로(한글·괄호 포함 여부)와도 무관했다.
Cloudflare 측 안내는 "Microsoft Visual C++ 재배포 패키지(VC++ Redistributable)를 최신으로
업데이트하라"는 것이다:

https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist

다른 PC 또는 VC++ Redistributable 업데이트 후에는 정상 동작할 가능성이 높다. 이 문제는
**로컬 개발 도구 실행 환경의 문제이며, 배포된 실제 서비스(Cloudflare 원격 서버)의 동작과는
무관하다** — Cloudflare의 실제 엣지 서버는 이 로컬 바이너리를 쓰지 않는다.

로컬에서 dev 서버를 못 띄우는 대신, 이 저장소의 라우트 코드는 Node 내장 `node:sqlite`로
D1을 흉내 낸 테스트 하네스로 전체 시나리오(키 발급→활성화→2대 성공→3대 거부→같은 기기
재요청→revoke→INVALID_KEY→관리자 인증 거부)를 실제 코드 그대로 검증했다. 자세한 내용은
작업 보고를 참고.

`wrangler dev`가 정상 동작하는 환경이라면 다음으로 로컬 실행이 가능하다:

```
npm run db:init:local
npm run dev
```
