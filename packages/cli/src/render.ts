/** Plain-text rendering helpers. No colours: output must survive pipes and logs. */

export function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, Math.max(0, n - 1)) + "…";
}

export function table(rows: Record<string, unknown>[], columns: { key: string; label: string; max?: number; right?: boolean }[]): string {
  const cells = rows.map((r) => columns.map((c) => truncate(cellText(r[c.key]), c.max ?? 40)));
  const widths = columns.map((c, i) => Math.max(c.label.length, ...cells.map((row) => row[i].length)));
  const fmt = (vals: string[]) =>
    vals.map((v, i) => (columns[i].right ? v.padStart(widths[i]) : v.padEnd(widths[i]))).join("  ").trimEnd();
  return [fmt(columns.map((c) => c.label)), fmt(widths.map((w) => "-".repeat(w))), ...cells.map(fmt)].join("\n");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Finds the first array of objects in a result (movements, items, tools…). */
export function firstRecordArray(value: Record<string, unknown>): { key: string; rows: Record<string, unknown>[] } | null {
  for (const [key, v] of Object.entries(value)) {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      return { key, rows: v as Record<string, unknown>[] };
    }
  }
  return null;
}

/** Generic human view of a tool result: a table for the first record list, key/value lines for the rest. */
export function renderResult(value: Record<string, unknown>): string {
  const lines: string[] = [];
  const list = firstRecordArray(value);
  for (const [k, v] of Object.entries(value)) {
    if (k === "_meta" || (list && k === list.key)) continue;
    if (v === null || v === undefined) continue;
    lines.push(`${k}: ${typeof v === "object" ? truncate(JSON.stringify(v), 160) : String(v)}`);
  }
  if (list) {
    const keys = [...new Set(list.rows.slice(0, 20).flatMap((r) => Object.keys(r)))]
      .filter((k) => typeof list.rows[0][k] !== "object" || list.rows[0][k] === null)
      .slice(0, 6);
    lines.push("", `${list.key} (${list.rows.length}):`, table(list.rows, keys.map((key) => ({ key, label: key, max: 36 }))));
  }
  return lines.join("\n");
}

export interface SplitIssues {
  errors: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  info: Record<string, unknown>[];
}

/** Import preview issues by severity: «info» is a note (e.g. a remembered column mapping), not a problem. */
export function splitIssues(issues: unknown[]): SplitIssues {
  const out: SplitIssues = { errors: [], warnings: [], info: [] };
  for (const raw of issues) {
    const i = (raw && typeof raw === "object" ? raw : { message: String(raw) }) as Record<string, unknown>;
    const sev = String(i.severity ?? "warning").toLowerCase();
    if (sev === "info") out.info.push(i);
    else if (sev === "error" || sev === "blocking") out.errors.push(i);
    else out.warnings.push(i);
  }
  return out;
}

function issueText(i: Record<string, unknown>): string {
  const msg = typeof i.message === "string" && i.message ? i.message : typeof i.code === "string" ? i.code : JSON.stringify(i);
  const row = typeof i.rowIndex === "number" ? ` (riga ${i.rowIndex + 1})` : typeof i.row === "number" ? ` (riga ${i.row})` : "";
  return `${truncate(msg, 200)}${row}`;
}

/** Readable lines for the import preview: errors and warnings one per line, info as short notes, never raw JSON. */
export function renderIssues(issues: unknown[], max = 10): string {
  const { errors, warnings, info } = splitIssues(issues);
  const lines: string[] = [];
  const block = (title: string, list: Record<string, unknown>[]) => {
    if (list.length === 0) return;
    lines.push(`${title} (${list.length}):`);
    for (const i of list.slice(0, max)) lines.push(`  - ${issueText(i)}`);
    if (list.length > max) lines.push(`  … altri ${list.length - max} (usa --json per l'elenco completo)`);
  };
  block("Errori", errors);
  block("Da controllare", warnings);
  block("Note", info);
  return lines.join("\n");
}

/** One line per duplicate the import will skip: row in the file, date, amount, description. */
export function renderDuplicates(duplicates: unknown[], max = 10): string {
  if (duplicates.length === 0) return "";
  const lines = ["Già presenti, verranno saltati:"];
  for (const raw of duplicates.slice(0, max)) {
    const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const idx = typeof d.rowIndex === "number" ? d.rowIndex : typeof d.index === "number" ? d.index : undefined;
    const bits = [d.date, d.amount !== undefined ? `${d.amount} €` : undefined, d.description].filter((x) => x !== undefined && x !== null && x !== "");
    lines.push(`  - ${idx !== undefined ? `riga ${idx + 1}: ` : ""}${truncate(bits.map(String).join(", ") || JSON.stringify(d), 160)}`);
  }
  if (duplicates.length > max) lines.push(`  … altri ${duplicates.length - max}`);
  return lines.join("\n");
}
