# RiftData — Spike fonti dati

Generato: 2026-11-18T23:21:04.486Z

| Sonda | Domanda | Esito | Sintesi |
|---|---|---|---|
| leaguepedia | Can the pipeline read Leaguepedia Cargo tables (tournaments and per-game scoreboards)? | ok | Tournaments and scoreboards readable |
| livestats | How far back does the livestats feed keep frames, and is every Worlds 2026 game recoverable? | ok | 2026: 98 full, 0 partial, 0 none of 98 games |
| cors | Can a visitor's browser read the lolesports schedule directly (CORS with x-api-key)? | ok | Browser CORS allowed on getLive and getSchedule |

## leaguepedia

- Mode: anonymous
- anonymous - tournaments: HTTP 200, 3 rows
- anonymous - scoreboard: HTTP 200, 5 rows

## livestats

- 2019: tournament not found
- 2020: no completed games from getCompletedEvents (status 200); path data.schedule.events[].games[] may differ
- 2021: no completed games from getCompletedEvents (status 200); path data.schedule.events[].games[] may differ
- 2022: no completed games from getCompletedEvents (status 200); path data.schedule.events[].games[] may differ
- 2023: full 2/2
- 2024: full 2/2
- 2025: full 2/2
- 2026: full 98 / partial 0 / none 0 su 98
- details (game 115660588583171787, status 200): participants include items and perkMetadata

## cors

- getLive?hl=en-US -> allowed=true (all CORS conditions met)
- getLive?hl=en-US OPTIONS 200: access-control-allow-origin=*, access-control-allow-headers=Content-Type,X-Api-Key, access-control-allow-methods=OPTIONS,GET
- getLive?hl=en-US GET 200: access-control-allow-origin=*, access-control-allow-headers=Content-Type,X-Api-Key, access-control-allow-methods=GET,OPTIONS
- getSchedule?hl=en-US&leagueId=98767975604431411 -> allowed=true (all CORS conditions met)
- getSchedule?hl=en-US&leagueId=98767975604431411 OPTIONS 200: access-control-allow-origin=*, access-control-allow-headers=Content-Type,X-Api-Key, access-control-allow-methods=OPTIONS,GET
- getSchedule?hl=en-US&leagueId=98767975604431411 GET 200: access-control-allow-origin=*, access-control-allow-headers=Content-Type,X-Api-Key, access-control-allow-methods=GET,OPTIONS
