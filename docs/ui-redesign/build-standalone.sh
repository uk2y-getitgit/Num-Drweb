#!/usr/bin/env bash
# mockup.html + ui-tokens.css → mockup-standalone.html (CSS 내장 단일 파일)
#
# mockup-standalone.html 은 생성물이다. 직접 고치지 말고 원본을 고친 뒤 이 스크립트를 다시 돌린다.
#   bash docs/ui-redesign/build-standalone.sh
set -e
cd "$(dirname "$0")"

FONTS='https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap'

{
  echo '<title>Quickspect 제도 콘솔</title>'
  echo "<link rel=\"stylesheet\" href=\"$FONTS\">"
  echo '<style>'
  cat ui-tokens.css
  cat <<'CSS'

/* ── [L] 단일 파일 배포용 오버라이드 ───────────────────────────────────────
   실제 앱은 창 전체를 쓰지만, 이 예시는 좁은 화면에서도 열린다.
   가로 스크롤은 페이지가 아니라 이 틀 안에서 일어나게 한다. */
body{display:block; height:100dvh; overflow-x:auto; overflow-y:hidden;
     background:var(--c-900); color:var(--t-0)}
#viewport{display:flex; flex-direction:column; height:100%; min-width:1180px}
CSS
  echo '</style>'
  echo '<div id="viewport">'
  awk '/<body>/{f=1;next} /<\/body>/{f=0} f' mockup.html
  echo '</div>'
} > mockup-standalone.html

echo "생성 완료: mockup-standalone.html ($(wc -c < mockup-standalone.html) bytes)"
