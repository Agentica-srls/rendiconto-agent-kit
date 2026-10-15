import { readFile, stat } from "node:fs/promises";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { credentialsPath, loadCredentials, resolveAuth, saveCredentials } from "../src/config.js";
import { redactToken, scrubTokens } from "../src/redact.js";
import { FAKE_TOKEN, startMockServer, type MockServer } from "./mock-server.js";
import { makeIo } from "./helpers.js";

let mock: MockServer;
beforeAll(async () => (mock = await startMockServer()));
afterAll(async () => mock.close());

describe("credentials", () => {
  it("login saves ~/.config/rendiconto/credentials.json with mode 0600 and never prints the token", async () => {
    const io = await makeIo();
    io.answers.push(FAKE_TOKEN);
    const code = await run(["login", "--base-url", mock.url, "--profile", "ente-a"], io);
    expect(code).toBe(0);
    const file = credentialsPath(io.env);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.profiles["ente-a"].token).toBe(FAKE_TOKEN);
    expect(saved.profiles["ente-a"].workspace).toBe("APS Mock");
    expect(saved.default).toBe("ente-a");
    expect(io.stdout + io.stderr).not.toContain(FAKE_TOKEN);
    expect(io.stdout).toContain("…XXXX");
  });

  it("login accepts the token from stdin (--token-stdin) and rejects a malformed one with exit 2", async () => {
    const io = await makeIo();
    io.stdin = FAKE_TOKEN + "\n";
    expect(await run(["login", "--token-stdin", "--base-url", mock.url], io)).toBe(0);
    const bad = await makeIo();
    bad.answers.push("not-a-token");
    expect(await run(["login", "--base-url", mock.url], bad)).toBe(2);
  });

  it("login with a wrong token exits 3 and writes nothing", async () => {
    const io = await makeIo();
    io.answers.push("rmcp_" + "Y".repeat(43));
    expect(await run(["login", "--base-url", mock.url], io)).toBe(3);
    await expect(stat(credentialsPath(io.env))).rejects.toThrow();
    expect(io.stderr).not.toContain("YYYYYYYY");
  });

  it("a rewrite keeps mode 0600 even over a world-readable file", async () => {
    const io = await makeIo();
    await saveCredentials({ version: 1, profiles: { a: { token: FAKE_TOKEN } } }, io.env);
    const { chmod } = await import("node:fs/promises");
    await chmod(credentialsPath(io.env), 0o644);
    await saveCredentials({ version: 1, profiles: { a: { token: FAKE_TOKEN } } }, io.env);
    expect((await stat(credentialsPath(io.env))).mode & 0o777).toBe(0o600);
  });

  it("RENDICONTO_TOKEN overrides the saved profile; base url precedence flag > env > profile", async () => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: "rmcp_" + "E".repeat(43), RENDICONTO_BASE_URL: "http://env.example/" } });
    await saveCredentials({ version: 1, default: "p", profiles: { p: { token: FAKE_TOKEN, baseUrl: "http://profile.example" } } }, io.env);
    const a = await resolveAuth({}, io.env);
    expect(a.token).toBe("rmcp_" + "E".repeat(43));
    expect(a.source).toBe("env");
    expect(a.baseUrl).toBe("http://env.example");
    expect((await resolveAuth({ baseUrl: "http://flag.example" }, io.env)).baseUrl).toBe("http://flag.example");
    const noEnv = { RENDICONTO_CONFIG_DIR: io.env.RENDICONTO_CONFIG_DIR };
    const b = await resolveAuth({}, noEnv);
    expect(b).toMatchObject({ token: FAKE_TOKEN, baseUrl: "http://profile.example", source: "profile" });
    expect((await loadCredentials(noEnv)).default).toBe("p");
  });

  it("whoami with the env token works and prints only the redacted token", async () => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: FAKE_TOKEN } });
    expect(await run(["whoami", "--base-url", mock.url], io)).toBe(0);
    expect(io.stdout).toContain("APS Mock");
    expect(io.stdout + io.stderr).not.toContain(FAKE_TOKEN);
  });

  it("redaction helpers show at most the last 4 characters", () => {
    expect(redactToken(FAKE_TOKEN)).toBe("…XXXX");
    expect(scrubTokens(`boom ${FAKE_TOKEN} boom`)).not.toContain(FAKE_TOKEN);
    expect(scrubTokens(`boom ${FAKE_TOKEN}`)).toContain("rmcp_…XXXX");
  });
});
