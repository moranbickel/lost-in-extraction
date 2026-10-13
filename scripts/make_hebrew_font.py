"""Derive assets/fonts/NotoSansHebrew-Regular.ttf from the original variable font.

The original is Noto Sans Hebrew (SIL OFL 1.1). The derivative is a static Regular
instance (wght=400, wdth=100) whose name table says Regular instead of the variable
font's default instance (Thin). Output is deterministic: the head timestamp is kept.
"""
import argparse
import hashlib
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONTS = Path(__file__).resolve().parents[1] / "assets" / "fonts"
FAMILY, STYLE = "Noto Sans Hebrew", "Regular"


def build(original, output):
    font = TTFont(original, recalcTimestamp=False)
    instantiateVariableFont(font, {"wght": 400, "wdth": 100}, inplace=True)
    names = font["name"]
    version = names.getDebugName(5).replace("Version ", "")
    # Name IDs 16/17/25 describe the variable family; a static Regular needs none of them.
    for name_id in (16, 17, 25):
        names.removeNames(nameID=name_id)
    for name_id, value in {
        1: FAMILY,
        2: STYLE,
        3: f"{version};GOOG;NotoSansHebrew-{STYLE}",
        4: f"{FAMILY} {STYLE}",
        6: f"NotoSansHebrew-{STYLE}",
    }.items():
        for record in [n for n in names.names if n.nameID == name_id]:
            record.string = value
    font.save(output)
    return hashlib.sha256(Path(output).read_bytes()).hexdigest()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--original", type=Path, default=FONTS / "NotoSansHebrew.ttf")
    parser.add_argument("--output", type=Path, default=FONTS / "NotoSansHebrew-Regular.ttf")
    args = parser.parse_args()
    print(build(args.original, args.output))
