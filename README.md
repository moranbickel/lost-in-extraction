# Paper Cuts

Checks for facts lost or altered during PDF extraction.

MIT licensed; see [License](#license). The npm package is marked `"private": true`
and is not published to npm.

Paper Cuts runs synthetic PDFs through pypdf and pdfplumber, checks specific
expected text and row associations, and writes an HTML report alongside JSON.
The report contains the source PDFs, rendered previews, raw extracted text,
parser versions, settings, and individual check results. It opens offline.

The collection has 7 documents: six English cases and one Hebrew case. They
cover identifiers, signs, decimals, table rows, column order, footnotes, and
negation, plus right-to-left text. All content is invented.

## Run it

Requires Node.js 22+ and Python 3.12. Parser dependencies are pinned in
`requirements.txt`. The runner and report have no JavaScript runtime dependencies.

Windows / PowerShell:

```powershell
.\scripts\setup.ps1
npm run check
npm start
```

Open **http://127.0.0.1:8765**. The preview server only exposes the selected
report and its JSON. It binds to the local computer. No documents are uploaded.

On macOS/Linux, create the environment first:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run check
npm start
```

`check` currently returns **exit code 1** because some stress cases fail and
some checks are unsupported. The HTML and JSON are still written to a new
timestamped directory under `runs/`. Existing reports are never overwritten.

Run a single case or parser:

```powershell
node bin/paper-cuts.js list
node bin/paper-cuts.js run --case leading-zeros --parser pypdf
node bin/paper-cuts.js run --parser pdfplumber --out runs/my-run
node bin/paper-cuts.js serve --run runs/my-run
```

Set `PAPER_CUTS_PYTHON` to use a different Python environment, for example when
testing a parser upgrade. The actual parser versions are recorded in the report.
`PAPER_CUTS_ADAPTER` is for the test suite only: it replaces the extraction script
so tests can run stub adapters. Do not set it for real runs. Like
`PAPER_CUTS_PYTHON`, it names code that runs on your machine. When it is set, the
run prints a notice, the report records the script path and its SHA-256 and says
"adapter override" on the page, and `compare` refuses to compare such a report with
one made by a different adapter script (exit `2`).

## Read the results

| Status | Meaning |
| --- | --- |
| Passed | This assertion was satisfied by this adapter's output. |
| Failed | The expected text or row association was not found. |
| Unsupported | This adapter does not provide the data required by the check. |
| Error | The extraction or check could not run correctly. |

Exit code `0` means every check passed. `1` means at least one failed or was
unsupported. `2` means invalid input or an execution error. An empty suite fails.

The two spatial checks are unsupported by the pypdf adapter because it exposes
plain text only. This is an adapter limitation, not a claim that pypdf cannot
provide coordinates through other APIs.

These counts apply to deliberately selected cases and the recorded settings.
They are not general parser accuracy scores. Changing a parser's options can
change the results. For example, an application may implement its own column
ordering or bidi reconstruction.

## Compare an upgrade

Keep the old JSON report, run the same fixtures in the new environment, then:

```powershell
node bin/paper-cuts.js compare --before runs/before/report.json --after runs/after/report.json
```

A previously passing check that now fails or becomes unsupported is a
regression (exit `1`). New execution errors are also listed as regressions,
but any execution error in the new report produces exit `2`. Existing failures
remain visible without being reported as new regressions. A comparison with no
new regressions or execution errors returns `0`; this does not mean every
underlying check passed.

Both reports must cover the same cases, parsers, and checks, with identical
source PDF and case-definition hashes. Incompatible reports produce exit `2`.

## What the assertions establish

`contains` looks for a contiguous token sequence on a specified page. It applies
Unicode NFKC normalization and ignores whitespace variation. Bidi controls, soft
hyphens, zero-width characters, word joiners, variation selectors and the
byte-order mark are ignored when matching;
the report keeps the raw text. Case, punctuation, digits, and Hebrew letter order
remain significant. Ligatures can normalize. A superscript digit stays separate
from the word before it (a footnote marker is not part of the word), whereas
subscript digits still fold into ordinary digits. An expected amount or
identifier that starts with a digit or currency symbol does not match when any
dash or minus sign precedes it, when it sits in accounting parentheses such as
`(5)`, or when it is the tail of a joined token such as `A/004208`, `ID_004208`
or `#004208`. Because whitespace is ignored, a spaced dash (`Total - $5`) reads
as a sign. It does not infer synonyms, paraphrases, or the meaning of a sentence.
Highlight rectangles locate the authored source passage; they do not restrict a
plain-text search to those coordinates.

`row` requires a label and value on one spatial line within an authored region.
The pdfplumber adapter puts a word on an existing line when the word's vertical
centre lies inside that line's vertical extent (or the line's centre lies inside
the word's), so words of different sizes on one baseline share a line. It then
sorts each line by horizontal position. This is a simple
geometric check, not a general table understanding system. An ambiguous label
fails. Multi-line cells are outside this first version.

The adapters receive only PDF paths and case IDs. They never receive expected
answers. No model is used. Raw extraction is retained before the checker applies
its normalization. Source PDF and preview hashes are verified before a run; PDFs
are checked again after extraction, and a PDF that changed makes the run exit `2`.
A directory under `fixtures/` without a `case.json` is an error, not a skip.

## Add a case

Each directory under `fixtures/` contains:

- `case.json`: the drawing recipe and separately authored assertions.
- `source.pdf`: the generated source document.
- `page-1.png`: a rendered preview (one per page).
- `artifact.json`: PDF and preview hashes, page count, and dimensions.

Copy a small existing `case.json` into a new fixture directory. Give it a unique
ID, edit the drawing recipe, and write the expected assertions independently.
Regions use `[left, top, right, bottom]` in PDF points, measured from the top left.

```powershell
.\.venv\Scripts\python.exe scripts\build_fixtures.py --case your-case
node bin/paper-cuts.js run --case your-case
```

Open every rendered page and check the source itself before accepting results.
To regenerate an existing case, add `--rebuild`; the generator first creates
`.bak_YYYYMMDD_HHmmss` copies. Backups are ignored by Git. On macOS/Linux use
`.venv/bin/python` for the same command.

Fixtures are generated with ReportLab and rendered with PDFium. Hebrew uses an
embedded Noto font and python-bidi visual ordering. This exercises that specific
PDF construction; it does not represent every Hebrew PDF producer. The drawing
recipe is recorded in each case. The font, its license and its provenance are in
`assets/fonts/`; `scripts/make_hebrew_font.py` reproduces the Regular instance
from the original variable font.

## Development checks

```powershell
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:ui
```

Unit and integration tests cover false passes, missing inputs, row swaps,
unsupported capabilities, hash mismatches, a PDF changed during extraction,
adapters never receiving expected answers, raw text retained in the report,
report embedding, report comparisons, preview-server request handling, and CLI
exit codes. Browser tests cover parser switching, filters, downloads,
mobile layout, and the absence of external page requests. Run the full `check`
before browser tests so the latest report contains all 7 fixtures and both parsers.

The CI workflow tests Windows and Linux. Stress-case failures are expected in
the generated report; the test suite separately requires the control cases to
pass. CI has no deployment or publication steps, and its actions are pinned to
commit SHAs.

## Current limits

Digitally generated PDFs only. No OCR, arbitrary-document auditing, automatic
repair, or overall quality score. Expected answers and highlighted regions are
human-reviewable annotations, not independent proof of correctness. The PDF and
image hashes detect changes to the recorded artifacts, not fraudulent authorship.

Created with AI assistance.

## License

Code and fixtures are released under the MIT License (`LICENSE`). The bundled
Noto Sans Hebrew font is under the SIL Open Font License 1.1
(`assets/fonts/OFL.txt`). Third-party dependencies keep their own licenses; see
`THIRD_PARTY_NOTICES.md`.
