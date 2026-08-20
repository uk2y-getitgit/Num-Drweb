---
name: android-release
description: 사진번호 자동입력 안드로이드 앱(pic-numinc)의 빌드와 플레이스토어 배포를 처리한다. 릴리스 서명 AAB·APK 빌드, 앱 버전 올리기, Play Console 업로드 준비, 스토어 등재 상태 확인, 키스토어 준비 안내를 담당한다. "안드로이드 빌드해줘", "APK 만들어줘", "앱 버전 올려줘", "플레이스토어 올려줘", "스토어 등록 어디까지 됐어", "앱 서명 어떻게 해" 같은 요청이면 반드시 이 스킬을 사용할 것.
---

# /android-release — 안드로이드 앱 빌드·배포

## 이 스킬이 지키는 것

**서명되지 않은 산출물을 만들어 놓고 "빌드 완료"라고 말하지 않는다.**
이 프로젝트의 `app/build.gradle` 은 서명 키가 없어도 릴리스 빌드를 **경고 없이 성공시킨다.**
그 파일은 Play Console 이 거부한다. 그래서 이 스킬은 빌드 **전에** 키를 확인하고,
빌드 **후에** 서명을 명령으로 검증한다.

**대상 저장소가 다르다.** 여기는 `Num-Drweb` 이 아니다.

```
프로젝트  D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/pic-numinc
저장소    github.com/uk2y-getitgit/pic-numinc  (master)
패키지명  comJuLab.PicNuminc      ← Play Console 등록값. 바꾸지 않는다
빌드 파일 app/build.gradle (Groovy)  ← .kts 는 쓰이지 않는다. 고쳐도 반영 안 됨
```

## Phase 0 — 컨텍스트 확인

지금이 어떤 상황인지부터 판별한다. 이 앱은 데스크톱과 달리 **서명 준비 여부**가 모든 것을 가른다.

```bash
P="D:/시스템운영-절대지우지마시오(26년)/user/Desktop/AI활용/pic-numinc"
git -C "$P" fetch --prune && git -C "$P" status -sb | head -2   # 원격과 어긋났나
grep -n "applicationId\|versionCode\|versionName" "$P/app/build.gradle"
grep -c "KEYSTORE_PATH" "$P/local.properties"                    # 0 이면 서명 불가
ls "$P/app/build/outputs/bundle/release" "$P/app/build/outputs/apk/release" 2>/dev/null
```

| 상황 | 진입 지점 |
|---|---|
| `local.properties` 에 `KEYSTORE_*` 없음 | **Phase 1(키스토어 준비)** — 사람이 해야 하는 단계다. 1-A 와 1-B 중 어디인지부터 가른다 |
| 키는 있고 새 버전 요청 | Phase 2 (2단계부터) |
| 이미 빌드된 산출물이 있고 업로드만 남음 | Phase 2 의 4단계(서명 검증)부터 |
| "스토어 등록 어디까지 됐나" | Phase 4 (상태 확인)만 수행 |
| 원격보다 뒤처짐 | 먼저 `git -C "$P" merge --ff-only origin/master` |

## Phase 1 — 키스토어 준비 (사람이 수행)

**에이전트가 대신 만들지 않는다.** 키스토어 비밀번호는 사람이 직접 입력해야 한다.

**먼저 갈래를 판별한다.** Play Console → 테스트 및 출시 → 앱 무결성 → Play 앱 서명 화면에서
인증서가 몇 개 보이는지가 기준이다.

| 화면에 보이는 것 | 뜻 | 갈 길 |
|---|---|---|
| 앱 서명 키 하나만 | 업로드한 적 없음 | **1-A. 새 키 생성** 후 바로 업로드 |
| 앱 서명 키 + 업로드 키 | 이미 서명본을 올렸음 | 그때 쓴 `.jks` 를 찾아야 한다. 없으면 **1-B. 업로드 키 재설정** |

**이 프로젝트의 현재 상태(2026-08-20 확인): 인증서 2개가 등록되어 있고, 그 키를 만든 PC는
정리되었으며, 이 PC의 C·D·E 드라이브와 저장소 히스토리 어디에도 `.jks` 가 없다.**
따라서 기본 경로는 **1-B** 다. 1-A 를 먼저 권하지 말 것.

### 1-A. 새 업로드 키 생성

사용자에게 아래를 안내한다. **이 명령은 별도 터미널 창(PowerShell 등)에서 직접 실행하도록 권한다.**
`keytool` 은 비밀번호와 이름·조직을 콘솔에서 대화식으로 물으므로, 세션 안에서 `!` 로 실행하면
입력 프롬프트에 답할 수 없어 중간에 멈춘다.

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
"$JAVA_HOME/bin/keytool" -genkeypair -v \
  -keystore "<저장소 밖 안전한 경로>/numinc-release.jks" \
  -alias numinc -keyalg RSA -keysize 2048 -validity 10000
```

그다음 `local.properties` 에 네 줄을 **사용자가 직접** 추가한다 (이 파일은 커밋되지 않는다).

```
KEYSTORE_PATH=<위에서 만든 .jks 절대경로>
KEYSTORE_PASSWORD=<입력한 비밀번호>
KEY_ALIAS=numinc
KEY_PASSWORD=<입력한 키 비밀번호>
```

안내할 때 **반드시 함께 말할 것**: 이 `.jks` 파일과 비밀번호를 별도로 백업해 둘 것,
저장소 폴더 안에 두지 말 것, 이 값들을 대화창에 붙여넣지 말 것.

### 1-B. 업로드 키 재설정 (기존 업로드 키를 잃어버렸을 때)

**앱은 죽지 않는다.** 앱 서명 키는 구글이 보관하므로 이미 설치한 사용자에게는 아무 영향이 없다.
바뀌는 것은 "앞으로 무엇으로 서명해 올리느냐"뿐이다.

1. 1-A 절차로 **새 키스토어를 만든다.** 유효기간은 넉넉히 준다 (`-validity 10000`).
2. 새 키의 인증서를 PEM 으로 내보낸다 — 이 명령도 비밀번호를 물으므로 사람이 실행한다.

```bash
"$JAVA_HOME/bin/keytool" -export -rfc   -keystore "<새 .jks 경로>" -alias numinc -file upload_certificate.pem
```

3. Play Console → 테스트 및 출시 → 앱 무결성 → Play 앱 서명 → **업로드 키 재설정 요청**
   (메뉴가 안 보이면 도움말 → 지원팀 문의에서 "업로드 키 분실"로 요청한다).
   위 `upload_certificate.pem` 을 첨부한다.
4. 구글 승인까지 보통 **1~2 영업일**이 걸린다. 승인 전에는 새 키로 서명한 파일이 거부된다.
   승인 알림을 받은 뒤에 빌드·업로드를 진행한다.

**이 단계에서 사람에게 확인받을 것:** 새 키를 만들기 전에, 옛 `.jks` 가 정말 없는지
마지막으로 한 번 더 확인하도록 권한다 — 메일 첨부, 클라우드 드라이브, 정리한 PC 의
분리 보관된 저장장치가 흔한 소재다. 찾으면 재설정 없이 그대로 쓸 수 있다.

## Phase 2 — 빌드

`android-pilot` 에이전트로 실행한다.

```
Agent(subagent_type: "android-pilot", model: "opus",
      prompt: "<버전> 빌드. Phase 0 판별 결과: <진입 지점>. 산출물 형식: aab|apk. 변경 요약: <...>")
```

에이전트가 밟는 단계는 `.claude/agents/android-pilot.md` 에 있다. 요약:

1. 원격 동기화 확인
2. `app/build.gradle`(Groovy) 의 `versionCode` +1, `versionName` 갱신
3. `./gradlew bundleRelease`(스토어용 .aab) 또는 `./gradlew assembleRelease`(직접 배포용 .apk)
4. `apksigner verify --print-certs` 로 **서명 실제 확인** — 여기서 통과 못 하면 실패로 보고
5. 산출물 경로·크기 보고

## Phase 3 — 업로드 (사람이 수행)

Play Console 업로드와 게시는 사람이 브라우저에서 한다. 스킬은 무엇을 어디에 올릴지 안내만 한다.
등재 정보 중 코드로 확인 가능한 것은 미리 점검해 둔다.

- 개인정보처리방침 페이지(`docs/privacy-policy.html`, GitHub Pages) 가 실제로 응답하는지
- 스토어 등재용 아이콘·스크린샷 자산(`Icon.png` · `shot01.jpg` 등) 이 저장소에 있는지
- `versionCode` 가 직전 업로드분보다 큰지

## Phase 4 — 상태 확인

스토어 주소가 404 를 준다고 해서 앱이 없다고 단정하지 않는다. **게시 전·심사 중·비공개 트랙은
모두 404 로 보인다.** 확정적으로 알려면 사람이 Play Console 화면을 봐야 한다.

```
https://play.google.com/store/apps/details?id=comJuLab.PicNuminc
```

사용자에게 확인을 요청할 때는 Play Console 의 **"대시보드"** 와 **"프로덕션 → 버전"** 두 화면에서
①앱 상태(초안·검토 중·게시됨) ②마지막으로 올라간 versionCode ③미완료 항목 목록을 보고 알려 달라고 한다.

## Phase 5 — 보고

```
저장소    : pic-numinc  master <커밋> (원격과 일치)
버전      : versionCode 2 → 3 / versionName 1.1 → 1.2
서명      : 확인됨 (인증서 지문 앞 8자리) / 또는 "키 없음 — 빌드 중단"
산출물    : app/build/outputs/bundle/release/app-release.aab (12.3MB)
다음 동작 : Play Console → 프로덕션 → 새 버전 만들기 (사람이 수행)
확인 못 함: (있으면 여기에 적는다)
```

배포 기록은 `사업화_실행계획.md` 의 S0-2a 항목에 체크와 근거 한 줄로 남긴다.

## 자주 나는 문제

| 증상 | 원인·대응 |
|---|---|
| `java: command not found` | PATH 에 JDK 가 없다. `export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"` |
| 빌드는 성공했는데 스토어가 거부 | 서명 없는 산출물. `local.properties` 의 네 값을 다시 확인 |
| `.kts` 를 고쳤는데 반영 안 됨 | Gradle 은 Groovy `build.gradle` 을 쓴다. 그쪽을 고친다 |
| `versionCode` 중복 거부 | 같은 정수는 두 번 못 올린다. +1 해서 재빌드 |
| 기기에 두 개가 깔림 | 디버그본은 `.debug` 접미어가 붙은 별개 앱이다. 디버그본을 지운다 |
| 스토어 주소 404 | 게시 전·심사 중일 수 있다. Phase 4 로 확인 |

## 테스트 시나리오

- **정상**: "앱 1.2로 올려서 스토어용 파일 만들어줘" → Phase 0 → 키 확인 → Phase 2 → 서명 검증 → 보고
- **차단**: 키스토어 없음 → Phase 1 안내에서 멈추고 사람에게 넘김 (빌드하지 않는다)
- **조회**: "스토어 등록 어디까지 됐어" → Phase 4 만 수행, 404 를 "없음"으로 해석하지 않음

## 금칙

- 키스토어를 대신 생성하지 않는다. 비밀번호를 출력·기록하지 않는다.
- `local.properties` 를 커밋하지 않는다.
- `.apk` · `.aab` 를 `Num-Drweb` 저장소에 두지 않는다 (2026-08-19 히스토리 재작성 사고).
- `applicationId` 를 바꾸지 않는다.
- Play Console 업로드·게시를 대신 수행하지 않는다.
- 스토어에 게시되지 않은 상태를 홈페이지에 "제공 중"으로 쓰지 않는다.
