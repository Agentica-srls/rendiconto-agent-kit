---
name: scadenze-del-mese
description: Usa quando la persona chiede cosa scade nel mese o nei prossimi giorni, o dice «scadenze», «cosa devo fare questo mese». Elenca le scadenze dei prossimi 30 giorni come checklist e completa solo quelle che la persona conferma.
---

# Scadenze del mese

Presenta le scadenze dei prossimi 30 giorni come checklist e segna come completate solo quelle che la persona conferma.

## Passi

1. Prendi la data di oggi del sistema (formato `AAAA-MM-GG`); se non la conosci, chiedila. Poi fai **tre letture**, nell'ordine:
   - le **scadute**: `list_scadenze` con `status: "pending"` e `to` = ieri (nessun `from`, altrimenti le scadute non compaiono);
   - le **prossime**: `list_scadenze` con `status: "pending"`, `from` = oggi e `to` = oggi + 30 giorni;
   - le **rimandate**: `list_scadenze` con `status: "snoozed"` (senza date), per dire alla persona che cosa è stato messo da parte e fino a quando.
   Se un elenco ha `nextCursor`, continua finché non è finito: non fermarti alla prima pagina.
2. Presenta una checklist in questo ordine, con una sezione per ognuna: **1) Scadute** (le più vecchie per prime, con i giorni di ritardo), **2) Entro 7 giorni**, **3) Da qui a 30 giorni**, **4) Rimandate**. Per ogni voce: nome della scadenza, data, giorni mancanti o di ritardo, e ciò che manca (documento, importo, firma) solo se risulta dai dati. Se il nome non c'è, usa quello della voce di catalogo; se non c'è nemmeno quello, scrivi «scadenza senza nome» con data e id.
3. Se una scadenza scaduta è un'uscita di denaro (per esempio una restituzione o un F24), dillo in chiaro e con l'importo **solo se** lo strumento lo restituisce. Per capire quale F24 è in arrivo puoi chiamare `get_ritenute_report` (ritenute per mese e codice tributo, con scadenza dell'F24 già spostata per festivi e agosto). Per il 5x1000 e i suoi passi di legge c'è `list_cinque_per_mille`. Generare l'F24 o la CU resta all'app.
4. Se l'ente ha un libro soci e la persona chiede delle quote, `list_quote_non_pagate` (`year`) elenca le quote ancora da incassare con il totale e quali sono scadute. Per segnarne una pagata c'è `record_quota_payment` (si collega al movimento che l'ha incassata; chiede sempre conferma perché il socio riceve una email); per sollecitare `send_quota_reminder` (un socio) o `send_quota_reminders` (tutti): chiedono sempre conferma e dicono quante email partiranno, e non partono se il socio non ha email o è stato sollecitato nelle ultime 24 ore. Mai sollecitare o segnare pagamenti senza un «sì» esplicito. I dati personali dei soci (codice fiscale, contatti) non si leggono da qui.
5. Per ogni scadenza **non inventare** importi o adempimenti: se il dato non c'è, scrivi «dato non disponibile».
6. Chiedi quali risultano già fatte. Solo per quelle che la persona **conferma una per una** chiama `complete_scadenza` (con una nota breve se la persona la detta). Non completare in blocco e non dedurre da solo che «sarà già fatta». Una scadenza scaduta non si cancella né si rimanda per far sparire il ritardo: se è davvero da fare, resta in cima.
7. Se una scadenza va spostata usa `snooze_scadenza` solo su richiesta (la nuova data deve essere futura); per rimetterla attiva `unsnooze_scadenza`; per aggiungerne una nuova `create_scadenza` solo con titolo e data dati dalla persona.
8. Chiudi con il riepilogo: completate, ancora aperte (con data, le scadute per prime), spostate. Se serve un promemoria in calendario, dillo alla persona: Rendiconto non invia messaggi a terzi da qui.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
