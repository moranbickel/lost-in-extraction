// Each test here arms one promise the README makes. Every one was shown RED by
// reintroducing the defect it names (see the pull request that added them).
import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { normalize } from "../lib/checks.js";
import { ROOT, loadFixtures, runSuite } from "../lib/suite.js";

const STUB = path.join(ROOT, "test", "helpers", "stub_adapter.py");

async function scratch() {
  const dir = path.join(ROOT, "tmp", "tests", randomUUID());
  await mkdir(dir, { recursive: true });
  return dir;
}

async function copyOf(id) {
  const dir = await scratch();
  const fixtures = path.join(dir, "fixtures");
  await cp(path.join(ROOT, "fixtures", id), path.join(fixtures, id), {
    recursive: true,
    filter: (source) => !source.includes(".bak_"),
  });
  return { dir, fixtures };
}

async function withEnv(values, action) {
  const before = Object.fromEntries(
    Object.keys(values).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, values);
  try {
    return await action();
  } finally {
    for (const [k, v] of Object.entries(before))
      v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
}

test("a PDF that changes during extraction is rejected", async () => {
  // PROTECTS: the README promise "PDFs are checked again after extraction".
  // Without this test the post-extraction re-hash can be deleted and every
  // other test stays green, because no other test has an adapter that alters
  // its input; a parser that rewrites the source would then be accepted.
  const { fixtures } = await copyOf("leading-zeros");
  const loaded = await loadFixtures(fixtures);
  await withEnv({ STUB_MODE: "mutate" }, () =>
    assert.rejects(
      runSuite(loaded, ["pypdf"], { adapter: STUB }),
      /source PDF changed during extraction/,
    ),
  );
});

test("the CLI exits 2 when a PDF changes during extraction", async () => {
  // PROTECTS: that the rejection above reaches the process exit code.
  // Without it the library can throw while the CLI still exits 0 or 1.
  const { dir, fixtures } = await copyOf("leading-zeros");
  const result = spawnSync(
    process.execPath,
    [
      "bin/paper-cuts.js",
      "run",
      "--fixtures",
      fixtures,
      "--parser",
      "pypdf",
      "--out",
      path.join(dir, "out"),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, STUB_MODE: "mutate", PAPER_CUTS_ADAPTER: STUB },
    },
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /changed during extraction/);
});

test("the CLI exits 2 on an execution error", async () => {
  // PROTECTS: the README promise "2 means invalid input or an execution error".
  // Without it, mapping execution errors to exit 1 (the "some checks failed"
  // code) passes every test, and a broken environment reads as a failing parser.
  const { dir } = await copyOf("leading-zeros");
  const result = spawnSync(
    process.execPath,
    [
      "bin/paper-cuts.js",
      "run",
      "--case",
      "leading-zeros",
      "--parser",
      "pypdf",
      "--out",
      path.join(dir, "out"),
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        PAPER_CUTS_PYTHON: path.join(ROOT, "does-not-exist-python"),
      },
    },
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /"error":2/);
});

test("adapters receive only document ids and paths, never expected answers", async () => {
  // PROTECTS: the README promise "adapters never receive expected answers".
  // Without it, passing the checks to the adapter (so it could tune or echo
  // them) leaves every test green, since the real adapter ignores extra keys.
  const dir = await scratch();
  const dump = path.join(dir, "request.json");
  const fixtures = await loadFixtures(path.join(ROOT, "fixtures"));
  await withEnv({ STUB_MODE: "dump", STUB_DUMP: dump }, () =>
    runSuite(fixtures, ["pypdf"], { adapter: STUB }),
  );
  const rawRequest = await readFile(dump, "utf8");
  const request = JSON.parse(rawRequest);
  assert.deepEqual(Object.keys(request).sort(), ["documents", "parser"]);
  assert.equal(request.documents.length, fixtures.length);
  for (const document of request.documents)
    assert.deepEqual(Object.keys(document).sort(), ["id", "path"]);
  let strings = 0;
  for (const fixture of fixtures)
    for (const check of fixture.checks)
      for (const key of ["expected", "anchor", "value", "label"])
        if (check[key]) {
          strings++;
          assert.ok(
            !rawRequest.includes(check[key]),
            `${fixture.id}/${check.id}: ${key} reached the adapter`,
          );
        }
  assert.ok(strings > 0, "no expected strings were examined");
});

test("the report keeps the adapter's raw text, not the normalized form", async () => {
  // PROTECTS: the README promise "raw extraction is retained before the checker
  // applies its normalization". Without it, storing normalized text in the
  // report passes every test, and the report would no longer show what the
  // parser really returned (ligatures, spacing, invisible characters).
  const raw = "ofﬁce   ①‏ x\t\ny  ¹";
  assert.notEqual(raw, normalize(raw));
  const { fixtures } = await copyOf("leading-zeros");
  const loaded = await loadFixtures(fixtures);
  const report = await withEnv(
    { STUB_MODE: "raw", STUB_RAW: JSON.stringify(raw) },
    () => runSuite(loaded, ["pypdf"], { adapter: STUB }),
  );
  assert.equal(report.cases[0].results[0].pages[0].text, raw);
});

test("a report records an adapter override, and the real adapter records none", async () => {
  // PROTECTS: the README promise that the report says which parser ran. Without
  // it a stub (or a stale PAPER_CUTS_ADAPTER in the shell) produces a report that
  // claims whatever parser version it likes, indistinguishable from a real run.
  const { fixtures } = await copyOf("leading-zeros");
  const loaded = await loadFixtures(fixtures);
  const sha256 = createHash("sha256").update(await readFile(STUB)).digest("hex");
  const raw = { STUB_MODE: "raw", STUB_RAW: '"x"' };
  // The stub also tries to claim it is not an override; the runner's record wins.
  const stubbed = await withEnv({ ...raw, STUB_SPOOF: "1" }, () =>
    runSuite(loaded, ["pypdf"], { adapter: STUB }),
  );
  assert.deepEqual(stubbed.adapters[0].adapterOverride, {
    script: STUB,
    sha256,
  });
  const viaEnv = await withEnv({ ...raw, PAPER_CUTS_ADAPTER: STUB }, () =>
    runSuite(loaded, ["pypdf"]),
  );
  assert.equal(viaEnv.adapters[0].adapterOverride.sha256, sha256);
  const saved = process.env.PAPER_CUTS_ADAPTER;
  delete process.env.PAPER_CUTS_ADAPTER;
  try {
    const real = await runSuite(loaded, ["pypdf"]);
    assert.equal(real.adapters[0].adapterOverride, null);
  } finally {
    if (saved !== undefined) process.env.PAPER_CUTS_ADAPTER = saved;
  }
});

test("compare refuses reports made by different adapter overrides, and the CLI exits 2", async () => {
  // PROTECTS: comparisons against a real baseline. Without the identity check a
  // stub run compares as "0 regressions" against a real report, because compare
  // looks only at statuses and hashes.
  const { dir, fixtures } = await copyOf("leading-zeros");
  const { PAPER_CUTS_ADAPTER, ...inherited } = process.env;
  const cli = (args, env = {}) =>
    spawnSync(process.execPath, ["bin/paper-cuts.js", ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 30000,
      env: { ...inherited, ...env },
    });
  const base = ["run", "--fixtures", fixtures, "--parser", "pypdf", "--out"];
  const realRun = cli([...base, path.join(dir, "real")]);
  assert.notEqual(realRun.status, 2, realRun.stdout + realRun.stderr);
  assert.doesNotMatch(realRun.stdout, /adapter override/i);
  const stubEnv = {
    PAPER_CUTS_ADAPTER: STUB,
    STUB_MODE: "raw",
    STUB_RAW: '"x"',
  };
  const stubRun = cli([...base, path.join(dir, "stub")], stubEnv);
  assert.match(stubRun.stdout, /adapter override/i);
  const report = (name) => path.join(dir, name, "report.json");
  const compare = cli([
    "compare",
    "--before",
    report("real"),
    "--after",
    report("stub"),
  ]);
  assert.equal(compare.status, 2, compare.stdout);
  assert.match(compare.stderr, /adapter/i);
  const same = cli([
    "compare",
    "--before",
    report("stub"),
    "--after",
    report("stub"),
  ]);
  assert.equal(same.status, 0, same.stderr);
});
