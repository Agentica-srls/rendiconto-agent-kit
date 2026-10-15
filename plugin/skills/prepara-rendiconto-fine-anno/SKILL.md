---
name: prepara-rendiconto-fine-anno
description: Usa a fine esercizio o quando la persona dice «prepara il rendiconto», «chiudiamo l'anno», «Modello D», «Modello A/B/C», «relazione di missione»: checklist di fine anno, bilancio per cassa (Modello D) o per competenza (Modelli A, B, C e libro giornale), bozza delle sezioni mancanti della relazione, esportazioni.
---

# Prepara il rendiconto di fine anno

Porta l'esercizio fino al rendiconto pronto: lacune chiuse, bilancio quadrato (Modello D per cassa; Modelli A, B, C per competenza), relazione di missione scritta e riletta, file esportati.

## Prima di tutto: cassa o competenza?

Ogni esercizio ha il suo regime. Leggilo con `get_workspace_info` (campo `years[].regime`) o con `list_years`, **prima** di chiamare qualunque Modello:

- **Cassa** → il bilancio è il **Modello D**. Segui i passi «Per cassa».
- **Competenza** → il bilancio è formato da **Modello A** (Stato Patrimoniale), **Modello B** (Rendiconto Gestionale) e **Modello C** (relazione di missione con le cifre), più il libro giornale. **Non chiamare mai** `get_modello_d` né `export_modello_d` su un esercizio in competenza: rispondono con un errore (409). Segui i passi «Per competenza».
- Un ente può avere esercizi diversi con regimi diversi (per esempio cassa fino al 2024 e competenza dal 2025): decidi anno per anno. Il regime non lo cambi tu: se è sbagliato, dillo alla persona (Impostazioni dell'ente › Regime contabile).

## Passi comuni

1. Chiedi l'esercizio se non è chiaro (`get_workspace_info` dice quali sono aperti e con quale regime). Poi chiama `get_year_end_checklist` con `year`. Se l'esercizio non esiste ancora o è già chiuso, dillo: creare o chiudere un esercizio si fa dall'app (Impostazioni dell'ente › Esercizi), non da qui.
2. Chiudi le lacune **una alla volta**, nell'ordine della checklist: movimenti senza categoria (skill `classifica-movimenti`), uscite non ripartite sui centri di costo (skill `analisi-centri-di-costo`), documenti mancanti (indica quali movimenti, con data, importo e descrizione). Non passare al punto successivo senza il consenso.
3. Se l'ente ha ricevuto il **5×1000**, controlla anche il suo rendiconto: `list_cinque_per_mille` mostra per ogni anno i passi di legge (redatto entro 12 mesi dall'accredito; da 20.000 euro anche invio al Ministero, pubblicazione e link), il prossimo passo e la sanzione a rischio; `get_cinque_per_mille` (`filingId`) dà le spese per sezione e la differenza con l'importo ricevuto; `export_cinque_per_mille` ne fa il PDF (link firmato di 15 minuti). Con il permesso `write:reports` puoi creare la bozza (`create_cinque_per_mille`) e registrare le date dei passi (`update_cinque_per_mille`), ma solo su richiesta della persona e con le date che ti detta: non c'è un cambio di stato manuale e non si elimina nulla.

## Per cassa

4. Chiama `get_modello_d` e controlla la **quadratura**: totali per sezione, avanzo/disavanzo, saldo di cassa. Se i totali non tornano, **fermati**, mostra le due cifre che divergono e dove, e chiedi come procedere. Non «aggiustare» importi e non proporre scritture inventate.
5. **Relazione di missione** (vale anche per la competenza). Chiama `get_relazione_sections`: per ogni punto obbligatorio senza testo scrivi una **bozza** usando solo i dati dell'ente (nome, esercizio, totali del bilancio, contributi). Nessuna cifra o attività che non risulti dagli strumenti: dove manca un dato lascia un segnaposto «[da completare]» e chiedilo. Mostra la bozza di ogni sezione alla persona. Salva con `update_relazione_section` **solo dopo** che l'ha riletta e approvata, una sezione per volta. Se la relazione risulta già approvata o depositata (campo `stato`) non sovrascriverla senza un suo ordine esplicito: del resto il server non lo permette.
6. Esporta con `export_modello_d` ed `export_analisi` (`format` pdf). Gli strumenti restituiscono un link firmato valido 15 minuti con `sha256`: con la CLI `rendiconto export modello-d --anno <anno> -o modello-d.pdf` lo scarica e lo verifica.

## Per competenza

4. Chiama `check_quadratura` e poi `get_salute` (`year`): riporta ogni differenza con gli importi esatti (dare/avere, attivo/passivo) e se la contabilità risulta depositabile. Poi `validate_period_close`: è una prova, non chiude nulla; elenca i `blockers` uno per uno. Per il dettaglio di ogni controllo usa la skill `verifica-quadratura-bilancio`.
5. Leggi i bilanci: `get_modello_a` (Stato Patrimoniale), `get_modello_b` (Rendiconto Gestionale), `get_modello_c` (le cifre e i 22 punti della relazione). Se avanzo e variazione del patrimonio netto non tornano, **fermati** e mostra le due cifre. Per il controllo delle scadenze di pagamento e incasso c'è `list_open_items` (crediti e debiti aperti); per la banca `reconcile_status`.
6. Relazione di missione: come al punto 5 di «Per cassa» (`get_relazione_sections`, poi `update_relazione_section` dopo l'approvazione della persona; sono i 22 punti del Modello C).
7. Archivia le copie con `create_snapshot` (`reportType`: `modello-a`, `modello-b` o `modello-c`; compaiono in Archivio report come bozza). Esporta con `export_modello_a_b_c` (`model`: `a`, `b` o `c`) e `export_libro_giornale` (CSV); con la CLI: `rendiconto export modello-a --anno <anno> -o a.pdf` (e `modello-b`, `modello-c`, `libro-giornale`). Anche qui il link è firmato e dura 15 minuti. Puoi aggiungere `export_analisi` (`format` pdf) per la parte sui centri di costo e sui contributi.
8. Le correzioni di contabilità (scritture di rettifica, ratei e risconti, cespiti, saldi di apertura) non le inventi: con il permesso `write:competenza` un agente può preparare **bozze** di prima nota, ma approvarle, stornarle, chiudere l'esercizio e approvare o depositare il bilancio restano alla persona nell'app. Proponile solo se la persona lo chiede, citando i dati restituiti dagli strumenti.

## Chiusura

- Chiudi con un riepilogo: cosa è pronto, cosa manca, chi deve firmare o approvare. Chiudere l'esercizio, approvare il bilancio o depositare non è compito tuo: è dell'ente, dall'app.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
