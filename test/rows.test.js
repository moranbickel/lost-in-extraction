import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { evaluateCase } from "../lib/checks.js";
import { ROOT, defaultPython, invokeAdapter } from "../lib/suite.js";

const row = (id, anchor, value, region) => ({
  id,
  label: id,
  kind: "row",
  anchor,
  value,
  page: 1,
  region,
});

test("a label and value on one baseline share a row even at different font sizes", async () => {
  const dir = path.join(ROOT, "tmp", "tests", randomUUID());
  await mkdir(dir, { recursive: true });
  const pdf = path.join(dir, "rows.pdf");
  const made = spawnSync(
    defaultPython(),
    [path.join(ROOT, "test", "helpers", "make_rows_pdf.py"), pdf],
    { encoding: "utf8" },
  );
  assert.equal(made.status, 0, made.stderr);
  const response = await invokeAdapter("pdfplumber", [{ id: "rows", path: pdf }]);
  const checks = [
    // 20 pt label, 9 pt value, same baseline
    row("paid", "Amount paid", "$10,000", [0, 120, 595, 150]),
    // 17 pt label, 13 pt value, same baseline
    row("fee", "Total fee", "$7", [0, 175, 595, 200]),
    // two ordinary rows 14 pt apart
    row("balance", "Balance", "$3", [0, 228, 595, 245]),
    row("tax", "Tax", "$1", [0, 246, 595, 262]),
  ];
  const fixture = { document: [[{}]], checks };
  const status = () =>
    evaluateCase(fixture, response.documents[0], ["text", "spatial-lines"]).map(
      (r) => `${r.id}:${r.status}`,
    );
  assert.deepEqual(status(), [
    "paid:pass",
    "fee:pass",
    "balance:pass",
    "tax:pass",
  ]);

  // NEGATIVE CONTROL FOR baseline row grouping. DO NOT DELETE AS REDUNDANT.
  // Protects: rows staying separate. Without it, a grouping rule loose enough
  // to merge neighbouring lines would pass the checks above, and a value
  // from the row below would satisfy a label's row check.
  fixture.checks = [
    row("balance-takes-tax-value", "Balance", "$1", [0, 228, 595, 245]),
    row("tax-takes-balance-value", "Tax", "$3", [0, 246, 595, 262]),
  ];
  assert.deepEqual(status(), [
    "balance-takes-tax-value:fail",
    "tax-takes-balance-value:fail",
  ]);
});
