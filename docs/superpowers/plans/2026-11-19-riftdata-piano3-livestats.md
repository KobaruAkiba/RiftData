# RiftData — Piano 3: dettaglio dei game del Worlds corrente da livestats — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comando `npm run ingest:livestats` che salva nel repo, per ogni game concluso del Worlds corrente, serie al minuto ed eventi dal feed livestats, collegati ai game e ai giocatori di Leaguepedia.

**Architecture:** Client lolesports (API + feed) con attesa di 500 ms e retry. Funzioni pure per collegamento, campionamento con gestione delle pause, costruzione del file del game e abbinamento dei giocatori, testate su fixture reali ridotte e casi sintetici. Un orchestratore con IO iniettato scrive i file del feed una volta sola e rigenera l'indice Leaguepedia a ogni lancio. Schemi zod condivisi con il sito in `src/data/schema/timeline.ts`.

**Tech Stack:** Node 22, TypeScript 7 strict ESM, tsx, Vitest 5, zod 4.

**Spec:** `docs/superpowers/specs/2026-11-19-riftdata-piano3-livestats-design.md` (questo piano), che integra `docs/superpowers/specs/2026-11-18-riftdata-design.md` (§2.1, §6.2, §6.3, §8.2). Esiti dello spike: `docs/superpowers/spikes/2026-11-19-data-sources-report.md`.

## Global Constraints

- Lavorare in `G:\HOME\Repos\RiftData`, branch `develop`. Il push lo fa l'utente con GitHub Desktop.
- Ogni messaggio di commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omesso negli esempi).
- Feed e API lolesports: intervallo minimo **500 ms** tra richieste; User-Agent `USER_AGENT` di `scripts/lib/http.ts`; header `x-api-key: LOLESPORTS_PUBLIC_KEY` per l'API (non per il feed).
- Costanti delle fonti solo in `scripts/lib/sources.ts`. Id dei tornei letti dall'API, mai cablati.
- Un game è "giocato" in `getCompletedEvents` se ha `vods` non vuoti.
- Schemi solo in `src/data/schema/`; la pipeline li importa. Import relativi con estensione `.js`.
- Scrittura con `writeIfChanged` (chiavi ordinate, LF, newline finale, nessun timestamp di esecuzione).
- Nessuna lista di squadre, giocatori, campioni o id cablata nel codice.
- Un game con errore non produce file; gli altri proseguono.
- File del game ≤ **100 KB**.
- Le regole del design valgono salvo smentita del Task 1. Se il Task 1 le smentisce, il report lo dice e i task successivi seguono il report.

## Review Focus

1. **Remake o game in più su lolesports** (la partita ha più game giocati su lolesports che su Leaguepedia): nessun abbinamento sbagliato in silenzio; tutta la partita resta non collegata con un warning, risolvibile con l'override. → test nel Task 3.
2. **Più pause nello stesso game**: il campione `i` resta al tempo di gioco `i:00` entro 10 s per pausa; nessun minuto in più. → test nel Task 4.
3. **Feed vuoto o 204 a metà game** (fotogrammi mancanti dopo l'inizio): il game fallisce con warning, nessun file parziale. → test nel Task 7.
4. **Game appena concluso senza righe `ScoreboardPlayers` su Leaguepedia** (caso tipico nel 2027): file del feed salvato, nessuna voce nell'indice, warning; il lancio successivo completa l'indice senza riscaricare il feed. → test nel Task 7.
5. **Richiesta oltre la fine del game** (il feed restituisce `finished` o l'ultimo fotogramma): nessun minuto duplicato in coda; l'ultimo campione è lo stato finale. → test nel Task 4.

---

## File Structure

| File | Responsabilità |
|---|---|
| `scripts/lib/lolesports/client.ts` | Client API lolesports e feed: attesa, retry, parsing JSON tollerante |
| `scripts/pipeline/livestats/types.ts` | Tipi delle risposte del feed già normalizzate (`WindowFrame`, `DetailsFrame`, `GameMetadata`, `LolMatch`) |
| `scripts/pipeline/livestats/parse.ts` | Risposte grezze → tipi di `types.ts` |
| `scripts/pipeline/livestats/discover.ts` | Verifica sui dati veri e fixture (`npm run discover:livestats`) |
| `src/data/schema/timeline.ts` | `GameTimelineSchema`, `LivestatsIndexSchema` |
| `scripts/pipeline/store.ts` | + opzione di serializzazione compatta |
| `scripts/pipeline/livestats/link.ts` | Collegamento game lolesports ↔ Leaguepedia |
| `scripts/pipeline/livestats/sampling.ts` | Campionamento al minuto di gioco con gestione delle pause |
| `scripts/pipeline/livestats/build.ts` | Campioni → `GameTimeline` (serie, cambi di oggetti, eventi) |
| `scripts/pipeline/livestats/roster.ts` | Voce dell'indice: partecipanti ↔ `ScoreboardPlayers` |
| `scripts/pipeline/livestats/overrides.ts` | Lettura di `data/overrides/livestats.json` |
| `scripts/pipeline/livestats/ingest.ts` | Orchestrazione con IO iniettato |
| `scripts/pipeline/ingest-livestats.ts` | CLI |
| `data/livestats/<anno>/…`, `data/overrides/livestats.json` | Dati salvati |
| `tests/fixtures/livestats/**`, `tests/pipeline/livestats/**`, `tests/data/livestats-integrity.test.ts` | Fixture e test |

---

### Task 1: Client lolesports e verifica sui dati veri

**Files:**
- Create: `scripts/lib/lolesports/client.ts`, `scripts/pipeline/livestats/types.ts`, `scripts/pipeline/livestats/parse.ts`, `scripts/pipeline/livestats/discover.ts`, `tests/fixtures/livestats/**`, `docs/superpowers/spikes/2026-11-19-livestats-discovery.md`
- Modify: `package.json` (script `discover:livestats`)
- Test: `tests/lib/lolesports/client.test.ts`, `tests/pipeline/livestats/parse.test.ts`

**Interfaces:**
- Consumes: `httpRequest`, `sleep`, `HttpResult` (`scripts/lib/http.ts`); `LOLESPORTS_API`, `LOLESPORTS_PUBLIC_KEY`, `LIVESTATS_FEED`, `WORLDS_LEAGUE_ID` (`scripts/lib/sources.ts`); `toStartingTime` (`scripts/spike/livestats.ts`, da spostare qui e riesportare dallo spike).
- Produces:
  ```ts
  // client.ts
  export const LOLESPORTS_INTERVAL_MS = 500;
  export interface LolesportsDeps { http: (url: string, init?: HttpInit) => Promise<HttpResult>; sleep: (ms: number) => Promise<void> }
  export interface LolesportsClient {
    tournaments(): Promise<unknown>;                       // getTournamentsForLeague
    completedEvents(tournamentId: string): Promise<unknown>;
    window(gameId: string, startingTime?: string): Promise<unknown | null>;   // null su 204 o corpo vuoto
    details(gameId: string, startingTime?: string): Promise<unknown | null>;
  }
  export function createLolesportsClient(deps: LolesportsDeps): LolesportsClient;  // attesa ≥ 500 ms tra richieste; retry su 429/5xx/errore di rete con attese crescenti; lancia dopo l'ultimo tentativo
  export function toStartingTime(d: Date): string;          // spostata dallo spike
  // types.ts
  export interface TeamFrame { totalGold: number; totalKills: number; towers: number; inhibitors: number; barons: number; dragons: string[]; participants: ParticipantWindow[] }
  export interface ParticipantWindow { participantId: number; totalGold: number; level: number; kills: number; deaths: number; assists: number; creepScore: number }
  export interface WindowFrame { timestamp: string; gameState: string; blue: TeamFrame; red: TeamFrame }
  export interface ParticipantDetails { participantId: number; items: number[]; perkMetadata: { styleId: number; subStyleId: number; perks: number[] }; killParticipation: number; championDamageShare: number; wardsPlaced: number; wardsDestroyed: number }
  export interface DetailsFrame { timestamp: string; participants: ParticipantDetails[] }
  export interface ParticipantMeta { participantId: number; championId: string; role: string; summonerName: string }
  export interface GameMetadata { participants: ParticipantMeta[] }   // blue 1-5, red 6-10
  export interface LolGame { id: string; number: number; played: boolean }
  export interface LolMatch { id: string; startTime: string; teams: { code: string; name: string }[]; games: LolGame[] }
  // parse.ts
  export function parseWindow(json: unknown): { metadata: GameMetadata | null; frames: WindowFrame[] };
  export function parseDetails(json: unknown): DetailsFrame[];
  export function parseCompletedEvents(json: unknown): LolMatch[];
  export function pickWorldsTournamentId(json: unknown, year: number): string | null;
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/lib/lolesports/client.test.ts` (http e sleep finti):

```ts
test("consecutive requests are spaced by at least 500 ms", async () => { /* due window(): sleep chiamato con ≥ 500 */ });
test("api requests send x-api-key, feed requests do not", async () => { /* ispezione degli header */ });
test("204 and empty body return null", async () => { expect(await client.window("1")).toBeNull(); });
test("429 then 200 retries and succeeds; persistent 5xx throws", async () => {});
```

`tests/pipeline/livestats/parse.test.ts`, sui campioni dello spike in `spike-samples/` e sulle fixture del Task 1:

```ts
test("window frames are normalized", () => {
  const { frames } = parseWindow(readSample("livestats-window-2026.json"));
  expect(frames[0]).toMatchObject({ gameState: "in_game", blue: { totalGold: 0, dragons: [] } });
  expect(frames[0]!.blue.participants.map((p) => p.participantId)).toEqual([1, 2, 3, 4, 5]);
});
test("details keep items, runes and shares", () => {
  const p = parseDetails(readSample("livestats-details-2026.json"))[0]!.participants[0]!;
  expect(p).toMatchObject({ participantId: 1, items: [1056, 2031, 3047, 2508], perkMetadata: { styleId: 8200, subStyleId: 8400 } });
});
test("completed events: played games only, numbered in order", () => {
  const [m] = parseCompletedEvents(readSample("lolesports-completed-events-2026.json"));
  expect(m).toMatchObject({ id: "115660588583171786", startTime: "2026-10-15T18:00:00Z", teams: [{ code: "KC" }, { code: "C9" }] });
  expect(m!.games[0]).toMatchObject({ id: "115660588583171787", number: 1, played: true });
});
test("unexpected shapes give empty results, never throw", () => {
  expect(parseWindow(null).frames).toEqual([]);
  expect(parseCompletedEvents({ data: {} })).toEqual([]);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/lib/lolesports tests/pipeline/livestats/parse.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare `client.ts`, `types.ts`, `parse.ts`; spostare `toStartingTime`**

`parseWindow` legge `gameMetadata.blueTeamMetadata.participantMetadata` / `redTeamMetadata` se presenti (forma da confermare allo Step 5).

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck`
Expected: PASS (i test dello spike restano verdi), nessun errore.

- [ ] **Step 5: Implementare `discover.ts` ed eseguirlo (rete, alcuni minuti)**

Run: `npm run discover:livestats`

Il comando, senza toccare `data/`:
1. trova il torneo Worlds 2026 e salva `tests/fixtures/livestats/completed-events-2026.json` ridotto (prime 4 partite + la finale);
2. per il primo game della finale salva `window-meta.json` (risposta senza `startingTime`, fotogrammi troncati a 3), `window-minute-10.json` e `details-minute-10.json` (risposte complete a +10 minuti dal primo fotogramma);
3. per 10 game del 2026 campiona `window` ogni minuto e registra i valori di `gameState`; se trova un fotogramma non `in_game` o una sequenza congelata, salva le risposte attorno alla pausa in `pause/`;
4. interroga la Cargo API (`cargofields`) per `MatchScheduleGame`, `ScoreboardGames`, `ScoreboardPlayers` e stampa i campi che contengono `Riot`, `Link`, `Champion`, `Role`, `Side`; salva le righe `ScoreboardPlayers` della finale in `scoreboard-players-final.json`.

Ogni fixture ≤ 200 KB.

- [ ] **Step 6: Scrivere `docs/superpowers/spikes/2026-11-19-livestats-discovery.md`**

Risposte ai 5 punti del design §7.2, con esempi reali: forma e valori esatti di `participantMetadata` e `role`; numero di fotogrammi e intervallo coperto da una chiamata con `startingTime`; come appare una pausa; campo Leaguepedia con l'id lolesports (o "assente"); campi di `ScoreboardPlayers`. Per ogni regola del design smentita: la regola sostitutiva per i Task 3–6.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/lolesports scripts/pipeline/livestats scripts/spike/livestats.ts package.json tests/lib/lolesports tests/pipeline/livestats tests/fixtures/livestats docs/superpowers/spikes/2026-11-19-livestats-discovery.md
git commit -m "feat(livestats): add lolesports client and verify feed shapes on real data"
```

---

### Task 2: Schemi del game e serializzazione compatta

**Files:**
- Create: `src/data/schema/timeline.ts`
- Modify: `src/data/schema/index.ts`, `scripts/pipeline/store.ts`
- Test: `tests/schema/timeline.test.ts`, `tests/pipeline/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // timeline.ts
  export const LolGameIdSchema: ZodString;            // solo cifre
  export const GameTimelineSchema;  export type GameTimeline;
  //   { gameId, year, minutes,
  //     participants: [{ participantId 1..10, side: "blue"|"red", role, championKey, runes: { primary, secondary, perks: number[] } }]  (10, id unici, 1-5 blue, 6-10 red),
  //     teams: { blue: TeamSeries, red: TeamSeries },   TeamSeries = { gold, kills, towers, inhibitors, barons, dragons: number[] }
  //     players: [{ participantId, gold, level, kills, deaths, assists, cs, damageShare, killParticipation, wardsPlaced, wardsDestroyed: number[] }],
  //     items: [{ participantId, changes: [{ minute, items: number[] }] }],
  //     events: [{ minute, side, type: "dragon"|"baron"|"tower"|"inhibitor", dragonType?: string }] }
  //   refine: ogni serie lunga `minutes`; dragonType presente sse type === "dragon"; changes[0].minute === 0
  export const LivestatsIndexSchema;  export type LivestatsIndex;
  //   { games: Record<GameId Leaguepedia, { gameId, participants: [{ participantId, player, team, role, champion }] }> }
  // store.ts
  export interface StringifyOptions { compactArrays?: boolean }   // array di soli primitivi su una riga
  export function stableStringify(value: unknown, opts?: StringifyOptions): string;
  export async function writeIfChanged(path: string, value: unknown, opts?: StringifyOptions): Promise<boolean>;
  export function livestatsGamePath(year: number, gameId: string): string;   // data/livestats/<anno>/<id>.json
  export function livestatsIndexPath(year: number): string;                  // data/livestats/<anno>/index.json
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("a valid timeline parses; series of wrong length are rejected", () => {
  expect(GameTimelineSchema.safeParse(timeline({ minutes: 3 })).success).toBe(true);
  expect(GameTimelineSchema.safeParse(withGold(timeline({ minutes: 3 }), [0, 500])).success).toBe(false);
});
test("dragonType is required for dragons and forbidden otherwise", () => {});
test("participants must be 10 with blue 1-5 and red 6-10", () => {});
test("compact arrays put primitive arrays on one line and keep objects indented", () => {
  expect(stableStringify({ b: [1, 2], a: { c: [3] } }, { compactArrays: true })).toBe('{\n  "a": {\n    "c": [3]\n  },\n  "b": [1, 2]\n}\n');
});
test("default output is unchanged", () => {
  expect(stableStringify({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/schema/timeline.test.ts tests/pipeline/store.test.ts`
Expected: FAIL sui nuovi test.

- [ ] **Step 3: Implementare schemi e opzione compatta**

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck`
Expected: PASS; i file in `data/` non cambiano (`git status` pulito su `data/`).

- [ ] **Step 5: Commit**

```bash
git add src/data/schema scripts/pipeline/store.ts tests/schema/timeline.test.ts tests/pipeline/store.test.ts
git commit -m "feat(data): add game timeline schemas and compact JSON output"
```

---

### Task 3: Collegamento lolesports ↔ Leaguepedia

**Files:**
- Create: `scripts/pipeline/livestats/link.ts`, `scripts/pipeline/livestats/overrides.ts`, `data/overrides/livestats.json` (`{}`)
- Test: `tests/pipeline/livestats/link.test.ts`

**Interfaces:**
- Consumes: `LolMatch` (Task 1); `Edition`, `Team` (schema).
- Produces:
  ```ts
  // overrides.ts
  export type LivestatsOverrides = Record<string, string | null>;     // id lolesports → GameId Leaguepedia | null (ignora)
  export async function loadLivestatsOverrides(path?: string): Promise<LivestatsOverrides>;   // default data/overrides/livestats.json; file assente → {}; chiavi non numeriche → errore
  // link.ts
  export interface GameLink { lolGameId: string; leaguepediaGameId: string }
  export interface LinkResult { links: GameLink[]; unlinked: { lolGameId: string; reason: string }[] }
  export function normalizeTeamKey(value: string): string;   // minuscole, solo alfanumerici
  export function linkGames(matches: LolMatch[], edition: Edition, teams: Team[], overrides: LivestatsOverrides, commonIds?: Map<string, string>): LinkResult;
  ```

Regole (design §7.3, salvo report del Task 1): override → id comune (`commonIds`, se il Task 1 lo trova) → partita con stesso giorno UTC e stessa coppia di squadre (codice lolesports normalizzato contro `short` e `name` di `teams.json`), poi game n-esimo giocato ↔ `number` n. Più candidati o nessuno → non collegato. Se una partita ha più game giocati su lolesports che game su Leaguepedia → tutti i suoi game non collegati, motivo `game count mismatch`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("real 2026 fixture links every played game of the saved matches", () => {
  const r = linkGames(parseCompletedEvents(fixture("completed-events-2026.json")), edition2026(), teams(), {});
  expect(r.unlinked).toEqual([]);
  expect(r.links.find((l) => l.leaguepediaGameId === "2026 Season World Championship/Main Event_Finals_1_1")).toBeDefined();
});
test("team code different from short still links through the name", () => {});
test("same pair twice on the same day (tiebreak) is left unlinked", () => {});
test("extra played game on lolesports (remake) unlinks the whole match", () => {
  expect(r.links.filter((l) => l.lolGameId.startsWith(remakeMatchPrefix))).toEqual([]);
  expect(new Set(r.unlinked.map((u) => u.reason))).toEqual(new Set(["game count mismatch"]));
});
test("override wins; null override ignores the game", () => {});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/livestats/link.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare `overrides.ts` e `link.ts`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/pipeline/livestats/link.test.ts; npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/livestats/link.ts scripts/pipeline/livestats/overrides.ts data/overrides/livestats.json tests/pipeline/livestats/link.test.ts
git commit -m "feat(livestats): link lolesports games to Leaguepedia games"
```

---

### Task 4: Campionamento al minuto di gioco con pause

**Files:**
- Create: `scripts/pipeline/livestats/sampling.ts`
- Test: `tests/pipeline/livestats/sampling.test.ts`

**Interfaces:**
- Consumes: `WindowFrame` (Task 1).
- Produces:
  ```ts
  export type WindowAt = (wall: Date) => Promise<WindowFrame[]>;   // fotogrammi della risposta `window` a quel tempo reale (arrotondato a 10 s); [] = nessun dato
  export interface Sample { minute: number; wall: Date; frame: WindowFrame }
  export class SamplingError extends Error {}
  export function isStalled(frames: WindowFrame[], gameSeconds: number): boolean;
  export async function sampleGame(windowAt: WindowAt, first: WindowFrame): Promise<Sample[]>;
  ```

Regole (design §7.6, salvo report del Task 1):
- `first` = primo fotogramma `in_game` = minuto 0.
- Prossima richiesta: `wall` dell'ultimo campione valido + 60 s.
- `isStalled`: un fotogramma con `gameState` diverso da `in_game`, oppure, se `gameSeconds ≥ 120`, oro totale dei due lati invariato tra primo e ultimo fotogramma della risposta (o rispetto al campione precedente se la risposta copre meno di 10 s, secondo il report del Task 1).
- Pausa: ricerca binaria a passi di 10 s dell'ultimo istante attivo tra l'ultimo campione e la richiesta; poi avanzamento con passi 30 s, 60 s, 120 s… fino al primo istante attivo, e ricerca binaria della ripresa; durata aggiunta allo spostamento; richiesta ripetuta al tempo corretto.
- Fine: un fotogramma `finished`, o `[]` dopo almeno un campione → ultimo campione = ultimo fotogramma attivo noto (anche a metà minuto), solo se diverso dall'ultimo campione salvato.
- `[]` prima della fine (nessun `finished` visto e meno di 2 campioni) → `SamplingError`.

- [ ] **Step 1: Scrivere i test che falliscono**

Feed sintetico: funzione `fakeFeed({ gameMinutes, pauses: [{ atGameSec, lengthSec }], stateDuringPause: "paused" | "frozen" })` che genera `WindowAt` con oro crescente in gioco e invariato in pausa, fotogrammi ogni 10 s.

```ts
test("no pauses: one sample per game minute plus the final state", async () => {
  const s = await sampleGame(feed({ gameMinutes: 5.5 }), first);
  expect(s.map((x) => x.minute)).toEqual([0, 1, 2, 3, 4, 5, 6]);
});
test("one paused-state pause keeps samples on game time within 10 s", async () => {
  const f = feed({ gameMinutes: 6, pauses: [{ atGameSec: 150, lengthSec: 240 }], stateDuringPause: "paused" });
  for (const x of await sampleGame(f, first)) expect(Math.abs(f.gameSecondsAt(x.wall) - x.minute * 60)).toBeLessThanOrEqual(10);
});
test("several frozen pauses add no extra minutes", async () => {
  const s = await sampleGame(feed({ gameMinutes: 20, pauses: [{ atGameSec: 300, lengthSec: 120 }, { atGameSec: 610, lengthSec: 400 }, { atGameSec: 900, lengthSec: 60 }], stateDuringPause: "frozen" }), first);
  expect(s).toHaveLength(21);
});
test("unchanged stats between minute 0 and 1 are not a pause", async () => {});
test("requests past the end add no duplicate minute", async () => {});
test("empty feed after the start throws SamplingError", async () => {});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/livestats/sampling.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `isStalled` e `sampleGame`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/pipeline/livestats/sampling.test.ts; npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/livestats/sampling.ts tests/pipeline/livestats/sampling.test.ts
git commit -m "feat(livestats): sample feed frames on game minutes across pauses"
```

---

### Task 5: Costruzione del file del game

**Files:**
- Create: `scripts/pipeline/livestats/build.ts`
- Test: `tests/pipeline/livestats/build.test.ts`

**Interfaces:**
- Consumes: `Sample` (Task 4); `DetailsFrame`, `GameMetadata` (Task 1); `GameTimeline`, `GameTimelineSchema` (Task 2).
- Produces:
  ```ts
  export interface BuildInput { gameId: string; year: number; metadata: GameMetadata; samples: Sample[]; details: DetailsFrame[] }  // details[i] allineato a samples[i]
  export function buildGameTimeline(input: BuildInput): GameTimeline;      // valida con GameTimelineSchema.parse
  export function expectedMinutes(durationSec: number): number;            // floor(durationSec / 60) + 2
  export function checkDuration(timeline: GameTimeline, durationSec: number): string | null;   // null se |minutes - expected| ≤ 1, altrimenti messaggio
  ```

Regole: serie dalle statistiche dei campioni (`gold` = `totalGold`, `cs` = `creepScore`); `damageShare` = `championDamageShare`, `killParticipation`, entrambi a 3 decimali; `runes` dall'ultimo `DetailsFrame` (`primary` = `styleId`, `secondary` = `subStyleId`, `perks`); `items` solo quando l'inventario (ordinato) cambia, primo elemento al minuto 0; eventi dalle differenze di conteggio tra campioni consecutivi, al minuto del campione in cui compaiono; tipi dei draghi dai nuovi elementi in coda alla lista `dragons`; `role` e `championKey` da `metadata`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("series have one value per sample and match the frames", () => {});
test("dragon events carry the type in the order the feed lists them", () => {
  // campioni con blue.dragons: [] → ["ocean"] → ["ocean", "infernal"]; red: [] → [] → ["cloud"]
  expect(t.events).toEqual([
    { minute: 1, side: "blue", type: "dragon", dragonType: "ocean" },
    { minute: 2, side: "blue", type: "dragon", dragonType: "infernal" },
    { minute: 2, side: "red", type: "dragon", dragonType: "cloud" },
  ]);
});
test("two towers in the same minute give two events", () => {});
test("items are stored only when the inventory changes", () => {
  expect(t.items[0]!.changes).toEqual([{ minute: 0, items: [1056, 2003] }, { minute: 3, items: [1056, 2003, 3070] }]);
});
test("shares are rounded to 3 decimals", () => { expect(t.players[0]!.damageShare[0]).toBe(0.244); });
test("duration check tolerates one minute", () => {
  expect(checkDuration(withMinutes(34), 1993)).toBeNull();     // expected 35
  expect(checkDuration(withMinutes(32), 1993)).toMatch(/minutes/);
});
test("real fixture frames build a valid timeline under 100 KB in compact form", () => {
  expect(Buffer.byteLength(stableStringify(t, { compactArrays: true }))).toBeLessThan(100_000);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/livestats/build.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `build.ts`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/pipeline/livestats/build.test.ts; npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/livestats/build.ts tests/pipeline/livestats/build.test.ts
git commit -m "feat(livestats): build per-game timelines with series, items and events"
```

---

### Task 6: Giocatori e voce dell'indice

**Files:**
- Create: `scripts/pipeline/livestats/roster.ts`
- Modify: `scripts/pipeline/leaguepedia/queries.ts` (`PlayerRow` e `playersQuery` con i campi del report del Task 1: almeno `Link`, `Champion`, `Role`, `Side`)
- Test: `tests/pipeline/livestats/roster.test.ts`, `tests/pipeline/queries.test.ts` (campi aggiornati)

**Interfaces:**
- Consumes: `GameTimeline`, `LivestatsIndex` (Task 2); `Game` (schema edizione); `PlayerRow`; `normalizeTeamKey` (Task 3).
- Produces:
  ```ts
  export type IndexEntry = LivestatsIndex["games"][string];
  export interface RosterResult { entry: IndexEntry | null; warnings: string[] }
  export function roleKey(value: string): string;   // "Bot"/"bottom"/"adc" → "bottom", "Mid"/"middle" → "mid", ecc.
  export function buildIndexEntry(timeline: GameTimeline, game: Game, players: PlayerRow[], resolveTeam: (name: string) => string | null): RosterResult;
  ```

Regole (design §7.4): lato dal `participantId`; squadra del lato da `game.blue.team` / `game.red.team`; riga `ScoreboardPlayers` per lato + `roleKey`; nessuna riga, o più righe per lo stesso lato e ruolo → `entry: null` con warning; campione normalizzato diverso dalla `championKey` → warning, `entry` comunque prodotta; `player` = `Link`, `champion` = `Champion`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("real final: 10 participants matched by side and role", () => {
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), fixture("scoreboard-players-final.json"), resolve);
  expect(r.entry!.participants).toHaveLength(10);
  expect(new Set(r.entry!.participants.map((p) => p.player)).size).toBe(10);
});
test("MonkeyKing and Renata keys match Wukong and Renata Glasc with a warning, not an error", () => {
  expect(r.entry).not.toBeNull();
  expect(r.warnings).toEqual([expect.stringMatching(/MonkeyKing.*Wukong/), expect.stringMatching(/Renata.*Renata Glasc/)]);
});
test("missing player rows give no entry and a warning", () => {
  expect(buildIndexEntry(t, game, [], resolve)).toMatchObject({ entry: null, warnings: [expect.stringMatching(/no players/i)] });
});
test("two rows for the same side and role give no entry", () => {});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/livestats/roster.test.ts tests/pipeline/queries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare `roster.ts`; estendere `PlayerRow` e `playersQuery`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck`
Expected: PASS (inclusi i test del Piano 2: la normalizzazione delle edizioni non cambia).

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/livestats/roster.ts scripts/pipeline/leaguepedia/queries.ts tests/pipeline/livestats/roster.test.ts tests/pipeline/queries.test.ts
git commit -m "feat(livestats): match feed participants to Leaguepedia players"
```

---

### Task 7: Orchestrazione e comando

**Files:**
- Create: `scripts/pipeline/livestats/ingest.ts`, `scripts/pipeline/ingest-livestats.ts`
- Modify: `package.json` (script `ingest:livestats`)
- Test: `tests/pipeline/livestats/ingest.test.ts`

**Interfaces:**
- Consumes: tutto ciò che producono i Task 1–6; `readJson`, `writeIfChanged`, `livestatsGamePath`, `livestatsIndexPath`, `editionPath` (`store.ts`); `CargoClient`, `playersQuery`.
- Produces:
  ```ts
  export interface LivestatsArgs { year?: number; game?: string }
  export function parseLivestatsArgs(argv: string[]): LivestatsArgs;     // --year 2025, --game 1156…
  export function selectEditionYear(editions: Edition[], year?: number): number | null;   // year esplicito, altrimenti il più recente con status ongoing|completed
  export interface LivestatsIO {
    readEdition(year: number): Promise<Edition | null>;
    readTeams(): Promise<Team[]>;
    listEditionYears(): Promise<number[]>;
    gameExists(year: number, gameId: string): Promise<boolean>;
    readGame(year: number, gameId: string): Promise<GameTimeline | null>;
    writeGame(year: number, timeline: GameTimeline): Promise<boolean>;     // compactArrays
    writeIndex(year: number, index: LivestatsIndex): Promise<boolean>;
    log(message: string): void;
  }
  export interface LivestatsResult { written: string[]; skipped: number; unlinked: string[]; failed: string[]; warnings: string[] }
  export async function ingestLivestats(lol: LolesportsClient, cargo: CargoClient, overrides: LivestatsOverrides, args: LivestatsArgs, io: LivestatsIO): Promise<LivestatsResult>;
  ```

Flusso (design §7.1): anno → edizione → torneo e partite lolesports → collegamento → per ogni game collegato e senza file (o uguale a `--game`): `window` senza `startingTime` per metadati e primo fotogramma `in_game`, `sampleGame`, `details` agli stessi `wall`, `buildGameTimeline`, `checkDuration` con `durationSec` del game Leaguepedia, `writeGame`. Errore su un game → `failed` con motivo, nessun file. Poi `ScoreboardPlayers` dell'edizione (una query) e indice rigenerato per tutti i game con file e collegamento, con `buildIndexEntry`; `writeIndex`. Progresso stampato per game (il primo lancio dura circa un'ora).

- [ ] **Step 1: Scrivere i test che falliscono**

Client lolesports e Cargo finti, IO in memoria:

```ts
test("current edition is the newest ongoing or completed one", () => {
  expect(selectEditionYear([ed(2026, "completed"), ed(2027, "upcoming")])).toBe(2026);
  expect(selectEditionYear([ed(2026, "completed"), ed(2027, "ongoing")])).toBe(2027);
  expect(selectEditionYear([ed(2026, "completed")], 2025)).toBe(2025);
});
test("games with a stored file are not downloaded again", async () => { /* nessuna chiamata window/details per quel game */ });
test("a game failing mid-way writes no file and the others are saved", async () => {
  // feed finto: game A ok, game B restituisce [] dopo 3 minuti (Review Focus 3)
  expect(r.failed).toEqual([expect.stringContaining(gameB)]);
  expect(io.games.has(gameB)).toBe(false);
});
test("missing player rows: file saved, no index entry, completed on the next run without feed calls", async () => {
  // Review Focus 4: primo lancio con ScoreboardPlayers vuoto, secondo con le righe
});
test("second run with nothing new writes nothing", async () => { expect(r2.written).toEqual([]); });
test("--game downloads that game again even if stored", async () => {});
test("duration mismatch fails the game with a warning", async () => {});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/livestats/ingest.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `ingest.ts` e la CLI `ingest-livestats.ts`**

La CLI crea `createLolesportsClient({ http: httpRequest, sleep })`, `connectCargo` come `scripts/pipeline/ingest.ts`, IO reale su `store.ts`; stampa il riepilogo; esce con codice 1 solo per errori globali (torneo non trovato, rete giù prima di iniziare), non per singoli game falliti.

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/livestats/ingest.ts scripts/pipeline/ingest-livestats.ts package.json tests/pipeline/livestats/ingest.test.ts
git commit -m "feat(livestats): add incremental livestats ingest command"
```

---

### Task 8: Primo popolamento del 2026, integrità e documentazione

**Files:**
- Create: `data/livestats/2026/**`, `tests/data/livestats-integrity.test.ts`
- Modify: `data/README.md`, `data/overrides/livestats.json` (solo se servono correzioni)

- [ ] **Step 1: Scrivere il test di integrità**

`tests/data/livestats-integrity.test.ts`, per ogni anno in `data/livestats/`:

```ts
test("every index entry has its game file", () => {});
test("every index key is a game of the edition and sides match its teams", () => {});
test("every game file is valid, has 10 unique participants and series of length minutes", () => {});
test("no game file is larger than 100 KB", () => {});
```

- [ ] **Step 2: Primo popolamento reale (rete, circa un'ora, in background)**

Run: `npm run ingest:livestats`
Expected: riepilogo con 98 game scritti; per ogni game mancante un warning con la causa. Correggere i casi risolvibili con `data/overrides/livestats.json` e rilanciare: si scaricano solo i mancanti.

- [ ] **Step 3: Secondo lancio**

Run: `npm run ingest:livestats`
Expected: `written: []`, nessuna richiesta al feed.

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck; du -sh data/livestats/2026`
Expected: PASS; cartella intorno ai 5 MB.

- [ ] **Step 5: Aggiornare `data/README.md` con l'agente `sintetizzatore`**

Sezione nuova: archivio `data/livestats/` (file del game e indice, cicli di vita separati), campi del game con riferimento a `src/data/schema/timeline.ts`, precisione al minuto e gestione delle pause, comandi `ingest:livestats` (opzioni `--year`, `--game`) e `discover:livestats`, override `livestats.json`, lacune note emerse dal popolamento. Stesso stile del file.

- [ ] **Step 6: Commit**

```bash
git add data/livestats data/overrides/livestats.json data/README.md tests/data/livestats-integrity.test.ts
git commit -m "feat(data): store Worlds 2026 game timelines from livestats"
```
