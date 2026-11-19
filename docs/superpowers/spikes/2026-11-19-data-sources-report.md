# Report spike fonti dati

- Data: 2026-11-19
- Scopo: verificare i punti aperti di §6.4 del documento di progetto.
- Piano: [Fase 0 – spike fonti](../plans/2026-11-19-riftdata-fase0-spike-fonti.md)
- Documento di progetto: [RiftData design](../specs/2026-11-18-riftdata-design.md)

## Esecuzioni

| Ambiente | Data (UTC) | Dettagli |
|---|---|---|
| Locale | 2026-11-18T23:21Z | PC dell'utente |
| GitHub Actions | 2026-11-19T10:33Z | workflow `spike`, run #1, commit 8ab969e, conclusione success, test 40/40 |

- Run GitHub Actions: https://github.com/KobaruAkiba/RiftData/actions/runs/44506295932
- Esiti GitHub Actions identici a quelli locali.

## Riepilogo

| Sonda | Domanda | Esito GitHub Actions | Esito locale | Decisione |
|---|---|---|---|---|
| Leaguepedia | La pipeline accede a Leaguepedia (§6.4-1)? | ok, accesso anonimo | ok, accesso anonimo | Fonte confermata. Nessun account bot. |
| Livestats | Il Worlds 2026 è recuperabile a posteriori; quanto indietro arriva il feed (§6.4-2)? | ok: 98/98 game `full` nel 2026 | ok (identico) | Worlds 2026 con pagine complete (tabellino + timeline). |
| CORS calendario | Il browser legge il calendario lolesports (§6.4-3)? | ok | ok; confermato da browser reale | Badge live letto dal browser. Nessun proxy. |

Punto §6.4-4 (fallback Oracle's Elixir): non necessario.

## Dettaglio sonde

### Leaguepedia

- Esito: ok. Accesso anonimo, senza account bot, anche dai runner GitHub.
- Query `Tournaments`: HTTP 200, 3 righe.
- Query `ScoreboardGames` sul Worlds 2026: HTTP 200, 5 righe.
- Campi presenti e valorizzati:
  - `Team1`, `Team2`, `WinTeam`
  - `Gamelength`
  - `Team1Dragons`, `Team2Dragons`
  - `Team1Barons`, `Team2Barons`
  - `Team1Picks`, `Team1Bans`
- `OverviewPage` del Worlds 2026: `2026 Season World Championship/Main Event`.
- Decisione:
  - Fonte confermata.
  - I secrets `LEAGUEPEDIA_BOT_USER` e `LEAGUEPEDIA_BOT_PASSWORD` non servono.
  - Il login bot resta nel codice come riserva, per eventuali blocchi o limiti futuri.

### Livestats

- Esito: ok per il Worlds 2026.
- Worlds 2026: 98 game su 98 con copertura `full` (fotogrammi all'inizio e a +10 minuti).
- La chiamata `details` su un game 2026 contiene `items` e `perkMetadata` per i partecipanti.
- Profondità storica:

| Edizione | Esito |
|---|---|
| 2026 | 98/98 `full` |
| 2025, 2024, 2023 | `full` 2/2 per anno (controllati primo e ultimo game) |
| 2022, 2021, 2020 | Nessun game giocato trovato in `getCompletedEvents` (status 200). Causa probabile: struttura diversa della risposta. Non approfondito. |
| 2019, 2018, 2017, 2013, 2012 | Assenti da `getTournamentsForLeague` della lega Worlds |

- Edizioni presenti in `getTournamentsForLeague`: 2011, 2014, 2015, 2016, 2020–2026.
- Decisione:
  - Worlds 2026 con pagine partita complete (tabellino + timeline).
  - Il ripiego "solo tabellino finale" (§6.4-2) non serve per il 2026.
  - Il modello della pagina partita su due livelli resta utile per le edizioni senza dati di dettaglio.
- Nota: i dati di dettaglio esistono anche per il 2023–2025. Il v1 non li raccoglie: il dettaglio per giocatore dei Worlds passati è un non-obiettivo (§3). Estensione futura da decidere con l'utente.

### CORS calendario lolesports

- Esito: ok.
- Endpoint `getLive` e `getSchedule`:
  - preflight: HTTP 200;
  - `access-control-allow-origin: *`;
  - `access-control-allow-headers: Content-Type,X-Api-Key`;
  - la GET ha `access-control-allow-origin: *`.
- Conferma da browser reale (pagina `scripts/spike/cors-check.html`): "CORS OK · status 200".
- Decisione: il badge live legge il calendario direttamente dal browser. Nessun proxy serverless.

## Costanti confermate

Fonte: `scripts/lib/sources.ts`.

| Costante | Valore |
|---|---|
| `LOLESPORTS_PUBLIC_KEY` | `0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z` |
| `WORLDS_LEAGUE_ID` | `98767975604431411` |
| API lolesports | `esports-api.lolesports.com/persisted/gw` |
| Feed livestats | `feed.lolesports.com/livestats/v1` |
| API Leaguepedia | `lol.fandom.com/api.php` |

- Gli ID dei tornei lolesports (es. `worlds_2026` = `115660540725177488`) si leggono dall'API. Non vanno cablati.

## Correzioni durante lo spike

1. `getCompletedEvents`: i game non hanno il campo `state`. Un game è giocato se ha `vods` non vuoti.
2. Tabella `Tournaments` di Leaguepedia: il campo `Name` non contiene "World Championship". Filtro: `OverviewPage LIKE "%Season World Championship%"`.
3. Escape del carattere `|` nelle celle del report: bug corretto in revisione.

## Limiti noti e follow-up

1. GitHub Actions avvisa: `actions/checkout@v4`, `setup-node@v4` e `upload-artifact@v4` usano Node 20, deprecato. Nel piano della pipeline (Piano 9) usare le versioni più recenti.
2. Log e summary dei run sono visibili solo agli utenti autenticati su GitHub.
3. Forma di `getCompletedEvents` per il 2020–2022: non verificata. Serve solo se la raccolta si estende ai Worlds passati.
4. Dettaglio livestats 2023–2025: disponibile, non raccolto nel v1.

## Attribuzione

I campioni in `spike-samples/` contengono dati Leaguepedia sotto licenza CC BY-SA. Mantenere l'attribuzione ovunque i campioni siano riusati (es. come fixture, Piano 2).
