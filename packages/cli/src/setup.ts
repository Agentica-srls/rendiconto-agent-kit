import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CliError, UsageError } from "./errors.js";
import type { Io } from "./io.js";

export const TOKEN_ENV = "RENDICONTO_TOKEN";

export function mcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/mcp`;
}

/**
 * Version of the `mcp-remote` bridge Claude Desktop runs through `npx`. Pinned on purpose: the bridge
 * receives the bearer token, so «latest» would let a new release read it unreviewed. 0.14.3 is the last
 * release older than three weeks as of 2026-10-14 (0.15.0 was published that day). Raise it deliberately.
 */
export const MCP_REMOTE_VERSION = "0.14.3";

/**
 * Same arguments as the app's «Accesso creato» dialog (claudeCode tab), minus the program name.
 * With `literalToken` the header carries the token itself (kept by Claude Code in its own config,
 * so no `export` is needed on every terminal); without it the header cites `${RENDICONTO_TOKEN}`.
 */
export function claudeAddArgs(baseUrl: string, scope?: string, literalToken?: string): string[] {
  return [
    "mcp",
    "add",
    "--transport",
    "http",
    ...(scope ? ["--scope", scope] : []),
    "rendiconto",
    mcpUrl(baseUrl),
    "--header",
    literalToken ? `Authorization: Bearer ${literalToken}` : `Authorization: Bearer \${${TOKEN_ENV}}`,
  ];
}

/** Cursor reads `${env:NAME}` in headers, so the file never holds the token. */
export function cursorServerEntry(baseUrl: string): { url: string; headers: { Authorization: string } } {
  return { url: mcpUrl(baseUrl), headers: { Authorization: `Bearer \${env:${TOKEN_ENV}}` } };
}

/** Claude Desktop cannot expand variables: the `mcp-remote` bridge gets the header through its own env. */
export function desktopServerEntry(baseUrl: string, bearerValue: string) {
  return {
    command: "npx",
    args: ["-y", `mcp-remote@${MCP_REMOTE_VERSION}`, mcpUrl(baseUrl), "--header", "Authorization:${AUTH}"],
    env: { AUTH: bearerValue },
  };
}

export function desktopConfigPath(io: Pick<Io, "platform" | "homedir" | "env">): string {
  if (io.platform === "darwin") return join(io.homedir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (io.platform === "win32") return join(io.env.APPDATA ?? join(io.homedir, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(io.env.XDG_CONFIG_HOME ?? join(io.homedir, ".config"), "Claude", "claude_desktop_config.json");
}

/** Adds/replaces mcpServers.rendiconto in a JSON config file; keeps every other key. */
export async function mergeMcpServer(path: string, entry: unknown, mode?: number): Promise<{ created: boolean }> {
  let doc: Record<string, unknown> = {};
  let created = true;
  try {
    const raw = await readFile(path, "utf8");
    created = false;
    if (raw.trim() !== "") {
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
        doc = parsed as Record<string, unknown>;
      } catch {
        throw new UsageError(`${path} non è un JSON valido: correggilo a mano, non lo sovrascrivo.`);
      }
    }
  } catch (e) {
    if (e instanceof CliError) throw e;
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const servers = (doc.mcpServers && typeof doc.mcpServers === "object" ? doc.mcpServers : {}) as Record<string, unknown>;
  servers.rendiconto = entry;
  doc.mcpServers = servers;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(doc, null, 2) + "\n");
  if (mode !== undefined) await chmod(path, mode);
  return { created };
}
