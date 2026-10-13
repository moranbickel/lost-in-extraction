import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { ROOT } from "../lib/suite.js";

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

async function startPreview() {
  const directory = path.join(ROOT, "tmp", "tests", randomUUID());
  await mkdir(directory, { recursive: true });
  const run = path.join(directory, "run");
  const made = spawnSync(
    process.execPath,
    [
      "bin/paper-cuts.js",
      "run",
      "--case",
      "leading-zeros",
      "--parser",
      "pypdf",
      "--out",
      run,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(made.status, 0, made.stderr);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    ["bin/paper-cuts.js", "serve", "--run", run, "--port", String(port)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (d) => {
      if (String(d).includes(`http://127.0.0.1:${port}`)) resolve();
    });
    child.on("exit", (code) =>
      reject(new Error(`preview exited ${code}: ${stderr}`)),
    );
  });
  return { child, port, stderr: () => stderr };
}

// Sends the bytes exactly as given; fetch() and URL parsers would normalise the target.
function rawRequest(
  port,
  target,
  { host = `127.0.0.1:${port}`, method = "GET" } = {},
) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () =>
      socket.write(
        `${method} ${target} HTTP/1.1\r\n` +
          (host === null ? "" : `Host: ${host}\r\n`) +
          "Connection: close\r\n\r\n",
      ),
    );
    socket.on("data", (d) => (data += d));
    socket.on("error", (error) => resolve({ error: error.code }));
    socket.on("close", () => {
      const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1]);
      resolve({ status: Number.isFinite(status) ? status : null, data });
    });
  });
}

test("preview server survives malformed request targets", async (t) => {
  // PROTECTS: the preview server staying up. Before the fix `GET //[` made
  // `new URL` throw inside the request callback and Node terminated the process.
  // Without this test a malformed target is a one-request denial of service
  // that every other server test (all well-formed requests) would not notice.
  const { child, port, stderr } = await startPreview();
  t.after(() => child.kill());
  for (const target of [
    "//[",
    "//",
    "//evil.example/report.json",
    "http://[",
    "*",
    "/%zz",
  ]) {
    const response = await rawRequest(port, target);
    assert.ok(
      response.status === 400 || response.status === 404,
      `${target}: ${response.error ?? response.status}`,
    );
    assert.equal(
      child.exitCode,
      null,
      `server exited after ${target}: ${stderr()}`,
    );
  }
  assert.equal((await rawRequest(port, "//[")).status, 400);
  assert.equal(
    (await rawRequest(port, "//evil.example/report.json")).status,
    400,
  );
  assert.equal((await rawRequest(port, "/report.json")).status, 200);
});

test("preview server rejects Host headers that are not the local machine", async (t) => {
  // PROTECTS: against DNS rebinding. Without the Host check a page served from a
  // hostile name that resolves to 127.0.0.1 can read the report; the path-only
  // tests would still pass because every path they use is a legitimate one.
  const { child, port } = await startPreview();
  t.after(() => child.kill());
  for (const host of [
    "evil.example",
    `evil.example:${port}`,
    "127.0.0.1.evil.example",
  ]) {
    const response = await rawRequest(port, "/report.json", { host });
    assert.equal(response.status, 403, `Host ${host}`);
  }
  // Node itself refuses an HTTP/1.1 request that has no Host header.
  assert.equal(
    (await rawRequest(port, "/report.json", { host: null })).status,
    400,
  );
  for (const host of [
    `127.0.0.1:${port}`,
    "127.0.0.1",
    `localhost:${port}`,
    "LOCALHOST",
  ]) {
    const response = await rawRequest(port, "/report.json", { host });
    assert.equal(response.status, 200, `Host ${host}`);
  }
});
