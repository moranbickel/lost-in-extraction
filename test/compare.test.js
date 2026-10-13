import test from "node:test";
import assert from "node:assert/strict";
import { compareReports } from "../lib/compare.js";
const report = (status) => ({
  schemaVersion: 1,
  cases: [
    {
      id: "invoice",
      sourceSha256: "pdf-hash",
      caseSha256: "case-hash",
      results: [
        { parser: "pypdf", version: "1", checks: [{ id: "zeros", status }] },
      ],
    },
  ],
});
test("compare flags a lost pass, including lost capability", () => {
  for (const status of ["fail", "unsupported", "error"])
    assert.equal(compareReports(report("pass"), report(status)).regressions, 1);
});
test("existing failures are retained without being called new regressions", () => {
  assert.equal(compareReports(report("fail"), report("fail")).regressions, 0);
  assert.equal(compareReports(report("fail"), report("pass")).regressions, 0);
});
test("reports must cover identical source bytes and check definitions", () => {
  const changed = report("pass");
  changed.cases[0].sourceSha256 = "new-pdf";
  assert.throws(
    () => compareReports(report("pass"), changed),
    /Source or expected checks changed/,
  );
  const dropped = report("pass");
  dropped.cases[0].results[0].checks = [];
  assert.throws(() => compareReports(report("pass"), dropped));
});
test("operational errors remain errors even when also present in the baseline", () => {
  assert.equal(compareReports(report("error"), report("error")).errors, 1);
});

const withAdapter = (override) => ({
  ...report("pass"),
  adapters: [{ parser: "pypdf", adapterOverride: override }],
});
test("reports from different adapter scripts are not comparable", () => {
  // PROTECTS: the identity of what produced a report. Without it a stub's
  // report compares cleanly against a real baseline.
  const stub = { script: "/a/stub.py", sha256: "aaa" };
  assert.throws(
    () => compareReports(withAdapter(null), withAdapter(stub)),
    /adapter/i,
  );
  assert.throws(
    () =>
      compareReports(withAdapter(stub), withAdapter({ ...stub, sha256: "bbb" })),
    /adapter/i,
  );
  // NEGATIVE CONTROL: the same script bytes at another path, and reports with no
  // adapter metadata at all, remain comparable. DO NOT DELETE AS REDUNDANT.
  // Protects: comparing across machines and older reports; without it a check
  // that rejects every override (or a missing field) passes the assertions above.
  assert.equal(
    compareReports(
      withAdapter(stub),
      withAdapter({ script: "/b/stub.py", sha256: "aaa" }),
    ).checks,
    1,
  );
  assert.equal(compareReports(report("pass"), withAdapter(null)).checks, 1);
});
