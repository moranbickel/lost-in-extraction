# Third-party notices

Paper Cuts itself (code and fixtures) is MIT licensed; see `LICENSE`. Nothing
below is copied into this repository except the font. Python and npm packages
are installed from their registries by `requirements.txt` and `package-lock.json`,
and keep their own licences. The licences below were read from the installed
package metadata at the pinned versions.

## Bundled font

| File | Licence | Notes |
| --- | --- | --- |
| `assets/fonts/NotoSansHebrew.ttf`, `assets/fonts/NotoSansHebrew-Regular.ttf` | SIL Open Font License 1.1 (`assets/fonts/OFL.txt`) | Noto Sans Hebrew, Copyright 2024 The Noto Project Authors. The Regular file is a modified version (static instance, renamed Regular); `assets/fonts/provenance.json` records the source, hashes and the exact transformation. No Reserved Font Name is declared. The font stays under the OFL; it is not covered by the MIT licence. |

## Python packages (`requirements.txt`)

Used when the checks run (the two parser adapters and what they need):

| Package | Version | Licence |
| --- | --- | --- |
| pdfplumber | 0.11.10 | MIT |
| pdfminer.six | 20260107 | MIT |
| pypdf | 6.20.1 | BSD-3-Clause |
| pypdfium2 | 5.14.0 | BSD-3-Clause and Apache-2.0, plus the licences of the bundled PDFium binary and its build dependencies (shipped inside the package) |
| pillow | 12.3.0 | MIT-CMU |
| cryptography | 50.0.2 | Apache-2.0 OR BSD-3-Clause |
| cffi | 2.1.1 | MIT-0 |
| pycparser | 3.11 | BSD-3-Clause |
| charset-normalizer | 3.5.2 | MIT |

Used only to generate the fixtures (`scripts/build_fixtures.py`, `scripts/make_hebrew_font.py`):

| Package | Version | Licence |
| --- | --- | --- |
| reportlab | 5.0.1 | BSD (its package also ships fonts under their own licences, none of which is used here) |
| python-bidi | 0.6.11 | LGPL (the package ships `COPYING.LESSER`, LGPL version 3). Installed from PyPI for fixture generation only; not vendored, modified or redistributed by this repository. |
| fonttools | 4.66.1 | MIT |

## npm packages (`package.json`, `package-lock.json`)

Development dependency only (browser tests of the report page); the runner and
the report have no JavaScript runtime dependencies.

| Package | Version | Licence |
| --- | --- | --- |
| @playwright/test | 1.64.0 | Apache-2.0 |
| playwright, playwright-core (installed with it) | 1.64.0 | Apache-2.0 |
