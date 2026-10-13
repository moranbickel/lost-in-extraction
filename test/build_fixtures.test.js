import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ROOT, defaultPython } from "../lib/suite.js";

test("rebuilding a fixture writes LF metadata and removes previews of pages that no longer exist", async () => {
  // PROTECTS: reproducible fixture metadata. Without it a rebuild on Windows
  // writes CRLF artifact.json (a spurious diff), and a case that shrinks from
  // two pages to one keeps a stale page-2.png that loadFixtures silently ignores.
  const fixtures = path.join(ROOT, "tmp", "tests", randomUUID());
  const folder = path.join(fixtures, "leading-zeros");
  await mkdir(fixtures, { recursive: true });
  await cp(path.join(ROOT, "fixtures", "leading-zeros"), folder, {
    recursive: true,
    filter: (source) => !source.includes(".bak_"),
  });
  await writeFile(path.join(folder, "page-2.png"), "stale preview");
  const build = spawnSync(
    defaultPython(),
    [
      path.join(ROOT, "scripts", "build_fixtures.py"),
      "--fixtures",
      fixtures,
      "--rebuild",
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  const files = await readdir(folder);
  assert.ok(!files.includes("page-2.png"), "stale page-2.png remains");
  assert.ok(
    files.some((f) => f.startsWith("page-2.png.bak_")),
    "stale preview was not backed up before removal",
  );
  assert.ok(files.includes("page-1.png"));
  const artifact = await readFile(path.join(folder, "artifact.json"));
  assert.ok(!artifact.includes(13), "artifact.json contains CR");
  assert.deepEqual(JSON.parse(artifact.toString("utf8")).previews, ["page-1.png"]);
});
