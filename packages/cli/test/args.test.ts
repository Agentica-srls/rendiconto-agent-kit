import { describe, expect, it } from "vitest";
import { run, VERSION } from "../src/cli.js";
import { EXIT, exitCodeFor } from "../src/errors.js";
import { makeIo } from "./helpers.js";

describe("arg parsing and exit codes", () => {
  it("prints help and version with exit 0", async () => {
    const io = await makeIo();
    expect(await run(["--help"], io)).toBe(0);
    expect(io.stdout).toContain("rendiconto");
    expect(io.stdout).toContain("setup claude|cursor|desktop");
    const io2 = await makeIo();
    expect(await run(["--version"], io2)).toBe(0);
    expect(io2.stdout.trim()).toBe(VERSION);
  });

  it.each([
    [["nonsense"], "Comando sconosciuto"],
    [["whoami", "--nope"], "Opzione sconosciuta"],
    [["import"], "Uso: rendiconto import"],
    [["import", "x.csv"], "--conto"],
    [["movimenti", "--anno", "abc"], "--anno"],
    [["movimenti", "--anno", "1999"], "2000 e 2100"],
    [["movimenti", "extra"], "inatteso"],
    [["classifica"], "--suggerisci"],
    [["classifica", "--suggerisci", "--applica", "f.json"], "--suggerisci"],
    [["export", "bogus"], "Uso: rendiconto export"],
    [["export", "analisi", "--formato", "csv"], "supporta solo"],
    [["tools", "call"], "Uso: rendiconto tools call"],
    [["tools", "call", "x", "--args", "{bad"], "JSON"],
    [["setup", "vim"], "Uso: rendiconto setup"],
  ])("usage error %j exits 2", async (argv, fragment) => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: "rmcp_" + "X".repeat(43), RENDICONTO_BASE_URL: "http://127.0.0.1:1" } });
    const code = await run(argv, io);
    expect(code).toBe(EXIT.usage);
    expect(io.stderr).toContain(fragment);
    expect(io.stdout).toBe("");
  });

  it("--json writes a machine readable error to stderr", async () => {
    const io = await makeIo();
    expect(await run(["wat", "--json"], io)).toBe(2);
    expect(JSON.parse(io.stderr)).toMatchObject({ code: "usage" });
  });

  it("missing credentials exit 3", async () => {
    const io = await makeIo();
    expect(await run(["whoami"], io)).toBe(EXIT.auth);
    expect(io.stderr).toContain("rendiconto login");
  });

  it("maps server codes to exit codes", () => {
    expect(exitCodeFor("invalid_token")).toBe(3);
    expect(exitCodeFor("http_401")).toBe(3);
    expect(exitCodeFor("scope_not_granted")).toBe(4);
    expect(exitCodeFor("ai_not_granted")).toBe(4);
    expect(exitCodeFor("rate_limited")).toBe(5);
    expect(exitCodeFor("http_429")).toBe(5);
    expect(exitCodeFor("internal_error")).toBe(6);
    expect(exitCodeFor("timeout")).toBe(6);
    expect(exitCodeFor("agent_platform_disabled", 503)).toBe(6);
    expect(exitCodeFor("http_503")).toBe(6);
    expect(exitCodeFor("invalid_args")).toBe(1);
    expect(exitCodeFor("unknown_tool", 404)).toBe(1);
  });
});
