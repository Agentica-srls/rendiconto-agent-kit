---
name: verifica-quadratura-bilancio
description: Usa per gli enti in contabilità per competenza quando la persona vuole sapere se il bilancio quadra, se il periodo si può chiudere o come sta la contabilità: quadratura, chiusura del periodo, riconciliazione, salute.
---

# Verifica la quadratura del bilancio

Solo per enti in **competenza** (gli strumenti restituiscono `not_competenza` altrimenti: in quel caso spiegalo e proponi la skill `prepara-rendiconto-fine-anno`). Serve il permesso «Leggere la contabilità per competenza» (`read:contabilita`).

## Passi

1. Chiama `check_quadratura` (`year`) e riporta **ogni differenza con gli importi esatti** (dare/avere, attivo/passivo), così come restituiti. Non arrotondare e non compensare a mente.
2. Chiama `validate_period_close` (`year`): è una prova, non chiude nulla. Elenca i `blockers` uno per uno, in italiano semplice.
3. Chiama `reconcile_status` (riconciliazione banca ↔ partite) e `get_salute` (`year`): riporta i controlli con stato e dettaglio e se la contabilità è depositabile.
4. Riassumi cosa è a posto e cosa no, con le cifre. Per ogni problema di quadratura indica dove guardare (scritture sbilanciate, bozze, partite senza contropartita) citando i riferimenti restituiti.
5. **Non proporre scritture inventate** e non dire «basta una rettifica di X»: se serve una correzione, descrivi il problema e chiedi alla persona come procedere. Le scritture le decide l'ente con il suo commercialista.
6. Chiudere il periodo non è un tuo compito: tu verifichi e riferisci. Quando tutto è a posto e la persona vuole i documenti, passa alla skill `prepara-rendiconto-fine-anno` (ramo «Per competenza»: Modelli A, B, C e libro giornale; mai il Modello D, che esiste solo per la cassa).
7. Salute e `validate_period_close` ora danno per ogni controllo un nome in italiano (`label`), lo stato leggibile (`stateLabel`), la differenza in euro (`delta`) e una guida (`guidance`: che cosa controlla e che cosa fare): riporta quelle parole, non i codici interni. Sul saldo della banca c'è anche l'importo in banca e quello a libro, con la frase che dice quale dei due è maggiore.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
