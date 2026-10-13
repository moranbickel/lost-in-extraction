import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultPython } from "../lib/suite.js";

const fonts = new URL("../assets/fonts/", import.meta.url);
const sha = async (name) =>
  createHash("sha256").update(await readFile(new URL(name, fonts))).digest("hex");

test("the bundled font's metadata, licence year and provenance agree", async () => {
  // PROTECTS: the licence record. Without it the Regular instance can drift
  // back to carrying the Thin name of the variable font's default instance,
  // OFL.txt can disagree with the font's own copyright year, and provenance.json
  // can stop describing the files actually shipped.
  const probe = spawnSync(
    defaultPython(),
    [
      "-c",
      [
        "import json, sys",
        "from fontTools.ttLib import TTFont",
        "f = TTFont(sys.argv[1])",
        "n = f['name']",
        "print(json.dumps({'fvar': 'fvar' in f, 'ids': {i: n.getDebugName(i) for i in (0, 1, 2, 4, 6)}}))",
      ].join("\n"),
      fileURLToPath(new URL("NotoSansHebrew-Regular.ttf", fonts)),
    ],
    { encoding: "utf8" },
  );
  assert.equal(probe.status, 0, probe.stderr);
  const font = JSON.parse(probe.stdout);
  assert.equal(font.fvar, false);
  assert.equal(font.ids[1], "Noto Sans Hebrew");
  assert.equal(font.ids[2], "Regular");
  assert.equal(font.ids[4], "Noto Sans Hebrew Regular");
  assert.equal(font.ids[6], "NotoSansHebrew-Regular");
  const year = /Copyright (\d{4}) The Noto Project Authors/;
  const licence = await readFile(new URL("OFL.txt", fonts), "utf8");
  assert.equal(year.exec(licence.split("\n")[0])?.[1], year.exec(font.ids[0])?.[1]);
  const provenance = JSON.parse(await readFile(new URL("provenance.json", fonts), "utf8"));
  assert.equal(provenance.original_sha256, await sha(provenance.original));
  assert.equal(provenance.used_sha256, await sha(provenance.used));
});
