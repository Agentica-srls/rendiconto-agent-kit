import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** Fake token shaped like the real ones: rmcp_ + 43 chars. Never a real credential. */
export const FAKE_TOKEN = "rmcp_" + "X".repeat(43);

const PINNED = JSON.parse(readFileSync(new URL("../tools.pinned.json", import.meta.url), "utf8")) as {
  version: string;
  tools: { name: string; description: string; title: string; inputSchema: unknown }[];
};

export interface MockState {
  calls: { tool: string; args: Record<string, unknown> }[];
  origins: (string | undefined)[];
  authHeaders: (string | undefined)[];
  uploads: Map<string, { bytes: Buffer; contentType: string; authHeader?: string }>;
  confirmed: string[];
  exportBytes: Buffer;
  exportSha: string;
  /** Tools that answer scope_not_granted. */
  denied: Set<string>;
  /** Make the export link carry a wrong sha256. */
  corruptSha: boolean;
  /** Tool name -> error bodies to answer, one per call, before the tool works. */
  toolErrors: Record<string, unknown[]>;
  /** What import_statement_preview reports. */
  previewIssues: unknown[];
  previewDuplicates: unknown[];
  /** Tool name -> HTTP status to fail the whole POST with (server-side error). */
  failStatus?: number;
}

export interface MockServer {
  url: string;
  state: MockState;
  close(): Promise<void>;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

const text = (v: unknown, isError = false) => ({ content: [{ type: "text" as const, text: JSON.stringify(v) }], ...(isError ? { isError: true } : {}) });

export async function startMockServer(): Promise<MockServer> {
  const exportBytes = Buffer.from("%PDF-1.4 fake rendiconto export\n");
  const state: MockState = {
    calls: [],
    origins: [],
    authHeaders: [],
    uploads: new Map(),
    confirmed: [],
    exportBytes,
    exportSha: createHash("sha256").update(exportBytes).digest("hex"),
    denied: new Set(),
    corruptSha: false,
    previewIssues: [],
    previewDuplicates: [],
    toolErrors: {},
  };
  let base = "";

  const MOVEMENTS = [
    { id: "11111111-1111-4111-8111-111111111111", date: "2026-03-02", amount: "-120.00", description: "Affitto sala marzo" },
    { id: "22222222-2222-4222-8222-222222222222", date: "2026-03-05", amount: "350.00", description: "Quota associativa Rossi" },
  ];

  function buildMcp(): Server {
    const s = new Server({ name: "rendiconto-mock", version: "0" }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: PINNED.tools.slice(0, 20).map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
    }));
    s.setRequestHandler(CallToolRequestSchema, async (req) => {
      const name = req.params.name;
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      state.calls.push({ tool: name, args });
      const queued = state.toolErrors[name]?.shift();
      if (queued) return text(queued, true);
      if (state.denied.has(name)) return text({ code: "scope_not_granted", message: "Questo accesso non ha il permesso richiesto." }, true);
      switch (name) {
        case "get_workspace_info":
          return text({ workspace: { name: "APS Mock" }, currentYear: 2026, years: [{ year: 2026, regime: "cassa" }, { year: 2025, regime: "competenza" }] });
        case "list_movements":
          return text({ movements: MOVEMENTS, nextCursor: null });
        case "list_unclassified_movements":
          return text({ movements: MOVEMENTS });
        case "create_upload_link": {
          const fileId = randomUUID();
          return text({
            fileId,
            uploadUrl: `${base}/api/agent/v1/uploads/${fileId}?ws=w&exp=9999999999&sig=s`,
            method: "PUT",
            contentType: args.contentType,
            maxBytes: 20 * 1024 * 1024,
            expiresAt: "2099-01-01T00:00:00.000Z",
          });
        }
        case "import_statement_preview": {
          if (!state.uploads.has(String(args.fileId))) return text({ code: "file_not_ready", message: "Il file non è ancora stato caricato." }, true);
          return text({
            previewId: "33333333-3333-4333-8333-333333333333",
            filename: "estratto.csv",
            totalRows: 2,
            rows: MOVEMENTS.map((m, index) => ({ index, date: m.date, amount: m.amount, description: m.description })),
            issues: state.previewIssues,
            duplicates: state.previewDuplicates,
            duplicateCount: state.previewDuplicates.length,
          });
        }
        case "import_statement_confirm": {
          if (!args.confirmationId) {
            return text({
              requiresConfirmation: true,
              summary: "Importerà 2 movimenti sul conto BCC.",
              effects: { movements: 2 },
              confirmationId: "c1.test.sig",
              expiresAt: "2099-01-01T00:00:00.000Z",
            });
          }
          if (args.confirmationId !== "c1.test.sig") return text({ code: "confirmation_invalid", message: "Codice di conferma non valido." }, true);
          state.confirmed.push(String(args.confirmationId));
          return text({ batchId: "44444444-4444-4444-8444-444444444444", imported: 2 });
        }
        case "suggest_classification":
          return text({
            suggestions: (args.movementIds as string[]).map((id, i) => ({
              movementId: id,
              suggestion: i === 0 ? { analyticalCategoryId: "55555555-5555-4555-8555-555555555555", analyticalCategoryName: "Affitti", confidence: 91, reasoning: "Storico" } : null,
            })),
          });
        case "bulk_classify_movements":
          return text({ classified: (args.movementIds as string[]).length });
        case "get_review_queue":
          return text({ sections: [{ name: "senza categoria", count: 2 }] });
        case "list_anomalies":
          return text({ anomalies: [{ type: "unclassified", severity: "warning", movementId: MOVEMENTS[0].id }] });
        case "export_analisi":
        case "export_modello_d":
        case "export_modello_a_b_c":
        case "export_libro_giornale":
          return text({
            url: `${base}/dl/analisi.pdf`,
            filename: `${name}-${args.year}.pdf`,
            contentType: "application/pdf",
            bytes: exportBytes.length,
            sha256: state.corruptSha ? "0".repeat(64) : state.exportSha,
            expiresAt: "2099-01-01T00:00:00.000Z",
          });
        default:
          return text({ code: "unknown_tool", message: "Strumento sconosciuto." }, true);
      }
    });
    return s;
  }

  const http: HttpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    try {
      if (url.pathname === "/api/agent/v1/tools.json" && req.method === "GET") {
        return json(res, 200, { version: PINNED.version, tools: PINNED.tools.slice(0, 5).map((t) => ({ ...t, risk: "normal", write: false, scope: ["read"] })) });
      }
      if (url.pathname.startsWith("/dl/")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        return void res.end(exportBytes);
      }
      if (url.pathname.startsWith("/api/agent/v1/uploads/") && req.method === "PUT") {
        const fileId = url.pathname.split("/").pop()!;
        state.uploads.set(fileId, { bytes: await readBody(req), contentType: String(req.headers["content-type"]), authHeader: req.headers.authorization });
        return json(res, 201, { fileId });
      }
      // everything below needs the bearer
      state.origins.push(req.headers.origin);
      state.authHeaders.push(req.headers.authorization);
      if (state.failStatus) return json(res, state.failStatus, { error: "Errore interno del server.", code: "internal_error" });
      if (req.headers.authorization !== `Bearer ${FAKE_TOKEN}`) {
        return json(res, 401, { error: "Token non valido, scaduto o revocato.", code: "invalid_token" }, { "www-authenticate": 'Bearer realm="rendiconto"' });
      }
      if (url.pathname === "/api/agent/v1/whoami" && req.method === "GET") {
        return json(res, 200, {
          workspace: { id: "w", name: "APS Mock", entityType: "APS" },
          token: { id: "t", name: "Test", scopes: ["read", "write:import"], expiresAt: "2099-01-01T00:00:00.000Z" },
          usage: { windowHours: 24, token: { calls: 3, writes: 1, exports: 0 }, workspace: { calls: 3, writes: 1, exports: 0 } },
          limits: { perToken: { callsPerDay: 5000 } },
          registryVersion: PINNED.version,
        });
      }
      if (url.pathname === "/api/mcp") {
        if (req.method !== "POST") return json(res, 405, { error: "Metodo non consentito.", code: "method_not_allowed" });
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const server = buildMcp();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        return void (await transport.handleRequest(req, res, body));
      }
      json(res, 404, { error: "not found", code: "http_404" });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message), code: "internal_error" });
    }
  });

  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  return { url: base, state, close: () => new Promise((r) => http.close(() => r())) };
}
