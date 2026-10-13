import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, loadFixtures, runSuite } from "../lib/suite.js";
import { writeReport } from "../lib/report.js";

async function scratch() {
  const dir = path.join(ROOT, "tmp", "tests", randomUUID());
  await mkdir(dir, { recursive: true });
  return dir;
}

test("real parsers run the complete suite and report their versions", async () => {
  const fixtures = await loadFixtures(path.join(ROOT, "fixtures"));
  const report = await runSuite(fixtures, ["pypdf", "pdfplumber"]);
  assert.equal(report.cases.length, 7);
  assert.equal(report.counts.error, 0);
  assert.equal(
    Object.values(report.counts).reduce((a, b) => a + b, 0),
    fixtures.reduce((n, f) => n + f.checks.length, 0) * 2,
  );
  assert.ok(report.counts.pass > 0);
  assert.ok(report.counts.unsupported > 0);
  for (const adapter of report.adapters)
    assert.match(adapter.version, /^\d+\./);
  // These controls should survive both parsers. Stress cases are allowed to improve in future versions.
  for (const id of [
    "leading-zeros",
    "signed-amounts",
    "footnote-exception",
    "split-negation",
  ]) {
    for (const result of report.cases.find((c) => c.id === id).results)
      assert.equal(result.status, "pass", `${id}: ${result.parser}`);
  }
  const dir = path.join(await scratch(), "report");
  // Embedded JSON must remain inert even if document text contains HTML/script terminators.
  report.cases[0].description = '</script><script>alert("injected")</script>';
  await writeReport(dir, report, fixtures);
  const html = await readFile(path.join(dir, "report.html"), "utf8");
  assert.ok(!html.includes("</script><script>alert"));
  assert.ok(html.includes("data:application/pdf;base64,"));
  assert.ok(html.includes("data:image/png;base64,"));
  assert.ok(!html.includes('"PAPER_CUTS_DATA"'));
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")),
    report,
  );
  await assert.rejects(writeReport(dir, report, fixtures), /EEXIST/);
});

test("missing Python creates error results instead of unsupported or passing checks", async () => {
  const fixtures = (await loadFixtures(path.join(ROOT, "fixtures"))).filter(
    (f) => f.id === "leading-zeros",
  );
  const report = await runSuite(fixtures, ["pypdf"], {
    python: path.join(ROOT, "does-not-exist-python"),
  });
  assert.equal(report.counts.error, 2);
  assert.equal(report.counts.pass, 0);
  assert.equal(report.counts.unsupported, 0);
});

test("empty suites, altered PDFs and altered previews are rejected", async () => {
  const dir = await scratch();
  await assert.rejects(loadFixtures(dir), /No fixtures/);
  const folder = path.join(dir, "leading-zeros");
  await cp(path.join(ROOT, "fixtures", "leading-zeros"), folder, {
    recursive: true,
    filter: (source) => !source.includes(".bak_"),
  });
  const original = await readFile(path.join(folder, "source.pdf"));
  await writeFile(
    path.join(folder, "source.pdf"),
    Buffer.concat([original, Buffer.from("\naltered")]),
  );
  await assert.rejects(loadFixtures(dir), /source PDF hash/);
  await writeFile(path.join(folder, "source.pdf"), original);
  await writeFile(path.join(folder, "page-1.png"), "not the original preview");
  await assert.rejects(loadFixtures(dir), /preview hash/);
});

test("CLI distinguishes passing, incomplete, and invalid selections", async () => {
  const directory = await scratch();
  const run = (args) =>
    spawnSync(process.execPath, ["bin/paper-cuts.js", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
    });
  const green = run([
    "run",
    "--case",
    "leading-zeros",
    "--parser",
    "pypdf",
    "--out",
    path.join(directory, "green"),
  ]);
  assert.equal(green.status, 0, green.stderr);
  const unsupported = run([
    "run",
    "--case",
    "payment-rows",
    "--parser",
    "pypdf",
    "--out",
    path.join(directory, "unsupported"),
  ]);
  assert.equal(unsupported.status, 1, unsupported.stderr);
  const invalid = run(["run", "--case", "not-a-case"]);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Unknown case/);
  assert.equal(run(["run", "--parser", "typo"]).status, 2);
  assert.equal(
    run(["run", "--parser", "pypdf", "--parser", "pdfplumber"]).status,
    2,
  );
});

test("a fixture directory without case.json is an error, not a skip", async () => {
  // PROTECTS: against silently shrinking the suite. Without it, deleting one
  // case.json (and with it that case's failing checks) leaves a run that lists
  // fewer documents and can exit 0, with nothing saying a fixture went missing.
  const dir = await scratch();
  await cp(
    path.join(ROOT, "fixtures", "leading-zeros"),
    path.join(dir, "leading-zeros"),
    { recursive: true, filter: (source) => !source.includes(".bak_") },
  );
  await cp(
    path.join(ROOT, "fixtures", "payment-rows"),
    path.join(dir, "payment-rows"),
    { recursive: true, filter: (source) => !source.includes(".bak_") },
  );
  assert.equal((await loadFixtures(dir)).length, 2);
  await rm(path.join(dir, "payment-rows", "case.json"));
  await assert.rejects(loadFixtures(dir), /payment-rows.*no case\.json/);
  const result = spawnSync(
    process.execPath,
    ["bin/paper-cuts.js", "run", "--fixtures", dir, "--parser", "pypdf"],
    { cwd: ROOT, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 2, result.stdout);
  assert.match(result.stderr, /payment-rows.*no case\.json/);
});
