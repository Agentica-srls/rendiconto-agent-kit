---
name: rimborsi-volontari
description: Usa quando la persona deve rimborsare un volontario o un socio per spese anticipate: giustificativi (scontrini, ricevute), richiesta di rimborso e dichiarazione da firmare.
---

# Rimborsi ai volontari

Crea la richiesta di rimborso dai giustificativi e prepara la dichiarazione da firmare.

## Due tipi di rimborso: scegli prima

- **Documentato**: il volontario porta scontrini o ricevute. Serve il giustificativo caricato.
- **Autocertificato** (art. 17 comma 4 del Codice del Terzo settore): spese senza giustificativo, dichiarate dal volontario con una dichiarazione firmata. Ha limiti di importo e **richiede una delibera dell'ente che lo ammette, registrata nell'app** (pagina Rimborsi). Un agente non può registrarla: se manca, il server risponde `self_declaration_resolution_missing` («devi registrare la delibera…»). In quel caso **fermati**, spiega alla persona che la delibera va registrata dall'app (Rimborsi), e non ritentare con altri giri.

La **dichiarazione da firmare** (`export_rimborso_declaration`) esiste **solo** per i rimborsi autocertificati: su un rimborso documentato il server risponde 422. Chiedi quindi alla persona, prima di creare la richiesta, quale dei due tipi vale.

## Passi

1. Chiedi chi è il volontario (nome, eventuale email) e quali spese ha sostenuto. Raccogli i file dei giustificativi (foto o PDF), se il rimborso è documentato.
2. Carica ogni giustificativo con `create_upload_link` (`purpose: "document"`) e un `PUT` con `curl -T "<file>" -H "Content-Type: <tipo>" "<uploadUrl>"`. Poi **l'ordine conta**, perché `upload_document` archivia il file e lo **consuma** (un file caricato si usa una volta sola):
   - **Foto** (JPEG, PNG o WebP, fino a 10 MB): prima leggi lo scontrino con `scan_receipt` (`fileId`), che non consuma il file e non crea nulla; mostra la lettura alla persona; solo dopo archivia con `upload_document` (stesso `fileId`) per ottenere il `documentId`. Se chiami `scan_receipt` dopo `upload_document` risponde «Il file non è ancora stato caricato (o è già stato usato)».
   - **PDF** o altri formati: `scan_receipt` non li legge. Archivia con `upload_document`, poi, se la persona vuole, `extract_document_data` sul `documentId` (lettura automatica).
   Servono il permesso AI per entrambe le letture. Sono letture automatiche e possono sbagliare.
3. Mostra alla persona, per **ogni** giustificativo, data, importo e descrizione/esercente letti. Se ciò che leggi non coincide con quanto dichiarato dal volontario (importo diverso, data fuori periodo, scontrino illeggibile), **fermati** e chiedi: non correggere tu l'importo e non scegliere quale vale.
4. Calcola il totale solo sommando gli importi confermati dalla persona e riportalo per verifica prima di procedere.
5. Dopo il consenso crea la richiesta con `create_rimborso` (`beneficiaryName`, `amount` come stringa con due decimali, `description`, `expenseDate`, `documentId` del giustificativo, e `method` «autocertificato» solo se è il caso). Una richiesta per spesa, salvo diversa indicazione. Non creare rimborsi per importi che la persona non ha approvato. La richiesta nasce «inviata»: **l'approvazione la dà una persona nell'app**, mai l'agente. Se l'autocertificazione supera i limiti il server la rifiuta con il motivo: riportalo com'è.
6. Solo per i rimborsi autocertificati: genera la dichiarazione con `export_rimborso_declaration` (`reimbursementId`): è un link firmato valido 15 minuti. Ricorda che la **firma** del volontario e l'approvazione dell'ente restano fuori da Rendiconto.
7. Non effettuare né indicare come effettuato alcun pagamento: Rendiconto qui registra la richiesta, non muove denaro. Il collegamento tra il rimborso e il movimento del bonifico non si fa da qui: dillo alla persona e rimandala all'app.

## Regole che valgono sempre

- **Fermati e chiedi** alla persona prima di ogni strumento che richiede conferma (la risposta contiene `requiresConfirmation`), prima di eliminare o annullare qualcosa (`undo_import`, ripartizioni da togliere) e ogni volta che gli importi non tornano. Mostra il riepilogo del server e aspetta un «sì» esplicito. Poi richiama lo stesso strumento con gli stessi argomenti e il `confirmationId` ricevuto.
- **Non inventare mai** importi, date, categorie, codici fiscali o movimenti. Le cifre vengono solo da ciò che restituiscono gli strumenti. Se un dato manca, dillo e chiedilo.
- **Cita sempre** data, importo e descrizione di ogni movimento di cui proponi la modifica, per esempio: «2026-03-02, -120,00 €, Affitto sala marzo».
- Nelle scritture passa una `idempotencyKey` nuova per ogni operazione (una ripetizione con la stessa chiave non duplica).
- Se uno strumento risponde con un errore di permesso (`scope_not_granted`, `ai_not_granted`, `role_missing_permission`), non aggirarlo: spiega quale permesso manca e che si dà in Impostazioni → Accesso per agenti e API.
- Importi: stringhe con due decimali; date `AAAA-MM-GG`. Parla in italiano semplice, senza gergo informatico.
