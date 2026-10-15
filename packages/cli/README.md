# @rendiconto/cli

CLI e SDK per [Rendiconto.io](https://rendiconto.io): importa estratti conto, classifica movimenti, controlla anomalie ed esporta i report dal terminale o da uno script. Node 20 o superiore.

> **Non ancora pubblicato su npm.** Arriverà a breve; finché non c'è, non lanciare `npx @rendiconto/cli`. Per collegare Claude usa il plugin o `claude mcp add` descritti nel [README del kit](https://github.com/Agentica-srls/rendiconto-agent-kit#readme). Il codice si compila a mano: `npm install && npm run build`.

Quando sarà pubblicato:

```bash
npx @rendiconto/cli login
npx @rendiconto/cli whoami
```

SDK:

```ts
import { createClient } from "@rendiconto/cli";

const c = createClient({ token: process.env.RENDICONTO_TOKEN! });
const info = await c.call("get_workspace_info");
await c.close();
```

Quando sarà pubblicato, per collegare Claude Code o Claude Desktop senza `export` ripetuti: `rendiconto login`, poi `rendiconto setup claude --con-token` o `rendiconto setup desktop`. Guida passo passo: <https://github.com/Agentica-srls/rendiconto-agent-kit/blob/main/GUIDA.md>.

Documentazione completa, creazione del token e sicurezza: <https://github.com/Agentica-srls/rendiconto-agent-kit>.
