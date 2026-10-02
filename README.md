# My Obsidian Bookmark

Plugin Obsidian per creare **bookmark nominati su posizioni precise** dentro le note Markdown
(es. «Policy routing» alla riga 42 di `Linux/modulo00/lezione01/lesson.md`), senza mai
modificare le note. I bookmark compaiono in una sidebar a destra, raggruppati per percorso.

- Completamente locale: nessuna richiesta di rete, telemetria o servizio esterno.
- Dati in `.obsidian/plugins/lesson-bookmarks/data.json` (formato versionato).
- Desktop, iPadOS e iOS.

## Installazione

Requisiti di sviluppo: Node.js ≥ 20.12 e pnpm.

1. Indica il vault in `.env` (non versionato; parti da `.env.example`):

   ```bash
   cp .env.example .env
   # OBSIDIAN_VAULT_PATH=/percorso/assoluto/del/vault   (la cartella che contiene .obsidian/)
   ```

2. Installa le dipendenze, compila e copia nel vault:

   ```bash
   pnpm install
   pnpm run install:vault
   ```

   Lo script esegue la build e copia `main.js`, `manifest.json` e `styles.css` in
   `<VAULT>/.obsidian/plugins/lesson-bookmarks/`. Se il percorso non contiene `.obsidian/` si
   ferma con un errore, senza creare nulla.

3. In Obsidian: _Impostazioni → Plugin della community_ → disattiva la modalità
   provvisoria se richiesto → ricarica l'elenco → attiva **My Obsidian Bookmark**.

**Installazione a mano** (senza `.env`): dopo `pnpm build` copia i tre file nella cartella
`<VAULT>/.obsidian/plugins/lesson-bookmarks/`.

Per gli aggiornamenti: `pnpm run install:vault` e poi ricarica il plugin. `data.json` non va mai
copiato né cancellato: contiene i bookmark.

Su iPhone/iPad il plugin arriva tramite la sincronizzazione del vault (Obsidian Sync, iCloud…),
purché la sincronizzazione includa i plugin della community.

Requisito: Obsidian **1.7.2** o successivo.

## Uso

| Azione               | Come                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Creare un bookmark   | Pulsante 🔖+ nell'intestazione della nota, comando «Aggiungi bookmark alla posizione corrente», pulsante + nella sidebar |
| Aprire la sidebar    | Icona 🔖 nella barra laterale (ribbon) o comando «Apri pannello»                                                         |
| Andare a un bookmark | Clic nella sidebar, oppure comando «Vai a un bookmark…»                                                                  |
| Rinominare           | Doppio clic sul nome, F2, oppure menu → Rinomina                                                                         |
| Altre azioni         | Clic destro o pulsante `⋯` sul bookmark                                                                                  |

Menu del bookmark: Vai al bookmark · Aggiorna alla posizione corrente · Rinomina · Duplica ·
Sposta su/giù (ordinamento manuale) · Apri nota · Copia link · Copia percorso · Mostra dettagli ·
Elimina.

**Ricerca:** testo libero (nome, percorso, anteprima; senza distinzione di maiuscole/accenti),
oppure `name:"da verificare"` e `path:linux` (alias `nome:` e `file:`). I termini sono in AND.

**Raggruppamento** (pulsante nella sidebar o impostazioni): percorso ad albero (predefinito),
percorso completo, cartella principale, nome file, data di modifica, nessuno.

**Copia link** produce `obsidian://lesson-bookmarks?vault=…&id=…`: incollato in una nota o
aperto dal browser, porta direttamente alla posizione del bookmark.

### Nomi duplicati

Il nome identifica il bookmark all'interno della nota (senza distinzione di maiuscole/minuscole).
Se crei un bookmark con un nome già usato nella stessa nota, il plugin propone di aggiornare
quello esistente alla posizione corrente.

## Come viene ritrovata la posizione

Per ogni bookmark vengono salvati riga, colonna, offset, ~64 caratteri prima e dopo, la riga
intera e i titoli che la contengono (`# Routing › ## Policy routing`).

1. **Tracciamento in tempo reale** (disattivabile): mentre scrivi in Obsidian, gli offset dei
   bookmark della nota vengono spostati insieme al testo, e il contesto viene ricalcolato.
2. **Recupero tramite contesto** (all'apertura della nota e al clic sul bookmark), utile quando
   la nota è cambiata fuori da Obsidian o su un altro dispositivo:
   1. verifica che il contesto salvato si trovi ancora nella posizione salvata;
   2. altrimenti cerca il contesto completo, poi il solo testo precedente, poi il solo testo
      successivo, poi versioni corte (24 caratteri), poi la riga intera, anche tollerando
      differenze di spazi e fine riga;
   3. una corrispondenza viene accettata **solo se è unica** (eventualmente dopo il filtro per titoli);
   4. se il testo compare in più punti, viene chiesto all'utente quale scegliere;
   5. se non viene trovato, il bookmark **non viene spostato**: compare un avviso con le opzioni
      «Apri alla riga salvata» e «Aggiorna alla posizione corrente».

Nella sidebar: ⚠ = posizione da verificare, icona rossa = file non trovato.

### File rinominati, spostati, eliminati

- Rinomina/spostamento di file o cartelle **dentro Obsidian**: i percorsi vengono aggiornati
  automaticamente.
- File eliminato: i bookmark diventano **orfani** e non vengono mai cancellati in automatico.
- Aprendo un bookmark orfano (comportamento configurabile, predefinito «Chiedi») il plugin cerca
  file con lo stesso nome che contengono il testo del bookmark, e su richiesta cerca in tutto il
  vault; puoi ricollegare, mantenere come orfano o eliminare.

## Sincronizzazione e sicurezza dei dati

- Prima di ogni scrittura `data.json` viene riletto e unito ai dati in memoria: i bookmark creati
  su un altro dispositivo non vengono persi.
- Per lo stesso bookmark vince la modifica dell'utente più recente; le correzioni automatiche non
  annullano mai una modifica fatta altrove.
- Le eliminazioni sono registrate (per 90 giorni) per evitare che un dispositivo non aggiornato
  faccia ricomparire bookmark eliminati.
- Quando la sincronizzazione modifica `data.json` mentre Obsidian è aperto, il plugin ricarica e
  aggiorna la sidebar (`onExternalSettingsChange`). Il pulsante ⟳ della sidebar forza la ricarica.
- `data.json` danneggiato → copia in `data.corrupt-<data>.json`, avviso, ripartenza da vuoto.
- Migrazione da un formato precedente → backup in `data.backup-v<N>-<data>.json` prima di salvare.
- `data.json` scritto da una versione **più recente** del plugin → sola lettura, il file non
  viene toccato finché non aggiorni il plugin.

## Mobile (iOS / iPadOS)

| Funzione                                    | Stato                                                                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Creazione da cursore (editing/Live Preview) | ✅                                                                                                                                                           |
| Pulsante 🔖+ nell'intestazione della nota   | ✅                                                                                                                                                           |
| **Toolbar mobile**                          | ⚙ Un plugin non può aggiungersi da solo: _Impostazioni → Mobile → Gestisci toolbar_ → aggiungi «My Obsidian Bookmark: Aggiungi bookmark alla posizione corrente» |
| Sidebar destra                              | ✅ (scorri da destra o comando «Apri pannello»)                                                                                                              |
| Menu contestuale                            | ✅ pulsante `⋯` sempre visibile (il long-press può variare tra versioni)                                                                                     |
| Riordino                                    | ✅ «Sposta su/giù» dal menu. Il drag & drop è solo desktop                                                                                                   |
| Rinomina                                    | ✅ menu → Rinomina (il doppio tocco non è affidabile su touch)                                                                                               |
| Tooltip con i dettagli                      | ⚠ niente hover su touch → menu → Mostra dettagli                                                                                                             |

## Limiti noti

- **Modalità lettura:** non esiste un cursore. Il bookmark viene creato sulla prima riga di testo
  visibile (il modal lo segnala) e la navigazione scorre fino alla riga senza evidenziarla.
  Per una posizione precisa usa la modalità editing/Live Preview.
- **Rinomina fatta fuori da Obsidian** (Finder, git, altro dispositivo senza il plugin):
  appare come eliminazione + creazione; il bookmark diventa orfano e va ricollegato (il plugin
  propone i candidati). Se la rinomina avviene su un altro dispositivo con il plugin attivo, il
  nuovo percorso arriva con la sincronizzazione di `data.json`.
- **Conflitti del servizio di sync:** se il servizio crea copie di conflitto di `data.json`
  (es. `data 2.json` su iCloud), queste non vengono unite automaticamente.
- Il tracciamento in tempo reale segue solo l'editor con il focus. Le modifiche fatte da altri
  plugin in un editor senza focus vengono gestite dal recupero tramite contesto.

## Sviluppo

```bash
pnpm install
pnpm dev                 # watch mode; se .env indica un vault, copia lì ogni rebuild
pnpm build               # tsc --noEmit + bundle di produzione
pnpm run install:vault   # build + copia nel vault di .env
pnpm test                # test unitari (vitest)
pnpm lint                # eslint
```

Con `pnpm dev` e `OBSIDIAN_VAULT_PATH` impostata, ogni salvataggio ricompila e aggiorna il
plugin nel vault. Il plugin [Hot Reload](https://github.com/pjeby/hot-reload) lo ricarica in
automatico in Obsidian. Una variabile già presente nell'ambiente ha la precedenza su `.env`.

### Struttura

```
main.ts                  registrazione: comandi, vista, eventi, impostazioni
src/types.ts             tipi e impostazioni predefinite
src/anchor/              cattura e recupero della posizione (puro, testato)
src/store/               operazioni, migrazioni, schema zod, persistenza, StoreManager (puro, testato)
src/view/                sidebar, raggruppamento e ricerca (puri), modal
src/editor/              estensioni CodeMirror (evidenziazione, tracciamento), navigazione
src/controller.ts        flussi utente (crea, vai, aggiorna, ricollega, elimina)
tests/                   test vitest
scripts/                 copia nel vault (install:vault, pnpm dev)
```

### Formato di `data.json` (v1)

```jsonc
{
  "version": 1,
  "bookmarks": [
    {
      "id": "uuid",
      "filePath": "Linux/modulo00/lezione01/lesson.md",
      "name": "Policy routing",
      "position": {
        "line": 41,
        "ch": 12,
        "offset": 1830,
        "contextBefore": "…",
        "contextAfter": "…",
        "lineText": "…",
        "headingPath": ["Routing", "Policy routing"],
        "source": "editor",
      },
      "order": 0,
      "status": "ok", // ok | orphan | unresolved
      "createdAt": "…",
      "updatedAt": "…", // updatedAt = ultima modifica dell'utente
      "revisedAt": "…", // ultima modifica di qualsiasi tipo (sync)
    },
  ],
  "tombstones": [{ "id": "…", "deletedAt": "…" }],
  "settings": { "grouping": "pathTree", "sort": "manual", "…": "…" },
}
```

Per un nuovo formato: incrementa `CURRENT_STORE_VERSION` in `src/types.ts` e aggiungi il passo in
`src/store/migrations.ts`. Il backup del file precedente è automatico.
