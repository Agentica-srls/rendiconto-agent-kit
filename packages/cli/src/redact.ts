/** Shows only the last 4 characters of a token. */
export function redactToken(token: string): string {
  const t = token.trim();
  return t.length <= 4 ? "…" : `…${t.slice(-4)}`;
}

const TOKEN_RE = /rmcp_[A-Za-z0-9_-]{8,}/g;

/** Removes every token-shaped string from free text (error messages, logs). */
export function scrubTokens(text: string): string {
  return text.replace(TOKEN_RE, (m) => `rmcp_…${m.slice(-4)}`);
}
