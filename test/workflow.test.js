import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every GitHub Action in the workflow is pinned to a full commit SHA", async () => {
  // PROTECTS: CI against a moved tag. A mutable tag (actions/checkout@v4) can
  // change what runs in CI without any change to this repository; the other
  // tests never read the workflow file.
  const workflow = await readFile(
    new URL("../.github/workflows/test.yml", import.meta.url),
    "utf8",
  );
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)(.*)$/gm)];
  assert.ok(uses.length >= 3);
  for (const [, reference, rest] of uses) {
    assert.match(reference, /@[0-9a-f]{40}$/, reference);
    assert.match(rest, /#\s*v\d/, `${reference} needs a version comment`);
  }
});
