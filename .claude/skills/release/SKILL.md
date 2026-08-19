---
name: release
description: NumDraw 설치파일을 빌드해서 R2에 올리고 홈페이지 다운로드 링크·버전 표기까지 맞춘 뒤 Cloudflare Pages에 배포한다. "배포해줘", "버전 올려줘", "1.2.5 릴리즈", "설치파일 새로 올려줘", "홈페이지 버전이 안 맞아", "배포 다시 해줘", "저번 배포 이어서" 같은 요청이면 반드시 이 스킬을 사용할 것. 배포 절차의 일부만(업로드만·링크만) 요청해도 이 스킬로 처리한다.
---

# /release — 릴리즈·배포

## 이 스킬이 지키는 것

**`package.json` 버전 = R2 파일명 버전 = 홈페이지 표기 버전.** 세 값이 같아야 배포가 끝난 것이다.
하나라도 다르면 사용자는 홈페이지에서 본 것과 다른 프로그램을 받는다.

## Phase 0 — 컨텍스트 확인

먼저 지금이 어떤 상황인지 판별한다. 판별 없이 1단계부터 시작하면 이미 올라간 파일을
다시 올리거나, 끊긴 지점을 지나쳐 버린다.

```bash
grep '"version"' package.json                       # 현재 버전
ls -la dist/*.exe 2>/dev/null                       # 빌드 산출물이 이미 있나
grep -n "DOWNLOAD_URL" web/purchase.html            # 홈페이지가 가리키는 버전
grep -rn "1\.2\.[0-9]" web/ | grep -v guide.html    # 표기 버전 분포
```

| 상황 | 진입 지점 |
|---|---|
| 세 값이 이미 일치 + 새 버전 요청 없음 | 배포할 것 없음을 보고하고 종료 |
| 세 값이 어긋남 (버전 올림 없이) | **4단계(업로드)부터** — 어긋난 지점만 맞춘다 |
| 새 버전 요청 | 1단계부터 |
| 이전 배포가 중간에 끊김 | 끊긴 단계부터 이어간다 |

## Phase 1 — 실행

`release-pilot` 에이전트로 실행한다.

```
Agent(subagent_type: "release-pilot", model: "opus",
      prompt: "<버전> 배포. Phase 0 판별 결과: <진입 지점>. 변경 요약: <...>")
```

에이전트가 밟는 9단계는 `.claude/agents/release-pilot.md` 에 있다. 요약:

1. `package.json` 버전 수정
2. `npm run checkrelease` — 실패하면 **중단** (공개키·활성화 주소 미주입 상태로 팔면 고객이 활성화 못 함)
3. `npm run build` → `dist/NumDraw Setup <ver>.exe`
4. **[승인]** R2 업로드
   `cd server && npx wrangler r2 object put numdraw-download/NumDraw-Setup-<ver>.exe --file "../dist/NumDraw Setup <ver>.exe" --remote`
5. `web/purchase.html` — `DOWNLOAD_URL`(약 455행) + `dl__file` 표기(약 393행: 파일명·용량)
6. `grep -rn "1\.2\.[0-9]" web/` 로 남은 표기 전부 갱신
7. **[승인]** `cd server && npx wrangler pages deploy ../web --project-name numdraw --branch main --commit-dirty=true`
8. 공개 URL 응답·파일 크기 확인
9. 릴리스 노트 초안

## Phase 2 — 배포 전 게이트

4단계(첫 승인) 앞에서 **`qa-runner` 결과를 확인한다.** 최근 점검 기록이 없으면
`/qa` 를 먼저 돌리도록 안내한다. 실패 항목이 있는데 배포하려면 사용자에게 명시적으로 확인받는다.

## Phase 3 — 보고

```
버전      : 1.2.4
빌드      : dist/NumDraw Setup 1.2.4.exe (79.4MB)
R2        : https://pub-....r2.dev/NumDraw-Setup-1.2.4.exe (200, 79.4MB)
홈페이지  : purchase.html DOWNLOAD_URL·dl__file / index·product·purchase 버전표기
Pages     : 배포 완료
세 값 일치: ✅
확인 못 함: 없음
```

배포 기록은 `사업화_실행계획.md` 의 해당 항목(S0-1 등)에 체크와 근거 한 줄로 남긴다.

## 자주 나는 문제

| 증상 | 원인·대응 |
|---|---|
| `checkrelease` 실패 | 공개키·`activationUrl`·`supportContact` 중 빈 값. 사용자에게 요청, 우회 금지 |
| `wrangler` 인증 오류 | 사용자가 별도 터미널에서 `npx wrangler login` (에이전트가 대신하지 않는다) |
| 업로드는 됐는데 404 | 버킷 공개(dev-url) 설정 확인 |
| 배포 후에도 옛 화면 | 캐시. 5분 뒤 재확인 |

## 테스트 시나리오

- **정상**: "1.2.5로 배포해줘" → Phase 0 에서 새 버전 판별 → 1~9단계 → 세 값 일치 보고
- **부분**: "홈페이지 버전이 설치파일이랑 안 맞아" → Phase 0 에서 불일치 감지 → 4단계부터
- **에러**: 가드 실패 → 빌드 중단, 빈 설정값 보고, 사용자 조치 안내

## 금칙

- 승인 없이 R2 업로드·Pages 배포하지 않는다.
- `NUMDRAW_ALLOW_UNCONFIGURED_BUILD=1` 로 판매용 빌드를 만들지 않는다.
- R2 의 이전 버전 파일을 삭제하지 않는다.
- 시크릿 관련 명령(`genkeys`, `wrangler secret put`)을 실행하지 않는다.
