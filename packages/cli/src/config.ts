import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_BASE_URL = "https://rendiconto.io";
export const DEFAULT_PROFILE = "default";

export interface Profile {
  token: string;
  baseUrl?: string;
  /** Ente name from whoami at login time. For display only. */
  workspace?: string;
  savedAt?: string;
}

export interface CredentialsFile {
  version: 1;
  default?: string;
  profiles: Record<string, Profile>;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.RENDICONTO_CONFIG_DIR) return env.RENDICONTO_CONFIG_DIR;
  const xdg = env.XDG_CONFIG_HOME;
  return join(xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"), "rendiconto");
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "credentials.json");
}

export async function loadCredentials(env: NodeJS.ProcessEnv = process.env): Promise<CredentialsFile> {
  try {
    const raw = await readFile(credentialsPath(env), "utf8");
    const parsed = JSON.parse(raw) as Partial<CredentialsFile>;
    return { version: 1, default: parsed.default, profiles: parsed.profiles ?? {} };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, profiles: {} };
    throw new CliError("usage", `Impossibile leggere ${credentialsPath(env)}: ${(e as Error).message}`, { exitCode: 2 });
  }
}

/** Writes the file with mode 0600 (directory 0700). Atomic: temp file + rename. */
export async function saveCredentials(file: CredentialsFile, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const path = credentialsPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  await chmod(path, 0o600);
  return path;
}

export interface ResolveOpts {
  profile?: string;
  baseUrl?: string;
}

export interface ResolvedAuth {
  token: string;
  baseUrl: string;
  profile: string;
  source: "env" | "profile";
}

/** RENDICONTO_TOKEN overrides the profile. Base URL: flag > env > profile > default. */
export async function resolveAuth(opts: ResolveOpts, env: NodeJS.ProcessEnv = process.env): Promise<ResolvedAuth> {
  const creds = await loadCredentials(env);
  const profileName = opts.profile ?? env.RENDICONTO_PROFILE ?? creds.default ?? DEFAULT_PROFILE;
  const prof = creds.profiles[profileName];
  const envToken = env.RENDICONTO_TOKEN?.trim();
  const token = envToken || prof?.token;
  if (!token) {
    throw new CliError(
      "no_credentials",
      "Nessun token. Esegui «rendiconto login» oppure imposta RENDICONTO_TOKEN (crealo in Impostazioni → Accesso per agenti e API).",
      { exitCode: 3 }
    );
  }
  const baseUrl = normalizeBaseUrl(opts.baseUrl ?? env.RENDICONTO_BASE_URL ?? prof?.baseUrl ?? DEFAULT_BASE_URL);
  return { token, baseUrl, profile: profileName, source: envToken ? "env" : "profile" };
}

export function normalizeBaseUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, "");
  try {
    const p = new URL(u);
    if (p.protocol !== "https:" && p.protocol !== "http:") throw new Error("protocol");
  } catch {
    throw new CliError("usage", `Indirizzo non valido: ${url}`, { exitCode: 2 });
  }
  return u;
}
