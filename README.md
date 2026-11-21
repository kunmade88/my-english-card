# my-english-card (Polyglot Master)

개인용 어학 카드 앱. https://kunmade88.github.io/my-english-card/

- 오프라인 동작 (서비스 워커 `sw.js`, 외부 CDN 없음)
- 🎙️ 발음 연습: 내 목소리 녹음 · 원어민(기기 음성)과 번갈아 듣기 · 파형 · 단어별 자동 판정(선택, 온라인)
- 🇺🇸/🇬🇧 영어 억양 전환
- FIND: 유튜브·글 주소나 원문에서 자주 쓰는 표현 추출 → 카드 저장 (Gemini API 키 또는 채팅 복사·붙여넣기)
- LIST → BACKUP 내보내기/가져오기 (카드 + 녹음)

## 수정할 때
- 파일을 바꾸면 `sw.js` 의 `VERSION` 을 올려야 휴대폰에 새 버전이 반영됩니다.
- `index.html` 에 새 Tailwind 클래스를 쓰면 CSS 를 다시 빌드하세요:
  `npx tailwindcss@3.4.17 -i src/input.css -o assets/app.css --minify`
