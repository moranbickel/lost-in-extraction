#!/usr/bin/env node
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { ROOT, PARSERS, loadFixtures, runSuite } from "../lib/suite.js";
import { writeReport } from "../lib/report.js";
import { compareReports } from "../lib/compare.js";

const HELP = `Paper Cuts 0.1.0

  node bin/paper-cuts.js run [--parser pypdf|pdfplumber|all] [--case ID]
                           [--fixtures DIR] [--out NEW-DIRECTORY]
  node bin/paper-cuts.js list [--fixtures DIR]
  node bin/paper-cuts.js compare --before REPORT.json --after REPORT.json
  node bin/paper-cuts.js serve [--run DIRECTORY] [--port 8765]

run writes a self-contained report.html and report.json.
Exit codes: 0 all checks passed; 1 failed or unsupported checks; 2 execution/input error.
serve binds to 127.0.0.1 only and serves the selected report.
compare exits 1 for lost passes, 2 for invalid/incomparable reports or execution errors.
`;

function parseArgs(args) {
  const [command = "help", ...rest] = args;
  const allowed = {
    run: ["parser", "case", "fixtures", "out"],
    list: ["fixtures"],
    compare: ["before", "after"],
    serve: ["run", "port"],
    help: [],
  };
  if (!allowed[command]) throw new Error(`Unknown command: ${command}`);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i].replace(/^--/, "");
    if (
      !rest[i].startsWith("--") ||
      !allowed[command].includes(flag) ||
      !rest[i + 1] ||
      rest[i + 1].startsWith("--") ||
      flag in options
    ) {
      throw new Error(`Invalid or duplicate option: ${rest[i]}`);
    }
    options[flag] = rest[i + 1];
  }
  return { command, options };
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

async function serve(options) {
  let directory = options.run && path.resolve(options.run);
  if (!directory) {
    let names;
    try {
      names = await readdir(path.join(ROOT, "runs"), { withFileTypes: true });
    } catch {
      throw new Error("No reports yet. Run npm run check first.");
    }
    for (const entry of names
      .filter((e) => e.isDirectory())
      .sort((a, b) => b.name.localeCompare(a.name))) {
      const candidate = path.join(ROOT, "runs", entry.name);
      try {
        if ((await stat(path.join(candidate, "report.html"))).isFile()) {
          directory = candidate;
          break;
        }
      } catch {
        /* incomplete run */
      }
    }
  }
  if (!directory) throw new Error("No complete reports found.");
  const html = await readFile(path.join(directory, "report.html"));
  const json = await readFile(path.join(directory, "report.json"));
  const port = Number(options.port ?? 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Port must be an integer between 1024 and 65535.");
  const server = createServer((req, res) => {
    // Only a loopback name is accepted, so a hostile page whose DNS name
    // resolves to 127.0.0.1 cannot read the report (DNS rebinding).
    const host = /^([^:/]+|\[[^\]]*\])(?::\d+)?$/.exec(req.headers.host ?? "");
    if (!host || !LOOPBACK_HOSTS.has(host[1].toLowerCase())) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    // Origin-form targets only. Absolute-form and protocol-relative targets are
    // malformed for this server, and `new URL` throws on some of them.
    let pathname;
    try {
      if (!/^\/(?!\/)/.test(req.url)) throw new Error("not origin-form");
      pathname = new URL(req.url, "http://127.0.0.1").pathname;
    } catch {
      res.writeHead(400);
      res.end("Bad request");
      return;
    }
    const content =
      pathname === "/" || pathname === "/report.html"
        ? html
        : pathname === "/report.json"
          ? json
          : null;
    if (!content || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": pathname.endsWith(".json")
        ? "application/json; charset=utf-8"
        : "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  });
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Paper Cuts: http://127.0.0.1:${port}\nReport: ${directory}\nPress Ctrl+C to stop.`,
    );
  });
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help") console.log(HELP);
  else if (command === "serve") await serve(options);
  else if (command === "compare") {
    if (!options.before || !options.after)
      throw new Error("compare requires --before and --after report paths.");
    const result = compareReports(
      JSON.parse(await readFile(options.before, "utf8")),
      JSON.parse(await readFile(options.after, "utf8")),
    );
    for (const change of result.changes)
      console.log(
        `${change.regression ? "REGRESSION" : "CHANGE"} ${change.caseId} / ${change.parser} / ${change.checkId}: ${change.before} -> ${change.after}`,
      );
    console.log(
      `${result.checks} checks compared. ${result.regressions} regressions, ${result.errors} execution errors.`,
    );
    process.exitCode = result.errors ? 2 : result.regressions ? 1 : 0;
  } else {
    let fixtures = await loadFixtures(
      options.fixtures
        ? path.resolve(options.fixtures)
        : path.join(ROOT, "fixtures"),
    );
    if (command === "list")
      for (const f of fixtures)
        console.log(
          `${f.id.padEnd(23)} ${f.language.padEnd(8)} ${f.checks.length} checks  ${f.title}`,
        );
    else {
      if (options.case)
        fixtures = fixtures.filter((f) => f.id === options.case);
      if (!fixtures.length) throw new Error(`Unknown case: ${options.case}`);
      const selection = options.parser ?? "all";
      if (![...PARSERS, "all"].includes(selection))
        throw new Error(`Unknown parser: ${selection}`);
      const parsers = selection === "all" ? PARSERS : [selection];
      const report = await runSuite(fixtures, parsers);
      const stamp = report.createdAt.replaceAll(":", "-").replaceAll(".", "-");
      const directory = options.out
        ? path.resolve(options.out)
        : path.join(ROOT, "runs", stamp);
      await mkdir(path.dirname(directory), { recursive: true });
      await writeReport(directory, report, fixtures);
      for (const a of report.adapters.filter((a) => a.adapterOverride))
        console.log(
          `Paper Cuts: adapter override active for ${a.parser}: ${a.adapterOverride.script} (sha256 ${a.adapterOverride.sha256}). This is not a run of the built-in adapter.`,
        );
      for (const c of report.cases)
        for (const r of c.results) {
          console.log(
            `${c.id.padEnd(23)} ${r.parser.padEnd(12)} ${r.status.toUpperCase().padEnd(12)} ${r.counts.pass} pass / ${r.counts.fail} fail / ${r.counts.unsupported} unsupported / ${r.counts.error} error`,
          );
        }
      console.log(
        `\n${fixtures.length} documents, ${parsers.length} parsers. ${JSON.stringify(report.counts)}\nReport: ${path.join(directory, "report.html")}`,
      );
      process.exitCode = report.counts.error
        ? 2
        : report.counts.fail || report.counts.unsupported
          ? 1
          : 0;
    }
  }
} catch (error) {
  console.error(`Paper Cuts: ${error.message}`);
  process.exitCode = 2;
}
