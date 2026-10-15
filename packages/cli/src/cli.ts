import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClient, toCliError, type ConfirmationRequest, type ExportLink, type RendicontoClient } from "./client.js";
import {
  DEFAULT_BASE_URL,
  DEFAULT_PROFILE,
  credentialsPath,
  loadCredentials,
  normalizeBaseUrl,
  resolveAuth,
  saveCredentials,
} from "./config.js";
import { CliError, EXIT, UsageError, errorField, type ExitCode } from "./errors.js";
import type { Io } from "./io.js";
import { redactToken, scrubTokens } from "./redact.js";
import { firstRecordArray, renderDuplicates, renderIssues, renderResult, splitIssues, table } from "./render.js";
import {
  TOKEN_ENV,
  claudeAddArgs,
  cursorServerEntry,
  desktopConfigPath,
  desktopServerEntry,
  mergeMcpServer,
  MCP_REMOTE_VERSION,
} from "./setup.js";

export const VERSION = "0.1.0";

const HELP = `rendiconto ${VERSION} - Rendiconto.io da terminale

Uso: rendiconto <comando> [opzioni]

Comandi
  login                       Salva il token (input nascosto) dopo averlo verificato
  whoami                      Ente, permessi, scadenza e uso di oggi
  setup claude|cursor|desktop Scrive la configurazione MCP del client
  import <file> --conto <id>  Carica un estratto conto, mostra l'anteprima, importa dopo conferma
  movimenti                   Elenca i movimenti (--anno, --non-classificati, --cerca, --limite)
  classifica                  --suggerisci [--anno] -o file.json   |   --applica file.json
  anomalie                    Coda di revisione e anomalie (--anno)
  export <cosa> -o file       analisi | modello-d (cassa) | modello-a|b|c e libro-giornale (competenza)
                              scadenzario | movimenti | contributo | cinque-per-mille | dichiarazione-rimborso | workbook
  tools list                  Strumenti visibili a questo token (--all: registro pubblico)
  tools call <nome> --args    Chiama uno strumento con argomenti JSON

Opzioni comuni
  --json            Output JSON (tutti i comandi)
  --profile <nome>  Profilo di credenziali (default: "${DEFAULT_PROFILE}")
  --base-url <url>  Default ${DEFAULT_BASE_URL}, oppure RENDICONTO_BASE_URL
  -y, --yes         Non chiedere conferma
  -h, --help        Aiuto        -v, --version  Versione

Variabili: RENDICONTO_TOKEN (ha la precedenza sul profilo), RENDICONTO_BASE_URL.
Codici di uscita: 0 ok, 1 altro errore, 2 uso errato, 3 autenticazione, 4 permesso negato, 5 limite, 6 errore del server.
`;

interface Ctx {
  io: Io;
  json: boolean;
  yes: boolean;
  profile?: string;
  baseUrl?: string;
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

const COMMON = {
  json: { type: "boolean" },
  profile: { type: "string" },
  "base-url": { type: "string" },
  yes: { type: "boolean", short: "y" },
  help: { type: "boolean", short: "h" },
} as const;

type OptSpec = Record<string, { type: "string" | "boolean"; short?: string }>;

function parse(argv: string[], extra: OptSpec, positionalsMax = 1): { values: Ctx["values"]; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { ...COMMON, ...extra } as never,
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > positionalsMax) throw new UsageError(`Argomento inatteso: ${positionals[positionalsMax]}`);
    return { values: values as Ctx["values"], positionals };
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new UsageError((e as Error).message.replace(/^Unknown option/, "Opzione sconosciuta"));
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function needStr(v: unknown, flag: string): string {
  const s = str(v);
  if (!s) throw new UsageError(`Manca ${flag}.`);
  return s;
}

function intOpt(v: unknown, flag: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag} deve essere un numero intero positivo.`);
  return n;
}

function yearOpt(v: unknown): number | undefined {
  const n = intOpt(v, "--anno");
  if (n !== undefined && (n < 2000 || n > 2100)) throw new UsageError("--anno deve essere tra 2000 e 2100.");
  return n;
}

// ─── Output and confirmation ───────────────────────────────────────────────────

function emit(ctx: Ctx, data: unknown, human: string): void {
  if (ctx.json) ctx.io.out(JSON.stringify(data, null, 2) + "\n");
  else ctx.io.out(human.endsWith("\n") ? human : human + "\n");
}

const YES = /^(y|yes|s|si|sì)$/i;

/** The confirmation round of the server (requiresConfirmation): show the summary, ask once. */
function confirmer(ctx: Ctx) {
  return async (req: ConfirmationRequest): Promise<boolean> => {
    ctx.io.err(`\nConferma richiesta (${req.tool})\n${req.summary}\n`);
    if (req.effects && Object.keys(req.effects).length) {
      ctx.io.err(Object.entries(req.effects).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n");
    }
    if (ctx.yes) {
      ctx.io.err("--yes: confermo.\n");
      return true;
    }
    if (!ctx.io.interactive) {
      throw new UsageError("Questa operazione chiede conferma e qui non posso chiederla: rilancia con --yes dopo aver letto il riepilogo.");
    }
    return YES.test((await ctx.io.readLine("Procedo? [y/N] ")).trim());
  };
}

async function withClient<T>(ctx: Ctx, fn: (c: RendicontoClient) => Promise<T>): Promise<T> {
  const auth = await resolveAuth({ profile: ctx.profile, baseUrl: ctx.baseUrl }, ctx.io.env);
  const client = createClient({ token: auth.token, baseUrl: auth.baseUrl, fetch: ctx.io.fetch, onConfirm: confirmer(ctx) });
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

// ─── Commands ──────────────────────────────────────────────────────────────────

async function cmdLogin(ctx: Ctx): Promise<void> {
  const baseUrl = normalizeBaseUrl(ctx.baseUrl ?? ctx.io.env.RENDICONTO_BASE_URL ?? DEFAULT_BASE_URL);
  let token: string;
  if (ctx.values["token-stdin"]) token = (await ctx.io.readStdin()).trim();
  else token = (await ctx.io.readSecret("Token (rmcp_…, non viene mostrato): ")).trim();
  if (!/^rmcp_[A-Za-z0-9_-]{8,}$/.test(token)) {
    throw new UsageError("Il token deve iniziare con «rmcp_». Crealo in Impostazioni → Accesso per agenti e API.");
  }
  const client = createClient({ token, baseUrl, fetch: ctx.io.fetch });
  const who = await client.whoami();
  const profileName = ctx.profile ?? ctx.io.env.RENDICONTO_PROFILE ?? DEFAULT_PROFILE;
  const creds = await loadCredentials(ctx.io.env);
  const workspace = (who.workspace as { name?: string } | undefined)?.name;
  creds.profiles[profileName] = {
    token,
    ...(baseUrl !== DEFAULT_BASE_URL ? { baseUrl } : {}),
    ...(workspace ? { workspace } : {}),
    savedAt: new Date().toISOString(),
  };
  creds.default ??= profileName;
  const path = await saveCredentials(creds, ctx.io.env);
  emit(
    ctx,
    { ok: true, profile: profileName, workspace: workspace ?? null, token: redactToken(token), file: path },
    `Accesso salvato nel profilo «${profileName}»${workspace ? ` (${workspace})` : ""}.\nToken ${redactToken(token)} in ${path} (permessi 0600).`
  );
}

function whoamiText(who: Record<string, unknown>, auth: { profile: string; source: string }): string {
  const ws = (who.workspace ?? {}) as Record<string, unknown>;
  const tk = (who.token ?? {}) as Record<string, unknown>;
  const usage = (who.usage ?? {}) as Record<string, Record<string, number>>;
  const limits = (who.limits ?? {}) as Record<string, Record<string, number>>;
  const scopes = Array.isArray(tk.scopes) ? (tk.scopes as string[]).join(", ") : "-";
  const lines = [
    `Ente:      ${ws.name ?? "-"}${ws.entityType ? ` (${ws.entityType})` : ""}`,
    `Token:     ${tk.name ?? "-"}  [profilo ${auth.profile}, da ${auth.source === "env" ? RENDICONTO_ENV : "credenziali salvate"}]`,
    `Permessi:  ${scopes}`,
    `Scade:     ${tk.expiresAt ?? "-"}`,
  ];
  if (usage.token) {
    lines.push(`Uso 24h:   ${usage.token.calls ?? 0}/${limits.perToken?.callsPerDay ?? "?"} chiamate, ${usage.token.writes ?? 0} scritture, ${usage.token.exports ?? 0} esportazioni`);
  }
  return lines.join("\n");
}
const RENDICONTO_ENV = TOKEN_ENV;

async function cmdWhoami(ctx: Ctx): Promise<void> {
  const auth = await resolveAuth({ profile: ctx.profile, baseUrl: ctx.baseUrl }, ctx.io.env);
  const client = createClient({ token: auth.token, baseUrl: auth.baseUrl, fetch: ctx.io.fetch });
  const who = await client.whoami();
  emit(ctx, who, whoamiText(who, auth));
}

async function cmdSetup(ctx: Ctx): Promise<void> {
  const target = ctx.positionals[0];
  const baseUrl = normalizeBaseUrl(ctx.baseUrl ?? ctx.io.env.RENDICONTO_BASE_URL ?? DEFAULT_BASE_URL);
  const print = ctx.values.print === true;
  if (target === "claude") {
    // --con-token: the header holds the token itself (read from `login` or the environment), so Claude Code
    // keeps working in every terminal and after a restart with no `export`. The default cites ${RENDICONTO_TOKEN}.
    const withToken = ctx.values["con-token"] === true;
    const scope = str(ctx.values.scope) ?? (withToken ? "user" : undefined);
    const token = withToken && !print ? (await resolveAuth({ profile: ctx.profile, baseUrl }, ctx.io.env)).token : undefined;
    const args = claudeAddArgs(baseUrl, scope, token);
    const shown = `claude ${claudeAddArgs(baseUrl, scope, withToken ? "rmcp_…" : undefined).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
    const note = withToken
      ? "Il token resta nella configurazione di Claude Code: non serve altro. Apri una nuova sessione e chiedi «chi sono su Rendiconto?»."
      : `Esporta il token prima di usare Claude Code: export ${TOKEN_ENV}='rmcp_…'  (oppure rilancia con --con-token per non doverlo fare ogni volta)`;
    if (print) return emit(ctx, { command: shown }, `${shown}\n${note}`);
    if (withToken) await ctx.io.exec("claude", ["mcp", "remove", "rendiconto", "--scope", scope!]).catch(() => undefined);
    const res = await ctx.io.exec("claude", args);
    if (res.code !== 0) {
      throw new CliError("setup_failed", `«claude mcp add» non è riuscito (${res.code}). ${scrubTokens(res.stderr || res.stdout).trim()}\nComando da eseguire a mano:\n${shown}`, { exitCode: EXIT.failed });
    }
    return emit(ctx, { ok: true, client: "claude", command: shown, ...(token ? { token: redactToken(token) } : {}) }, `Server «rendiconto» registrato in Claude Code.\n${note}`);
  }
  if (target === "cursor") {
    const path = str(ctx.values.file) ?? (ctx.values.project ? join(ctx.io.cwd, ".cursor", "mcp.json") : join(ctx.io.homedir, ".cursor", "mcp.json"));
    const entry = cursorServerEntry(baseUrl);
    if (print) return emit(ctx, { file: path, mcpServers: { rendiconto: entry } }, JSON.stringify({ mcpServers: { rendiconto: entry } }, null, 2));
    await mergeMcpServer(path, entry);
    return emit(ctx, { ok: true, client: "cursor", file: path }, `Configurazione scritta in ${path}.\nIl file cita ${"${env:" + TOKEN_ENV + "}"}: esporta il token prima di avviare Cursor.`);
  }
  if (target === "desktop") {
    const path = str(ctx.values.file) ?? desktopConfigPath(ctx.io);
    if (print) {
      const entry = desktopServerEntry(baseUrl, "Bearer rmcp_…");
      return emit(ctx, { file: path, mcpServers: { rendiconto: entry } }, JSON.stringify({ mcpServers: { rendiconto: entry } }, null, 2));
    }
    const auth = await resolveAuth({ profile: ctx.profile, baseUrl }, ctx.io.env);
    await mergeMcpServer(path, desktopServerEntry(baseUrl, `Bearer ${auth.token}`), 0o600);
    return emit(
      ctx,
      { ok: true, client: "desktop", file: path, token: redactToken(auth.token) },
      `Configurazione scritta in ${path} (permessi 0600).\nClaude Desktop non legge variabili d'ambiente: il file contiene il token ${redactToken(auth.token)}. Non condividerlo.\nPassi che restano:\n  1. Chiudi Claude Desktop del tutto (Cmd+Q su Mac) e riaprilo.\n  2. Scrivi «chi sono su Rendiconto?»: deve rispondere con il nome del tuo ente.\nServe Node 20 o superiore (il ponte mcp-remote@${MCP_REMOTE_VERSION} parte con npx).`
    );
  }
  throw new UsageError("Uso: rendiconto setup claude|cursor|desktop [--print]");
}

const PREVIEW_ROWS = 15;

async function cmdImport(ctx: Ctx): Promise<void> {
  const file = ctx.positionals[0];
  if (!file) throw new UsageError("Uso: rendiconto import <file> --conto <id> [--yes]");
  const conto = needStr(ctx.values.conto, "--conto <id>");
  await withClient(ctx, async (c) => {
    ctx.io.err(`Carico ${file}…\n`);
    const up = await c.uploadFile(resolve(ctx.io.cwd, file), "import");
    const preview = await c.call("import_statement_preview", { fileId: up.fileId, bankAccountId: conto });
    const rows = (preview.rows as Record<string, unknown>[] | undefined) ?? [];
    const issues = (preview.issues as unknown[] | undefined) ?? [];
    const duplicates = (preview.duplicates as unknown[] | undefined) ?? [];
    const dups = (preview.duplicateCount as number | undefined) ?? duplicates.length;
    if (!ctx.json) {
      const split = splitIssues(issues);
      const problems = split.errors.length + split.warnings.length;
      const note = split.info.length ? `, ${split.info.length} ${split.info.length === 1 ? "nota" : "note"}` : "";
      ctx.io.err(
        `\nAnteprima ${preview.filename ?? up.filename}: ${preview.totalRows ?? rows.length} righe, ${problems} ${problems === 1 ? "cosa da controllare" : "cose da controllare"}${note}, ${dups} già presenti.\n` +
          table(rows.slice(0, PREVIEW_ROWS), [
            { key: "index", label: "#", right: true },
            { key: "date", label: "Data" },
            { key: "amount", label: "Importo", right: true },
            { key: "description", label: "Descrizione", max: 50 },
          ]) +
          (rows.length > PREVIEW_ROWS ? `\n… altre ${rows.length - PREVIEW_ROWS} righe (usa --json per l'elenco completo)` : "") +
          "\n"
      );
      const issueText = renderIssues(issues);
      if (issueText) ctx.io.err(`${issueText}\n`);
      const dupText = renderDuplicates(duplicates);
      if (dupText) ctx.io.err(`${dupText}\n`);
    }
    const done = await c.call("import_statement_confirm", { previewId: String(preview.previewId), bankAccountId: conto });
    const batchId = String(done.batchId ?? done.importBatchId ?? "");
    const undo = `rendiconto tools call undo_import --args '{"batchId":"${batchId}"}'`;
    emit(
      ctx,
      { ok: true, batchId, preview: ctx.json ? preview : undefined, result: done, undo },
      `Importazione completata. batchId: ${batchId}\n${renderResult(done)}\nPer annullarla (entro 24 ore, solo se i movimenti non sono stati toccati):\n${undo}`
    );
  });
}

async function cmdMovimenti(ctx: Ctx): Promise<void> {
  const anno = yearOpt(ctx.values.anno);
  const limit = intOpt(ctx.values.limite, "--limite") ?? 50;
  const cerca = str(ctx.values.cerca);
  const tool = ctx.values["non-classificati"] ? "list_unclassified_movements" : "list_movements";
  await withClient(ctx, async (c) => {
    const res = await c.call(tool, { ...(anno ? { year: anno } : {}), ...(cerca ? { search: cerca } : {}), limit, ...(str(ctx.values.cursor) ? { cursor: str(ctx.values.cursor) } : {}) } as never);
    const rows = (res.movements as Record<string, unknown>[] | undefined) ?? firstRecordArray(res)?.rows ?? [];
    const next = res.nextCursor ? `\nAltri risultati: --cursor ${String(res.nextCursor)}` : "";
    emit(
      ctx,
      res,
      rows.length === 0
        ? "Nessun movimento."
        : table(rows, [
            { key: "date", label: "Data" },
            { key: "amount", label: "Importo", right: true },
            { key: "description", label: "Descrizione", max: 56 },
            { key: "id", label: "Id", max: 36 },
          ]) + next
    );
  });
}

interface SuggestionRow {
  movementId: string;
  date?: string;
  amount?: string;
  description?: string;
  analyticalCategoryId?: string | null;
  analyticalCategoryName?: string | null;
  confidence?: number | null;
  reasoning?: string | null;
  applica: boolean;
}

async function cmdClassifica(ctx: Ctx): Promise<void> {
  const suggerisci = ctx.values.suggerisci === true;
  const applica = str(ctx.values.applica);
  if (suggerisci === (applica !== undefined)) throw new UsageError("Uso: rendiconto classifica --suggerisci [--anno] -o file.json   oppure   --applica file.json");

  if (suggerisci) {
    const anno = yearOpt(ctx.values.anno);
    const out = resolve(ctx.io.cwd, str(ctx.values.output) ?? "classificazioni.json");
    const max = intOpt(ctx.values.max, "--max") ?? 200;
    await withClient(ctx, async (c) => {
      const list = await c.call("list_unclassified_movements", { ...(anno ? { year: anno } : {}), limit: Math.min(max, 500) } as never);
      const movs = ((list.movements as Record<string, unknown>[] | undefined) ?? firstRecordArray(list)?.rows ?? []).slice(0, max);
      const items: SuggestionRow[] = [];
      for (let i = 0; i < movs.length; i += 50) {
        const batch = movs.slice(i, i + 50);
        const res = await c.call("suggest_classification", { movementIds: batch.map((m) => String(m.id)) } as never);
        const byId = new Map<string, { suggestion?: Record<string, unknown> | null }>();
        for (const s of (res.suggestions as { movementId: string; suggestion?: Record<string, unknown> | null }[] | undefined) ?? []) byId.set(s.movementId, s);
        for (const m of batch) {
          const sug = byId.get(String(m.id))?.suggestion ?? null;
          items.push({
            movementId: String(m.id),
            date: m.date as string | undefined,
            amount: m.amount as string | undefined,
            description: m.description as string | undefined,
            analyticalCategoryId: (sug?.analyticalCategoryId as string | undefined) ?? null,
            analyticalCategoryName: (sug?.analyticalCategoryName as string | undefined) ?? null,
            confidence: (sug?.confidence as number | undefined) ?? null,
            reasoning: (sug?.reasoning as string | undefined) ?? null,
            applica: Boolean(sug?.analyticalCategoryId),
          });
        }
      }
      await writeFile(out, JSON.stringify({ version: 1, anno: anno ?? null, items }, null, 2) + "\n");
      const withSug = items.filter((i) => i.analyticalCategoryId).length;
      emit(
        ctx,
        { ok: true, file: out, movements: items.length, withSuggestion: withSug },
        `${items.length} movimenti, ${withSug} con un suggerimento. Controlla ${out} (metti "applica": false dove non sei d'accordo), poi:\nrendiconto classifica --applica ${out}`
      );
    });
    return;
  }

  let doc: { items?: SuggestionRow[] };
  try {
    doc = JSON.parse(await readFile(resolve(ctx.io.cwd, applica!), "utf8"));
  } catch (e) {
    throw new UsageError(`Impossibile leggere ${applica}: ${(e as Error).message}`);
  }
  if (!Array.isArray(doc.items)) throw new UsageError("Il file deve contenere { \"items\": [...] }.");
  const groups = new Map<string, string[]>();
  for (const it of doc.items) {
    if (it.applica === false || !it.analyticalCategoryId || !it.movementId) continue;
    groups.set(it.analyticalCategoryId, [...(groups.get(it.analyticalCategoryId) ?? []), it.movementId]);
  }
  if (groups.size === 0) return emit(ctx, { ok: true, applied: 0 }, "Niente da applicare.");
  await withClient(ctx, async (c) => {
    const results: Record<string, unknown>[] = [];
    let applied = 0;
    for (const [categoryId, ids] of groups) {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        results.push(await c.call("bulk_classify_movements", { movementIds: chunk, analyticalCategoryId: categoryId }));
        applied += chunk.length;
      }
    }
    emit(ctx, { ok: true, applied, categories: groups.size, results }, `Classificati ${applied} movimenti in ${groups.size} categorie.`);
  });
}

async function cmdAnomalie(ctx: Ctx): Promise<void> {
  const anno = yearOpt(ctx.values.anno);
  await withClient(ctx, async (c) => {
    const args = anno ? { year: anno } : {};
    const [queue, anomalies] = [await c.call("get_review_queue", args), await c.call("list_anomalies", args)];
    emit(ctx, { reviewQueue: queue, anomalies }, `Coda di revisione\n${renderResult(queue)}\n\nAnomalie\n${renderResult(anomalies)}`);
  });
}

type ExportSpec = {
  tool: string;
  formats: string[];
  /** The export only exists for one accounting regime: cassa → Modello D, competenza → Modelli A/B/C e libro giornale. */
  regime?: "cassa" | "competenza";
  build(ctx: Ctx, anno: number | undefined, formato: string | undefined): Record<string, unknown>;
};

const modelloABC = (model: "a" | "b" | "c"): ExportSpec => ({
  tool: "export_modello_a_b_c",
  formats: ["pdf"],
  regime: "competenza",
  build: (_c, anno) => ({ model, year: anno }),
});

const EXPORTS: Record<string, ExportSpec> = {
  analisi: {
    tool: "export_analisi",
    formats: ["pdf", "xlsx"],
    build: (_c, anno, formato) => ({ year: anno ?? new Date().getFullYear(), ...(formato ? { format: formato } : {}) }),
  },
  "modello-d": { tool: "export_modello_d", formats: ["pdf"], regime: "cassa", build: (_c, anno) => ({ ...(anno ? { year: anno } : {}) }) },
  "modello-a": modelloABC("a"),
  "modello-b": modelloABC("b"),
  "modello-c": modelloABC("c"),
  "libro-giornale": { tool: "export_libro_giornale", formats: ["csv"], regime: "competenza", build: (_c, anno) => ({ year: anno }) },
  scadenzario: {
    tool: "export_scadenzario",
    formats: ["pdf", "xlsx"],
    build: (_c, _anno, formato) => ({ ...(formato ? { format: formato } : {}) }),
  },
  movimenti: {
    tool: "export_movements",
    formats: ["csv", "xlsx"],
    build: (_c, anno, formato) => ({ ...(formato ? { format: formato } : {}), ...(anno ? { dateFrom: `${anno}-01-01`, dateTo: `${anno}-12-31` } : {}) }),
  },
  contributo: {
    tool: "export_contributo_bundle",
    formats: ["zip"],
    build: (c) => ({ projectId: needStr(c.values.contributo, "--contributo <id>") }),
  },
  "cinque-per-mille": {
    tool: "export_cinque_per_mille",
    formats: ["pdf"],
    build: (c) => ({ filingId: needStr(c.values.id, "--id <id del rendiconto 5x1000>") }),
  },
  "dichiarazione-rimborso": {
    tool: "export_rimborso_declaration",
    formats: ["pdf"],
    build: (c) => ({ reimbursementId: needStr(c.values.rimborso, "--rimborso <id>") }),
  },
  workbook: { tool: "export_report_workbook", formats: ["xlsx"], build: (_c, anno) => ({ ...(anno ? { year: anno } : {}) }) },
};

/** Which regime the esercizio uses, from get_workspace_info; undefined when the server does not say. */
async function regimeOfYear(c: RendicontoClient, anno: number | undefined): Promise<{ year: number | undefined; regime: string | undefined }> {
  const info = (await c.call("get_workspace_info")) as { currentYear?: number; years?: { year: number; regime?: string }[] };
  const year = anno ?? info.currentYear;
  return { year, regime: info.years?.find((y) => y.year === year)?.regime };
}

async function cmdExport(ctx: Ctx): Promise<void> {
  const what = ctx.positionals[0];
  const spec = what ? EXPORTS[what] : undefined;
  if (!spec) throw new UsageError(`Uso: rendiconto export <${Object.keys(EXPORTS).join("|")}> --anno 2026 --formato pdf|xlsx -o file`);
  let anno = yearOpt(ctx.values.anno);
  const formato = str(ctx.values.formato);
  if (formato && !spec.formats.includes(formato)) throw new UsageError(`«${what}» supporta solo: ${spec.formats.join(", ")}.`);
  await withClient(ctx, async (c) => {
    if (spec.regime) {
      // Never ask for the wrong report: Modello D on a competenza esercizio (or A/B/C on a cassa one) is a 409.
      const found = await regimeOfYear(c, anno);
      anno = found.year;
      if (found.regime && found.regime !== spec.regime) {
        throw new UsageError(
          spec.regime === "cassa"
            ? `L'esercizio ${found.year} è in contabilità per competenza: il Modello D non esiste. Usa «export modello-a», «modello-b», «modello-c» o «libro-giornale».`
            : `L'esercizio ${found.year} è in contabilità per cassa: «${what}» esiste solo per la competenza. Usa «export modello-d».`
        );
      }
    }
    const args = spec.build(ctx, anno, formato);
    const res = await c.call(spec.tool, args as never);
    const link = res as unknown as ExportLink;
    const out = resolve(ctx.io.cwd, str(ctx.values.output) ?? link.filename ?? `${what}.${formato ?? spec.formats[0]}`);
    if (existsSync(out) && !ctx.values.force) throw new UsageError(`${out} esiste già: scegli un altro -o oppure usa --force.`);
    const saved = await c.downloadExport(link, out);
    emit(
      ctx,
      { ok: true, ...saved, filename: link.filename },
      `Salvato ${saved.path} (${saved.bytes} byte). sha256 ${saved.verified ? "verificato" : "non fornito dal server"}: ${saved.sha256}`
    );
  });
}

async function cmdTools(ctx: Ctx): Promise<void> {
  const sub = ctx.positionals[0];
  if (sub === "list") {
    if (ctx.values.all) {
      const a = await resolveAuth({ profile: ctx.profile, baseUrl: ctx.baseUrl }, ctx.io.env).catch(() => null);
      const client = createClient({ token: a?.token ?? "none", baseUrl: a?.baseUrl ?? ctx.baseUrl ?? ctx.io.env.RENDICONTO_BASE_URL ?? DEFAULT_BASE_URL, fetch: ctx.io.fetch });
      const cat = await client.toolsCatalog();
      const rows = cat.tools.map((t) => ({ name: t.name, risk: t.risk, write: t.write ? "W" : "R", scope: (t.scope as string[]).join("|") }));
      return emit(ctx, cat, table(rows, [{ key: "name", label: "Strumento", max: 40 }, { key: "write", label: "R/W" }, { key: "risk", label: "Rischio" }, { key: "scope", label: "Permesso", max: 40 }]) + `\n${rows.length} strumenti (registro ${cat.version}).`);
    }
    await withClient(ctx, async (c) => {
      const tools = await c.listTools();
      emit(
        ctx,
        { tools },
        table(tools.map((t) => ({ name: t.name, title: t.title ?? "" })), [{ key: "name", label: "Strumento", max: 40 }, { key: "title", label: "Titolo", max: 60 }]) + `\n${tools.length} strumenti.`
      );
    });
    return;
  }
  if (sub === "call") {
    const name = ctx.positionals[1];
    if (!name) throw new UsageError("Uso: rendiconto tools call <nome> --args '{...}'");
    let args: Record<string, unknown> = {};
    let raw = str(ctx.values.args);
    if (raw?.startsWith("@")) raw = await readFile(resolve(ctx.io.cwd, raw.slice(1)), "utf8").catch(() => { throw new UsageError(`File non trovato: ${raw!.slice(1)}`); });
    if (raw) {
      try {
        const p = JSON.parse(raw);
        if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("serve un oggetto");
        args = p;
      } catch (e) {
        throw new UsageError(`--args non è JSON valido: ${(e as Error).message}`);
      }
    }
    await withClient(ctx, async (c) => {
      const res = await c.call(name, args);
      emit(ctx, res, renderResult(res));
    });
    return;
  }
  throw new UsageError("Uso: rendiconto tools list | tools call <nome> --args '{...}'");
}

// ─── Entry point ───────────────────────────────────────────────────────────────

const COMMANDS: Record<string, { opts: OptSpec; max: number; run(ctx: Ctx): Promise<void> }> = {
  login: { opts: { "token-stdin": { type: "boolean" } }, max: 0, run: cmdLogin },
  whoami: { opts: {}, max: 0, run: cmdWhoami },
  setup: { opts: { print: { type: "boolean" }, "con-token": { type: "boolean" }, scope: { type: "string" }, file: { type: "string" }, project: { type: "boolean" } }, max: 1, run: cmdSetup },
  import: { opts: { conto: { type: "string" } }, max: 1, run: cmdImport },
  movimenti: {
    opts: { anno: { type: "string" }, "non-classificati": { type: "boolean" }, cerca: { type: "string" }, limite: { type: "string" }, cursor: { type: "string" } },
    max: 0,
    run: cmdMovimenti,
  },
  classifica: {
    opts: { suggerisci: { type: "boolean" }, applica: { type: "string" }, anno: { type: "string" }, output: { type: "string", short: "o" }, max: { type: "string" } },
    max: 0,
    run: cmdClassifica,
  },
  anomalie: { opts: { anno: { type: "string" } }, max: 0, run: cmdAnomalie },
  export: {
    opts: { anno: { type: "string" }, formato: { type: "string" }, output: { type: "string", short: "o" }, contributo: { type: "string" }, id: { type: "string" }, rimborso: { type: "string" }, force: { type: "boolean" } },
    max: 1,
    run: cmdExport,
  },
  tools: { opts: { args: { type: "string" }, all: { type: "boolean" } }, max: 2, run: cmdTools },
};

/** Runs the CLI and returns the exit code. Never calls process.exit. */
export async function run(argv: string[], io: Io): Promise<ExitCode> {
  const first = argv[0];
  if (!first || first === "-h" || first === "--help" || first === "help") {
    io.out(HELP);
    return EXIT.ok;
  }
  if (first === "-v" || first === "--version" || first === "version") {
    io.out(VERSION + "\n");
    return EXIT.ok;
  }
  const cmd = COMMANDS[first];
  let json = argv.includes("--json");
  let shownBase = io.env.RENDICONTO_BASE_URL ?? DEFAULT_BASE_URL;
  try {
    if (!cmd) throw new UsageError(`Comando sconosciuto: ${first}. Vedi «rendiconto --help».`);
    const rest = argv.slice(1);
    if (rest.includes("-h") || rest.includes("--help")) {
      io.out(HELP);
      return EXIT.ok;
    }
    const parsed = parse(rest, cmd.opts, cmd.max);
    const v = parsed.values;
    json = v.json === true;
    const ctx: Ctx = {
      io,
      json,
      yes: v.yes === true,
      profile: str(v.profile),
      baseUrl: str(v["base-url"]),
      values: v,
      positionals: parsed.positionals,
    };
    if (ctx.baseUrl) ctx.baseUrl = normalizeBaseUrl(ctx.baseUrl);
    if (ctx.baseUrl) shownBase = ctx.baseUrl;
    await cmd.run(ctx);
    return EXIT.ok;
  } catch (e) {
    const err = toCliError(e);
    if (json) {
      io.err(JSON.stringify({ error: scrubTokens(err.message), code: err.code, ...(err.details ? { details: err.details } : {}) }) + "\n");
    } else {
      io.err(`Errore: ${scrubTokens(err.message)}${err.code !== "usage" && err.code !== "declined" ? ` [${err.code}]` : ""}\n`);
      // Things an agent never does: say where the person does them in the app.
      if (err.code === "tool_excluded") {
        const where = errorField(err.details, "where");
        const appPath = errorField(err.details, "appPath");
        if (typeof where === "string") io.err(`Dove farlo: ${where}\n`);
        if (typeof appPath === "string") io.err(`Link: ${normalizeBaseUrl(shownBase)}${appPath}\n`);
      } else if (err.code === "rate_limited") {
        const retryAfter = errorField(err.details, "retryAfter");
        if (typeof retryAfter === "number") io.err(`Riprova tra ${retryAfter} secondi.\n`);
      } else if (err.code === "ai_unavailable") {
        io.err("Il servizio di lettura automatica non risponde: riprova tra qualche minuto.\n");
      }
    }
    return err.exitCode;
  }
}

export { credentialsPath };
