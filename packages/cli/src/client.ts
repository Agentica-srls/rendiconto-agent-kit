import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./config.js";
import { CliError, errorField, exitCodeFor } from "./errors.js";
import { TOOL_META, type ToolInputs, type ToolName } from "./generated/tools.js";
import { scrubTokens } from "./redact.js";

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".txt": "text/plain",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export function contentTypeFor(filename: string): string {
  return CONTENT_TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export interface ConfirmationRequest {
  tool: string;
  summary: string;
  effects?: Record<string, number>;
  confirmationId: string;
  expiresAt?: string;
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Called when a tool answers `requiresConfirmation`. Return true to retry with the confirmationId. Without it, the confirmation request is returned as the result. */
  onConfirm?: (req: ConfirmationRequest) => Promise<boolean>;
  clientName?: string;
  clientVersion?: string;
  /** Extra attempts when the server says the failure is passing (`retryable`, e.g. rate_limited, ai_unavailable). Default 2; 0 turns it off. */
  retries?: number;
  /** Test hook: how to wait between attempts. */
  sleep?: (ms: number) => Promise<void>;
}

export type ToolResult = Record<string, unknown>;

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

export interface UploadResult {
  fileId: string;
  filename: string;
  contentType: string;
  bytes: number;
}

export interface ExportLink {
  url: string;
  filename: string;
  contentType?: string;
  bytes?: number;
  sha256?: string;
  expiresAt?: string;
}

export interface RendicontoClient {
  readonly baseUrl: string;
  whoami(): Promise<Record<string, unknown>>;
  /** The public registry (REST), not filtered by the token. */
  toolsCatalog(): Promise<{ version: string; tools: Record<string, unknown>[] }>;
  /** The tools this token can see (MCP tools/list). */
  listTools(): Promise<McpToolInfo[]>;
  call<N extends ToolName>(name: N, args?: ToolInputs[N], opts?: CallOptions): Promise<ToolResult>;
  call(name: string, args?: Record<string, unknown>, opts?: CallOptions): Promise<ToolResult>;
  uploadFile(path: string, purpose: "import" | "document"): Promise<UploadResult>;
  downloadExport(link: ExportLink, outPath: string): Promise<{ path: string; bytes: number; sha256: string; verified: boolean }>;
  close(): Promise<void>;
}

export interface CallOptions {
  onConfirm?: (req: ConfirmationRequest) => Promise<boolean>;
}

/** Turns anything thrown by fetch / the MCP SDK into a CliError with a stable code. Never carries the token. */
export function toCliError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  const err = e as { message?: string; code?: unknown; name?: string };
  const message = scrubTokens(String(err?.message ?? e));
  const status = typeof err?.code === "number" ? err.code : undefined;
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const body = JSON.parse(message.slice(jsonStart, message.lastIndexOf("}") + 1)) as { error?: string; message?: string; code?: string };
      if (body.code) {
        return new CliError(body.code, body.error ?? body.message ?? message, { status });
      }
    } catch {
      /* fall through */
    }
  }
  if (status !== undefined) return new CliError(`http_${status}`, message, { status });
  return new CliError("network_error", `Connessione non riuscita: ${message}`);
}

function parseToolText(result: { content?: unknown; isError?: boolean }): { value: Record<string, unknown>; isError: boolean } {
  const blocks = Array.isArray(result.content) ? (result.content as { type?: string; text?: string }[]) : [];
  const text = blocks.find((b) => b.type === "text")?.text ?? "";
  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    value = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { result: parsed };
  } catch {
    value = { text };
  }
  return { value, isError: result.isError === true };
}

export function createClient(options: ClientOptions): RendicontoClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const doFetch: typeof fetch = options.fetch ?? ((...a) => globalThis.fetch(...a));
  const bearer = `Bearer ${options.token.trim()}`;
  let mcp: Client | null = null;

  async function connect(): Promise<Client> {
    if (mcp) return mcp;
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
      requestInit: { headers: { Authorization: bearer } },
      fetch: doFetch,
    });
    const client = new Client({ name: options.clientName ?? "rendiconto-cli", version: options.clientVersion ?? "0.1.0" });
    try {
      await client.connect(transport);
    } catch (e) {
      throw toCliError(e);
    }
    mcp = client;
    return client;
  }

  async function rest(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth) headers.set("authorization", bearer);
    try {
      return await doFetch(`${baseUrl}${path}`, { ...init, headers });
    } catch (e) {
      throw toCliError(e);
    }
  }

  async function failFromResponse(res: Response): Promise<never> {
    let code = `http_${res.status}`;
    let message = `Errore HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; message?: string; code?: string };
      code = body.code ?? code;
      message = scrubTokens(body.error ?? body.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new CliError(code, message, { status: res.status });
  }

  async function callOnce(name: string, args: Record<string, unknown>): Promise<{ value: Record<string, unknown>; isError: boolean }> {
    const c = await connect();
    try {
      const res = await c.callTool({ name, arguments: args });
      return parseToolText(res as { content?: unknown; isError?: boolean });
    } catch (e) {
      throw toCliError(e);
    }
  }

  const maxRetries = Math.max(0, options.retries ?? 2);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /**
   * Runs a tool and, when the server marks the failure as passing (`retryable`), waits and tries again with backoff.
   * A write is retried only when that cannot repeat it: the call was refused before it ran (rate_limited), or the tool
   * takes an idempotencyKey (the same key never repeats the operation).
   */
  async function runTool(name: string, args: Record<string, unknown>): Promise<{ value: Record<string, unknown>; isError: boolean }> {
    for (let attempt = 0; ; attempt++) {
      const out = await callOnce(name, args);
      if (!out.isError || attempt >= maxRetries) return out;
      const body = out.value as Record<string, unknown>;
      const code = String(body.code ?? "");
      const retryable = errorField(body, "retryable") === true || code === "rate_limited";
      const isWrite = (TOOL_META as Record<string, { write: boolean } | undefined>)[name]?.write === true;
      const safe = !isWrite || code === "rate_limited" || args.idempotencyKey !== undefined;
      if (!retryable || !safe) return out;
      const hinted = Number(errorField(body, "retryAfter"));
      const waitMs = Math.min(30_000, (Number.isFinite(hinted) && hinted > 0 ? hinted * 1000 : 1000 * 2 ** attempt));
      await sleep(waitMs);
    }
  }

  const api: RendicontoClient = {
    baseUrl,

    async whoami() {
      const res = await rest("/api/agent/v1/whoami");
      if (!res.ok) await failFromResponse(res);
      return (await res.json()) as Record<string, unknown>;
    },

    async toolsCatalog() {
      const res = await rest("/api/agent/v1/tools.json", {}, false);
      if (!res.ok) await failFromResponse(res);
      return (await res.json()) as { version: string; tools: Record<string, unknown>[] };
    },

    async listTools() {
      const c = await connect();
      try {
        const out: McpToolInfo[] = [];
        let cursor: string | undefined;
        do {
          const page = await c.listTools(cursor ? { cursor } : undefined);
          out.push(...(page.tools as McpToolInfo[]));
          cursor = page.nextCursor;
        } while (cursor);
        return out;
      } catch (e) {
        throw toCliError(e);
      }
    },

    async call(name: string, args: Record<string, unknown> = {}, opts: CallOptions = {}) {
      const meta = (TOOL_META as Record<string, { idempotent: boolean } | undefined>)[name];
      const callArgs: Record<string, unknown> = { ...args };
      if (meta?.idempotent && callArgs.idempotencyKey === undefined) callArgs.idempotencyKey = randomUUID();

      const first = await runTool(name, callArgs);
      if (first.isError) throw errorFromToolBody(first.value);
      const v = first.value;
      if (v.requiresConfirmation !== true) return v;

      const req: ConfirmationRequest = {
        tool: name,
        summary: String(v.summary ?? ""),
        effects: v.effects as Record<string, number> | undefined,
        confirmationId: String(v.confirmationId ?? ""),
        expiresAt: v.expiresAt as string | undefined,
      };
      const confirm = opts.onConfirm ?? options.onConfirm;
      if (!confirm) return v;
      if (!(await confirm(req))) throw new CliError("declined", "Operazione annullata: nessuna modifica eseguita.", { exitCode: 1 });
      const second = await runTool(name, { ...callArgs, confirmationId: req.confirmationId });
      if (second.isError) throw errorFromToolBody(second.value);
      return second.value;
    },

    async uploadFile(path, purpose) {
      const info = await stat(path).catch(() => {
        throw new CliError("usage", `File non trovato: ${path}`, { exitCode: 2 });
      });
      if (!info.isFile()) throw new CliError("usage", `Non è un file: ${path}`, { exitCode: 2 });
      if (info.size === 0) throw new CliError("file_empty", "Il file è vuoto.");
      if (info.size > UPLOAD_MAX_BYTES) throw new CliError("file_too_large", "File troppo grande (massimo 20 MB).");
      const filename = basename(path);
      const contentType = contentTypeFor(filename);
      const bytes = await readFile(path);

      const link = await api.call("create_upload_link", { purpose, filename, contentType } as ToolInputs["create_upload_link"]);
      const uploadUrl = String(link.uploadUrl ?? "");
      const fileId = String(link.fileId ?? "");
      if (!uploadUrl || !fileId) throw new CliError("internal_error", "Risposta di create_upload_link incompleta.");
      // The signed URL is the capability: it MUST stay on the Rendiconto origin and carries no bearer.
      if (new URL(uploadUrl).origin !== new URL(baseUrl).origin) {
        throw new CliError("internal_error", "Il link di caricamento punta a un altro indirizzo: operazione rifiutata.");
      }
      let res: Response;
      try {
        res = await doFetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": String(link.contentType ?? contentType), "content-length": String(bytes.byteLength) },
          body: bytes,
        });
      } catch (e) {
        throw toCliError(e);
      }
      if (!res.ok) await failFromResponse(res);
      return { fileId, filename, contentType, bytes: bytes.byteLength };
    },

    async downloadExport(link, outPath) {
      if (!link.url) throw new CliError("internal_error", "Risposta senza link di download.");
      let res: Response;
      try {
        res = await doFetch(link.url);
      } catch (e) {
        throw toCliError(e);
      }
      if (!res.ok) await failFromResponse(res);
      const buf = Buffer.from(await res.arrayBuffer());
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (link.sha256 && link.sha256.toLowerCase() !== sha256) {
        throw new CliError("integrity_error", `Verifica sha256 fallita: atteso ${link.sha256}, ottenuto ${sha256}. File non salvato.`);
      }
      await writeFile(outPath, buf, { mode: 0o600 });
      return { path: outPath, bytes: buf.byteLength, sha256, verified: Boolean(link.sha256) };
    },

    async close() {
      const c = mcp;
      mcp = null;
      if (c) await c.close().catch(() => {});
    },
  };
  return api;
}

function errorFromToolBody(body: Record<string, unknown>): CliError {
  const code = String(body.code ?? "internal_error");
  const message = scrubTokens(String(body.message ?? body.error ?? "Errore."));
  const { code: _c, message: _m, error: _e, ...details } = body;
  return new CliError(code, message, { details: Object.keys(details).length ? details : undefined, exitCode: exitCodeFor(code) });
}
