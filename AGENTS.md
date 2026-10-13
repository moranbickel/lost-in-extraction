# Contributing to Paper Cuts

Paper Cuts checks whether specific facts survive PDF text extraction. A few rules
keep it honest.

- Use invented fixture content only. Never add real documents or personal data.
- Preserve raw parser output. An adapter must never correct, repair or normalize
  what a parser returns; that would make a failed extraction look successful.
- Do not make accuracy claims. The cases are deliberately chosen stress tests,
  not a measure of how good a parser is overall.
- Record adapter settings and capability limits in the report.
- Keep text UTF-8, LF line endings, and the code dependency-light: Node.js for the
  runner, Python adapters for the PDF libraries, plain HTML, CSS and JavaScript
  for the report.
- Back up generated artifacts before replacing them. `scripts/build_fixtures.py
  --rebuild` does this. Look at every changed PDF preview.
- Write a failing test first. Say in the test what it protects.

Before sending a change run `npm test`, `npm run check` (exit 1 is expected: some
stress cases fail on purpose) and `npm run test:ui`. Run the full check before the
browser tests, which read the newest report.

CI must stay free of deployment and publishing steps, and every action in the
workflow stays pinned to a full commit SHA.
