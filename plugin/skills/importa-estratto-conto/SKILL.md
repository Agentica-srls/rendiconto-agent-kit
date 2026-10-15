---
name: importa-estratto-conto
description: Usa quando la persona vuole caricare un estratto conto (CSV, XLS, XLSX, CBI o PDF) in Rendiconto, importare movimenti dalla banca, o dice «importa l'estratto conto». Mostra anteprima, errori e duplicati e importa solo dopo conferma.
---

# Importa estratto conto

Carica un estratto conto, mostra cosa verrebbe importato e importa solo dopo il consenso. Alla fine passa a `classifica-movimenti`.

## Passi

1. Chiama `get_workspace_info` per sapere ente, esercizio e permessi. Serve il permesso «Importare estratti conto» (`write:import`): se manca, fermati e spiegalo.
2. Chiama `list_bank_accounts` e individua il conto di destinazione. Se è ambiguo (più conti simili, nessun IBAN nel nome del file) chiedi alla persona quale usare. Non indovinare.
3. Carica il file.
   - Con la CLI: `rendiconto import <file> --conto <id>` fa tutto (carica, anteprima, conferma) e chiede lui il «sì».
   - Con gli strumenti: `create_upload_link` (`purpose: "import"`, nome file e tipo MIME), poi un `PUT` con `curl -T "<file>" -H "Content-Type: <tipo>" "<uploadUrl>"`. Il link vale 10 minuti ed è monouso. Massimo 20 MB.
4. Chiama `import_statement_preview` con `fileId` e `bankAccountId`. Per i PDF o per colonne non riconosciute serve il permesso AI; senza, chiedi un CSV/XLSX.
5. Mostra alla persona il numero di righe, i **problemi** (`issues`), i **duplicati** già presenti e le prime righe con data, importo e descrizione. Le voci con gravità `info` (per esempio «uso le colonne ricordate») sono note, non problemi: non contarle tra i problemi e non allarmare la persona. Elenca i duplicati con il numero di riga (`rowIndex`), data, importo e descrizione. Il «saldo delle righe del file» comprende anche i duplicati che verranno saltati: se la persona chiede quanto entra davvero, somma tu le sole righe che entrano. Se l'importo totale o il numero di righe non corrisponde a ciò che la persona si aspetta dall'estratto, **fermati**: non importare.
6. Chiedi: «Importo queste N righe sul conto X?». Solo con il «sì» chiama `import_statement_confirm` (`previewId`, `bankAccountId`, e `excludeRowIndexes` per le righe da escludere, per esempio i duplicati). La prima chiamata risponde con `requiresConfirmation`: mostra il riepilogo, poi ripeti con il `confirmationId`.
7. Riporta il `batchId` e quanti movimenti sono entrati. Spiega che l'importazione si può annullare con `undo_import` entro 24 ore, solo con lo stesso accesso e solo se i movimenti non sono ancora stati classificati o collegati a documenti. **Non annullare mai** senza che la persona lo chieda.
8. Proponi di continuare con la classificazione (skill `classifica-movimenti`).

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
