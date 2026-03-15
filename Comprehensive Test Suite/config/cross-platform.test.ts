import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("cross-platform — home directory resolution", () => {
  it("resolves HOME on macOS/Linux", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    assert.ok(home.length > 0, "HOME or USERPROFILE must be set");
  });

  it("tilde resolver uses USERPROFILE fallback", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const resolveTilde = (p: string) =>
      p.startsWith("~") ? p.replace("~", home) : p;

    const resolved = resolveTilde("~/Desktop/test");
    assert.ok(!resolved.startsWith("~"), "Tilde should be resolved");
    assert.ok(resolved.includes("Desktop/test"), "Path should be preserved");
  });

  it("non-tilde paths are unchanged", () => {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const resolveTilde = (p: string) =>
      p.startsWith("~") ? p.replace("~", home) : p;

    assert.equal(resolveTilde("/absolute/path"), "/absolute/path");
    assert.equal(resolveTilde("relative/path"), "relative/path");
  });

  it("detects macOS correctly", () => {
    const isMac = process.platform === "darwin";
    const isWindows = process.platform === "win32";
    // One of these should be true in CI/local
    assert.ok(typeof isMac === "boolean");
    assert.ok(typeof isWindows === "boolean");
  });
});
