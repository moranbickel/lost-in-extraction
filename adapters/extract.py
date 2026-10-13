"""Read source PDFs only. Expected answers are never passed to this process."""
import importlib.metadata
import json
import platform
import sys
import traceback
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def extract_pdf(path, parser):
    if parser == "pypdf":
        from pypdf import PdfReader
        reader = PdfReader(path, strict=False)
        return [{"number": i + 1, "text": page.extract_text(extraction_mode="plain") or ""}
                for i, page in enumerate(reader.pages)]
    if parser == "pdfplumber":
        import pdfplumber
        pages = []
        with pdfplumber.open(path) as pdf:
            for i, page in enumerate(pdf.pages):
                # Rows are formed from word positions: a word joins a row when its vertical
                # centre lies inside the row's vertical extent (or the row's centre lies inside
                # the word's), so words of different sizes on one baseline share a row.
                # This is an adapter policy, not a claim that the parser returns table semantics.
                words = page.extract_words(x_tolerance=3, y_tolerance=3, keep_blank_chars=False,
                                           use_text_flow=False)
                rows = []
                for word in sorted(words, key=lambda w: (w["top"], w["x0"])):
                    centre = (word["top"] + word["bottom"]) / 2
                    row = next((r for r in rows
                                if r["top"] <= centre <= r["bottom"]
                                or word["top"] <= (r["top"] + r["bottom"]) / 2 <= word["bottom"]), None)
                    if row is None:
                        row = {"top": word["top"], "bottom": word["bottom"], "words": []}
                        rows.append(row)
                    row["top"] = min(row["top"], word["top"])
                    row["bottom"] = max(row["bottom"], word["bottom"])
                    row["words"].append(word)
                lines = [{"text": " ".join(w["text"] for w in sorted(row["words"], key=lambda w: w["x0"])),
                          "bbox": [min(w["x0"] for w in row["words"]), min(w["top"] for w in row["words"]),
                                   max(w["x1"] for w in row["words"]), max(w["bottom"] for w in row["words"])]}
                         for row in rows]
                pages.append({"number": i + 1, "text": page.extract_text(x_tolerance=3, y_tolerance=3) or "",
                              "lines": lines})
        return pages
    raise ValueError(f"Unknown parser: {parser}")


def main():
    request = json.load(sys.stdin)
    parser = request["parser"]
    if parser not in ("pypdf", "pdfplumber"):
        raise ValueError("Unsupported parser")
    packages = [parser] + (["pdfminer.six"] if parser == "pdfplumber" else [])
    versions = {name: importlib.metadata.version(name) for name in packages}
    result = {"schemaVersion": 1, "parser": parser, "version": versions[parser],
              "dependencies": versions, "python": platform.python_version(),
              "capabilities": ["text", "spatial-lines"] if parser == "pdfplumber" else ["text"],
              "settings": {"extraction_mode": "plain", "strict": False} if parser == "pypdf" else {
                  "x_tolerance": 3, "y_tolerance": 3, "line_grouping": "word vertical centre within the line extent; sorted by x0",
                  "use_text_flow": False}, "documents": []}
    for item in request["documents"]:
        try:
            pages = extract_pdf(str(Path(item["path"]).resolve()), parser)
            result["documents"].append({"id": item["id"], "pages": pages})
        except Exception as exc:
            result["documents"].append({"id": item["id"], "error": f"{type(exc).__name__}: {exc}"})
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(2)
