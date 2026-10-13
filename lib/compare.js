import { STATUSES } from "./checks.js";

function index(report) {
  if (
    report?.schemaVersion !== 1 ||
    !Array.isArray(report.cases) ||
    !report.cases.length
  )
    throw new Error("Not a nonempty version 1 report.");
  const entries = new Map();
  for (const c of report.cases) {
    if (
      typeof c.id !== "string" ||
      !c.sourceSha256 ||
      !c.caseSha256 ||
      !Array.isArray(c.results) ||
      !c.results.length
    )
      throw new Error("Invalid case in report.");
    for (const result of c.results) {
      if (
        typeof result.parser !== "string" ||
        !Array.isArray(result.checks) ||
        !result.checks.length
      )
        throw new Error("Invalid result in report.");
      for (const check of result.checks) {
        const key = JSON.stringify([c.id, result.parser, check.id]);
        if (
          typeof check.id !== "string" ||
          !STATUSES.includes(check.status) ||
          entries.has(key)
        )
          throw new Error("Invalid or duplicate check in report.");
        entries.set(key, {
          caseId: c.id,
          parser: result.parser,
          checkId: check.id,
          status: check.status,
          sourceSha256: c.sourceSha256,
          caseSha256: c.caseSha256,
          version: result.version,
        });
      }
    }
  }
  return entries;
}

// Which adapter script produced each parser's results: its sha256 when it was an
// override, null for the repository's own adapter (or a report that predates the field).
function adapterIdentity(report) {
  return new Map(
    (report.adapters ?? []).map((a) => [
      a.parser,
      a.adapterOverride?.sha256 ?? null,
    ]),
  );
}

export function compareReports(before, after) {
  const a = index(before),
    b = index(after);
  const identityBefore = adapterIdentity(before),
    identityAfter = adapterIdentity(after);
  for (const parser of new Set([...identityBefore.keys(), ...identityAfter.keys()]))
    if ((identityBefore.get(parser) ?? null) !== (identityAfter.get(parser) ?? null))
      throw new Error(
        `The ${parser} results were made by different adapter scripts. Reports from an adapter override cannot be compared with other reports.`,
      );
  if (a.size !== b.size || [...a.keys()].some((key) => !b.has(key)))
    throw new Error("Reports cover different cases, parsers, or checks.");
  const changes = [];
  for (const [key, old] of a) {
    const next = b.get(key);
    if (
      old.sourceSha256 !== next.sourceSha256 ||
      old.caseSha256 !== next.caseSha256
    )
      throw new Error(
        `Source or expected checks changed for ${old.caseId}. Re-establish the baseline.`,
      );
    if (old.status !== next.status)
      changes.push({
        ...next,
        before: old.status,
        after: next.status,
        regression:
          (old.status === "pass" && next.status !== "pass") ||
          (old.status !== "error" && next.status === "error"),
      });
  }
  return {
    changes,
    regressions: changes.filter((c) => c.regression).length,
    errors: [...b.values()].filter((c) => c.status === "error").length,
    checks: a.size,
  };
}
