import { test, expect } from "@playwright/test";
import { readFile, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("report opens, switches parsers and filters without external requests", async ({
  page,
}) => {
  const errors = [],
    external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      !request.url().startsWith("http://127.0.0.1:8766") &&
      !request.url().startsWith("data:")
    )
      external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("#case-list button")).toHaveCount(7);
  await expect(page.locator("#document-title")).toHaveText(
    "Two-column reading order",
  );
  await page
    .getByRole("button", { name: "pdfplumber Failed", exact: true })
    .click();
  await expect(page.locator("#checks .status.fail")).toHaveCount(2);
  await expect(page.locator("#extraction")).toContainText(
    "The buyer may cancel The deposit is refundable",
  );
  await page.screenshot({ path: "tmp/report-desktop.png", fullPage: true });
  await page.locator("#language").selectOption("Hebrew");
  await expect(page.locator("#case-list button")).toHaveCount(1);
  await page.locator("#search").fill("party");
  await expect(page.locator("#case-list button")).toHaveCount(1);
  await expect(page.locator("#extraction")).toContainText("זרא תרבח :קפס");
  await page.locator("#search").fill("there-is-no-such-case");
  await expect(page.locator("#empty")).toBeVisible();
  await page.locator("#search").fill("");
  await expect(page.locator("#document")).toBeVisible();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("source enlargement, footnote selection and report downloads work", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /An exception in the footnote, English/ })
    .click();
  await page
    .getByRole("button", { name: "Footnote exception Passed", exact: true })
    .click();
  await expect(page.locator("#check-detail")).toContainText(
    "Except public holidays",
  );
  await page.getByRole("button", { name: "Enlarge", exact: true }).click();
  await expect(page.locator("#source-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#source-dialog")).not.toBeVisible();
  const pdfPromise = page.waitForEvent("download");
  await page.locator("#download-pdf").click();
  const pdf = await pdfPromise;
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  const jsonPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const json = await jsonPromise;
  expect(
    JSON.parse(await readFile(await json.path(), "utf8")).cases,
  ).toHaveLength(7);
});

test("mobile layout fits and the unsupported filter remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Unsupported 2", exact: true })
    .click();
  await expect(page.locator("#case-list button")).toHaveCount(1);
  await page.getByRole("button", { name: "All checks", exact: false }).click();
  await page
    .getByRole("button", { name: /Hebrew party labels, Hebrew/ })
    .click();
  await expect(page.locator("#document-title")).toHaveText(
    "Hebrew party labels",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "tmp/report-mobile.png", fullPage: true });
});

test("preview server exposes only the report files", async ({ request }) => {
  expect(
    (await request.get("/fixtures/leading-zeros/source.pdf")).status(),
  ).toBe(404);
  expect((await request.get("/package.json")).status()).toBe(404);
  expect((await request.post("/")).status()).toBe(404);
  expect((await request.get("/report.json")).status()).toBe(200);
});

test("a report made with an adapter override says so on the page", async ({
  page,
}) => {
  // PROTECTS: a reader of the report page. Without it a stub run looks exactly
  // like a real one in the browser.
  const out = path.join(await mkdtemp(path.join(tmpdir(), "paper-cuts-")), "run");
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
      out,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PAPER_CUTS_ADAPTER: path.resolve("test/helpers/stub_adapter.py"),
        STUB_MODE: "raw",
        STUB_RAW: '"x"',
      },
    },
  );
  expect(result.status, result.stdout + result.stderr).not.toBe(2);
  await page.goto(pathToFileURL(path.join(out, "report.html")).href);
  await expect(page.locator("#run-info")).toContainText("adapter override");
  await page.locator("summary").click();
  await expect(page.locator("#method-content")).toContainText("Adapter script");
  await expect(page.locator("#method-content")).toContainText("stub_adapter.py");
});
