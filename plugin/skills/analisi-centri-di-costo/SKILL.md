---
name: analisi-centri-di-costo
description: Usa quando la persona vuole l'analisi per centri di costo o progetti, o dice che le uscite non sono ripartite sui centri di costo. Verifica la completezza, assegna i centri mancanti con conferma e commenta i risultati.
---

# Analisi per centri di costo

Verifica quanto della spesa è ripartita sui centri di costo, assegna quelli mancanti con il consenso e commenta l'analisi.

## Passi

1. Chiama `get_analisi` (`year`, con `compare` per il confronto con l'anno prima) e `get_cost_center_completeness`. Riporta spesa totale, quota ripartita e uscite non assegnate con le cifre dello strumento.
2. Per i movimenti senza centro di costo, raggruppali (stessa controparte, stessa descrizione) e proponi il centro. I centri validi vengono da `list_cost_centers`: non inventarne. **Cita** data, importo e descrizione di ogni movimento proposto.
3. Dopo il consenso assegna con `bulk_assign_cost_center` (un solo centro al 100% per chiamata, fino a 500 movimenti). Sopra 50 movimenti il server chiede una conferma sua: mostra il riepilogo e aspetta il «sì». Se un movimento va diviso su più centri usa `allocate_cost_centers` con percentuali che sommano a 100, e conferma la divisione con la persona.
4. Attenzione: l'assegnazione **sostituisce** la ripartizione esistente. Se un movimento ne ha già una, dillo prima di toccarlo.
5. Rileggi `get_cost_center_completeness`: la copertura deve essere salita come previsto. Se resta una differenza che non sai spiegare, riportala senza forzarla.
6. Commenta l'analisi in modo chiaro: centri con più spesa, scostamenti rispetto all'anno precedente, uscite ancora non assegnate. Usa solo cifre restituite dagli strumenti; niente stime o percentuali calcolate a mente se lo strumento le dà già.
7. Esporta con `export_analisi` (`format` pdf o xlsx) se la persona lo vuole.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
