/** Exit codes of the CLI (spec §7.2). Code 1 covers every other failed call (not found, conflict, invalid arguments). */
export const EXIT = { ok: 0, failed: 1, usage: 2, auth: 3, forbidden: 4, limit: 5, server: 6 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

const AUTH = new Set(["missing_token", "invalid_token", "issuer_inactive", "token_expired", "no_credentials"]);
const FORBIDDEN = new Set([
  "scope_not_granted",
  "ai_not_granted",
  "plan_read_only",
  "role_missing_permission",
  "feature_missing",
  "transport_not_allowed",
  "not_competenza",
  "workspace_mismatch",
  "ip_not_allowed",
  "origin_not_allowed",
  "host_not_allowed",
  "token_without_role",
  "plan_no_agent_access",
  "forbidden",
]);
const LIMIT = new Set(["rate_limited", "quota_exceeded", "ai_quota_exceeded"]);
const SERVER = new Set([
  "internal_error",
  "timeout",
  "storage_unavailable",
  "confirmation_unavailable",
  "agent_platform_disabled",
  "integrity_error",
  "network_error",
  "unavailable",
  "ai_unavailable",
  "upstream_timeout",
]);

/** Maps a stable server error code (and the HTTP status, when there is one) to an exit code. */
export function exitCodeFor(code: string | undefined, status?: number): ExitCode {
  if (code === "usage") return EXIT.usage;
  if (code && AUTH.has(code)) return EXIT.auth;
  if (code && FORBIDDEN.has(code)) return EXIT.forbidden;
  if (code && LIMIT.has(code)) return EXIT.limit;
  if (code && SERVER.has(code)) return EXIT.server;
  const m = code ? /^http_(\d{3})$/.exec(code) : null;
  const st = status ?? (m ? Number(m[1]) : undefined);
  if (st === 401) return EXIT.auth;
  if (st === 403) return EXIT.forbidden;
  if (st === 429) return EXIT.limit;
  if (st !== undefined && st >= 500) return EXIT.server;
  return EXIT.failed;
}

/** An error the CLI can report: stable code, Italian message from the server, optional details. */
export class CliError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details?: Record<string, unknown>;
  readonly exitCode: ExitCode;
  constructor(code: string, message: string, opts: { status?: number; details?: Record<string, unknown>; exitCode?: ExitCode } = {}) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
    this.exitCode = opts.exitCode ?? exitCodeFor(code, opts.status);
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super("usage", message, { exitCode: EXIT.usage });
    this.name = "UsageError";
  }
}

/** Reads a field the server may put at the top of the error body or inside its `details` object. */
export function errorField(details: Record<string, unknown> | undefined, key: string): unknown {
  if (!details) return undefined;
  if (details[key] !== undefined) return details[key];
  const inner = details.details;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>)[key] : undefined;
}
