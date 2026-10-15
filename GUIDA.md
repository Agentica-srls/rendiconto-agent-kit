# Guida passo passo: collegare Rendiconto a Claude

Per chi non è tecnico. Dieci minuti, una volta sola. Alla fine scrivi a Claude «chi sono su Rendiconto?» e lui risponde con il nome del tuo ente.

Questa guida vale per due programmi:

- **Claude Code** (si usa dal terminale);
- **Claude Desktop** (l'app per Mac e Windows).

Se non sai quale hai, probabilmente è Claude Desktop.

## Prima di cominciare

1. Il tuo ente ha un abbonamento **Premium o Studio**.
2. Il tuo ruolo in Rendiconto è tesoriere, contabile, presidente o studio. Un agente non può fare più di quanto puoi fare tu.
3. Solo per Claude Desktop: sul computer c'è **Node 20 o più recente**. Per controllare apri il terminale (su Mac: Cmd+Spazio, scrivi «Terminale»; su Windows: «PowerShell») e scrivi:

```bash
node --version
```

Se risponde `v20` o un numero più alto, vai avanti. Se non trova il comando, scarica la versione «LTS» da <https://nodejs.org> e installala, poi riapri il terminale.

## Passo 1. Crea l'accesso nell'app

1. Apri Rendiconto, scegli il tuo ente e vai in **Impostazioni › Accesso per agenti e API**. L'indirizzo è `https://rendiconto.io/` seguito dall'id del tuo ente e da `/settings/agenti`; è più semplice arrivarci dal menu.
2. Premi per creare un nuovo accesso e dagli un nome che ricordi (per esempio «Claude sul mio Mac»).
3. Scegli i **permessi**. Tre scelte pronte:
   - **Solo lettura**: Claude guarda movimenti, report e scadenze, ma non cambia niente. Parti da qui se hai dubbi.
   - **Assistente**: legge, importa estratti conto, classifica i movimenti, carica documenti, annota e scarica i report. Prima di ogni cosa grossa (importazioni, modifiche in blocco, annullamenti) si ferma e ti chiede il «sì».
   - **Completo**: tutti i permessi che il tuo ruolo consente, compresi 5×1000, soci e quote, rimborsi e, per gli enti in contabilità per competenza, la prima nota in bozza.
   La lettura con l'intelligenza artificiale (scontrini, PDF, suggerimenti di categoria) è una casella a parte: «Usare l'AI dell'abbonamento».
   Se il tuo ente è in contabilità per **competenza**, serve anche «Leggere la contabilità per competenza» (c'è già in «Completo»).
4. Scegli la scadenza (massimo un anno) e crea l'accesso.
5. Compare il **token**, una riga che inizia con `rmcp_`. **Si vede una sola volta.** Copialo e tienilo pronto: ti serve al passo 2.

Il token è come una password: non incollarlo in una chat, in un'email o in uno screenshot. Se finisce dove non doveva, nella stessa pagina premi «Revoca accesso» e ne crei un altro.

## Passo 2. Collega Claude Code o Claude Desktop

Scegli **uno** dei tre percorsi. Non serve installare nient'altro che Claude: la parte da riga di comando `@rendiconto/cli` arriverà su npm a breve e non è necessaria.

### 2A. Claude Code con il plugin (consigliato)

Il plugin porta il collegamento e le procedure guidate in italiano (importa estratto conto, scadenze, rendiconto di fine anno…).

```bash
claude plugin marketplace add Agentica-srls/rendiconto-agent-kit
```

```bash
claude plugin install rendiconto@rendiconto-agent-kit
```

Il plugin legge il token dalla variabile `RENDICONTO_TOKEN`. Impostala una volta per sempre (sostituisci `rmcp_…` con il tuo token, tra apici). Mac e Linux:

```bash
echo "export RENDICONTO_TOKEN='rmcp_…'" >> ~/.zshrc
```

Windows (PowerShell):

```powershell
setx RENDICONTO_TOKEN "rmcp_…"
```

Chiudi e riapri il terminale, poi riavvia Claude Code. Questa strada lascia il token scritto in chiaro in un file e nella cronologia del terminale: usala solo su un computer tuo.

**Verifica.** Apri una nuova sessione di Claude Code e scrivi: «chi sono su Rendiconto?». Deve nominare il tuo ente.

### 2B. Claude Code senza plugin

Solo il collegamento, senza procedure guidate (qui `$RENDICONTO_TOKEN` è la variabile del terminale in cui lanci il comando):

```bash
claude mcp add --transport http rendiconto https://rendiconto.io/api/mcp --header "Authorization: Bearer $RENDICONTO_TOKEN" --scope user
```

### 2C. Claude Desktop

In Claude Desktop apri **Impostazioni › Sviluppatore › Modifica configurazione** e incolla questo (con il tuo token al posto di `rmcp_…`). Il file contiene il token: non condividerlo.

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

Poi:

1. **Chiudi Claude Desktop del tutto** (su Mac: Cmd+Q; su Windows: dall'icona nella barra, «Esci»). Chiudere la finestra non basta.
2. Riaprilo.
3. In una nuova conversazione scrivi: «chi sono su Rendiconto?». Deve nominare il tuo ente.

**Perché c'è un «ponte».** Claude Desktop collega i servizi esterni in due modi: i *connettori personalizzati* (che chiedono un accesso con login, detto OAuth) e i programmi locali. Rendiconto oggi usa un token, non OAuth (l'indirizzo `/api/mcp` non pubblica i dati di accesso OAuth), quindi il connettore personalizzato non si può usare. Si usa invece un programma locale piccolo, **mcp-remote versione 0.14.3**, che Claude Desktop avvia da solo con `npx` (per questo serve Node). La versione è fissata a mano: così un aggiornamento futuro del ponte, che vede il token, non entra nel tuo computer senza che nessuno lo abbia riletto.

### La riga di comando `rendiconto` (in arrivo)

Il pacchetto `@rendiconto/cli` (comando `rendiconto`, per script e per importare dal terminale) **non è ancora su npm**: quando lo sarà, qui troverai `rendiconto login` e `rendiconto setup`. Per ora non serve.

## Se qualcosa non va

| Cosa vedi | Cosa fare |
|---|---|
| `npx: command not found` o «comando non trovato» (Claude Desktop) | Node non è installato: vedi «Prima di cominciare». |
| `invalid_token` o `token_expired` | Il token è sbagliato, scaduto o revocato. Crea un nuovo accesso (passo 1) e rifai il passo 2 con il nuovo token. |
| `scope_not_granted` | All'accesso manca un permesso. Il messaggio dice quale; si aggiunge creando un nuovo accesso con il permesso in più. |
| `tool_excluded` | Quella cosa un agente non la fa mai. Il messaggio dice dove farla nell'app. L'elenco è in README, «Cosa l'agente non fa». |
| `rate_limited` | Troppe richieste in un minuto. Il messaggio dice tra quanti secondi riprovare; Claude riprova. |
| Claude Desktop non mostra «rendiconto» | Hai chiuso solo la finestra: esci del tutto e riapri. Se resta così, apri il file di configurazione e controlla che sia un JSON valido (virgole e parentesi). |
| Il file di configurazione ha un errore | Controlla virgole e parentesi, oppure incolla di nuovo il blocco del passo 2C. |

Per cambiare ente: un token vale per **un solo ente**. Crea un accesso per ogni ente e registralo con un nome diverso (per esempio `claude mcp add --transport http rendiconto-nome-ente …` con il token di quell'ente).
