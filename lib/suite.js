import { readFileSync } from "node:fs";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluateCase, overall, summarize, validateCase } from "./checks.js";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const PARSERS = ["pypdf", "pdfplumber"];
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export async function loadFixtures(directory) {
  const root = await realpath(directory);
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const fixtures = [];
  const ids = new Set();
  for (const entry of entries) {
    const folder = await realpath(path.join(root, entry.name));
    if (!folder.startsWith(root + path.sep))
      throw new Error("Fixture path leaves the suite directory.");
    let recipe;
    try {
      recipe = await readFile(path.join(folder, "case.json"));
    } catch (error) {
      if (error.code === "ENOENT")
        throw new Error(
          `${entry.name}: fixture directory has no case.json. Add it or remove the directory.`,
        );
      throw error;
    }
    const fixture = validateCase(JSON.parse(recipe.toString("utf8")));
    if (ids.has(fixture.id))
      throw new Error(`Duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    const pdf = await readFile(path.join(folder, "source.pdf"));
    const artifact = JSON.parse(
      await readFile(path.join(folder, "artifact.json"), "utf8"),
    );
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error(`${fixture.id}: source is not a PDF`);
    if (artifact.sha256 !== sha256(pdf))
      throw new Error(
        `${fixture.id}: source PDF hash differs from artifact.json`,
      );
    if (
      artifact.pages !== fixture.document.length ||
      !Number.isFinite(artifact.width) ||
      !Number.isFinite(artifact.height) ||
      artifact.width <= 0 ||
      artifact.height <= 0
    )
      throw new Error(`${fixture.id}: invalid artifact dimensions/pages`);
    if (
      !Array.isArray(artifact.previews) ||
      artifact.previews.length !== artifact.pages ||
      artifact.previews.some((name) => !/^page-\d+\.png$/.test(name))
    )
      throw new Error(`${fixture.id}: invalid preview manifest`);
    for (const name of artifact.previews) {
      if (
        artifact.previewSha256?.[name] !==
        sha256(await readFile(path.join(folder, name)))
      ) {
        throw new Error(
          `${fixture.id}: preview hash differs from artifact.json`,
        );
      }
    }
    for (const check of fixture.checks) {
      if (check.region[2] > artifact.width || check.region[3] > artifact.height)
        throw new Error(`${fixture.id}: check region exceeds page`);
    }
    fixtures.push({
      ...fixture,
      folder,
      pdf,
      artifact,
      caseSha256: sha256(recipe),
    });
  }
  if (!fixtures.length)
    throw new Error("No fixtures found. An empty suite cannot pass.");
  return fixtures;
}

export function defaultPython() {
  return (
    process.env.PAPER_CUTS_PYTHON ??
    path.join(
      ROOT,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    )
  );
}

export function invokeAdapter(
  parser,
  documents,
  { python, adapter, timeout = 60000 } = {},
) {
  const executable = python ?? defaultPython();
  // PAPER_CUTS_ADAPTER replaces the extraction script; it exists so tests can
  // run stub adapters. It is as trusted as PAPER_CUTS_PYTHON, which already
  // names an arbitrary executable. An override is recorded in the report (script
  // and sha256), so a stub run cannot pass as a real parser run.
  const overridden = adapter || process.env.PAPER_CUTS_ADAPTER;
  const script = overridden || path.join(ROOT, "adapters/extract.py");
  return new Promise((resolve, reject) => {
    const adapterOverride = overridden
      ? {
          script: path.resolve(overridden),
          sha256: sha256(readFileSync(overridden)),
        }
      : null;
    const child = spawn(executable, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Adapter ${parser} timed out after ${timeout}ms.`));
    }, timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.on("error", (error) =>
      finish(
        new Error(
          `Could not start Python: ${error.message}. Run scripts/setup.ps1 first.`,
        ),
      ),
    );
    child.stdout.on("data", (data) => {
      stdout += data.toString("utf8");
      if (stdout.length > 16 * 1024 * 1024) {
        child.kill();
        finish(new Error("Adapter output exceeds 16 MiB."));
      }
    });
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString("utf8")).slice(-8192);
    });
    child.stdin.on("error", (error) =>
      finish(new Error(`Adapter input failed: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (code !== 0)
        return finish(
          new Error(`Adapter ${parser} exited ${code}: ${stderr.trim()}`),
        );
      try {
        const response = JSON.parse(stdout);
        if (
          response.schemaVersion !== 1 ||
          response.parser !== parser ||
          typeof response.version !== "string" ||
          !Array.isArray(response.documents) ||
          !Array.isArray(response.capabilities) ||
          response.capabilities.some(
            (c) => !["text", "spatial-lines"].includes(c),
          )
        )
          throw new Error("Invalid adapter envelope");
        const ids = response.documents.map((d) => d.id);
        if (
          new Set(ids).size !== ids.length ||
          ids.length !== documents.length ||
          documents.some((d) => !ids.includes(d.id))
        ) {
          throw new Error(
            "Adapter did not return exactly the requested documents",
          );
        }
        for (const doc of response.documents) {
          if (doc.error) {
            if (typeof doc.error !== "string")
              throw new Error("Invalid adapter error");
            continue;
          }
          if (
            !Array.isArray(doc.pages) ||
            doc.pages.some(
              (page, index) =>
                page.number !== index + 1 || typeof page.text !== "string",
            )
          ) {
            throw new Error(`Invalid pages for ${doc.id}`);
          }
        }
        // Set after the spread: the adapter cannot describe itself as not overridden.
        finish(null, { ...response, stderr, adapterOverride });
      } catch (error) {
        finish(new Error(`Invalid ${parser} response: ${error.message}`));
      }
    });
    child.stdin.end(JSON.stringify({ parser, documents }));
  });
}

export async function runSuite(fixtures, parsers, options = {}) {
  if (!fixtures.length || !parsers.length)
    throw new Error("Select at least one fixture and parser.");
  if (parsers.some((parser) => !PARSERS.includes(parser)))
    throw new Error("Unknown parser.");
  const report = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    toolVersion: "0.1.0",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    adapters: [],
    cases: [],
  };
  for (const parser of parsers) {
    let response;
    try {
      response = await invokeAdapter(
        parser,
        fixtures.map((f) => ({
          id: f.id,
          path: path.join(f.folder, "source.pdf"),
        })),
        options,
      );
    } catch (error) {
      response = {
        parser,
        version: null,
        capabilities: [],
        error: error.message,
        documents: fixtures.map((f) => ({ id: f.id, error: error.message })),
      };
    }
    const { documents, ...metadata } = response;
    report.adapters.push(metadata);
    for (const fixture of fixtures) {
      let item = report.cases.find((c) => c.id === fixture.id);
      if (!item) {
        const {
          id,
          title,
          documentTitle,
          description,
          language,
          category,
          construction,
          caseSha256,
          artifact,
        } = fixture;
        item = {
          id,
          title,
          documentTitle,
          description,
          language,
          category,
          construction,
          caseSha256,
          sourceSha256: artifact.sha256,
          pageCount: artifact.pages,
          width: artifact.width,
          height: artifact.height,
          results: [],
        };
        report.cases.push(item);
      }
      const document = documents.find((d) => d.id === fixture.id);
      const checks = evaluateCase(fixture, document, response.capabilities);
      item.results.push({
        parser,
        version: response.version,
        status: overall(checks),
        counts: summarize(checks),
        checks,
        pages: document?.pages ?? [],
        error: document?.error ?? null,
      });
    }
  }
  // A parser may not alter its input and still produce an accepted result.
  for (const fixture of fixtures) {
    if (
      sha256(await readFile(path.join(fixture.folder, "source.pdf"))) !==
      fixture.artifact.sha256
    ) {
      throw new Error(`${fixture.id}: source PDF changed during extraction`);
    }
  }
  const checks = report.cases.flatMap((c) =>
    c.results.flatMap((r) => r.checks),
  );
  report.counts = summarize(checks);
  report.status = overall(checks);
  return report;
}
