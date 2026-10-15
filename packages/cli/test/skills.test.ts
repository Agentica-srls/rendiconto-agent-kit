import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../../plugin/", import.meta.url).pathname;
const pinned = JSON.parse(readFileSync(new URL("../tools.pinned.json", import.meta.url), "utf8")) as { tools: { name: string }[] };
const prompts = JSON.parse(readFileSync(new URL("./fixtures/prompts.json", import.meta.url), "utf8")) as { prompts: Record<string, string[]> };
const toolNames = new Set(pinned.tools.map((t) => t.name));

function readSkill(name: string) {
  const raw = readFileSync(join(root, "skills", name, "SKILL.md"), "utf8");
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`${name}: no frontmatter`);
  const fm = Object.fromEntries(m[1].split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { fm, body: m[2] };
}

// snake_case words in the skills that are error codes, enum values or flags, not tools.
const NOT_TOOLS = new Set(["scope_not_granted", "ai_not_granted", "role_missing_permission", "not_competenza", "amount_mismatch", "self_declaration_resolution_missing", "year_locked", "missing_document"]);

const skillDirs = readdirSync(join(root, "skills")).sort();

describe("plugin skills", () => {
  it("the 9 skill names equal the MCP prompt names pinned from src/mcp/prompts.ts", () => {
    expect(skillDirs).toEqual(Object.keys(prompts.prompts).sort());
    expect(skillDirs).toHaveLength(9);
  });

  it.each(skillDirs)("%s: frontmatter says when to use it", (name) => {
    const { fm } = readSkill(name);
    expect(fm.name).toBe(name);
    expect(fm.description.length).toBeGreaterThan(60);
    expect(fm.description).toMatch(/^Usa /);
  });

  it.each(skillDirs)("%s: names only tools that exist in tools.pinned.json", (name) => {
    const { body } = readSkill(name);
    const ticks = [...new Set([...body.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]))];
    const unknown = ticks.filter((t) => !toolNames.has(t) && !NOT_TOOLS.has(t));
    expect(unknown).toEqual([]);
  });

  it.each(skillDirs)("%s: mentions every tool of the MCP prompt, in the same order", (name) => {
    const { body } = readSkill(name);
    const expected = prompts.prompts[name];
    let from = 0;
    for (const tool of expected) {
      // `create_upload_link` may be introduced after the CLI alternative: order is checked on first mention after the previous tool
      const idx = body.indexOf(tool, from);
      expect(idx, `${name}: ${tool} missing or out of order`).toBeGreaterThanOrEqual(0);
      from = idx;
    }
  });

  it.each(skillDirs)("%s: carries the authoring rules (stop and ask, never invent, quote movements)", (name) => {
    const { body } = readSkill(name);
    expect(body).toMatch(/Fermati e chiedi/);
    expect(body).toMatch(/Non inventare mai/);
    expect(body).toMatch(/Cita sempre/);
    expect(body).toMatch(/requiresConfirmation/);
  });

  it("rendiconta-contributo carries «si spende l'ammessa, non il concesso»", () => {
    expect(readSkill("rendiconta-contributo").body).toContain("si spende l'ammessa, non il concesso");
  });

  it("every confirm-risk tool a skill uses is stated as needing the person's go-ahead", () => {
    const confirm = ["import_statement_confirm", "undo_import", "bulk_classify_movements", "allocate_to_contributo", "bulk_assign_cost_center", "mark_contributo_report_sent"];
    for (const name of skillDirs) {
      const { body } = readSkill(name);
      for (const t of confirm) if (body.includes(`\`${t}\``)) expect(body, `${name}/${t}`).toMatch(/consenso|conferma|«sì»|richiesta esplicita|se la persona accetta|Solo con/i);
    }
  });
});

describe("plugin files", () => {
  const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
  it("plugin.json and .mcp.json are valid and the MCP server uses the env var bearer", () => {
    expect(read(".claude-plugin/plugin.json").name).toBe("rendiconto");
    const mcp = read(".mcp.json");
    expect(mcp.mcpServers.rendiconto.type).toBe("http");
    expect(mcp.mcpServers.rendiconto.headers.Authorization).toBe("Bearer ${RENDICONTO_TOKEN}");
    expect(mcp.mcpServers.rendiconto.url).toMatch(/\/api\/mcp$/);
    expect(JSON.stringify(mcp)).not.toMatch(/rmcp_[A-Za-z0-9]/);
  });
  it("marketplace.json lists the plugin with a relative source that exists", () => {
    const mk = JSON.parse(readFileSync(join(root, "../.claude-plugin/marketplace.json"), "utf8"));
    expect(mk.plugins.map((p: { name: string }) => p.name)).toEqual(["rendiconto"]);
    expect(existsSync(join(root, "../", mk.plugins[0].source, ".claude-plugin/plugin.json"))).toBe(true);
  });
  it("every command file references an existing skill", () => {
    for (const f of readdirSync(join(root, "commands"))) {
      const body = readFileSync(join(root, "commands", f), "utf8");
      const skill = /skill `([a-z-]+)`/.exec(body)?.[1];
      expect(skillDirs, f).toContain(skill);
    }
  });
});
