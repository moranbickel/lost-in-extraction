(() => {
  "use strict";
  const { report, assets } = JSON.parse(
    document.getElementById("report-data").textContent,
  );
  const $ = (id) => document.getElementById(id);
  const labels = {
    pass: "Passed",
    fail: "Failed",
    unsupported: "Unsupported",
    error: "Error",
  };
  const state = {
    filter: "all",
    query: "",
    language: "all",
    caseId: report.cases[0]?.id,
    parser:
      report.cases[0]?.results.find((r) => r.status === "fail")?.parser ??
      report.adapters[0]?.parser,
    checkId: null,
  };
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const dot = (status) => {
    const e = make("span", undefined, `dot ${status}`);
    e.setAttribute("aria-hidden", "true");
    return e;
  };
  const statusLabel = (status) => {
    const e = make("span", undefined, `status ${status}`);
    e.append(dot(status), document.createTextNode(labels[status]));
    return e;
  };
  const combined = (item) =>
    ["error", "fail", "unsupported", "pass"].find((s) =>
      item.results.some((r) => r.status === s),
    );
  const visible = () =>
    report.cases.filter(
      (item) =>
        (state.language === "all" || item.language === state.language) &&
        `${item.title} ${item.id} ${item.category} ${item.description}`
          .toLowerCase()
          .includes(state.query) &&
        (state.filter === "all" ||
          item.results.some((r) =>
            r.checks.some((c) => c.status === state.filter),
          )),
    );

  $("run-info").textContent =
    `${report.cases.length} documents / ${report.adapters.length} parsers\n${new Date(report.createdAt).toLocaleString()}\n${report.environment.platform} · Python ${report.adapters.find((a) => a.python)?.python ?? "unavailable"}${report.adapters.some((a) => a.adapterOverride) ? "\nadapter override: not the built-in adapter" : ""}`;
  const all = Object.values(report.counts).reduce((a, b) => a + b, 0);
  for (const [key, label, count] of [
    ["all", "All checks", all],
    ...Object.entries(report.counts).map(([k, v]) => [k, labels[k], v]),
  ]) {
    const button = make("button");
    button.dataset.filter = key;
    button.setAttribute("aria-pressed", String(state.filter === key));
    if (key !== "all") button.append(dot(key));
    button.append(make("span", label), make("span", String(count), "count"));
    button.onclick = () => {
      state.filter = key;
      render();
    };
    $("summary").append(button);
  }

  function render() {
    for (const button of $("summary").children)
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.filter === state.filter),
      );
    const cases = visible();
    if (!cases.some((c) => c.id === state.caseId)) state.caseId = cases[0]?.id;
    $("document-count").textContent =
      `${cases.length} / ${report.cases.length}`;
    $("case-list").replaceChildren();
    for (const item of cases) {
      const button = make("button", undefined, "case-button");
      button.setAttribute("aria-current", String(item.id === state.caseId));
      button.setAttribute(
        "aria-label",
        `${item.title}, ${item.language}, ${labels[combined(item)]}`,
      );
      const copy = make("span");
      copy.append(
        make("span", item.title, "case-title"),
        make("span", `${item.language} / ${item.category}`, "case-language"),
      );
      button.append(copy, dot(combined(item)));
      button.onclick = () => {
        state.caseId = item.id;
        state.checkId = null;
        render();
      };
      $("case-list").append(button);
    }
    $("document").hidden = !cases.length;
    $("empty").hidden = Boolean(cases.length);
    if (!cases.length) return;
    const item = cases.find((c) => c.id === state.caseId);
    const result =
      item.results.find((r) => r.parser === state.parser) ?? item.results[0];
    state.parser = result.parser;
    $("case-meta").textContent =
      `${item.language.toUpperCase()} / ${item.category.toUpperCase()}`;
    $("document-title").textContent = item.title;
    $("description").textContent = item.description;
    $("download-pdf").href = assets[item.id].pdf;
    $("download-pdf").download = `${item.id}.pdf`;
    $("parser-buttons").replaceChildren();
    for (const output of item.results) {
      const button = make("button");
      button.setAttribute(
        "aria-pressed",
        String(result.parser === output.parser),
      );
      button.append(make("span", output.parser), statusLabel(output.status));
      button.onclick = () => {
        state.parser = output.parser;
        render();
      };
      $("parser-buttons").append(button);
    }
    $("parser-version").textContent = result.version
      ? `v${result.version}`
      : "not available";
    const check =
      result.checks.find((c) => c.id === state.checkId) ??
      result.checks.find((c) => c.status === "fail") ??
      result.checks[0];
    state.checkId = check.id;
    $("checks").replaceChildren();
    for (const entry of result.checks) {
      const wrapper = make("div");
      wrapper.setAttribute("role", "listitem");
      const button = make("button", undefined, "check-row");
      button.setAttribute("aria-pressed", String(entry.id === check.id));
      button.append(make("span", entry.label), statusLabel(entry.status));
      button.onclick = () => {
        state.checkId = entry.id;
        render();
      };
      wrapper.append(button);
      $("checks").append(wrapper);
    }
    const page = result.pages.find((p) => p.number === check.page);
    $("extraction").textContent =
      page?.text || result.error || "(No text returned on this page.)";
    $("source-image").src = assets[item.id].previews[check.page - 1];
    $("source-image").alt =
      `${item.documentTitle}, page ${check.page}. Synthetic source PDF.`;
    $("source-caption").textContent =
      `Page ${check.page} / ${item.pageCount}. Highlight: ${check.label.toLowerCase()}.`;
    const [left, top, right, bottom] = check.region;
    Object.assign($("source-region").style, {
      left: `${(left / item.width) * 100}%`,
      top: `${(top / item.height) * 100}%`,
      width: `${((right - left) / item.width) * 100}%`,
      height: `${((bottom - top) / item.height) * 100}%`,
    });
    const showRegion = () => {
      const viewport = $("paper").parentElement;
      viewport.scrollTop = Math.max(
        0,
        (top / item.height) * $("paper").clientHeight -
          viewport.clientHeight / 3,
      );
    };
    $("source-image").onload = showRegion;
    requestAnimationFrame(showRegion);
    const detail = $("check-detail");
    detail.replaceChildren();
    detail.append(
      make(
        "p",
        check.kind === "row"
          ? "EXPECTED ON ONE SPATIAL LINE"
          : "EXPECTED TOKEN SEQUENCE",
        "detail-label",
      ),
    );
    const expected = make(
      "p",
      check.kind === "row"
        ? `${check.anchor}  |  ${check.value}`
        : check.expected,
      "expected",
    );
    expected.dir = "auto";
    detail.append(expected);
    detail.append(make("p", check.reason, "reason"));
    if (check.kind === "row" && check.observed) {
      detail.append(make("p", "OBSERVED IN THIS REGION", "detail-label"));
      const observed = make("p", check.observed, "expected observed");
      observed.dir = "auto";
      detail.append(observed);
    }
    detail.append(
      make(
        "p",
        `${labels[check.status]} · ${check.kind === "row" ? "Word positions required" : "NFKC normalization; whitespace ignored; case and punctuation retained"}`,
        "detail-label",
      ),
    );
    const metadata = report.adapters.find((a) => a.parser === result.parser);
    $("method-content").replaceChildren();
    $("method-content").append(
      make("p", item.construction),
      make(
        "p",
        "These cases are deliberately chosen stress tests and controls. Counts apply only to this suite and these adapter settings. An unsupported check is not a pass.",
      ),
      make(
        "pre",
        `Source SHA-256: ${item.sourceSha256}\nCase SHA-256: ${item.caseSha256}\nParser settings: ${JSON.stringify(metadata.settings ?? {})}\nDependencies: ${JSON.stringify(metadata.dependencies ?? {})}\nCapabilities: ${(metadata.capabilities ?? []).join(", ")}${metadata.adapterOverride ? `\nAdapter script (override): ${metadata.adapterOverride.script}\nAdapter script SHA-256: ${metadata.adapterOverride.sha256}` : ""}`,
      ),
    );
    if (metadata.stderr)
      $("method-content").append(make("pre", metadata.stderr));
  }

  $("search").addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });
  $("language").addEventListener("change", (event) => {
    state.language = event.target.value;
    render();
  });
  $("expand-source").onclick = () => {
    $("large-source").src = $("source-image").src;
    $("large-source").alt = $("source-image").alt;
    $("dialog-title").textContent = $("document-title").textContent;
    $("source-dialog").showModal();
  };
  $("close-dialog").onclick = () => $("source-dialog").close();
  $("source-dialog").addEventListener("click", (event) => {
    if (event.target === $("source-dialog")) $("source-dialog").close();
  });
  $("download-report").onclick = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = make("a");
    link.href = url;
    link.download = "paper-cuts-report.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  render();
})();
