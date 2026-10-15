# Rendiconto agent kit

Italiano · [English below](#english)

Il kit pubblico per collegare **Rendiconto.io** a Claude Code, Cursor e Claude Desktop (la CLI per gli script arriva su npm a breve). Contiene:

| Cartella | Cosa è |
|---|---|
| `packages/cli` | `@rendiconto/cli`: il comando `rendiconto` e l'SDK `createClient` (Node 20+). **In arrivo su npm**: oggi non serve, il plugin e il server MCP funzionano senza |
| `plugin/` | Il plugin `rendiconto` per Claude Code: server MCP, 9 skill in italiano e scorciatoie `/rendiconto:…` |
| `.claude-plugin/marketplace.json` | Il marketplace che elenca il plugin |

**Prima volta e non sei tecnico?** Segui la [guida passo passo](GUIDA.md): token, Claude Code e Claude Desktop, verifica e problemi comuni.

Servono un abbonamento **Premium o Studio** e un token. Tutto passa dallo stesso server MCP (`/api/mcp`) e dalle stesse regole dell'app: permessi, conferme, registro delle attività.

## 1. Crea il token

1. Apri Rendiconto → **Impostazioni → Accesso per agenti e API**.
2. Crea un accesso: scegli il nome, i permessi («Solo lettura», «Assistente» o «Completo», oppure uno per uno) e la scadenza.
3. Copia il token (`rmcp_…`): **si vede una sola volta**.

Un token vale per **un solo ente**. Se segui più enti, crea un token per ciascuno e usa un profilo diverso (`--profile`).

## 2. Claude Code (plugin)

```bash
claude plugin marketplace add Agentica-srls/rendiconto-agent-kit
```

```bash
claude plugin install rendiconto@rendiconto-agent-kit
```

Il plugin collega il server MCP di Rendiconto (`/api/mcp`, HTTP) e legge il token dalla variabile `RENDICONTO_TOKEN`. Impostala **una volta sola**, in modo che resti anche dopo un riavvio. Sostituisci `rmcp_…` con il tuo token, tra apici.

Mac e Linux (zsh):

```bash
echo "export RENDICONTO_TOKEN='rmcp_…'" >> ~/.zshrc
```

Windows (PowerShell):

```powershell
setx RENDICONTO_TOKEN "rmcp_…"
```

Poi apri un nuovo terminale e riavvia Claude Code. In alternativa, senza toccare il terminale, puoi scrivere la variabile nel file `~/.claude/settings.json`, nella sezione `"env"`: `{ "env": { "RENDICONTO_TOKEN": "rmcp_…" } }`. In entrambi i casi il token resta scritto in chiaro in un file: usalo solo su un computer tuo.

Poi, in Claude Code, scrivi per esempio «importa questo estratto conto» oppure usa `/rendiconto:classifica`. Le skill:

| Skill | Quando |
|---|---|
| `importa-estratto-conto` | caricare un estratto conto con anteprima, duplicati e conferma |
| `classifica-movimenti` | dare una categoria ai movimenti, regole prima, poi suggerimenti |
| `controlla-anomalie` | spiegare e sistemare anomalie e avvisi |
| `prepara-rendiconto-fine-anno` | checklist e bilancio: Modello D per cassa, Modelli A/B/C e libro giornale per competenza; relazione di missione, 5×1000, esportazioni |
| `rendiconta-contributo` | spese da imputare a un contributo, «si spende l'ammessa, non il concesso» |
| `analisi-centri-di-costo` | completezza dei centri di costo e commento |
| `scadenze-del-mese` | scadute per prime, poi i prossimi 30 giorni e le rimandate; F24 delle ritenute, 5×1000, quote soci non pagate |
| `rimborsi-volontari` | giustificativi (prima la lettura dello scontrino, poi l'archivio), richiesta di rimborso, dichiarazione per gli autocertificati (serve la delibera registrata nell'app) |
| `verifica-quadratura-bilancio` | enti in competenza: quadratura, chiusura, riconciliazione |

Ogni skill si ferma e chiede prima di una conferma, di un annullamento e quando gli importi non tornano; non inventa importi; cita data, importo e descrizione dei movimenti. Le stesse nove procedure sono disponibili come *prompt* MCP in Cursor e Claude Desktop.

### Senza plugin: `claude mcp add`

Se vuoi solo il collegamento, senza le skill:

```bash
claude mcp add --transport http rendiconto https://rendiconto.io/api/mcp --header "Authorization: Bearer $RENDICONTO_TOKEN" --scope user
```

Il comando scrive il token nella configurazione di Claude Code: non serve più la variabile d'ambiente. Per verificare, apri una sessione e scrivi «chi sono su Rendiconto?».

### Oltre le skill: gli altri strumenti

Il server ha 145 strumenti; le skill ne usano una parte. Puoi chiedere in italiano anche queste cose, senza skill dedicata:

- **Soci e quote** (permesso «Soci e quote»): elenco soci (senza codice fiscale né contatti), quote non pagate e scadute, registrare un pagamento, sollecitare uno o tutti (chiede sempre conferma e dice quante email partono).
- **5×1000**: rendiconti, passi di legge e sanzione a rischio, PDF; creazione della bozza e date dei passi.
- **Ritenute e percipienti**: ritenute per mese e codice tributo con la data dell'F24, percipienti con i dati mancanti per la CU (F24 e CU si generano nell'app).
- **Competenza, bozze di prima nota**: scritture bilanciate in bozza, ratei e risconti, cespiti, saldi di apertura (permesso «Preparare la contabilità per competenza»); approvare, stornare e chiudere restano nell'app.
- **Correzioni**: correggere o togliere un movimento inserito a mano, togliere un proprio commento, elenco dei collaboratori per le menzioni.
- **Regole di classificazione senza AI**: proposte in anteprima, poi applicazione ai movimenti approvati.

Per un server diverso da produzione (prove): `export RENDICONTO_BASE_URL=https://…` prima di avviare Claude Code.

## 3. CLI (in arrivo su npm)

> **Non è ancora pubblicata su npm.** Il pacchetto `@rendiconto/cli` arriverà a breve; finché non c'è, non lanciare `npx @rendiconto/cli`. Il plugin (sezione 2), `claude mcp add` e Claude Desktop (sezione 4) coprono già l'uso con Claude. La CLI serve soprattutto per gli script e per chi vuole importare e classificare da terminale. Il codice è in `packages/cli` e si può compilare a mano (vedi «Sviluppo»).

Quando sarà pubblicata, `rendiconto login` chiederà il token con input nascosto, lo verificherà e lo salverà in `~/.config/rendiconto/credentials.json` (permessi `0600`). Con `RENDICONTO_TOKEN` nell'ambiente il file non serve. I comandi:

| Comando | Cosa fa |
|---|---|
| `rendiconto whoami` | ente, permessi, scadenza, uso di oggi |
| `rendiconto setup claude\|cursor\|desktop` | scrive la configurazione MCP del client (con `--print` la mostra soltanto). `setup claude --con-token` salva il token in Claude Code; `setup desktop` usa il ponte `mcp-remote@0.14.3` |
| `rendiconto import estratto.csv --conto <id>` | carica, mostra l'anteprima, chiede conferma (`--yes` per saltarla), stampa il `batchId` e come annullare |
| `rendiconto movimenti --anno 2026 --non-classificati --cerca affitto` | elenco movimenti |
| `rendiconto classifica --suggerisci -o c.json` | suggerimenti in un file da rivedere (`"applica": false` per escludere una riga) |
| `rendiconto classifica --applica c.json` | applica in blocco, con conferma |
| `rendiconto anomalie --anno 2026` | coda di revisione e anomalie |
| `rendiconto export analisi --anno 2026 --formato pdf -o analisi.pdf` | scarica da link firmato e verifica lo sha256. Per cassa: `modello-d`. Per competenza: `modello-a`, `modello-b`, `modello-c`, `libro-giornale`. Altri: `scadenzario`, `movimenti`, `contributo --contributo <id>`, `cinque-per-mille --id <id>`, `dichiarazione-rimborso --rimborso <id>`, `workbook`. Se l'esercizio ha l'altro regime, dice quale comando usare |
| `rendiconto tools list` · `tools call <nome> --args '{…}'` | accesso diretto a tutti gli strumenti |

Opzioni comuni: `--json` (output per script), `--profile <nome>`, `--base-url <url>` (o `RENDICONTO_BASE_URL`), `--yes`.

Codici di uscita: `0` ok · `1` altro errore · `2` uso errato · `3` autenticazione · `4` permesso negato · `5` limite · `6` errore del server.

Per Cursor: `rendiconto setup cursor`. Cursor legge il token dalla variabile `RENDICONTO_TOKEN` (il file non lo contiene).

La CLI riprova da sola (fino a 2 volte, con attesa) quando il server dice che l'errore è passeggero (`rate_limited`, `ai_unavailable`); non ripete mai una scrittura che potrebbe duplicarsi. Se chiedi qualcosa che un agente non fa, stampa il perché e dove farlo nell'app (`tool_excluded`).

## 4. Claude Desktop

Claude Desktop passa dal ponte `mcp-remote@0.14.3` (spiegazione sotto). Serve Node 20 o più recente. In Claude Desktop apri **Impostazioni › Sviluppatore › Modifica configurazione** e incolla questo, con il tuo token al posto di `rmcp_…`:

```json
{
  "mcpServers": {
    "rendiconto": {
      "command": "npx",
      "args": ["-y", "mcp-remote@0.14.3", "https://rendiconto.io/api/mcp", "--header", "Authorization:${AUTH}"],
      "env": { "AUTH": "Bearer rmcp_…" }
    }
  }
}
```

Poi chiudi Claude Desktop del tutto (Cmd+Q su Mac), riaprilo e scrivi «chi sono su Rendiconto?». Dettagli e problemi comuni: [GUIDA.md](GUIDA.md). Quando la CLI sarà su npm, `rendiconto setup desktop` scriverà questo file al posto tuo.

Claude Desktop non espande variabili: il file di configurazione contiene il token, quindi non condividerlo (la CLI, quando sarà disponibile, lo scrive con permessi `0600`). Rendiconto usa un token, non OAuth (`/api/mcp` non pubblica i metadati OAuth), perciò il *connettore personalizzato* di Claude non si può usare. Si passa dal ponte `mcp-remote`, **fissato alla versione 0.14.3** (l'ultima uscita da più di tre settimane il 2026-10-14): il ponte vede il token e non deve aggiornarsi da solo. La versione si cambia a mano in `packages/cli/src/setup.ts` (`MCP_REMOTE_VERSION`). Serve Node 20 o più recente.

## Cosa l'agente non fa

Queste cose un agente **non** le fa: o per scelta (sono decisioni di una persona), o perché non c'è ancora uno strumento. Se glielo chiedi, risponde con il motivo e dove farlo nell'app. Le prime sei righe sono fisse nel server (`tool_excluded`, elenco `AGENT_EXCLUDED_CAPABILITIES`); le altre sono strumenti che non esistono.

| Cosa | Dove si fa nell'app |
|---|---|
| Cambiare il regime contabile (cassa o competenza) | Impostazioni dell'ente › Profilo dell'ente › Regime contabile |
| Creare, chiudere o riaprire un esercizio | Impostazioni dell'ente › Esercizi |
| Eliminare un contributo (un agente può solo chiuderlo) | Contributi › apri il contributo › Elimina |
| Dati dell'ente, piano e fatturazione | Impostazioni dell'ente; Impostazioni › Fatturazione |
| Invitare collaboratori o cambiarne il ruolo | Impostazioni dell'ente › Collaboratori |
| Creare o revocare accessi per agenti | Impostazioni dell'ente › Accesso per agenti e API |
| Scaricare in massa dati personali: Certificazioni Uniche, F24, libro soci, elenco quote | Esportazioni e Soci |
| Approvare un rimborso; registrare la delibera per i rimborsi autocertificati; collegare un rimborso al bonifico | Rimborsi |
| Contabilizzare, stornare o respingere una scrittura; chiudere il periodo; cambiare il piano dei conti; approvare o depositare il bilancio | Contabilità |
| Eliminare un socio; generare le quote dell'anno; collegare una quota già pagata a un altro movimento | Soci |
| Correggere o togliere un movimento importato dalla banca (un'importazione recente e non lavorata si annulla con `undo_import`) | Movimenti |
| Modificare un commento (si cancella il proprio e se ne scrive un altro); cambiare il conto di un movimento | Movimenti |
| Verbali, registro del volontariato, raccolte fondi, ricevute ai donatori, anagrafica contatti, richieste, scritture di previsione | Verbali · Volontariato · Raccolte fondi · Richieste · Previsioni |

## Sicurezza

- **Un token per ente.** Non vale per nessun altro ente e non può crearne altri.
- **Mai più dei tuoi permessi.** Un agente non può fare più di quanto puoi fare tu con il tuo ruolo; se il tuo ruolo cambia o esci dall'ente, l'accesso si adegua o smette entro un minuto.
- **Permessi (scope) minimi.** Parti da «Solo lettura» e aggiungi solo ciò che serve (`write:import`, `write:classify`, `export`, `use:ai`…).
- **Conferma delle operazioni delicate.** Importazioni, annullamenti e modifiche in blocco si fermano e chiedono la tua conferma; la CLI la mostra e ti chiede `y/N`.
- **Revoca.** Puoi revocare un accesso in qualsiasi momento da Impostazioni → Accesso per agenti e API, e vedere ogni chiamata nel registro delle attività. Ha una scadenza (massimo un anno) e si può limitare a certi indirizzi IP.
- **Il token è una password.** Non incollarlo in chat, repository o screenshot; la CLI non lo stampa mai (solo le ultime 4 cifre). Se è finito dove non doveva, revocalo e creane uno nuovo.
- Questo kit non invia nulla a terzi: parla solo con il tuo server Rendiconto.

## Sviluppo

```bash
cd packages/cli && npm install && npm run build && npm test
```

`npm run gen` rigenera `src/generated/tools.ts` da `tools.pinned.json` (copia del registro `GET /api/agent/v1/tools.json`, ora 145 strumenti), oppure da un indirizzo: `RENDICONTO_TOOLS_URL=https://rendiconto.io/api/agent/v1/tools.json npm run gen`. Rigeneralo quando il registro cambia.

Pubblicazione della CLI (non ancora fatta): tag `cli-v<versione>` → `.github/workflows/publish.yml` (richiede il segreto `NPM_TOKEN`).

Licenza: MIT.

---

## English

Public kit that connects **Rendiconto.io** (bookkeeping for Italian non-profits) to Claude Code, Cursor, Claude Desktop and scripts: the `rendiconto` Claude Code plugin and the upcoming `@rendiconto/cli` package (command `rendiconto` + `createClient` SDK, not on npm yet) (MCP server, nine Italian-language skills, slash shortcuts).

Requires a Premium or Studio subscription. Create a token in **Settings → Accesso per agenti e API** (one token per organisation, shown once, revocable, scoped).

```bash
claude plugin marketplace add Agentica-srls/rendiconto-agent-kit
claude plugin install rendiconto@rendiconto-agent-kit
```

Set the token once so it survives restarts (the plugin reads `RENDICONTO_TOKEN`):

```bash
echo "export RENDICONTO_TOKEN='rmcp_…'" >> ~/.zshrc
```

Without the plugin: `claude mcp add --transport http rendiconto https://rendiconto.io/api/mcp --header "Authorization: Bearer $RENDICONTO_TOKEN" --scope user`. Claude Desktop goes through the pinned `mcp-remote@0.14.3` bridge (config snippet in section 4 above).

The `@rendiconto/cli` package is **coming soon on npm**; it is not published yet, so do not run `npx @rendiconto/cli` for now.

Step-by-step guide for non-technical users (Italian): [GUIDA.md](GUIDA.md). The README section «Cosa l'agente non fa» lists what agents deliberately cannot do and where to do it in the app.

The CLI (once published) talks to `<base>/api/mcp` (Streamable HTTP) and `<base>/api/agent/v1/*`. Exit codes: 0 ok, 1 other error, 2 usage, 3 auth, 4 forbidden, 5 rate limit, 6 server. The token is never printed (last 4 characters only) and `RENDICONTO_TOKEN` overrides any saved profile. MIT licence.
