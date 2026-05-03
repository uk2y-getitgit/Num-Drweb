---
name: warn-complex-code-edit
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.js$
  - field: new_text
    operator: regex_match
    pattern: (for\s*\(|while\s*\(|if\s*\(.*\{|function|=>|class\s+)
---

⚠️ **복잡한 로직이 변경되었습니다.**

JavaScript 파일에서 루프, 조건문, 함수 등 복잡한 코드를 수정하고 있습니다.

**확인사항:**
- 변경 이유가 명확한가요?
- 비직관적인 로직이 있다면 **한국어 한 줄 주석** 추가를 권장합니다
- 예: `// P1 클릭 후 마우스 이동 시 실시간 미리보기`

**주석 가이드:**
- 복잡한 알고리즘이나 숨겨진 제약사항을 설명
- 왜 이렇게 구현했는지 배경 설명
- "WHAT"이 아닌 "WHY"에 집중
