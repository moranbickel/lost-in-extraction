"""Write a one-page PDF of label/value rows with mixed font sizes on one baseline."""
import sys

from reportlab.pdfgen import canvas

ROWS = [
    # baseline (points from the bottom), label size, label, value size, value
    (700, 20, "Amount paid", 9, "$10,000"),
    (650, 17, "Total fee", 13, "$7"),
    (600, 13, "Balance", 13, "$3"),
    (586, 13, "Tax", 13, "$1"),
]

doc = canvas.Canvas(sys.argv[1], pagesize=(595.28, 841.89), invariant=1)
for baseline, label_size, label, value_size, value in ROWS:
    doc.setFont("Helvetica", label_size)
    doc.drawString(48, baseline, label)
    doc.setFont("Helvetica", value_size)
    doc.drawString(300, baseline, value)
doc.showPage()
doc.save()
