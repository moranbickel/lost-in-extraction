import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./suite.js";

export async function writeReport(directory, report, fixtures) {
  // Refuse existing output directories: every run remains separately inspectable.
  await mkdir(directory, { recursive: false });
  const assets = {};
  for (const fixture of fixtures) {
    const previews = [];
    for (const file of fixture.artifact.previews) {
      previews.push(
        `data:image/png;base64,${(await readFile(path.join(fixture.folder, file))).toString("base64")}`,
      );
    }
    assets[fixture.id] = {
      previews,
      pdf: `data:application/pdf;base64,${fixture.pdf.toString("base64")}`,
    };
  }
  const [template, css, js] = await Promise.all(
    ["index.html", "style.css", "app.js"].map((file) =>
      readFile(path.join(ROOT, "web", file), "utf8"),
    ),
  );
  const data = JSON.stringify({ report, assets })
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  const html = template
    .replace("/* PAPER_CUTS_STYLE */", () => css)
    .replace("/* PAPER_CUTS_APP */", () => js)
    .replace('"PAPER_CUTS_DATA"', () => data);
  await writeFile(
    path.join(directory, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
  await writeFile(path.join(directory, "report.html"), html, "utf8");
}
