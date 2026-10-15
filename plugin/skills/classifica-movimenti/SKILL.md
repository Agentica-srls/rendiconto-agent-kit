---
name: classifica-movimenti
description: Usa quando ci sono movimenti senza categoria da classificare, dopo un'importazione o quando la persona dice «classifica i movimenti», «metti a posto le categorie». Applica prima le regole dell'ente, poi i suggerimenti, in blocco con conferma.
---

# Classifica movimenti

Porta i movimenti senza categoria a una categoria, usando prima le regole dell'ente, poi i suggerimenti, e propone regole nuove per i casi ricorrenti.

## Passi

1. Chiama `list_unclassified_movements` (filtra per `year` se la persona indica un esercizio). Se sono più di 200, lavora a gruppi e dillo.
2. Chiama `list_classification_rules` e applica prima le regole esistenti: un movimento che soddisfa una regola va alla categoria della regola. Lo fai **senza AI e senza consumare la quota AI** con `apply_classification_rules`: la prima chiamata (`dryRun`, il predefinito) con `year` non scrive nulla e restituisce le proposte (movimento, categoria, regola); mostrale alla persona, poi richiama con `dryRun: false` e i soli `movementIds` che ha approvato (sopra 50 il server chiede la sua conferma). Tocca solo movimenti non ancora classificati, in esercizi aperti. Le regole non si applicano da sole all'importazione: dopo un'importazione vanno lanciate da qui.
3. Per il resto: se l'accesso ha il permesso «Usare l'AI dell'abbonamento» (`use:ai`), chiama `suggest_classification` (massimo 50 movimenti per chiamata, nessuna modifica ai dati). Senza quel permesso proponi tu una categoria, **citando** per ogni movimento data, importo e descrizione e il motivo. Le categorie valide vengono da `list_categories`: non usarne altre. Se esistono due categorie quasi uguali (per esempio «Affitti e noleggi» e «Affitto sede»), preferisci quella già usata per la stessa controparte negli altri movimenti (`list_movements` con `search`) e, nel dubbio, chiedi alla persona quale tenere: non unirle né rinominarle da solo.
4. Riassumi per categoria: quanti movimenti e totale (calcolato dagli importi restituiti, non a mente). Metti da parte, in una lista a parte, i movimenti incerti o con confidenza bassa: non vanno nel blocco.
5. Chiedi conferma alla persona sul riepilogo. Solo dopo applica con `bulk_classify_movements` (una chiamata per categoria). Sopra 50 movimenti il server chiede una conferma sua: mostra il riepilogo e aspetta il «sì». Per un solo movimento usa `classify_movement`.
6. Se un segno non è compatibile con la categoria (entrata in una categoria di uscita) il server rifiuta o salta la riga: riportalo, non forzarlo.
7. Proponi regole nuove per i casi ricorrenti (stessa controparte o stessa descrizione ripetuta): mostra la regola e i movimenti che coprirebbe, e crea con `create_classification_rule` solo se la persona accetta.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
