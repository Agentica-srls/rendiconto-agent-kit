import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { run } from "../src/cli.js";
import { MCP_REMOTE_VERSION, claudeAddArgs, cursorServerEntry, desktopServerEntry } from "../src/setup.js";
import { FAKE_TOKEN } from "./mock-server.js";
import { makeIo } from "./helpers.js";
import fixtures from "./fixtures/app-snippets.json" with { type: "json" };

// Fixtures = the output of the app's own builder (src/lib/agent/snippets.ts buildSetupSnippets).
type Tab = { id: string; blocks: { id: string; text: string }[] };
const block = (tabs: Tab[], tab: string, id: string) => tabs.find((t) => t.id === tab)!.blocks.find((b) => b.id === id)!.text;

const quote = (a: string) => (/\s/.test(a) ? `"${a}"` : a);

describe("setup snippet shapes equal the app builder output", () => {
  it("claude: same command as the dialog", () => {
    expect(`claude ${claudeAddArgs("https://rendiconto.io").map(quote).join(" ")}`).toBe(block(fixtures.placeholder as Tab[], "claudeCode", "add"));
    expect(`claude ${claudeAddArgs("http://localhost:3300/".replace(/\/+$/, "")).map(quote).join(" ")}`).toBe(block(fixtures.custom as Tab[], "claudeCode", "add"));
  });

  it("cursor: same JSON, with the env reference in place of the token", () => {
    const expected = JSON.parse(block(fixtures.envRef as Tab[], "cursor", "config"));
    expect({ mcpServers: { rendiconto: cursorServerEntry("https://rendiconto.io") } }).toEqual(expected);
    expect(JSON.stringify(expected)).not.toContain("rmcp_");
  });

  it("desktop: same mcp-remote shape, with the bridge pinned to an exact version", () => {
    const expected = JSON.parse(block(fixtures.placeholder as Tab[], "claudeDesktop", "config"));
    // the app dialog still says «mcp-remote»; the kit pins it (F04) and the app must follow
    expected.mcpServers.rendiconto.args[1] = `mcp-remote@${MCP_REMOTE_VERSION}`;
    expect(MCP_REMOTE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect({ mcpServers: { rendiconto: desktopServerEntry("https://rendiconto.io", "Bearer rmcp_…") } }).toEqual(expected);
  });
});

describe("rendiconto setup", () => {
  it("claude runs «claude mcp add» with the env var reference, not the token", async () => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: FAKE_TOKEN } });
    expect(await run(["setup", "claude"], io)).toBe(0);
    expect(io.execCalls).toHaveLength(1);
    expect(io.execCalls[0].file).toBe("claude");
    expect(io.execCalls[0].args.join(" ")).toContain("Authorization: Bearer ${RENDICONTO_TOKEN}");
    expect(JSON.stringify(io.execCalls)).not.toContain(FAKE_TOKEN);
  });

  it("claude --con-token registers the token itself at user scope, so no export is needed; output shows only the last 4", async () => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: FAKE_TOKEN } });
    expect(await run(["setup", "claude", "--con-token"], io)).toBe(0);
    const add = io.execCalls.find((c) => c.args[1] === "add")!;
    expect(add.args).toContain("user");
    expect(add.args.join(" ")).toContain(`Authorization: Bearer ${FAKE_TOKEN}`);
    expect(io.execCalls[0].args.slice(0, 3)).toEqual(["mcp", "remove", "rendiconto"]);
    expect(io.stdout + io.stderr).not.toContain(FAKE_TOKEN);
  });

  it("claude --con-token --print never shows or needs a token", async () => {
    const io = await makeIo();
    expect(await run(["setup", "claude", "--con-token", "--print", "--json"], io)).toBe(0);
    expect(io.execCalls).toHaveLength(0);
    expect(JSON.parse(io.stdout).command).toContain("Bearer rmcp_…");
  });

  it("claude prints the command with --print and does not execute", async () => {
    const io = await makeIo();
    expect(await run(["setup", "claude", "--print", "--json"], io)).toBe(0);
    expect(io.execCalls).toHaveLength(0);
    expect(JSON.parse(io.stdout).command).toBe(block(fixtures.placeholder as Tab[], "claudeCode", "add"));
  });

  it("claude failure reports the command to run by hand", async () => {
    const io = await makeIo();
    io.execCode = 127;
    expect(await run(["setup", "claude"], io)).toBe(1);
    expect(io.stderr).toContain("claude mcp add");
  });

  it("cursor merges into an existing mcp.json and keeps other servers", async () => {
    const io = await makeIo();
    const file = join(io.homedir, ".cursor", "mcp.json");
    await mkdir(join(io.homedir, ".cursor"), { recursive: true });
    await writeFile(file, JSON.stringify({ mcpServers: { other: { url: "https://x" } }, theme: "dark" }));
    expect(await run(["setup", "cursor"], io)).toBe(0);
    const doc = JSON.parse(await readFile(file, "utf8"));
    expect(doc.theme).toBe("dark");
    expect(doc.mcpServers.other).toEqual({ url: "https://x" });
    expect(doc.mcpServers.rendiconto).toEqual(cursorServerEntry("https://rendiconto.io"));
  });

  it("cursor refuses to overwrite an invalid JSON file (exit 2)", async () => {
    const io = await makeIo();
    const file = join(io.homedir, "broken.json");
    await writeFile(file, "{ not json");
    expect(await run(["setup", "cursor", "--file", file], io)).toBe(2);
    expect(await readFile(file, "utf8")).toBe("{ not json");
  });

  it("desktop writes the bridge entry with the token, mode 0600, and prints only the last 4", async () => {
    const io = await makeIo({ env: { RENDICONTO_TOKEN: FAKE_TOKEN } });
    const file = join(io.homedir, "claude_desktop_config.json");
    expect(await run(["setup", "desktop", "--file", file], io)).toBe(0);
    const doc = JSON.parse(await readFile(file, "utf8"));
    expect(doc.mcpServers.rendiconto.env.AUTH).toBe(`Bearer ${FAKE_TOKEN}`);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(io.stdout + io.stderr).not.toContain(FAKE_TOKEN);
    expect(io.stdout).toContain("…XXXX");
    expect(doc.mcpServers.rendiconto.args[1]).toBe(`mcp-remote@${MCP_REMOTE_VERSION}`);
    expect(io.stdout).toContain("Cmd+Q");
  });

  it("desktop --print never needs or shows a token", async () => {
    const io = await makeIo();
    expect(await run(["setup", "desktop", "--print"], io)).toBe(0);
    expect(io.stdout).toContain("rmcp_…");
  });
});
