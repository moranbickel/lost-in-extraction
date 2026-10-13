import test from "node:test";
import assert from "node:assert/strict";
import {
  containsSequence,
  evaluateCase,
  overall,
  validateCase,
} from "../lib/checks.js";

const check = {
  id: "due",
  label: "Outstanding amount",
  kind: "contains",
  expected: "Outstanding: $0",
  page: 1,
  region: [0, 10, 200, 40],
};
const fixture = {
  schemaVersion: 1,
  id: "control",
  title: "Control",
  documentTitle: "Control",
  description: "Control",
  language: "English",
  category: "Numbers",
  construction: "Control",
  document: [[{ text: "Outstanding: $0" }]],
  checks: [check],
};
const evaluate = (text, custom = fixture) =>
  evaluateCase(custom, { pages: [{ number: 1, text }] }, ["text"])[0];

test("whitespace and typographic ligatures can normalize without changing words", () => {
  assert.equal(
    containsSequence("The ofﬁce\n  remains open.", "The office remains open."),
    true,
  );
});
test("leading zeros cannot be lost", () =>
  assert.equal(containsSequence("ID: 127", "ID: 000127"), false));
test("zero cannot match a fractional amount", () =>
  assert.equal(
    containsSequence("Outstanding: $0.50", "Outstanding: $0"),
    false,
  ));
test("a positive amount cannot match a negative substring", () => {
  for (const text of ["-$10,000", "−$10,000", "-0.75%"]) {
    assert.equal(containsSequence(text, text.replace(/^[-−]/, "")), false);
  }
  assert.equal(containsSequence("Credit: -$10,000", "Credit: -$10,000"), true);
});
test("dropping a negation fails even when every other word survives", () => {
  assert.equal(
    containsSequence(
      "The goods must be shipped.",
      "The goods must not be shipped.",
    ),
    false,
  );
});
test("an unrelated occurrence of not does not rescue the sentence", () => {
  assert.equal(
    containsSequence(
      "The goods must be shipped. Payment is not received.",
      "The goods must not be shipped.",
    ),
    false,
  );
});
test("Hebrew must be in logical order", () => {
  assert.equal(
    containsSequence("אין לשלוח את הסחורה", "אין לשלוח את הסחורה"),
    true,
  );
  assert.equal(
    containsSequence("הרוחסה תא חולשל ןיא", "אין לשלוח את הסחורה"),
    false,
  );
});
test("empty extraction is a failed assertion, not a pass", () =>
  assert.equal(evaluate("").status, "fail"));
test("missing pages and parser failures are execution errors", () => {
  assert.equal(
    evaluateCase(fixture, { pages: [] }, ["text"])[0].status,
    "error",
  );
  assert.equal(
    evaluateCase(fixture, { error: "bad PDF" }, ["text"])[0].status,
    "error",
  );
});
test("the expected sentence on a different page cannot satisfy a check", () => {
  const f = {
    ...fixture,
    document: [fixture.document[0], fixture.document[0]],
  };
  assert.equal(
    evaluateCase(
      f,
      {
        pages: [
          { number: 1, text: "" },
          { number: 2, text: check.expected },
        ],
      },
      ["text"],
    )[0].status,
    "fail",
  );
});
const rowCheck = { ...check, kind: "row", anchor: "Outstanding", value: "$0" };
const rowFixture = { ...fixture, checks: [rowCheck] };
test("row checks cannot pass using plain text alone", () => {
  assert.equal(evaluate("Outstanding $0", rowFixture).status, "unsupported");
});
test("a value elsewhere in the document cannot satisfy its row", () => {
  const doc = {
    pages: [
      {
        number: 1,
        text: "Paid $0\nOutstanding $10,000",
        lines: [
          { text: "Outstanding $10,000", bbox: [0, 15, 150, 30] },
          { text: "Paid $0", bbox: [0, 55, 150, 70] },
        ],
      },
    ],
  };
  assert.equal(
    evaluateCase(rowFixture, doc, ["text", "spatial-lines"])[0].status,
    "fail",
  );
  doc.pages[0].lines[0].text = "Outstanding $0";
  assert.equal(
    evaluateCase(rowFixture, doc, ["text", "spatial-lines"])[0].status,
    "pass",
  );
});
test("ambiguous labels and missing position data do not pass", () => {
  const line = { text: "Outstanding $0", bbox: [0, 15, 150, 30] };
  assert.equal(
    evaluateCase(
      rowFixture,
      { pages: [{ number: 1, text: "", lines: [line, line] }] },
      ["text", "spatial-lines"],
    )[0].status,
    "fail",
  );
  assert.equal(
    evaluateCase(
      rowFixture,
      { pages: [{ number: 1, text: "Outstanding $0" }] },
      ["text", "spatial-lines"],
    )[0].status,
    "error",
  );
});
test("an empty suite has no passing status", () =>
  assert.equal(overall([]), "error"));
test("invalid and vacuous fixture specifications are rejected", () => {
  for (const invalid of [
    { ...fixture, id: undefined },
    { ...fixture, checks: [] },
    { ...fixture, checks: [check, check] },
    { ...fixture, checks: [{ ...check, expected: " " }] },
    { ...fixture, checks: [{ ...check, kind: "mystery" }] },
  ]) {
    assert.throws(() => validateCase(invalid), /Invalid fixture/);
  }
});

// A positive expected amount must never be satisfied by a negative one.
test("every dash, minus and accounting-parenthesis form carries a sign", () => {
  const negatives = [
    "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015",
    "\u2212", "\ufe63", "\uff0d", "-", "+",
  ];
  for (const sign of negatives) {
    assert.equal(
      containsSequence(`Balance ${sign}5 due`, "Balance 5 due"),
      false,
      `U+${sign.codePointAt(0).toString(16)} before a digit`,
    );
    assert.equal(
      containsSequence(`Fee ${sign}$1,250.50`, "$1,250.50"),
      false,
      `U+${sign.codePointAt(0).toString(16)} before a currency amount`,
    );
  }
  assert.equal(containsSequence("Balance (5) due", "5"), false);
  assert.equal(containsSequence("Fee ($1,250.50)", "$1,250.50"), false);
  assert.equal(containsSequence("Fee ( 1,250.50 )", "1,250.50"), false);
});
test("an unsigned amount still matches where nothing negates it", () => {
  // NEGATIVE CONTROL FOR the sign guard. DO NOT DELETE AS REDUNDANT.
  // Protects: legitimate matches. Without it a guard that blocks every
  // preceding or surrounding mark would pass the test above and turn every
  // amount in a sentence, list or parenthetical into a false failure.
  for (const [text, expected] of [
    ["Balance 5 due", "5"],
    ["Fee: $1,250.50.", "$1,250.50"],
    ["Fee ($1,250.50 each)", "$1,250.50"],
    ["Pay within (5 days)", "5 days"],
    ["Items (5) and (6)", "(5)"],
  ]) {
    assert.equal(containsSequence(text, expected), true, text);
  }
});
test("a spaced dash before an amount is read as a sign (documented limit)", () => {
  // Whitespace is ignored, so "Total – $5" cannot be told from "-$5".
  // The checker prefers a false failure to a false pass here.
  assert.equal(containsSequence("Total – $5", "$5"), false);
});
test("an identifier cannot match inside a longer joined identifier", () => {
  for (const text of [
    "Acct A/004208", "Acct ID_004208", "Acct #004208", "Acct A\\004208",
    "Acct a&004208", "Acct x@004208", "Acct .004208", "Acct ,004208",
  ]) {
    assert.equal(containsSequence(text, "004208"), false, text);
  }
  for (const text of [
    "Reference: 004208", "Ref 004208", "ID 004208.", "item 3, 004208",
    "It ended. 004208 followed", "ID: 004208",
  ]) {
    assert.equal(containsSequence(text, "004208"), true, text);
  }
});

test("invisible format characters do not break a match", () => {
  const invisible = [
    "\u200e", "\u200f", "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",
    "\u2066", "\u2067", "\u2068", "\u2069", "\u00ad", "\u200b", "\u200c",
    "\u200d", "\ufeff", "\u2060", "\u061c", "\ufe00", "\ufe0f",
  ];
  for (const mark of invisible) {
    const name = `U+${mark.codePointAt(0).toString(16)}`;
    assert.equal(containsSequence(`pay${mark}ment due`, "payment due"), true, name);
    assert.equal(containsSequence("0042" + mark + "08", "004208"), true, name);
    assert.equal(containsSequence(`ספק${mark}: חברת ארז`, "ספק: חברת ארז"), true, name);
    assert.equal(containsSequence("payment due", `pay${mark}ment due`), true, name);
  }
});
test("invisible characters do not make different words equal", () => {
  // NEGATIVE CONTROL FOR the invisible-character stripping. DO NOT DELETE AS REDUNDANT.
  // Protects: that stripping removes only format characters. Without it,
  // stripping letters or digits as well would pass the test above.
  assert.equal(containsSequence("pay\u200f ment", "paymen"), false);
  assert.equal(containsSequence("0042\u200b09", "004208"), false);
});
test("a superscript footnote marker is separate from the word it follows", () => {
  assert.equal(containsSequence("Open every day.\u00b9", "Open every day."), true);
  assert.equal(containsSequence("Open every day.\u00b9", "Open every day.\u00b9"), true);
  assert.equal(containsSequence("Open every day.", "Open every day.\u00b9"), false);
  // A superscript digit is not an ordinary digit.
  assert.equal(containsSequence("10\u00b2", "102"), false);
  assert.equal(containsSequence("area 10\u00b2", "area 10\u00b2"), true);
});

test("the footnote fixture fails when the marker linking footnote and statement is lost", async () => {
  // PROTECTS: the footnote fixture's purpose. Before the marker was part of the
  // expected text, both of its checks passed even when the "*" was dropped,
  // so the fixture could not tell a footnote from two unrelated sentences.
  const { readFile } = await import("node:fs/promises");
  const recipe = JSON.parse(
    await readFile(
      new URL("../fixtures/footnote-exception/case.json", import.meta.url),
      "utf8",
    ),
  );
  const run = (text) =>
    evaluateCase(recipe, { pages: [{ number: 1, text }] }, ["text"]).map(
      (r) => r.status,
    );
  assert.deepEqual(
    run(
      "Support is available every day.*\nContact the service desk for assistance.\n* Except public holidays in the service region.",
    ),
    ["pass", "pass"],
  );
  assert.deepEqual(
    run(
      "Support is available every day.\nContact the service desk for assistance.\nExcept public holidays in the service region.",
    ),
    ["fail", "fail"],
  );
});

test("a superscript marker cannot be forged with ordinary characters", () => {
  // NEGATIVE CONTROL FOR the superscript handling. DO NOT DELETE AS REDUNDANT.
  // Protects: a superscript digit stays distinguishable from printable text in
  // both directions. Without it, encoding superscripts with a printable stand-in
  // (" ^") passes every other superscript test while "10^2" satisfies an
  // expected "10\u00b2", and a literal " ^1" satisfies a footnote marker.
  assert.equal(containsSequence("10^2", "10\u00b2"), false);
  assert.equal(containsSequence("10\u00b2", "10^2"), false);
  assert.equal(containsSequence("x ^1", "x\u00b9"), false);
  assert.equal(containsSequence("x\u00b9", "x ^1"), false);
  // A private-use character in the document is dropped, so it cannot stand in for one.
  assert.equal(containsSequence("x\ue0001", "x\u00b9"), false);
  assert.equal(containsSequence("x\u00b9", "x\ue0001"), false);
  assert.equal(containsSequence("area 10\u00b2", "area 10\u00b2"), true);
});
