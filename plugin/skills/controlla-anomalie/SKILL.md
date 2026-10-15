---
name: controlla-anomalie
description: Usa quando la persona vuole sapere cosa non torna nei suoi dati: anomalie, avvisi, duplicati sospetti, documenti mancanti, importi che non coincidono, coda di revisione. Spiega in italiano semplice e corregge solo se la persona è d'accordo.
---

# Controlla anomalie

Passa in rassegna anomalie e avvisi, li spiega, e corregge solo con il consenso.

## Passi

1. Chiama `get_review_queue` (visione d'insieme per sezione), poi `list_anomalies` (filtra per `severity` o `type` se serve; `summaryOnly` per un primo conteggio) e `list_movement_warnings`.
2. Per i **documenti mancanti** (`missing_document`) non elencare un movimento alla volta: raggruppali per categoria e per controparte e riporta il totale per gruppo. Gli oneri bancari, i canoni del conto, gli F24, l'imposta di bollo e gli interessi non vengono più segnalati come senza documento (la banca li documenta già); i duplicati con controparti diverse non vengono più segnalati. Se la persona ne vede lo stesso, spiega perché compaiono.
3. Spiega ogni voce in italiano semplice, **citando** data, importo e descrizione del movimento: per esempio «2026-03-05, 350,00 €, Quota associativa Rossi: sembra un duplicato di un movimento del 2026-03-04». Raggruppa per tipo e parti dalle più gravi (`blocking`, poi `critical`, poi `warning`).
4. Per ogni gruppo proponi la correzione e **aspetta il consenso** prima di toccare qualcosa:
   - categoria mancante: `classify_movement` (o torna alla skill `classifica-movimenti`);
   - falso allarme o già risolto: `dismiss_anomaly` con `action` «dismiss» (falso allarme: il movimento torna completo) o «resolve» (da rivedere). Una chiusura cambia lo stato del movimento: chiedila per ogni gruppo;
   - serve una nota per il commercialista o per un collega: `add_comment` (il testo compare con «[via agente]»). Per menzionare qualcuno chiama prima `list_members` e scrivi nel testo il valore `mention` (per esempio «@Mario»); se `mention` è nullo quella persona non si può menzionare. Un commento sbagliato scritto dallo stesso accesso si toglie con `delete_comment` (chiede sempre conferma); non si modifica, si cancella e si riscrive;
   - un movimento **inserito a mano per errore** (per esempio una spesa di cassa doppia): `update_manual_movement` per correggere importo, data, descrizione o controparte, `delete_manual_movement` per toglierlo; entrambi chiedono conferma quando cambiano cifre o cancellano, e valgono solo per i movimenti manuali e per esercizi aperti. Un movimento **importato dalla banca** non si corregge né si cancella da qui: se l'importazione è recente e non lavorata c'è `undo_import`, altrimenti si fa nell'app;
   - duplicato sospetto: **non cancellare mai** di tua iniziativa un movimento che sembra un duplicato. Se è un movimento manuale e la persona conferma che è doppio, vale `delete_manual_movement`; se è importato, indica di verificarlo nell'app.
5. Se due fonti danno importi diversi per lo stesso movimento (`amount_mismatch`), **fermati** e mostra entrambi gli importi: decide la persona, tu non scegli.
6. Alla fine riassumi: cosa hai corretto (con data, importo, descrizione), cosa resta aperto e perché.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
