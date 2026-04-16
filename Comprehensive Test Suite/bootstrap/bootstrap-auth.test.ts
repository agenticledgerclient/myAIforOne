/**
 * bootstrap-auth.test.ts
 * Verifies the first-run shared-gateway bootstrap logic in src/index.ts:
 *
 *   When MYAGENT_DATA_DIR points at a directory that has NO config.json,
 *   the process MUST refuse to start unless BOTH
 *       INITIAL_AUTH_TOKEN
 *       INITIAL_AUTH_PASSWORD
 *   environment variables are set. This guards against accidentally exposing
 *   a Railway/Linux deployment as an open gateway.
 *
 * Strategy:
 *   Spawn the compiled dist/index.js (or, via tsx, the .ts source) as a
 *   subprocess with a freshly-created empty temp dir and specific env vars,
 *   then verify the exit code + stderr contents.
 *
 *   Tests are skipped when:
 *     - dist/index.js doesn't exist (pre-build state)
 *   so the suite stays green in fresh clones.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// .../Comprehensive Test Suite/bootstrap/bootstrap-auth.test.ts → repo root
const REPO_ROOT = resolve(__dirname, "..", "..");
const INDEX_JS = join(REPO_ROOT, "dist", "index.js");

function distAvailable(): boolean {
  return existsSync(INDEX_JS);
}

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Spawn `node dist/index.js` with a given env, capture output, and kill after
 * `timeoutMs`. If the process exits on its own before timeout (as in the
 * refusal path), we get the exit code directly.
 */
function runGateway(env: Record<string, string | undefined>, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolveRun) => {
    // Ensure a totally minimal PATH-only env so we don't inherit noisy vars from
    // the test harness (we WANT to verify the refusal with only what we pass).
    const cleanEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // Drop any INITIAL_AUTH_* the harness might have inherited from a parent.
    };
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete cleanEnv[k];
      else cleanEnv[k] = v;
    }

    const child = spawn("node", [INDEX_JS], {
      cwd: REPO_ROOT,
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => { stdout += b.toString(); });
    child.stderr?.on("data", (b) => { stderr += b.toString(); });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr, timedOut });
    });
  });
}

describe("first-run bootstrap refusal (MYAGENT_DATA_DIR without auth env)", () => {
  it("exits non-zero with 'Refusing to start' when INITIAL_AUTH_TOKEN + INITIAL_AUTH_PASSWORD are missing", async () => {
    if (!distAvailable()) return; // skip if not built
    const dataDir = mkdtempSync(join(tmpdir(), "myagent-boot-"));
    try {
      const r = await runGateway({
        MYAGENT_DATA_DIR: dataDir,
        // Explicitly unset both auth vars
        INITIAL_AUTH_TOKEN: undefined,
        INITIAL_AUTH_PASSWORD: undefined,
      }, 8000);

      assert.equal(r.timedOut, false, "process should exit quickly; it should NOT keep running");
      assert.notEqual(r.code, 0, "process must exit non-zero on refusal");
      const output = r.stderr + r.stdout;
      assert.match(output, /Refusing to start a shared gateway without auth/i,
        `expected refusal message; got:\n--- stderr ---\n${r.stderr}\n--- stdout ---\n${r.stdout}`);
      assert.match(output, /INITIAL_AUTH_TOKEN/, "should mention INITIAL_AUTH_TOKEN");
      assert.match(output, /INITIAL_AUTH_PASSWORD/, "should mention INITIAL_AUTH_PASSWORD");
      // No config.json should have been written to the empty data dir.
      assert.ok(!existsSync(join(dataDir, "config.json")),
        "config.json must not be written when bootstrap is refused");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when only INITIAL_AUTH_TOKEN is set (password missing)", async () => {
    if (!distAvailable()) return;
    const dataDir = mkdtempSync(join(tmpdir(), "myagent-boot-"));
    try {
      const r = await runGateway({
        MYAGENT_DATA_DIR: dataDir,
        INITIAL_AUTH_TOKEN: "token-only-no-password",
        INITIAL_AUTH_PASSWORD: undefined,
      }, 8000);

      assert.equal(r.timedOut, false);
      assert.notEqual(r.code, 0, "missing password alone must still refuse");
      const output = r.stderr + r.stdout;
      assert.match(output, /Refusing to start/i);
      assert.ok(!existsSync(join(dataDir, "config.json")),
        "config.json must not be written when bootstrap is refused");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when only INITIAL_AUTH_PASSWORD is set (token missing)", async () => {
    if (!distAvailable()) return;
    const dataDir = mkdtempSync(join(tmpdir(), "myagent-boot-"));
    try {
      const r = await runGateway({
        MYAGENT_DATA_DIR: dataDir,
        INITIAL_AUTH_TOKEN: undefined,
        INITIAL_AUTH_PASSWORD: "password-only-no-token",
      }, 8000);

      assert.equal(r.timedOut, false);
      assert.notEqual(r.code, 0, "missing token alone must still refuse");
      const output = r.stderr + r.stdout;
      assert.match(output, /Refusing to start/i);
      assert.ok(!existsSync(join(dataDir, "config.json")),
        "config.json must not be written when bootstrap is refused");
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("when config.json already exists at MYAGENT_DATA_DIR, bootstrap block is bypassed (no refusal)", async () => {
    if (!distAvailable()) return;
    const dataDir = mkdtempSync(join(tmpdir(), "myagent-boot-"));
    try {
      // Pre-seed a minimal config.json — this makes the bootstrap branch a no-op.
      // The process may still fail to fully start (license, channels, etc.) but
      // it must NOT emit the "Refusing to start" message within a short window.
      writeFileSync(join(dataDir, "config.json"), JSON.stringify({
        service: {
          logLevel: "error",
          webUI: { enabled: false, port: 0 },
        },
        channels: {},
        agents: {},
        defaultAgent: null,
      }, null, 2));

      const r = await runGateway({
        MYAGENT_DATA_DIR: dataDir,
        INITIAL_AUTH_TOKEN: undefined,
        INITIAL_AUTH_PASSWORD: undefined,
      }, 3000);

      // Either the process is still running (timed out, meaning it got past
      // the bootstrap guard) or it exited for some other reason. In both
      // cases the "Refusing to start" banner must NOT appear.
      const output = r.stderr + r.stdout;
      assert.doesNotMatch(output, /Refusing to start a shared gateway without auth/i,
        `bootstrap guard should not fire when config.json already exists; output:\n${output}`);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
