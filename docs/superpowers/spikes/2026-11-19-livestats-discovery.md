# Verifica livestats sui dati veri

- Data: 2026-11-19
- Scopo: Task 1 del [Piano 3](../plans/2026-11-19-riftdata-piano3-livestats.md), punti §7.2 del [design](../specs/2026-11-19-riftdata-piano3-livestats-design.md).
- Comando: `npm run discover:livestats` (circa 12 minuti, circa 1000 richieste, non scrive in `data/`).
- Perimetro: Worlds 2026, 98 game, id torneo `115660540725177488` (`worlds_2026`, letto dall'API).
- Fixture: `tests/fixtures/livestats/` (elenco in fondo).
- Esito: i punti 1, 2 e 5 confermano il design. Il punto 3 lo corregge (stato `paused` + risposte stantie, niente "fotogrammi congelati"). Il punto 4 è negativo (nessun id comune). Le correzioni valgono per i Task 3-7.

## Riepilogo

| # | Domanda | Esito |
|---|---|---|
| 1 | Forma di `gameMetadata` | Confermata. `role` ∈ `top`, `jungle`, `mid`, `bottom`, `support`. |
| 2 | Fotogrammi per chiamata con `startingTime` | Tutti quelli in `[S, S+10 s)`: 3-88, mediana 41, spaziatura irregolare. `details` ha gli stessi timestamp. |
| 3 | Come appare una pausa | Stato `paused` dedicato, poi nessun fotogramma fino alla ripresa. Una richiesta dentro la pausa restituisce gli ultimi 10 fotogrammi precedenti. |
| 4 | Id lolesports in Leaguepedia | Assente. |
| 5 | Campi di `ScoreboardPlayers` | `Link`, `Name`, `Champion`, `Role`, `Side` confermati. Abbinamento lato+ruolo: 980/980 partecipanti. |

## 1. `gameMetadata`

Presente in **ogni** risposta `window`, con o senza `startingTime`. `details` non lo contiene.

```json
"gameMetadata": {
  "patchVersion": "16.20.826.3891",
  "blueTeamMetadata": {
    "esportsTeamId": "100205573495116443",
    "participantMetadata": [
      { "participantId": 1, "esportsPlayerId": "99566404532924465",
        "summonerName": "GEN Kiin", "championId": "Olaf", "role": "top" },
      { "participantId": 5, "esportsPlayerId": "107454956790371682",
        "summonerName": "GEN Duro", "championId": "Nami", "role": "support" }
    ]
  },
  "redTeamMetadata": { "esportsTeamId": "99566404853854212", "participantMetadata": [ "…id 6-10…" ] }
}
```

- Blu = `participantId` 1-5, rosso = 6-10, in tutti i 98 game.
- `role`: solo `top`, `jungle`, `mid`, `bottom`, `support`. Ogni ruolo compare una volta per lato in 98/98 game.
- `championId` = chiave Data Dragon (`JarvanIV`, `KSante`, `MonkeyKing`, `Renata`, `Locke`). Non è il nome di Leaguepedia.
- `summonerName` = sigla squadra + nome (`GEN Kiin`). Non è un identificatore del giocatore.
- `esportsPlayerId` e `esportsTeamId` esistono ma `ParticipantMeta` non li porta (non servono al design). Leaguepedia non ha un campo corrispondente (`Players`: solo `ID`).

## 2. Fotogrammi e intervallo di una chiamata

| Chiamata | Risposta |
|---|---|
| `window/<id>` senza `startingTime` | I **primi 10** fotogrammi del game, tutti entro 1 s da `t0` (primo fotogramma). |
| `window/<id>?startingTime=S` | Tutti i fotogrammi con timestamp in `[S, S+10 s)`. 3-88 fotogrammi (mediana 41), spaziatura irregolare, in genere sotto 1 s, più fitta attorno agli eventi. Primo fotogramma fino a 9,9 s dopo `S`. |
| `details/<id>?startingTime=S` | Gli **stessi** timestamp di `window` alla stessa `S` (verificato su fixture: elenchi identici). |
| `startingTime` non multiplo di 10 s | HTTP 400 `BAD_QUERY_PARAMETER`. |
| `startingTime` oltre la fine del game | HTTP 200 con gli **ultimi 10** fotogrammi (timestamp tutti precedenti a `S`), gli ultimi con stato `finished`. Mai vuota, mai 204. |

Esempio (finale, game 1, `t0 = 2026-11-14T19:53:15.072Z`): `startingTime=2026-11-14T20:03:10Z` → 54 fotogrammi da `20:03:10.114Z` a `20:03:19.798Z`.

Dimensioni non compresse: `window` 30-90 KB, `details` circa 5 KB per fotogramma (fino a 300 KB). Le fixture tengono un fotogramma ogni due.

### Inizio del game

Il primo fotogramma ha tutte le statistiche a zero. L'oro compare in 3,5-5,9 s (mediana 4,5 s): da lì il cronometro di gioco parte.

- Durata Leaguepedia (`Gamelength_Number`) contro `finished − primo fotogramma`: mediana +4,1 s sui 88 game senza pause.
- Contro `finished − primo fotogramma con oro > 0`: mediana −0,2 s, intervallo da −8,4 a +0,7 s.
- Il primo fotogramma con oro > 0 è il tempo di gioco 0:00.

### Fine del game

L'ultimo fotogramma (`finished`) coincide con il tabellino di Leaguepedia: KC–C9, game 1, oro blu 57395 = `Team1Gold` 57395.

## 3. Stati e pause

Valori di `gameState` osservati: `in_game`, `paused`, `finished`. Nessun altro.

Pause: 10 game su 98 (+52 s … +2154 s oltre la durata di Leaguepedia). Scansione al minuto su 13 game (10 distribuiti + i 3 con più pausa).

Una pausa nel feed:

1. Fotogrammi `in_game` fino a `P`; il primo fotogramma `paused` ha timestamp `P`.
2. Fino alla ripresa `R` il feed **non emette fotogrammi**, salvo qualche fotogramma `paused` sporadico (nel game `…095075`, uno ogni pochi minuti).
3. Una richiesta con `startingTime = S` dentro la pausa restituisce gli ultimi 10 fotogrammi precedenti a `S`: tutti con timestamp `< S`, l'ultimo `paused`. È la stessa risposta del punto "oltre la fine", ma senza `finished`.
4. Alla ripresa il primo fotogramma è `in_game` con le stesse statistiche dell'ultimo fotogramma prima della pausa (oro totale dei due lati 79105 prima e dopo).

Esempio reale, game `115660540726095106` (quarti, Worlds 2026):

| Richiesta `S` | Risposta |
|---|---|
| `00:25:10Z` | 32 fotogrammi `in_game` |
| `00:26:10Z` | 10 fotogrammi da `00:25:22.846Z` a `00:25:25.785Z`; ultimo `paused` |
| `00:27:10Z` … `00:31:10Z` | gli stessi 10 fotogrammi |
| `00:32:10Z` | 39 fotogrammi da `00:32:12.315Z`, `in_game` |

Durata = `00:32:12.315 − 00:25:25.785` = **407 s**. Differenza di durata Leaguepedia: +411,4 s, di cui circa 4 s sono lo scarto di avvio (§2): quadra.

Altri esempi: game `…095006`, pausa a 26 s dall'inizio, 322 s. Game `…095075`: 3 episodi in 36 minuti (stime 422, 472, 1307 s; ogni stima è per eccesso di fino a 60 s per il passo della scansione), con sfarfallii `in_game`/`paused` di 1-2 s.

Fotogrammi congelati con `gameState: "in_game"`: **mai osservati**. L'oro totale resta invariato anche senza pausa nei primi circa 110 s di gioco (5000 totali fino ai minion).

Fixture: `pause/115660540726095106-step-{23,24,29}.json` (inizio, dentro, ripresa) e `pause/115660540726095075-step-{17,18,24}.json`.

## 4. Id lolesports in Leaguepedia

**Assente.** `cargofields` (campi con `Riot`, `Link`, `Champion`, `Role`, `Side`, `Vod`, `History`):

| Tabella | Campi rilevanti |
|---|---|
| `MatchScheduleGame` (47) | `MatchHistory`, `RiotPlatformGameId`, `RiotPlatformId`, `RiotGameId`, `RiotHash`, `RiotVersion`, `Vod*` |
| `ScoreboardGames` (69) | gli stessi, più `VOD` |
| `ScoreboardPlayers` (44) | vedi §5 |

- Valori reali della finale: `RiotPlatformGameId` = `LOLTMNT02_487405`, `RiotGameId`, `RiotHash`, `MatchHistory` vuoti. L'id lolesports (`115660540726095134`) non compare.
- `MatchSchedule` e `Players` non hanno campi equivalenti.
- Esiste `MatchScheduleGame.IsRemake`, non usato dal design.

## 5. `ScoreboardPlayers`

Campi usati (query della fixture `scoreboard-players-final.json`): `GameId`, `Team`, `Name`, `Link`, `Champion`, `Role`, `Role_Number`, `IngameRole`, `Side`. Altri campi utili al Piano 6: `Kills`, `Deaths`, `Assists`, `DamageToChampions`.

```json
{ "GameId": "2026 Season World Championship/Main Event_Finals_1_1", "Team": "Gen.G",
  "Name": "Kiin", "Link": "Kiin", "Champion": "Olaf",
  "Role": "Top", "RoleNumber": "1", "IngameRole": "Top", "Side": "1" }
{ "Team": "Bilibili Gaming", "Name": "Bin", "Link": "Bin (Chen Ze-Bin)",
  "Champion": "K'Sante", "Role": "Top", "Side": "2" }
```

- `Side`: `"1"` = blu, `"2"` = rosso. Tutti i valori sono stringhe.
- `Role`: `Top`, `Jungle`, `Mid`, **`Bot`**, `Support`. `Role_Number` 1-5 nello stesso ordine.
- `Link` è il nome della pagina: può contenere la disambiguazione (`Bin (Chen Ze-Bin)`). `Name` è il nome in gara (`Bin`).
- `Champion` è il nome esteso (`Jarvan IV`, `K'Sante`, `Renata Glasc`).

**Abbinamento lato+ruolo su tutti i 98 game** (coppie lolesports↔Leaguepedia per ordine cronologico, 98/98, coerenti con le durate):

- 980 partecipanti: 0 senza riga, 0 con più righe.
- Ruoli: `bottom→Bot`, `jungle→Jungle`, `mid→Mid`, `support→Support`, `top→Top`.
- Lati: partecipanti 1-5 → `Side` 1, 6-10 → `Side` 2.
- Campioni diversi dopo normalizzazione (minuscole, solo alfanumerici): solo `MonkeyKing → Wukong` (16 partecipanti) e `Renata → Renata Glasc` (17). `JarvanIV`, `KSante`, `LeeSin`, `Chogath`, `Velkoz`, `KogMaw` coincidono.

## 6. Regole del design: confermate o smentite

| Regola | Esito | Regola sostitutiva |
|---|---|---|
| §7.3.1 Override `livestats.json` | Confermata | Nessuna. |
| §7.3.2 Id comune | **Smentita** | Non esiste. `commonIds` di `linkGames` resta nella firma, sempre assente; salta questo passo. |
| §7.3.3 Stesso giorno UTC + coppia di squadre, poi game n-esimo | Confermata | Il codice lolesports non è il nome: `Cloud9 Kia` (lolesports) contro `Cloud9` (Leaguepedia); `C9` = `short`. `Gen.G Esports` contro `Gen.G`; `GEN` = `short`. `BILIBILI GAMING` contro `Bilibili Gaming` coincide solo dopo normalizzazione. Servono sia `short` sia `name`/alias. `getCompletedEvents` elenca tutti i game della serie (5 per `bestOf 5`): quelli non giocati hanno `vods: []`. `number` = posizione nell'elenco. |
| §7.4 Lato + ruolo, controllo campione con warning | Confermata | Mappa dei ruoli: `bottom→Bot`; gli altri con iniziale maiuscola. `Side` è `"1"`/`"2"`. `player` = `Link` (può avere la disambiguazione tra parentesi). |
| §7.6 "Minuto 0 = primo fotogramma `in_game`" | **Smentita** | Minuto 0 = primo fotogramma con oro totale > 0 (circa 4,5 s dopo il primo fotogramma). Si trova con una chiamata `window` a `startingTime = toStartingTime(t0)`; se non ha oro > 0, una seconda a +10 s. Il primo fotogramma ha statistiche a zero e darebbe un minuto 0 con oro 0 e un minuto 1 con oro 5010. |
| §7.6 "Fotogramma fermo: `gameState` ≠ `in_game`" | Confermata | Stato dedicato `paused`. |
| §7.6 "Fotogramma fermo: statistiche identiche dopo il minuto 2" | **Smentita** | Eliminare. Nessun fotogramma congelato `in_game`. Risposta ferma = (a) contiene un fotogramma `paused`, oppure (b) **ultimo fotogramma con timestamp < `startingTime` richiesto** (risposta stantia), oppure (c) vuota. `finished` non è una pausa. `isStalled` deve ricevere il tempo richiesto, non `gameSeconds`: `isStalled(frames, requested: Date)`. |
| §7.6 "Ricerca binaria a 10 s dell'inizio della pausa" | Parzialmente superflua | L'inizio `P` è il timestamp del primo fotogramma `paused` della risposta stantia (o dell'ultimo fotogramma se non c'è). Serve cercare solo la ripresa. |
| §7.6 "Avanzamento a passi crescenti, poi ricerca binaria della ripresa" | Confermata | Ripresa `R` = primo fotogramma della prima risposta non ferma; raffinare con ricerca binaria a passi di 10 s tra l'ultima richiesta ferma e la prima non ferma. Spostamento accumulato += `R − P`. Con la sola scansione al minuto l'errore per eccesso è fino a 60 s per pausa. |
| §7.6 "Tolleranza di 10 s per pausa" | Confermata per le pause singole | Il game `…095075` (3 episodi, 2154 s) è il caso limite: usarlo come prova di robustezza, non come criterio. |
| §7.6 "`[]` dopo almeno un campione = fine del game" | **Smentita** | Oltre la fine il feed non restituisce `[]`: restituisce gli ultimi 10 fotogrammi (ultimo `finished`). `[]` vale solo per `window` che restituisce 204, corpo vuoto o 404, quindi un errore. La fine si riconosce da un fotogramma `finished`. |
| §7.6 "Ultimo campione = stato finale" | Confermata, più semplice | Una sola richiesta con `startingTime` lontano nel futuro (es. `t0 + 6 h`) dà il fotogramma `finished`; non serve avanzare a passi fino alla fine. Il suo oro coincide con Leaguepedia. |
| §7.6 `minutes = floor(durationSec/60) + 2`, ±1 | Confermata | Con minuto 0 ancorato come sopra: minuti 0…floor(L/60) più l'ultimo campione. Durata Leaguepedia contro durata del feed: scarto massimo osservato 8,4 s. |
| Piano, Task 5: `details[i]` ↔ `samples[i]` | Confermata | Stessa `S` ⇒ stessi timestamp: una chiamata `details` per campione, alla stessa `startingTime`. |
| §7.1 Stima di circa 1 ora per il 2026 | **Da rivedere** | Misurato circa 0,7 s per richiesta (attesa 500 ms + latenza). Per game: 2 richieste per minuto di gioco (window + details), circa 34 minuti medi, più 3-4 di inizio/fine/pause: circa 80 richieste, circa 1 minuto. 98 game: circa 1,5-2 ore. Resta sotto il limite di un job. |

## 7. Indicazioni per i task successivi

- **Task 3.** Nessun id comune: i test usano override e abbinamento per partita. Dati reali per il test: `Cloud9 Kia`/`Cloud9`/`C9`, `MVK Esports`/`MVK Esports`. Non esiste nei dati del 2026 un remake: 98 game giocati su lolesports, 98 su Leaguepedia. Il caso "game in più" va coperto con dati sintetici.
- **Task 4.**
  - `first` = primo fotogramma con oro totale > 0.
  - Bersaglio del campione `i`: `wall_i = t_start + 60·i + pause accumulate`; richiesta a `toStartingTime(wall_i)`; campione = fotogramma della risposta più vicino a `wall_i`.
  - `isStalled(frames, requested)`: vero se un fotogramma è `paused`, se l'ultimo timestamp è `< requested` e non c'è `finished`, o se la lista è vuota.
  - Fine: fotogramma `finished`. L'ultimo campione è l'ultimo fotogramma dell'ultima risposta (con `startingTime` lontano).
  - `[]` prima della fine resta `SamplingError`.
  - Feed sintetico: durante la pausa, i fotogrammi si fermano; una richiesta dentro la pausa restituisce gli ultimi 10 fotogrammi precedenti, con l'ultimo `paused`.
- **Task 5.** `dragons` contiene tipi in ordine di abbattimento: `["ocean","chemtech","hextech","hextech","elder"]` (finale, game 1). `perkMetadata` è in `details`, non in `window`.
- **Task 6.** `Role` di Leaguepedia: `Bot`, non `Bottom`. `Side` è stringa. `Link` può contenere `(disambiguazione)`. `playersQuery`: aggiungere `Name`, `Link`, `Champion`, `Role`, `Side` (e `Role_Number=RoleNumber`, alias senza underscore come nelle altre query).
- **Task 7.** Il client lancia su HTTP 400 (startingTime non multiplo di 10 s), 403 e simili; ritorna `null` su 204, corpo vuoto, JSON illeggibile e 404. Tempo del primo lancio: stima rivista (§6).

## Fixture salvate

| File | Contenuto | Dimensione |
|---|---|---|
| `completed-events-2026.json` | forma completa dell'API, prime 4 partite + finale, 1 VOD per game | 9 KB |
| `window-meta.json` | risposta senza `startingTime`, fotogrammi troncati a 3 | 6 KB |
| `window-minute-10.json` | `window` a +10 min dalla partenza: 28 fotogrammi (di 54, uno ogni due) | 47 KB |
| `details-minute-10.json` | `details` stessa `S`: stessi 28 timestamp | 146 KB |
| `window-tail.json` | `startingTime` lontano: gli ultimi 10 fotogrammi, l'ultimo `finished` | 19 KB |
| `pause/115660540726095106-step-{23,24,29}.json` | pausa singola da 407 s: inizio, dentro, ripresa | 18-67 KB |
| `pause/115660540726095075-step-{17,18,24}.json` | primo episodio del game con 3 episodi di pausa | 6-70 KB |
| `scoreboard-players-final.json` | righe `ScoreboardPlayers` dei 4 game della finale (40 righe) | 13 KB |

Game di riferimento: finale Gen.G–BILIBILI GAMING, game 1, id lolesports `115660540726095134`, `GameId` Leaguepedia `2026 Season World Championship/Main Event_Finals_1_1`.

Attribuzione: le righe Leaguepedia sono dati CC BY-SA (vedi `spike-samples/README.md`).
