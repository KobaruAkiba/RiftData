# RiftData — Piano 3: dettaglio dei game del Worlds corrente da livestats — Design

- **Data**: 2026-11-19
- **Stato**: bozza, in attesa di approvazione
- **Spec generale**: [RiftData — Design doc](2026-11-18-riftdata-design.md) (§2.1, §6.2, §6.3, §8.2, §10). Questo documento lo integra solo per il Piano 3. In caso di conflitto vale lo spec generale, salvo le decisioni marcate qui.
- **Esiti dello spike**: [report fonti](../spikes/2026-11-19-data-sources-report.md), sezione Livestats.
- **Etichette**: **[Utente]**, **[Claude]**, **[Costruttore]**, come nello spec generale.

## 1. Intento

- Salvare nel repo, per ogni game del Worlds corrente, i dati nel tempo che servono alla pagina partita del Piano 6: oro, livello, KDA, CS, oggetti, rune, quota di danni, ward, draghi per tipo e ordine, baroni, torri, inibitori. [Utente, spec §2.1]
- Perché: il feed livestats non è ufficiale e può sparire. I dati scaricati una volta restano nel repo (spec §6.3).
- Il dettaglio per giocatore esiste solo per il Worlds corrente. [Utente, spec §2.1, confermato il 2026-11-19]

## 2. Obiettivi

1. Comando `npm run ingest:livestats` che scarica i game conclusi del Worlds corrente non ancora salvati.
2. Un file per game con serie al minuto ed eventi, validato con uno schema zod condiviso con il sito.
3. Collegamento affidabile tra game lolesports e game Leaguepedia, con override manuale.
4. Giocatori e campioni identificati con i nomi di Leaguepedia.
5. Primo popolamento: Worlds 2026, 98 game.
6. Dal 2027 la raccolta segue l'edizione corrente senza modifiche al codice.

## 3. Non-obiettivi

- Dettaglio dei Worlds passati (2023–2025). [Utente, opzione A] Il codice però accetta un anno esplicito (§7.7), così un'estensione futura non richiede riscritture.
- Copia integrale del feed o fotogrammi ogni 10 secondi. [Utente, opzione A]
- Campi che le pagine non usano: armatura, resistenza magica, velocità d'attacco, ordine delle abilità, salute.
- Nomi e icone di oggetti, rune e campioni: arrivano da Data Dragon nel Piano 6. Qui si salvano gli id numerici.
- Pagine del sito e workflow automatico (Piani 6 e 9).
- Badge live (Piano 8).

## 4. Anti-obiettivi

- File grandi: un game sopra i 100 KB indica che si sta salvando troppo.
- Un game salvato con dati parziali o incoerenti. Meglio nessun file che un file sbagliato.
- Riscaricare game già salvati (spec §6.3).
- Un game collegato al game Leaguepedia sbagliato senza che nessuno se ne accorga.
- Liste di squadre, giocatori o id cablate nel codice.

## 5. Vincoli

| Vincolo | Origine |
|---|---|
| Feed e API lolesports: intervallo minimo 500 ms tra richieste; User-Agent `USER_AGENT` di `scripts/lib/http.ts` | Piano Fase 0 |
| Costanti delle fonti solo in `scripts/lib/sources.ts`; id dei tornei letti dall'API, mai cablati | Spike |
| Un game è "giocato" in `getCompletedEvents` se ha `vods` non vuoti (i game non hanno `state`) | Spike, correzione 1 |
| Scrittura deterministica con `writeIfChanged` di `scripts/pipeline/store.ts`: chiavi ordinate, LF, nessun timestamp di esecuzione | Piano 2 |
| Schemi in `src/data/schema/`, unica definizione dei tipi di dominio | Piano 2 |
| Nomi di giocatori, squadre e campioni in originale | Spec §2.8 |
| Branch `develop`; il push lo fa l'utente | Prassi del progetto |

## 6. Approcci considerati

### 6.1 Quanto del feed conservare

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| A. Solo i campi usati dalle pagine, già in serie al minuto + eventi | ~50 KB per game, ~5 MB per edizione; pronto per i grafici | I campi non scelti si perdono se il feed chiude | **Scelta** [Utente] |
| B. A + fotografia compressa di tutti i campi al minuto | Dati per grafici futuri non previsti | +~5 MB binari per edizione; git gestisce male i binari | Scartata [Utente] |
| C. Tutti i fotogrammi ogni 10 s, compressi | Massima fedeltà | Decine di MB per edizione; precisione inutile ai grafici | Scartata |

### 6.2 Edizioni da raccogliere

| Opzione | Esito |
|---|---|
| A. Solo il Worlds corrente (2026, poi gli anni successivi) | **Scelta** [Utente] |
| B. Anche 2023–2025 da subito | Scartata [Utente]: dati ×4 e cambio di perimetro di Worlds History |

### 6.3 Precisione degli eventi [Claude]

| Opzione | Pro | Contro | Esito |
|---|---|---|---|
| Una richiesta per minuto di gioco; eventi assegnati al minuto in cui compaiono | ~70 richieste per game, ~1 ora per tutto il 2026 | Momento dell'evento con precisione di 1 minuto | **Scelta** |
| Una richiesta ogni 10 s | Eventi precisi a 10 s | ~420 richieste per game, ~6 ore per il 2026 (oltre il limite di un job GitHub Actions) | Scartata |
| Al minuto + ricerca binaria attorno a ogni evento | Precisione 10 s con ~45 richieste in più per game | Complessità per un dettaglio che le pagine non chiedono (spec: tipo e ordine dei draghi) | Scartata |

Nota: Claude aveva indicato per gli eventi una precisione "al decimo di secondo". Errore. Il feed ha fotogrammi ogni 10 s; la scelta qui sopra fissa la precisione a 1 minuto.

## 7. Design

### 7.1 Flusso [Claude]

1. Scegliere l'edizione da raccogliere (§7.7) e leggerne il JSON da `data/worlds/<anno>.json` (Piano 2).
2. Trovare il torneo lolesports dell'anno con `getTournamentsForLeague` e leggere partite e game con `getCompletedEvents`.
3. Collegare ogni game lolesports giocato a un game Leaguepedia dell'edizione (§7.3).
4. Saltare i game il cui file esiste già (§7.5).
5. Per ogni game da scaricare:
   1. leggere i metadati (`window` senza `startingTime`) e i fotogrammi al minuto da `window` e `details` (§7.6);
   2. costruire il file del game;
   3. validarlo con lo schema;
   4. scriverlo. Un game con un errore non produce file e finisce nei warning; gli altri proseguono.
6. Rigenerare l'indice per tutti i game con file presente e collegamento valido, con giocatori da Leaguepedia (§7.4, §7.5).
7. Stampare il riepilogo: scritti, già presenti, non collegati, falliti, avvisi sui campioni.

### 7.2 Verifica preliminare sui dati veri [Claude]

Lo spike non ha salvato tutto il necessario. Primo passo del piano: comando di scoperta `npm run discover:livestats`, sul modello di `npm run discover`. Salva fixture ridotte di un game reale del 2026 e risponde a:

1. Forma di `gameMetadata` in `window`: `participantMetadata` con `participantId`, `championId`, `role` (valori esatti), nome del giocatore, `esportsPlayerId`.
2. Quanti fotogrammi restituisce una chiamata `window` / `details` con `startingTime` e quale intervallo coprono.
3. Valori di `gameState` (`in_game`, `paused`, `finished`) e loro posizione; come appare una pausa reale nel feed (stato dedicato o fotogrammi congelati), su un game del 2026 con pausa nota.
4. Se Leaguepedia ha un campo che contiene l'id del game lolesports (in `MatchScheduleGame` o `ScoreboardGames`). Se c'è, il collegamento §7.3 lo usa come prima regola.
5. Campi di `ScoreboardPlayers` utili: nome del giocatore (`Link`), `Champion`, `Role`, `Side`.

Le regole sotto valgono salvo smentita della verifica. In caso di smentita: correggi il piano prima di procedere, come nel Piano 2.

### 7.3 Collegamento lolesports ↔ Leaguepedia [Claude]

Ordine delle regole:

1. **Override**: `data/overrides/livestats.json`, `{ "<idGameLolesports>": "<GameId Leaguepedia>" | null }`. `null` = game da ignorare (es. remake). Vince su tutto.
2. **Id comune**, se la verifica §7.2 lo trova.
3. **Abbinamento per partita**:
   - partita lolesports ↔ partita Leaguepedia con stesso giorno UTC e stessa coppia di squadre (codice lolesports confrontato con `short` e nome di `teams.json`, normalizzati: minuscole, solo alfanumerici);
   - dentro la partita, game n-esimo giocato ↔ game Leaguepedia con `number` = n.
4. Nessuna corrispondenza univoca → game non collegato: warning con id lolesports, squadre e data. Nessun file.

Il collegamento è una funzione pura, testata con fixture reali e casi sintetici: stessa coppia due volte nello stesso giorno (tiebreak), codice squadra diverso dal `short`, game remake.

### 7.4 Giocatori e campioni [Claude]

- Partecipanti 1–5 = lato blu, 6–10 = lato rosso (convenzione del feed).
- Il lato blu del game Leaguepedia (`blue.team`) dà la squadra di ogni lato.
- **Abbinamento partecipante ↔ riga `ScoreboardPlayers`: lato + ruolo**. Ruolo del feed (`top`, `jungle`, `mid`, `bottom`, `support`) ↔ `Role` di Leaguepedia (`Top`, `Jungle`, `Mid`, `Bot`, `Support`). I ruoli sono unici per lato.
- **Controllo del campione**: nome Leaguepedia e chiave del feed normalizzati (minuscole, solo alfanumerici). Se differiscono → warning, non errore. Le chiavi Data Dragon non coincidono sempre con il nome: `MonkeyKing` ↔ Wukong, `Renata` ↔ Renata Glasc, `Nunu` ↔ Nunu & Willump. Wukong e Renata Glasc sono stati scelti ai Worlds 2026.
- Si salvano entrambi: `champion` = nome Leaguepedia (in originale, per il testo), `championKey` = chiave del feed (per le icone Data Dragon nel Piano 6).
- Lato o ruolo senza corrispondenza univoca → il game non entra nell'indice, con warning (anti-obiettivo: dati incoerenti). I dati del feed restano salvati (§7.5).
- La query `playersQuery` del Piano 2 si estende con i campi necessari. La normalizzazione delle edizioni non cambia.

### 7.5 Archivio: dati del feed separati dai dati Leaguepedia [Claude]

Motivo: cicli di vita diversi. Il feed si scarica una volta sola. Leaguepedia può correggere nomi, lati o `GameId` anche dopo.

```
data/livestats/
  <anno>/
    <idGameLolesports>.json   solo dati del feed; scritto una volta, mai riscaricato
    index.json                collegamento + giocatori; rigenerato a ogni lancio
```

- **File del game** (`<idGameLolesports>.json`): solo ciò che viene dal feed (§7.6). Nome file = id lolesports: numerico, sicuro per il file system. Il `GameId` di Leaguepedia contiene spazi e `/`.
- **Indice** (`index.json`): `{ "games": { "<GameId Leaguepedia>": { "gameId": "<idGameLolesports>", "participants": [{ "participantId", "player", "team", "role", "champion" }] } } }`.
  - Rigenerato a ogni lancio da `getCompletedEvents`, dall'edizione e da `ScoreboardPlayers`: poche richieste, nessuna al feed.
  - Una correzione di Leaguepedia si propaga al lancio successivo senza riscaricare il feed.
- Un game con il file presente non si riscarica mai, salvo opzione esplicita (§7.7).
- Scrittura con `writeIfChanged`: il secondo lancio senza novità non scrive nulla.
- **Formato compatto**: serializzazione deterministica di `store.ts`, array di valori primitivi su una sola riga.
  - Un game di 41 minuti: ~135 KB con l'indentazione attuale, ~50 KB compatto.
  - L'opzione si aggiunge a `stableStringify`. Il formato dei file del Piano 2 non cambia.

### 7.6 Contenuto di un game [Claude]

Schema zod `GameTimelineSchema` in `src/data/schema/timeline.ts`, esportato da `index.ts`.

| Campo | Contenuto |
|---|---|
| `gameId` | id lolesports |
| `year` | anno dell'edizione |
| `minutes` | numero di campioni delle serie (minuto 0 compreso) |
| `participants` | 10 elementi, solo dati del feed: `participantId`, `side` (`blue`/`red`), `role` (feed), `championKey`, `runes` (`primary`, `secondary`, `perks[]`, id numerici) |
| `teams.blue`, `teams.red` | serie al minuto: `gold`, `kills`, `towers`, `inhibitors`, `barons`, `dragons` (conteggio) |
| `players[]` | per `participantId`, serie al minuto: `gold`, `level`, `kills`, `deaths`, `assists`, `cs`, `damageShare`, `killParticipation`, `wardsPlaced`, `wardsDestroyed` |
| `items[]` | per `participantId`, solo i cambi: `{ minute, items[] }` quando l'inventario cambia rispetto al campione precedente (primo elemento al minuto 0) |
| `events[]` | `minute`, `side`, `type` (`dragon`, `baron`, `tower`, `inhibitor`), `dragonType` per i draghi (valore del feed: `ocean`, `mountain`, `infernal`, `cloud`, `hextech`, `chemtech`, `elder`…) |

Giocatori, squadre e nomi dei campioni stanno nell'indice (§7.5), non nel file del game.

**Tempo di gioco e pause** (le pause sono frequenti ai Worlds):

- Le serie seguono i **minuti di gioco**, non l'orologio reale: il campione `i` corrisponde al tempo di gioco `i:00`, con tolleranza di 10 s per pausa.
- Fotogramma "fermo": `gameState` diverso da `in_game`, oppure, dopo il minuto 2 di gioco, statistiche identiche al fotogramma di 10 s prima (dal minuto 2 l'oro cresce sempre).
  - Prima del minuto 2 il controllo sulle statistiche non vale: al minuto 0→1 possono restare invariate.
- Campionamento: richiesta al tempo reale previsto per il minuto successivo (ultimo campione valido + 60 s + pause accumulate). Se il fotogramma è fermo:
  1. ricerca binaria, a passi di 10 s, dell'inizio della pausa tra l'ultimo campione valido e la richiesta;
  2. avanzamento a passi crescenti, poi ricerca binaria, fino alla ripresa;
  3. durata della pausa aggiunta all'accumulo; il campione si richiede di nuovo al tempo corretto.
- Costo: richieste extra solo per i game con pause (~6-10 per pausa).
- Ultimo campione: stato finale (`finished` o ultimo fotogramma disponibile), anche se cade a metà minuto.
- Coerenza con `durationSec` di Leaguepedia: `minutes` = `floor(durationSec / 60) + 2` (minuto 0 + ultimo campione parziale), con tolleranza ±1. Fuori tolleranza → nessun file, warning.

**Altre regole**:

- Tutte le serie hanno lunghezza `minutes`.
- Minuto 0 = primo fotogramma `in_game`.
- Eventi: differenza di conteggio tra campioni consecutivi, assegnata al minuto del campione in cui compare. L'ordine dei draghi segue l'ordine della lista `dragons` del feed.
- Numeri interi dove il feed li dà interi; `damageShare` e `killParticipation` arrotondati a 3 decimali.

### 7.7 Comando e opzioni [Claude]

| Comando | Effetto |
|---|---|
| `npm run ingest:livestats` | Edizione corrente: la più recente con stato `ongoing` o `completed`. Scarica i game giocati non presenti nell'indice |
| `npm run ingest:livestats -- --year 2025` | Anno esplicito (estensione futura ai Worlds passati) |
| `npm run ingest:livestats -- --game <idLolesports>` | Riscarica dal feed un singolo game, anche se già salvato (correzione di un errore di raccolta; le correzioni di Leaguepedia non lo richiedono) |
| `npm run discover:livestats` | Verifica §7.2; salva fixture; non tocca `data/` |

- Prerequisito: l'edizione è già aggiornata da `npm run ingest` (Piano 2). Il Piano 9 concatena i due comandi nel workflow.
- Primo popolamento del 2026: circa 1 ora (~70 richieste per game a 500 ms, 98 game).

### 7.8 Qualità e verifica [Claude]

| Area | Criterio |
|---|---|
| Test unitari | Collegamento, abbinamento giocatori (inclusi Wukong / `MonkeyKing` e Renata Glasc / `Renata`), campionamento con una e con più pause, minuto 0→1 invariato, eventi, cambi di inventario, coerenza con la durata, formato compatto; su fixture reali ridotte e casi sintetici |
| Test di integrità sui dati salvati | Ogni voce dell'indice ha il suo file; ogni file è nell'indice o nei warning dell'ultimo lancio (game non collegato); ogni chiave dell'indice esiste come game nell'edizione; 10 partecipanti unici; serie tutte lunghe `minutes`; squadre dei lati uguali a quelle del game Leaguepedia; nessun file sopra i 100 KB |
| Ingest | Primo lancio reale: 98/98 game del 2026 salvati o, per ogni mancante, un warning con la causa. Secondo lancio: nessuna scrittura |
| Errori di rete | Un errore su un game non blocca gli altri e non scrive file parziali |
| Documentazione | `data/README.md` aggiornato: archivio, schema del game, comando, override |

## 8. Lasciato al costruttore

- Struttura interna dei moduli sotto `scripts/pipeline/livestats/`, nel rispetto della responsabilità singola.
- Numero di tentativi e attese per gli errori di rete, nei limiti del vincolo dei 500 ms.
- Dimensione delle fixture, purché ridotte e sotto i 200 KB ciascuna.
- Ordine e nomi dei campi secondari nello schema, purché coprano la tabella §7.6.
