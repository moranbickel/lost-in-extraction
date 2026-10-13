// These are explicit text/row assertions, not judgments about a document's meaning.
export const STATUSES = ["pass", "fail", "unsupported", "error"];

// Format characters that PDF producers insert without changing what a reader
// sees: bidi marks and isolates, soft hyphen, zero-width characters, word joiner,
// Arabic letter mark, variation selectors, BOM. They are removed before matching
// only; the report keeps the raw text. U+E000 (private use) is removed too,
// because it is the superscript marker below and must not occur in the input.
const INVISIBLE =
  /[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufe00-\ufe0f\ufeff\ue000]/gu;
// A superscript digit is a footnote or exponent mark, not an ordinary digit.
// NFKC would fold it into the digits beside it ("day.\u00b9" -> "day.1"), so a
// run becomes a separate token: a private-use marker followed by its digits.
const SUPERSCRIPT = /[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+/gu;
const SUPERSCRIPT_DIGITS =
  "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079";
// Dash punctuation, plus the minus sign and plus, carry the sign of an amount.
const SIGN = /^[\p{Pd}\u2212+]$/u;

export function normalize(text) {
  return text
    .replace(INVISIBLE, "")
    .replace(
      SUPERSCRIPT,
      (run) =>
        " \ue000" + [...run].map((c) => SUPERSCRIPT_DIGITS.indexOf(c)).join(""),
    )
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

// Tokens remember whether whitespace preceded them, so that "A/004208"
// (joined) can be told from "ended. 004208" (separate).
function tokens(text) {
  const clean = normalize(text);
  return [
    ...clean.matchAll(/[\p{L}\p{M}\p{N}]+(?:[.,][\p{N}]+)*|[^\s]/gu),
  ].map((m) => ({
    text: m[0],
    joined: m.index > 0 && clean[m.index - 1] !== " ",
  }));
}

// Marks that attach an identifier or amount to whatever precedes it.
const JOINING = new Set(["/", "\\", "_", "#", "&", "@", ".", ","]);

export function containsSequence(text, expected) {
  const haystack = tokens(text);
  const needle = tokens(expected);
  if (!needle.length) return false;
  const startsAmount = /^[\p{N}$\u20ac\u20aa\u00a3]/u.test(needle[0].text);
  return haystack.some((_, index) => {
    const matches = needle.every(
      (token, offset) => haystack[index + offset]?.text === token.text,
    );
    if (!matches || !startsAmount) return matches;
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    // A positive amount must not match inside a negative one: -5, \u20135, (5).
    if (before && SIGN.test(before.text)) return false;
    // Parentheses count only when they close directly on the amount.
    if (
      before?.text === "(" &&
      after?.text === ")" &&
      /^\p{N}/u.test(needle.at(-1).text)
    )
      return false;
    // An identifier or amount must not be the tail of a longer joined one.
    if (before && JOINING.has(before.text) && haystack[index].joined)
      return false;
    return true;
  });
}

export function validateCase(value) {
  const fail = (message) => {
    throw new Error(`Invalid fixture ${value?.id ?? "(unnamed)"}: ${message}`);
  };
  if (!value || value.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (
    typeof value.id !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.id)
  )
    fail("invalid id");
  for (const field of [
    "title",
    "documentTitle",
    "description",
    "language",
    "category",
    "construction",
  ]) {
    if (typeof value[field] !== "string" || !value[field].trim())
      fail(`${field} must be nonempty`);
  }
  if (
    !Array.isArray(value.document) ||
    !value.document.length ||
    value.document.some((p) => !Array.isArray(p) || !p.length)
  ) {
    fail("at least one nonempty source page is required");
  }
  if (!Array.isArray(value.checks) || !value.checks.length)
    fail("at least one check is required");
  const seen = new Set();
  for (const check of value.checks) {
    if (
      !check ||
      typeof check.id !== "string" ||
      !check.id ||
      seen.has(check.id)
    )
      fail("empty or duplicate check id");
    seen.add(check.id);
    if (!["contains", "row"].includes(check.kind))
      fail(`unknown check kind: ${check.kind}`);
    if (typeof check.label !== "string" || !check.label.trim())
      fail("missing check label");
    if (
      !Number.isInteger(check.page) ||
      check.page < 1 ||
      check.page > value.document.length
    )
      fail("invalid check page");
    if (
      !Array.isArray(check.region) ||
      check.region.length !== 4 ||
      !check.region.every(Number.isFinite) ||
      check.region[0] < 0 ||
      check.region[1] < 0 ||
      check.region[2] <= check.region[0] ||
      check.region[3] <= check.region[1]
    ) {
      fail("region must be [left, top, right, bottom] in PDF points");
    }
    for (const key of check.kind === "contains"
      ? ["expected"]
      : ["anchor", "value"]) {
      if (typeof check[key] !== "string" || !normalize(check[key]))
        fail(`missing ${key}`);
    }
  }
  return value;
}

export function summarize(checks) {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const check of checks) {
    if (!STATUSES.includes(check.status))
      throw new Error(`Unknown check status: ${check.status}`);
    counts[check.status]++;
  }
  return counts;
}

export function overall(checks) {
  if (!checks.length || checks.some((c) => c.status === "error"))
    return "error";
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "unsupported")) return "unsupported";
  return "pass";
}

export function evaluateCase(fixture, document, capabilities) {
  return fixture.checks.map((check) => {
    const result = (status, reason, observed = "") => ({
      ...check,
      status,
      reason,
      observed,
    });
    if (!document || document.error)
      return result(
        "error",
        document?.error ?? "Adapter returned no document.",
      );
    if (
      !Array.isArray(document.pages) ||
      document.pages.length !== fixture.document.length
    ) {
      return result(
        "error",
        "Adapter page count does not match the source PDF.",
      );
    }
    const page = document.pages.find((p) => p.number === check.page);
    if (!page || typeof page.text !== "string")
      return result("error", "Adapter returned an invalid or missing page.");
    if (!capabilities.includes("text"))
      return result("unsupported", "This adapter does not provide page text.");
    if (check.kind === "contains") {
      const found = containsSequence(page.text, check.expected);
      return result(
        found ? "pass" : "fail",
        found
          ? "Expected token sequence found on the source page."
          : "Expected token sequence absent from this page. See the raw extraction.",
        found ? check.expected : page.text,
      );
    }
    if (!capabilities.includes("spatial-lines")) {
      return result(
        "unsupported",
        "This adapter provides plain text only; row association requires word positions.",
      );
    }
    if (
      !Array.isArray(page.lines) ||
      page.lines.some(
        (line) =>
          typeof line.text !== "string" ||
          !Array.isArray(line.bbox) ||
          line.bbox.length !== 4 ||
          !line.bbox.every(Number.isFinite),
      )
    ) {
      return result(
        "error",
        "Adapter advertised spatial lines but returned invalid line data.",
      );
    }
    const [left, top, right, bottom] = check.region;
    // Require a line centered in the authored source region and overlapping its horizontal span.
    const nearby = page.lines.filter((line) => {
      const [x0, y0, x1, y1] = line.bbox;
      const y = (y0 + y1) / 2;
      return y >= top && y <= bottom && x1 >= left && x0 <= right;
    });
    const anchors = nearby.filter((line) =>
      containsSequence(line.text, check.anchor),
    );
    if (anchors.length !== 1)
      return result(
        "fail",
        anchors.length
          ? "The row label is ambiguous in this region."
          : "The expected row label was not found in this region.",
        nearby.map((line) => line.text).join("\n"),
      );
    const found = containsSequence(anchors[0].text, check.value);
    return result(
      found ? "pass" : "fail",
      found
        ? "Label and value occur on the same spatial line."
        : "The row label survived, but its expected value is absent from that line.",
      anchors[0].text,
    );
  });
}
