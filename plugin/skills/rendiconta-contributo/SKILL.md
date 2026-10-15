---
name: rendiconta-contributo
description: Usa quando la persona deve rendicontare un contributo o un bando (Provincia, Comune, Fondazione, 5×1000): spese non ancora imputate, ripartizione sul contributo, controllo ammesso/concesso, fascicolo di rendicontazione.
---

# Rendiconta un contributo

Individua le spese non ancora imputate a un contributo, le ripartisce con il consenso e prepara il fascicolo.

## Passi

1. Chiama `list_contributi` e scegli il contributo. Se la persona indica un nome o un CUP e ci sono più corrispondenze, chiedi quale. Riporta importo **concesso**, **ammesso**, speso e residuo così come arrivano dallo strumento.
2. Chiama `get_contributo_rendicontazione` (`projectId`, e `from`/`to` se la persona vuole un periodo diverso da quello del finanziatore). Leggi spese imputate per voce, documenti e completezza.
3. Cerca le spese non ancora imputate (movimenti in uscita nella finestra di ammissibilità, senza imputazione a questo contributo). Elencale con data, importo e descrizione e proponi a quali voci e con quali importi imputarle.
4. **Regola fondamentale: si spende l'ammessa, non il concesso.** La spesa rendicontabile non può superare l'importo **ammesso**, anche se il concesso è più alto. Prima di proporre imputazioni calcola il residuo sull'ammessa con le cifre dello strumento. Se la somma proposta lo supera, **fermati**: mostra le due cifre e chiedi cosa fare.
5. Applica con `allocate_to_contributo` solo dopo il consenso. Sopra 50 movimenti il server chiede una conferma: mostra il riepilogo e aspetta il «sì». Un movimento già ripartito su più fondi va sostituito con la ripartizione **completa**: controlla che le quote sommino al totale del movimento.
6. Se manca un documento per una spesa che vuoi imputare, dillo: non imputare «in attesa». Per togliere un'imputazione (`remove_contributo_allocation`) serve la richiesta esplicita della persona.
7. Rileggi `get_contributo_rendicontazione`: ammesso, speso, residuo e completezza devono tornare con quanto hai proposto. Poi esporta con `export_contributo_bundle` (zip, link valido 15 minuti con `sha256`).
8. Non segnare la rendicontazione come inviata (`mark_contributo_report_sent`) a meno che la persona non lo chieda: è una conferma sua e riguarda un invio che avviene fuori da Rendiconto.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
