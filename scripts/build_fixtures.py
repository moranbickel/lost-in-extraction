"""Build the synthetic source PDFs and previews. Does not run the checkers."""
import argparse
import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

from bidi.algorithm import get_display
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 595.28, 841.89


def build(folder, rebuild=False):
    case = json.loads((folder / "case.json").read_text(encoding="utf-8"))
    pdf_path = folder / "source.pdf"
    if pdf_path.exists() and not rebuild:
        raise FileExistsError(f"Refusing to overwrite {pdf_path}. Use --rebuild to back up and regenerate.")
    if not rebuild and any(folder.glob("page-*.png")):
        raise FileExistsError(f"Refusing to delete existing previews in {folder}. Use --rebuild to back up and regenerate.")
    if rebuild:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        for existing in [pdf_path, folder / "artifact.json", *folder.glob("page-*.png")]:
            if existing.exists():
                backup = existing.with_name(existing.name + ".bak_" + stamp)
                if backup.exists():
                    raise FileExistsError(f"Backup already exists: {backup}")
                shutil.copy2(existing, backup)
    doc = canvas.Canvas(str(pdf_path), pagesize=(WIDTH, HEIGHT), invariant=1, pageCompression=1)
    doc.setTitle(case["title"])
    doc.setAuthor("Paper Cuts - synthetic test fixture")
    doc.setSubject(case["id"])
    for page_number, page in enumerate(case["document"], 1):
        doc.setFillColorRGB(.36, .38, .39)
        doc.setFont("Helvetica", 9)
        doc.drawString(48, HEIGHT - 46, "PAPER CUTS / SYNTHETIC DOCUMENT")
        doc.drawRightString(WIDTH - 48, HEIGHT - 46, case["id"])
        doc.setStrokeColorRGB(.80, .81, .80)
        doc.line(48, HEIGHT - 60, WIDTH - 48, HEIGHT - 60)
        doc.setFillColorRGB(.12, .14, .14)
        doc.setFont("Helvetica-Bold", 23)
        doc.drawString(48, HEIGHT - 112, case["documentTitle"])
        for item in page:
            kind = item.get("type", "text")
            if kind == "rule":
                doc.setStrokeColorRGB(.72, .74, .74)
                doc.line(item["x"], HEIGHT - item["y"], item["x2"], HEIGHT - item["y2"])
            elif kind == "text":
                text = item["text"]
                if item.get("direction") == "rtl":
                    # The content stream contains visual-order text; rendered Hebrew reads normally.
                    text = get_display(text, base_dir="R")
                font = "NotoHebrew" if item.get("direction") == "rtl" else item.get("font", "Helvetica")
                doc.setFont(font, item.get("size", 13))
                doc.setFillColorRGB(.12, .14, .14)
                draw = doc.drawRightString if item.get("align") == "right" else doc.drawString
                draw(item["x"], HEIGHT - item["y"], text)
            else:
                raise ValueError(f"Unknown drawing operation: {kind}")
        doc.setFont("Helvetica", 8)
        doc.setFillColorRGB(.42, .44, .44)
        doc.drawString(48, 36, "Invented content. No client records or personal data.")
        doc.drawRightString(WIDTH - 48, 36, str(page_number))
        doc.showPage()
    doc.save()
    previews = []
    with pdfium.PdfDocument(str(pdf_path)) as rendered:
        for i in range(len(rendered)):
            page = rendered[i]
            bitmap = page.render(scale=1.5)
            output = folder / f"page-{i + 1}.png"
            bitmap.to_pil().save(output)
            previews.append(output.name)
            bitmap.close()
            page.close()
    metadata = {
        "sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
        "pages": len(case["document"]), "width": WIDTH, "height": HEIGHT,
        "previews": previews,
        "generator": "reportlab", "renderer": "pypdfium2",
        "previewSha256": {name: hashlib.sha256((folder / name).read_bytes()).hexdigest() for name in previews},
    }
    # Bytes, not write_text: text mode would write CRLF on Windows.
    (folder / "artifact.json").write_bytes((json.dumps(metadata, indent=2) + "\n").encode("utf-8"))
    # Previews of pages the document no longer has (backed up above when rebuilding).
    for stale in folder.glob("page-*.png"):
        if stale.name not in previews:
            stale.unlink()
    print(f"Built {case['id']} ({len(previews)} page(s))")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixtures", type=Path, default=ROOT / "fixtures")
    parser.add_argument("--rebuild", action="store_true", help="Back up existing artifacts before regenerating")
    parser.add_argument("--case", help="Build a single fixture directory by name")
    args = parser.parse_args()
    pdfmetrics.registerFont(TTFont("NotoHebrew", str(ROOT / "assets/fonts/NotoSansHebrew-Regular.ttf")))
    folders = sorted(p.parent for p in args.fixtures.glob("*/case.json"))
    if args.case:
        folders = [folder for folder in folders if folder.name == args.case]
    if not folders:
        raise SystemExit("No fixtures found.")
    for fixture in folders:
        build(fixture, args.rebuild)
