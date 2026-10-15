import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "../src/index.js";
import { run } from "../src/cli.js";
import { FAKE_TOKEN, startMockServer, type MockServer } from "./mock-server.js";
import { makeIo, type TestIo } from "./helpers.js";

let mock: MockServer;
beforeAll(async () => (mock = await startMockServer()));
afterAll(async () => mock.close());
beforeEach(() => {
  mock.state.calls.length = 0;
  mock.state.origins.length = 0;
  mock.state.authHeaders.length = 0;
  mock.state.uploads.clear();
  mock.state.confirmed.length = 0;
  mock.state.denied.clear();
  mock.state.corruptSha = false;
  mock.state.failStatus = undefined;
  mock.state.toolErrors = {};
  mock.state.previewIssues = [];
  mock.state.previewDuplicates = [];
});

const io = (over: Partial<TestIo> = {}) => makeIo({ env: { RENDICONTO_TOKEN: FAKE_TOKEN, RENDICONTO_BASE_URL: mock.url }, ...over });

describe("end to end against the in-process mock (/api/mcp + REST)", () => {
  it("tools list --json goes through the MCP client", async () => {
    const t = await io();
    expect(await run(["tools", "list", "--json"], t)).toBe(0);
    const out = JSON.parse(t.stdout);
    expect(out.tools.length).toBe(20);
    expect(out.tools.map((x: { name: string }) => x.name)).toContain("get_workspace_info");
  });

  it("tools list --all reads the public tools.json over REST", async () => {
    const t = await io();
    expect(await run(["tools", "list", "--all", "--json"], t)).toBe(0);
    expect(JSON.parse(t.stdout).tools).toHaveLength(5);
  });

  it("tools call passes arguments and prints the result", async () => {
    const t = await io();
    expect(await run(["tools", "call", "get_workspace_info", "--args", "{}"], t)).toBe(0);
    expect(t.stdout).toContain("APS Mock");
  });

  it("sends the bearer on every authenticated request and never an Origin header", async () => {
    const t = await io();
    await run(["whoami"], t);
    await run(["tools", "list"], t);
    expect(mock.state.authHeaders.length).toBeGreaterThan(2);
    expect(mock.state.authHeaders.every((h) => h === `Bearer ${FAKE_TOKEN}`)).toBe(true);
    expect(mock.state.origins.every((o) => o === undefined)).toBe(true);
  });

  it("whoami --json returns the REST body", async () => {
    const t = await io();
    expect(await run(["whoami", "--json"], t)).toBe(0);
    expect(JSON.parse(t.stdout).workspace.name).toBe("APS Mock");
  });

  it("a bad token exits 3 and the message never carries the token", async () => {
    const bad = "rmcp_" + "Z".repeat(43);
    const t = await io({ env: { RENDICONTO_TOKEN: bad, RENDICONTO_BASE_URL: mock.url } });
    expect(await run(["tools", "list"], t)).toBe(3);
    expect(t.stderr).toContain("invalid_token");
    expect(t.stderr).not.toContain(bad);
  });

  it("a denied tool exits 4", async () => {
    mock.state.denied.add("list_movements");
    const t = await io();
    expect(await run(["movimenti"], t)).toBe(4);
    expect(t.stderr).toContain("scope_not_granted");
  });

  it("a rate_limited answer is retried after the time the server asks, then succeeds", async () => {
    mock.state.toolErrors.list_movements = [{ code: "rate_limited", message: "Troppe richieste: riprova tra 1 secondi.", details: { retryAfter: 0.01, retryable: true } }];
    const t = await io();
    expect(await run(["movimenti"], t)).toBe(0);
    expect(mock.state.calls.filter((c) => c.tool === "list_movements")).toHaveLength(2);
  });

  it("a non retryable error is not repeated", async () => {
    mock.state.toolErrors.list_movements = [{ code: "validation_failed", message: "Dati non validi." }, { code: "validation_failed", message: "Dati non validi." }];
    const t = await io();
    expect(await run(["movimenti"], t)).toBe(1);
    expect(mock.state.calls.filter((c) => c.tool === "list_movements")).toHaveLength(1);
  });

  it("tool_excluded says where the person does it in the app", async () => {
    mock.state.toolErrors.set_year_regime = [
      { code: "tool_excluded", message: "Cambiare il regime: gli agenti non lo fanno. Dove farlo: Impostazioni dell'ente.", details: { area: "regime", where: "Impostazioni dell'ente › Profilo dell'ente › Regime contabile", appPath: "/w1/settings#settings-regime" } },
    ];
    const t = await io();
    expect(await run(["tools", "call", "set_year_regime", "--args", "{}"], t)).toBe(1);
    expect(t.stderr).toContain("[tool_excluded]");
    expect(t.stderr).toContain("Dove farlo: Impostazioni dell'ente › Profilo dell'ente › Regime contabile");
    expect(t.stderr).toContain("/w1/settings#settings-regime");
  });

  it("a server failure exits 6", async () => {
    mock.state.failStatus = 500;
    const t = await io();
    expect(await run(["tools", "list"], t)).toBe(6);
  });

  it("an unreachable host exits 6", async () => {
    const t = await io({ env: { RENDICONTO_TOKEN: FAKE_TOKEN, RENDICONTO_BASE_URL: "http://127.0.0.1:1" } });
    expect(await run(["whoami"], t)).toBe(6);
  });

  it("movimenti lists a table and --json the raw result", async () => {
    const t = await io();
    expect(await run(["movimenti", "--anno", "2026", "--cerca", "affitto"], t)).toBe(0);
    expect(t.stdout).toContain("Affitto sala marzo");
    expect(t.stdout).toContain("-120.00");
    const args = mock.state.calls.find((c) => c.tool === "list_movements")!.args;
    expect(args).toMatchObject({ year: 2026, search: "affitto", limit: 50 });
    const j = await io();
    expect(await run(["movimenti", "--non-classificati", "--json"], j)).toBe(0);
    expect(JSON.parse(j.stdout).movements).toHaveLength(2);
    expect(mock.state.calls.some((c) => c.tool === "list_unclassified_movements")).toBe(true);
  });

  it("anomalie combines the review queue and the anomaly list", async () => {
    const t = await io();
    expect(await run(["anomalie", "--anno", "2026", "--json"], t)).toBe(0);
    const out = JSON.parse(t.stdout);
    expect(out.reviewQueue.sections[0].count).toBe(2);
    expect(out.anomalies.anomalies[0].type).toBe("unclassified");
  });
});

describe("import: upload flow + confirmation round-trip", () => {
  async function csv(t: TestIo) {
    const f = join(t.cwd, "estratto.csv");
    await writeFile(f, "data;importo;descrizione\n2026-03-02;-120,00;Affitto sala marzo\n");
    return f;
  }

  it("--yes: create_upload_link -> PUT to the signed URL (no bearer) -> preview -> confirm without id -> confirm with id", async () => {
    const t = await io();
    const f = await csv(t);
    const code = await run(["import", f, "--conto", "66666666-6666-4666-8666-666666666666", "--yes", "--json"], t);
    expect(code).toBe(0);

    const tools = mock.state.calls.map((c) => c.tool);
    expect(tools).toEqual(["create_upload_link", "import_statement_preview", "import_statement_confirm", "import_statement_confirm"]);
    expect(mock.state.calls[0].args).toMatchObject({ purpose: "import", filename: "estratto.csv", contentType: "text/csv" });

    const [up] = [...mock.state.uploads.values()];
    expect(up.bytes.toString("utf8")).toContain("Affitto sala marzo");
    expect(up.contentType).toBe("text/csv");
    expect(up.authHeader).toBeUndefined();

    const [firstConfirm, secondConfirm] = mock.state.calls.filter((c) => c.tool === "import_statement_confirm");
    expect(firstConfirm.args.confirmationId).toBeUndefined();
    expect(secondConfirm.args.confirmationId).toBe("c1.test.sig");
    // same arguments in both rounds, same idempotency key
    expect({ ...secondConfirm.args, confirmationId: undefined }).toEqual({ ...firstConfirm.args, confirmationId: undefined });

    const out = JSON.parse(t.stdout);
    expect(out.batchId).toBe("44444444-4444-4444-8444-444444444444");
    expect(out.undo).toContain("undo_import");
    expect(out.undo).toContain(out.batchId);
    expect(t.stderr).toContain("Importerà 2 movimenti");
  });

  it("interactive: answering n stops before any write (exit 1)", async () => {
    const t = await io({ interactive: true });
    t.answers.push("n");
    const f = await csv(t);
    expect(await run(["import", f, "--conto", "x"], t)).toBe(1);
    expect(mock.state.confirmed).toHaveLength(0);
    expect(t.stderr).toContain("Importerà 2 movimenti");
    expect(t.stderr).toContain("nessuna modifica");
  });

  it("interactive: answering y confirms and prints the batchId and how to undo", async () => {
    const t = await io({ interactive: true });
    t.answers.push("y");
    const f = await csv(t);
    expect(await run(["import", f, "--conto", "x"], t)).toBe(0);
    expect(mock.state.confirmed).toEqual(["c1.test.sig"]);
    expect(t.stdout).toContain("batchId: 44444444-4444-4444-8444-444444444444");
    expect(t.stdout).toContain("undo_import");
    expect(t.stderr).toContain("Affitto sala marzo");
  });

  it("non interactive without --yes refuses to confirm (exit 2) and writes nothing", async () => {
    const t = await io();
    const f = await csv(t);
    expect(await run(["import", f, "--conto", "x"], t)).toBe(2);
    expect(mock.state.confirmed).toHaveLength(0);
    expect(t.stderr).toContain("--yes");
  });

  it("the preview separates info from problems, lists the issues in words and the duplicates by row", async () => {
    mock.state.previewIssues = [
      { code: "memoryMappingUsed", severity: "info", message: "Uso le colonne ricordate dall'ultima importazione." },
      { code: "dateAmbiguous", severity: "warning", message: "Data ambigua nella riga 2." },
    ];
    mock.state.previewDuplicates = [{ rowIndex: 1, date: "2026-03-05", amount: "350.00", description: "Quota associativa Rossi" }];
    const t = await io();
    const f = await csv(t);
    expect(await run(["import", f, "--conto", "x", "--yes"], t)).toBe(0);
    expect(t.stderr).toContain("1 cosa da controllare, 1 nota, 1 già presenti");
    expect(t.stderr).toContain("Da controllare (1):");
    expect(t.stderr).toContain("Data ambigua nella riga 2.");
    expect(t.stderr).toContain("Note (1):");
    expect(t.stderr).toContain("riga 2: 2026-03-05, 350.00 €, Quota associativa Rossi");
    expect(t.stderr).not.toContain('"severity"');
    expect(t.stderr).not.toContain("{");
  });

  it("a missing file exits 2 before any call", async () => {
    const t = await io();
    expect(await run(["import", "nope.csv", "--conto", "x"], t)).toBe(2);
    expect(mock.state.calls).toHaveLength(0);
  });

  it("SDK: an onConfirm hook receives the summary; without a hook the request is returned", async () => {
    const c = createClient({ token: FAKE_TOKEN, baseUrl: mock.url });
    try {
      const raw = await c.call("import_statement_confirm", { previewId: "p", bankAccountId: "b" });
      expect(raw).toMatchObject({ requiresConfirmation: true, confirmationId: "c1.test.sig" });
      let seen = "";
      const done = await c.call("import_statement_confirm", { previewId: "p", bankAccountId: "b" }, { onConfirm: async (r) => ((seen = r.summary), true) });
      expect(seen).toContain("Importerà");
      expect(done.imported).toBe(2);
    } finally {
      await c.close();
    }
  });

  it("SDK: a signed upload URL on another origin is refused", async () => {
    const c = createClient({ token: FAKE_TOKEN, baseUrl: mock.url, fetch: async (input, init) => {
      const res = await fetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/api/mcp") && init?.body && String(init.body).includes("create_upload_link")) {
        const body = (await res.json()) as { result: { content: { text: string }[] } };
        const inner = JSON.parse(body.result.content[0].text);
        inner.uploadUrl = "https://evil.example/steal";
        body.result.content[0].text = JSON.stringify(inner);
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      return res;
    } });
    const f = join((await makeIo()).cwd, "a.csv");
    await writeFile(f, "x");
    await expect(c.uploadFile(f, "import")).rejects.toMatchObject({ code: "internal_error" });
    await c.close();
  });
});

describe("classifica and export", () => {
  it("--suggerisci writes a reviewable file; --applica groups by category and applies", async () => {
    const t = await io();
    expect(await run(["classifica", "--suggerisci", "--anno", "2026", "-o", "c.json", "--json"], t)).toBe(0);
    const doc = JSON.parse(await readFile(join(t.cwd, "c.json"), "utf8"));
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0]).toMatchObject({ analyticalCategoryName: "Affitti", applica: true, description: "Affitto sala marzo" });
    expect(doc.items[1]).toMatchObject({ analyticalCategoryId: null, applica: false });

    const a = await io({ cwd: t.cwd });
    expect(await run(["classifica", "--applica", "c.json", "--yes", "--json"], a)).toBe(0);
    const bulk = mock.state.calls.filter((c) => c.tool === "bulk_classify_movements");
    expect(bulk).toHaveLength(1);
    expect(bulk[0].args).toMatchObject({ movementIds: [doc.items[0].movementId], analyticalCategoryId: "55555555-5555-4555-8555-555555555555" });
    expect(JSON.parse(a.stdout).applied).toBe(1);
  });

  it("export downloads through the signed URL and verifies the sha256", async () => {
    const t = await io();
    expect(await run(["export", "analisi", "--anno", "2026", "--formato", "pdf", "-o", "a.pdf", "--json"], t)).toBe(0);
    const out = JSON.parse(t.stdout);
    expect(out.verified).toBe(true);
    expect(out.sha256).toBe(mock.state.exportSha);
    expect((await readFile(join(t.cwd, "a.pdf"))).equals(mock.state.exportBytes)).toBe(true);
    expect(mock.state.calls.find((c) => c.tool === "export_analisi")!.args).toMatchObject({ year: 2026, format: "pdf" });
  });

  it("modello-d on a competenza esercizio stops with the right alternative, before asking for the report", async () => {
    const t = await io();
    expect(await run(["export", "modello-d", "--anno", "2025"], t)).toBe(2);
    expect(t.stderr).toContain("competenza");
    expect(t.stderr).toContain("modello-a");
    expect(mock.state.calls.map((c) => c.tool)).not.toContain("export_modello_d");
  });

  it("modello-a|b|c and libro-giornale on a competenza esercizio call the competenza tools", async () => {
    const t = await io();
    expect(await run(["export", "modello-b", "--anno", "2025", "-o", "b.pdf", "--json"], t)).toBe(0);
    expect(mock.state.calls.find((c) => c.tool === "export_modello_a_b_c")!.args).toMatchObject({ model: "b", year: 2025 });
    const u = await io();
    expect(await run(["export", "libro-giornale", "--anno", "2025", "-o", "lg.csv", "--json"], u)).toBe(0);
    expect(mock.state.calls.find((c) => c.tool === "export_libro_giornale")!.args).toMatchObject({ year: 2025 });
  });

  it("modello-a on a cassa esercizio is refused with a pointer to modello-d", async () => {
    const t = await io();
    expect(await run(["export", "modello-a", "--anno", "2026"], t)).toBe(2);
    expect(t.stderr).toContain("per cassa");
    expect(t.stderr).toContain("modello-d");
  });

  it("a sha256 mismatch exits 6 and leaves no file", async () => {
    mock.state.corruptSha = true;
    const t = await io();
    expect(await run(["export", "analisi", "--anno", "2026", "-o", "bad.pdf"], t)).toBe(6);
    expect(existsSync(join(t.cwd, "bad.pdf"))).toBe(false);
    expect(t.stderr).toContain("sha256");
  });

  it("export refuses to overwrite without --force", async () => {
    const t = await io();
    await writeFile(join(t.cwd, "x.pdf"), "old");
    expect(await run(["export", "analisi", "--anno", "2026", "-o", "x.pdf"], t)).toBe(2);
    expect(await readFile(join(t.cwd, "x.pdf"), "utf8")).toBe("old");
  });
});
