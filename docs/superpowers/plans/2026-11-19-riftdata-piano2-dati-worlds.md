# RiftData — Piano 2: schema dati e ingest Leaguepedia dei Worlds — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaricare da Leaguepedia tutte le edizioni dei Worlds (dal 2011 alla prossima) e salvarle nel repo come JSON normalizzati e validati. Ogni squadra mantiene lo stesso ID attraverso le rinomine. Le correzioni manuali passano da file di override.

**Architecture:** Client Cargo con paginazione, attesa tra le richieste e retry. Query tipizzate con alias dei campi. Funzioni pure di normalizzazione (squadre, edizioni), testate su dati sintetici e su fixture reali. Override applicati prima del calcolo di stato e campione. Scrittura deterministica: un file viene riscritto solo se il contenuto cambia, quindi la pipeline non crea commit vuoti. Gli schemi zod in `src/data/schema/` sono il contratto condiviso con il sito (Piano 4).

**Tech Stack:** Node 22, TypeScript strict ESM, tsx, Vitest, zod 4.

**Spec:** `docs/superpowers/specs/2026-11-18-riftdata-design.md` (§2, §6, §8.2, §9, §10, §12). Esiti dello spike: `docs/superpowers/spikes/2026-11-19-data-sources-report.md`.

## Perimetro

- **Dentro:** edizioni Worlds (fasi, partite, tabellini di squadra per game), squadre con catena di rinomine, override, ingest incrementale, verifica di integrità dei dati salvati.
- **Fuori:** leghe e seed (nuovo **Piano 2b**, prima del Piano 5). La home resta nella sua fase 4 (§9, Worlds appena concluso) fino a circa aprile 2027: leghe e seed non servono al lancio. Fuori anche dettaglio per giocatore e timeline del Worlds corrente (Piano 3, da livestats).
- I tabellini di squadra coprono ciò che serve a Teams e Worlds History (§2.3): oro finale, kill, morti, assist, draghi, baroni, torri, pick e ban.

## Global Constraints

- Lavorare in `G:\HOME\Repos\RiftData`, branch `develop`. Il push lo fa l'utente con GitHub Desktop.
- Ogni messaggio di commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omesso negli esempi).
- User-Agent: `USER_AGENT` di `scripts/lib/http.ts`. Intervallo minimo tra richieste Leaguepedia: 2000 ms. Pagina Cargo: 500 righe.
- Credenziali solo da `LEAGUEPEDIA_BOT_USER` / `LEAGUEPEDIA_BOT_PASSWORD`, usate solo se l'accesso anonimo è bloccato. Mai stampate.
- Nessun timestamp di esecuzione nei file di dati: un file cambia solo se cambiano i dati.
- JSON scritti con chiavi ordinate, indentazione 2 spazi, newline finale, fine riga LF.
- Nomi di squadre, giocatori e campioni in originale. Testi destinati all'interfaccia in inglese (es. `"Worlds 2026"`).
- Gli schemi dati vivono in `src/data/schema/` e sono l'unica definizione dei tipi di dominio. La pipeline li importa, non li duplica.
- Dati Leaguepedia sotto CC BY-SA: `data/README.md` riporta l'attribuzione.
- Nessuna lista di leghe o squadre cablata nel codice. L'unico filtro fisso è la lega `World Championship`.
- Gli ID dei tornei e delle partite si leggono dai dati, mai cablati.

## Review Focus

1. **Squadra rinominata tra un'edizione e l'altra** (`SK Telecom T1` → `T1`): stesso ID in tutte le edizioni. Uno slot ceduto (`acquire`) crea invece una squadra diversa. → test nel Task 4.
2. **Partita futura con squadre `TBD` e senza punteggio**: squadra `null`, punteggio `null`, nessun crash; l'edizione risulta `upcoming` o `ongoing`. → test nel Task 5.
3. **Campi Cargo con underscore** (`DateTime_UTC`): Cargo li restituisce con lo spazio (`DateTime UTC`). Ogni campo con underscore deve avere un alias senza underscore. → test nel Task 3.
4. **Squadra rinominata dopo che le sue edizioni sono già salvate**: gli ID salvati non corrispondono più. Serve una ricostruzione completa, non file incoerenti. → test nel Task 8.
5. **Errore di rete o limite di richieste a metà esecuzione**: nessun file scritto, perché i dati restano coerenti con l'esecuzione precedente. → test nel Task 8.

---

## File Structure

| File | Responsabilità |
|---|---|
| `scripts/lib/leaguepedia/cargo.ts` | `CargoQuery`, URL, classificazione risposta (spostati dallo spike) |
| `scripts/lib/leaguepedia/auth.ts` | Login bot password (spostato dallo spike) |
| `scripts/lib/leaguepedia/client.ts` | Client Cargo: paginazione, attesa, retry, connessione anonima o bot |
| `src/data/schema/team.ts`, `src/data/schema/edition.ts`, `src/data/schema/index.ts` | Schemi zod e tipi di dominio |
| `scripts/pipeline/leaguepedia/queries.ts` | Query Cargo e tipi delle righe grezze |
| `scripts/pipeline/discover.ts` | Verifica dei campi Cargo e salvataggio delle fixture |
| `scripts/pipeline/teams/identity.ts` | Identità delle squadre dalla catena di rinomine |
| `scripts/pipeline/worlds/normalize.ts` | Righe grezze → `Edition` |
| `scripts/pipeline/worlds/apply-overrides.ts` | Applicazione pura degli override a un'edizione |
| `scripts/pipeline/overrides.ts` | Caricamento e validazione dei file di override |
| `scripts/pipeline/store.ts` | Serializzazione stabile, scrittura solo se cambiato, lettura validata |
| `scripts/pipeline/ingest.ts` | CLI e orchestrazione incrementale |
| `data/worlds/{year}.json`, `data/teams.json`, `data/overrides/*.json`, `data/README.md` | Dati salvati |
| `tests/fixtures/leaguepedia/**` | Campi Cargo reali e righe reali ridotte |
| `tests/data/integrity.test.ts` | Invarianti sui dati salvati |

---

### Task 1: Client Cargo condiviso

**Files:**
- Create: `scripts/lib/leaguepedia/cargo.ts`, `scripts/lib/leaguepedia/auth.ts`, `scripts/lib/leaguepedia/client.ts`
- Modify: `scripts/spike/leaguepedia.ts`, `scripts/spike/leaguepedia-auth.ts` (importano e riesportano da `scripts/lib/leaguepedia/`)
- Test: `tests/lib/leaguepedia/client.test.ts`

**Interfaces:**
- Consumes: `httpRequest`, `sleep`, `HttpInit`, `HttpResult` (`scripts/lib/http.ts`); `LEAGUEPEDIA_API` (`scripts/lib/sources.ts`).
- Produces:
  ```ts
  // cargo.ts: spostati dallo spike senza cambiare comportamento, più due campi
  export interface CargoQuery { tables: string; fields: string; where?: string; limit?: number; orderBy?: string; offset?: number }
  export type CargoOutcome = /* invariato */;
  export function buildCargoUrl(q: CargoQuery): string;   // aggiunge order_by e offset se presenti
  export function classifyCargoResponse(res: HttpResult): CargoOutcome;
  export function cargoString(value: string): string;     // valore tra virgolette doppie, `"` e `\` con escape `\`
  // auth.ts: cookieHeader e loginWithBotPassword spostati senza modifiche
  // client.ts
  export const CARGO_PAGE_SIZE = 500;
  export const CARGO_INTERVAL_MS = 2000;
  export const CARGO_BACKOFF_MS = [10_000, 30_000, 60_000];
  export type Row = Record<string, string>;
  export class CargoError extends Error { constructor(public kind: "blocked" | "rate_limited" | "error", message: string) }
  export interface CargoClientDeps { http: (url: string, init?: HttpInit) => Promise<HttpResult>; sleep: (ms: number) => Promise<void>; cookie?: string }
  export interface CargoClient { query(q: Omit<CargoQuery, "limit" | "offset"> & { orderBy: string }): Promise<Row[]> }
  export function createCargoClient(deps: CargoClientDeps): CargoClient;
  export function connectCargo(deps: Omit<CargoClientDeps, "cookie"> & { env: { user?: string; password?: string } }): Promise<CargoClient>;
  ```

Regole:
- `query` pagina con `limit=500` e `offset` crescente finché una pagina ha meno di 500 righe. `orderBy` è obbligatorio, per una paginazione stabile.
- Prima di ogni richiesta, tranne la prima del client, `sleep(2000)`.
- `rate_limited`: riprova dopo `sleep` dei valori di `CARGO_BACKOFF_MS`, in ordine; esauriti i tentativi, `CargoError("rate_limited")`. `blocked`: `CargoError("blocked")` subito. `error`: `CargoError("error")` con il messaggio.
- Se `cookie` è presente, lo manda come header `cookie`.
- `connectCargo`: una query di prova anonima (`tables=Tournaments`, `fields=Name`, `limit=1`); se il risultato è `blocked` o `rate_limited` e le credenziali esistono, esegue `loginWithBotPassword` e crea il client con il cookie; altrimenti crea il client anonimo. Senza credenziali e con accesso bloccato: `CargoError("blocked")`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const page = (n: number) => JSON.stringify({ cargoquery: Array.from({ length: n }, (_, i) => ({ title: { N: String(i) } })) });

test("buildCargoUrl adds order_by and offset", () => {
  const u = new URL(buildCargoUrl({ tables: "T", fields: "A", orderBy: "T.A", offset: 500, limit: 500 }));
  expect(u.searchParams.get("order_by")).toBe("T.A");
  expect(u.searchParams.get("offset")).toBe("500");
});
test("cargoString escapes quotes and backslashes", () => {
  expect(cargoString('Team "X" \\ Y')).toBe('"Team \\"X\\" \\\\ Y"');
});
test("query paginates until a short page and waits between requests", async () => {
  // fake http: prima risposta 500 righe, seconda 3 righe
  const rows = await createCargoClient(deps).query({ tables: "T", fields: "N", orderBy: "T.N" });
  expect(rows).toHaveLength(503);
  expect(requestedUrls.map((u) => new URL(u).searchParams.get("offset"))).toEqual(["0", "500"]);
  expect(sleeps).toEqual([2000]);
});
test("query retries rate_limited with backoff, then succeeds", async () => {
  // fake http: 429, poi 200 con 2 righe
  const rows = await createCargoClient(deps).query({ tables: "T", fields: "N", orderBy: "T.N" });
  expect(rows).toHaveLength(2);
  expect(sleeps).toContain(10_000);
});
test("query throws CargoError blocked on 402 without retry", async () => {
  await expect(createCargoClient(deps402).query({ tables: "T", fields: "N", orderBy: "T.N" }))
    .rejects.toMatchObject({ kind: "blocked" });
  expect(requestedUrls).toHaveLength(1);
});
test("query sends the cookie when configured", async () => {
  await createCargoClient({ ...deps, cookie: "a=1" }).query({ tables: "T", fields: "N", orderBy: "T.N" });
  expect(lastHeaders.cookie).toBe("a=1");
});
test("connectCargo without credentials throws blocked when anonymous access is blocked", async () => {
  await expect(connectCargo({ ...deps402, env: {} })).rejects.toMatchObject({ kind: "blocked" });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/lib/leaguepedia/client.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Spostare `cargo.ts` e `auth.ts`, implementare `client.ts`, aggiornare i moduli dello spike**

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npx tsc --noEmit`
Expected: tutti i test PASS, compresi quelli dello spike, che non cambiano. Typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/leaguepedia scripts/spike/leaguepedia.ts scripts/spike/leaguepedia-auth.ts tests/lib/leaguepedia
git commit -m "feat(pipeline): add paginated Cargo client with retry and bot fallback"
```

---

### Task 2: Schemi dati di dominio

**Files:**
- Create: `src/data/schema/team.ts`, `src/data/schema/edition.ts`, `src/data/schema/index.ts`
- Modify: `package.json` (dipendenza `zod`), `tsconfig.json` (`include` aggiunge `"src"`)
- Test: `tests/schema/schema.test.ts`

**Interfaces:**
- Produces (zod 4; i tipi TypeScript sono `z.infer` degli schemi, esportati con lo stesso nome senza `Schema`):
  ```ts
  // team.ts
  export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  export const TeamIdSchema = SlugSchema;
  export const TeamSchema = z.object({
    id: TeamIdSchema, name: z.string().min(1), short: z.string().optional(), region: z.string().optional(),
    aliases: z.array(z.string()).min(1),          // tutti i nomi storici, compreso quello attuale, ordinati
  });
  export const TeamsFileSchema = z.object({ teams: z.array(TeamSchema) });  // ordinate per id
  // edition.ts
  export const StageTypeSchema = z.enum(["play-in", "swiss", "groups", "single-elimination", "other"]);
  export const EditionStatusSchema = z.enum(["upcoming", "ongoing", "completed"]);
  export const GameSideSchema = z.object({
    team: TeamIdSchema, kills: z.number().int().min(0).optional(), deaths: z.number().int().min(0).optional(),
    assists: z.number().int().min(0).optional(), gold: z.number().int().min(0).optional(),
    dragons: z.number().int().min(0).optional(), barons: z.number().int().min(0).optional(),
    towers: z.number().int().min(0).optional(), picks: z.array(z.string()), bans: z.array(z.string()),
  });
  export const GameSchema = z.object({
    id: z.string(), number: z.number().int().min(1), blue: GameSideSchema, red: GameSideSchema,
    winner: z.enum(["blue", "red"]), durationSec: z.number().int().positive().optional(), patch: z.string().optional(),
  });
  export const MatchSchema = z.object({
    id: z.string(), round: z.string().optional(), date: z.iso.datetime().optional(),
    bestOf: z.number().int().positive().optional(),
    team1: TeamIdSchema.nullable(), team2: TeamIdSchema.nullable(),
    score1: z.number().int().min(0).nullable(), score2: z.number().int().min(0).nullable(),
    winner: TeamIdSchema.nullable(), games: z.array(GameSchema),   // games ordinati per number
  });
  export const StageSchema = z.object({
    id: SlugSchema, name: z.string(), type: StageTypeSchema,
    order: z.number().int().min(0), matches: z.array(MatchSchema),   // ordinati per date, poi id
  });
  export const EditionSchema = z.object({
    year: z.number().int().min(2011), name: z.string(), overviewPages: z.array(z.string()).min(1),
    startDate: z.iso.date().optional(), endDate: z.iso.date().optional(),
    status: EditionStatusSchema, champion: TeamIdSchema.nullable(),
    coverage: z.object({ matches: z.boolean(), games: z.boolean() }),
    stages: z.array(StageSchema),                                     // ordinati per order
  });
  // index.ts riesporta tutto
  ```

- [ ] **Step 1: Installare zod e scrivere i test che falliscono**

Run: `npm install zod@^4`

```ts
test("TeamId accepts slugs only", () => {
  expect(TeamIdSchema.safeParse("t1").success).toBe(true);
  expect(TeamIdSchema.safeParse("team-liquid").success).toBe(true);
  expect(TeamIdSchema.safeParse("Team Liquid").success).toBe(false);
  expect(TeamIdSchema.safeParse("-x").success).toBe(false);
});
test("Match allows TBD teams and missing scores", () => {
  expect(MatchSchema.safeParse({ id: "m1", team1: null, team2: null, score1: null, score2: null, winner: null, games: [] }).success).toBe(true);
});
test("Edition requires at least one overview page", () => {
  const base = { year: 2026, name: "Worlds 2026", status: "upcoming", champion: null, coverage: { matches: false, games: false }, stages: [] };
  expect(EditionSchema.safeParse({ ...base, overviewPages: [] }).success).toBe(false);
  expect(EditionSchema.safeParse({ ...base, overviewPages: ["2026 Season World Championship"] }).success).toBe(true);
});
test("Game winner is a side, not a team", () => {
  const side = { team: "t1", picks: [], bans: [] };
  expect(GameSchema.safeParse({ id: "g", number: 1, blue: side, red: { ...side, team: "geng" }, winner: "t1" }).success).toBe(false);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/schema/schema.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare gli schemi; aggiungere `"src"` a `include` in `tsconfig.json`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npx tsc --noEmit`
Expected: PASS; typecheck pulito.

- [ ] **Step 5: Commit**

```bash
git add src/data/schema tests/schema package.json package-lock.json tsconfig.json
git commit -m "feat(data): add zod domain schemas for teams and Worlds editions"
```

---

### Task 3: Query Cargo, verifica dei campi e fixture reali

**Files:**
- Create: `scripts/pipeline/leaguepedia/queries.ts`, `scripts/pipeline/discover.ts`, `tests/fixtures/leaguepedia/**` (generati)
- Modify: `package.json` (script `"discover": "tsx scripts/pipeline/discover.ts"`)
- Test: `tests/pipeline/queries.test.ts`

**Interfaces:**
- Consumes: `CargoQuery`, `cargoString`, `connectCargo`, `CargoClient` (Task 1).
- Produces:
  ```ts
  // queries.ts: un'interfaccia per tabella, chiavi = alias restituiti da Cargo
  export interface TournamentRow { Name: string; OverviewPage: string; DateStart: string; DateEnd: string; League: string; Region: string }
  export interface MatchRow { MatchId: string; OverviewPage: string; Tab: string; Round: string; DateTimeUTC: string; BestOf: string;
    Team1: string; Team2: string; Team1Score: string; Team2Score: string; Winner: string }   // Winner: "1" | "2" | ""
  export interface GameRow { GameId: string; MatchId: string; NGameInMatch: string; Team1: string; Team2: string; WinTeam: string;
    GamelengthNumber: string; Patch: string; Team1Kills: string; Team2Kills: string; Team1Gold: string; Team2Gold: string;
    Team1Dragons: string; Team2Dragons: string; Team1Barons: string; Team2Barons: string; Team1Towers: string; Team2Towers: string;
    Team1Picks: string; Team2Picks: string; Team1Bans: string; Team2Bans: string }
  export interface PlayerRow { GameId: string; Team: string; Assists: string }
  export interface RenameRow { Date: string; OriginalName: string; NewName: string; Verb: string }
  export interface TeamRow { Name: string; Short: string; Region: string }
  export type QueryDef = Omit<CargoQuery, "limit" | "offset"> & { orderBy: string };
  export function tournamentsQuery(): QueryDef;                  // where: League = "World Championship"
  export function matchesQuery(overviewPages: string[]): QueryDef;  // where: OverviewPage IN (...)
  export function gamesQuery(overviewPages: string[]): QueryDef;
  export function playersQuery(overviewPages: string[]): QueryDef;
  export function renamesQuery(): QueryDef;                      // tutte le righe di TeamRenames
  export function teamsQuery(names: string[]): QueryDef;         // where: Name IN (...)
  export function inList(values: string[]): string;              // "(\"A\",\"B\")" con cargoString
  ```

Campi e alias (formato Cargo `Campo=Alias`; alias solo dove indicato):

| Query | Tabella | Campi | `orderBy` |
|---|---|---|---|
| tournaments | `Tournaments` | `Name, OverviewPage, DateStart, Date=DateEnd, League, Region` | `Tournaments.DateStart, Tournaments.OverviewPage` |
| matches | `MatchSchedule` | `MatchId, OverviewPage, Tab, Round, DateTime_UTC=DateTimeUTC, BestOf, Team1, Team2, Team1Score, Team2Score, Winner` | `MatchSchedule.DateTime_UTC, MatchSchedule.MatchId` |
| games | `ScoreboardGames` | `GameId, MatchId, N_GameInMatch=NGameInMatch, Team1, Team2, WinTeam, Gamelength_Number=GamelengthNumber, Patch, Team1Kills, Team2Kills, Team1Gold, Team2Gold, Team1Dragons, Team2Dragons, Team1Barons, Team2Barons, Team1Towers, Team2Towers, Team1Picks, Team2Picks, Team1Bans, Team2Bans` | `ScoreboardGames.GameId` |
| players | `ScoreboardPlayers` | `GameId, Team, Assists` | `ScoreboardPlayers.GameId, ScoreboardPlayers.Team` |
| renames | `TeamRenames` | `Date, OriginalName, NewName, Verb` | `TeamRenames.Date, TeamRenames.OriginalName` |
| teams | `Teams` | `Name, Short, Region` | `Teams.Name` |

Convenzione Leaguepedia: in `ScoreboardGames`, `Team1` è il lato blu.

`discover.ts` (rete, eseguito a mano):
1. Per ogni tabella usata: `GET {LEAGUEPEDIA_API}?action=cargofields&table=<T>&format=json`; risposta attesa `{ cargofields: { <campo>: { type } } }`. Salva `tests/fixtures/leaguepedia/fields.json` come `{ <tabella>: { <campo>: <type> } }`.
2. Esegue `tournamentsQuery()` e salva `tests/fixtures/leaguepedia/tournaments.json` (tutte le righe).
3. Per le edizioni 2026 e 2013 (pagine raggruppate per anno di `DateStart`): esegue matches, games, players. Salva in `tests/fixtures/leaguepedia/worlds-<year>/` le prime 4 partite per data, i loro game e le righe giocatore di quei game (`matches.json`, `games.json`, `players.json`).
4. Esegue `renamesQuery()`. Salva `renames.json` con le sole righe in cui `OriginalName` o `NewName` compare nelle fixture, più tutte quelle con `T1` o `SK Telecom` nel nome (filtro usato solo per le fixture di test, non dalla pipeline). Salva `rename-verbs.json` con i valori distinti di `Verb` e il loro conteggio.
5. Stampa un riepilogo: righe per query, anni trovati, verbi distinti.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const defs = [tournamentsQuery(), matchesQuery(["P"]), gamesQuery(["P"]), playersQuery(["P"]), renamesQuery(), teamsQuery(["X"])];

test("every field with an underscore has an alias without underscores", () => {
  for (const d of defs) for (const f of d.fields.split(",").map((s) => s.trim())) {
    const [name, alias] = f.split("=");
    if (name!.includes("_")) expect(alias, `${d.tables}.${name}`).toMatch(/^[A-Za-z0-9]+$/);
  }
});
test("inList quotes and escapes values", () => {
  expect(inList(['A', 'B "C"'])).toBe('("A","B \\"C\\"")');
});
test("matchesQuery filters by overview pages", () => {
  expect(matchesQuery(["2026 Season World Championship/Main Event"]).where)
    .toBe('MatchSchedule.OverviewPage IN ("2026 Season World Championship/Main Event")');
});
test("every queried field exists in the real Cargo schema", async () => {
  const fields = JSON.parse(await readFile("tests/fixtures/leaguepedia/fields.json", "utf8"));
  for (const d of defs) for (const f of d.fields.split(",").map((s) => s.trim())) {
    const name = f.split("=")[0]!;
    expect(Object.keys(fields[d.tables] ?? {}), `${d.tables}.${name}`).toContain(name);
  }
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/queries.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `queries.ts` e `discover.ts`; eseguire la verifica dei campi**

Run: `npm run discover`
Expected: fixture scritte; riepilogo con 2026 e 2013 tra gli anni trovati. Per 2026 le pagine attese sono `2026 Season World Championship`, `.../Play-In`, `.../Main Event`.

- [ ] **Step 4: Verificare i test sui campi reali**

Run: `npx vitest run tests/pipeline/queries.test.ts`
Expected: PASS. Se un campo non esiste, correggere il nome in `queries.ts` usando `fields.json` e rieseguire gli Step 3–4. Annotare la correzione nel messaggio di commit.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/leaguepedia scripts/pipeline/discover.ts tests/pipeline/queries.test.ts tests/fixtures/leaguepedia package.json
git commit -m "feat(pipeline): add typed Cargo queries and verify fields against Leaguepedia"
```

---

### Task 4: Identità delle squadre

**Files:**
- Create: `scripts/pipeline/teams/identity.ts`
- Test: `tests/pipeline/identity.test.ts`

**Interfaces:**
- Consumes: `RenameRow`, `TeamRow` (Task 3); `Team`, `TeamId` (Task 2); `TeamOverrides` (definito qui, riusato dal Task 6).
- Produces:
  ```ts
  export interface TeamOverrides { merge: { from: string; into: string }[] }
  export interface TeamIdentity {
    resolve(name: string): TeamId | null;   // null per "", "TBD", "TBA"
    teams(): Team[];                         // ordinate per id
  }
  export function slugify(name: string): string;
  export function isSameOrgVerb(verb: string): boolean;
  export function buildTeamIdentity(renames: RenameRow[], teamRows: TeamRow[], namesInUse: string[], overrides: TeamOverrides): TeamIdentity;
  ```

Regole:
- `slugify`: NFKD, rimozione dei diacritici, minuscolo, ogni sequenza non alfanumerica diventa `-`, trattini iniziali e finali rimossi.
- `isSameOrgVerb(verb)`: vero se `verb` contiene `rename` e non contiene `acquir`, `slot`, `sold`, `purchas` (senza distinzione tra maiuscole e minuscole). Verificare i verbi reali in `tests/fixtures/leaguepedia/rename-verbs.json` (Task 3). Se compaiono verbi di rinomina diversi (es. `rebrand`), aggiungerli alla regola con un test.
- Archi: `OriginalName → NewName` per le righe con `isSameOrgVerb`, più gli archi `from → into` degli override. Se un nome ha più archi, vale quello con `Date` più recente; l'override vince sempre.
- `resolve`: segue gli archi fino al nome terminale, con protezione dai cicli (si ferma al primo nome già visitato). L'ID è `slugify(terminale)`.
- Collisione: due terminali diversi con lo stesso slug → il secondo, in ordine alfabetico, riceve il suffisso `-<slugify(region)>`. Senza regione, il suffisso è `-2`.
- `teams()`: una squadra per ID tra quelle raggiunte da `namesInUse`. `name` = terminale; `aliases` = nomi di `namesInUse` e della catena che portano a quell'ID, ordinati; `short` e `region` dalla `TeamRow` del terminale, altrimenti da quella dell'alias più recente presente.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const r = (OriginalName: string, NewName: string, Verb: string, Date = "2020-01-01"): RenameRow => ({ OriginalName, NewName, Verb, Date });

test("slugify strips diacritics and punctuation", () => {
  expect(slugify("Gen.G")).toBe("gen-g");
  expect(slugify("Team Liquid Honda")).toBe("team-liquid-honda");
  expect(slugify("Fünatic  Esports!")).toBe("funatic-esports");
});
test("a renamed team keeps the same id across names", () => {
  const id = buildTeamIdentity([r("SK Telecom T1", "T1", "rename", "2019-10-29")], [{ Name: "T1", Short: "T1", Region: "Korea" }], ["SK Telecom T1", "T1"], { merge: [] });
  expect(id.resolve("SK Telecom T1")).toBe("t1");
  expect(id.resolve("T1")).toBe("t1");
  expect(id.teams()).toEqual([{ id: "t1", name: "T1", short: "T1", region: "Korea", aliases: ["SK Telecom T1", "T1"] }]);
});
test("an acquired slot is a different team", () => {
  const id = buildTeamIdentity([r("Old Org", "New Org", "acquire")], [], ["Old Org", "New Org"], { merge: [] });
  expect(id.resolve("Old Org")).toBe("old-org");
  expect(id.resolve("New Org")).toBe("new-org");
});
test("chains are followed and cycles do not loop", () => {
  const id = buildTeamIdentity([r("A", "B", "rename", "2018-01-01"), r("B", "C", "rename", "2019-01-01"), r("C", "A", "rename", "2017-01-01")], [], ["A"], { merge: [] });
  expect(["a", "b", "c"]).toContain(id.resolve("A"));
});
test("merge override forces two names into one team", () => {
  const id = buildTeamIdentity([], [], ["Fnatic", "Fnatic Academy"], { merge: [{ from: "Fnatic Academy", into: "Fnatic" }] });
  expect(id.resolve("Fnatic Academy")).toBe("fnatic");
});
test("TBD placeholders resolve to null", () => {
  const id = buildTeamIdentity([], [], [], { merge: [] });
  expect(id.resolve("TBD")).toBeNull();
  expect(id.resolve("")).toBeNull();
});
test("slug collisions get a region suffix", () => {
  const id = buildTeamIdentity([], [{ Name: "Team X", Short: "", Region: "Europe" }, { Name: "Team-X", Short: "", Region: "Korea" }], ["Team X", "Team-X"], { merge: [] });
  expect(new Set([id.resolve("Team X"), id.resolve("Team-X")])).toEqual(new Set(["team-x", "team-x-korea"]));
});
test("isSameOrgVerb accepts the real rename verbs from Leaguepedia", async () => {
  const verbs: Record<string, number> = JSON.parse(await readFile("tests/fixtures/leaguepedia/rename-verbs.json", "utf8"));
  expect(Object.keys(verbs).some(isSameOrgVerb)).toBe(true);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/identity.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `identity.ts`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/pipeline/identity.test.ts; npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/teams tests/pipeline/identity.test.ts
git commit -m "feat(pipeline): resolve team identity through Leaguepedia rename chains"
```

---

### Task 5: Normalizzazione di un'edizione

**Files:**
- Create: `scripts/pipeline/worlds/normalize.ts`, `scripts/pipeline/worlds/apply-overrides.ts`
- Test: `tests/pipeline/normalize.test.ts`, `tests/pipeline/apply-overrides.test.ts`

**Interfaces:**
- Consumes: `TournamentRow`, `MatchRow`, `GameRow`, `PlayerRow` (Task 3); `TeamIdentity`, `slugify` (Task 4); `Edition`, `Stage`, `Match`, `Game`, `StageType`, `EditionStatus`, `EditionSchema` (Task 2).
- Produces:
  ```ts
  // apply-overrides.ts
  export interface EditionOverrides {
    stages: Record<string, { name?: string; type?: StageType }>;        // chiave "<year>/<stageId>"
    matches: Record<string, { score1?: number; score2?: number; winner?: string | null; date?: string }>;  // chiave MatchId; winner = TeamId
  }
  export function applyEditionOverrides(edition: Edition, o: EditionOverrides): Edition;  // pura, non muta l'input
  // normalize.ts
  export interface EditionInput { year: number; tournaments: TournamentRow[]; matches: MatchRow[]; games: GameRow[]; players: PlayerRow[] }
  export function normalizeEdition(input: EditionInput, identity: TeamIdentity, overrides: EditionOverrides, now: Date): Edition;
  export function editionYear(row: TournamentRow): number;          // anno di DateStart
  export function stageNameOf(row: MatchRow): string;               // Tab; se vuoto, parte di OverviewPage dopo l'ultimo "/"; se assente, "Main Event"
  export function inferStageType(name: string): StageType;
  export function editionStatus(edition: Pick<Edition, "stages" | "startDate" | "endDate">, now: Date): EditionStatus;
  export function championOf(edition: Pick<Edition, "stages" | "status">): TeamId | null;
  export function parseList(value: string): string[];               // "A, B,,C" → ["A","B","C"]
  export function orphanGameIds(input: EditionInput): string[];     // GameId dei game il cui MatchId non è tra le partite; usato dall'ingest per i warnings
  ```

Regole:
- `name` = `"Worlds <year>"`. `overviewPages` = `OverviewPage` delle righe torneo, ordinate. `startDate` = minimo `DateStart`; `endDate` = massimo `DateEnd`; omessi se vuoti.
- Fasi: raggruppare le partite per `stageNameOf`. `id` = `slugify(nome)`; `order` per data della prima partita; `type` = `inferStageType(nome)`.
- `inferStageType` (prima regola che corrisponde, senza distinzione tra maiuscole e minuscole): `play-in` → `play-in`; `swiss` → `swiss`; `group` → `groups`; `knockout|playoff|bracket|elimination|quarterfinal|semifinal|final` → `single-elimination`; altrimenti `other`.
- Partita: `team1`/`team2` via `identity.resolve`; `score` = intero o `null` se vuoto; `winner` = squadra del lato indicato da `Winner` (`"1"`/`"2"`), altrimenti `null`; `date` = `DateTimeUTC` in ISO con `Z` (il formato Cargo è `YYYY-MM-DD HH:MM:SS`, UTC); `bestOf` intero o assente; `round` = `Round` o assente.
- Game: collegati alla partita tramite `MatchId`; `number` = `NGameInMatch`; `blue` = Team1, `red` = Team2; `winner` = `"blue"` se `WinTeam === Team1`, altrimenti `"red"`; `durationSec` = `Math.round(GamelengthNumber * 60)`; `deaths` di un lato = kill dell'altro lato; `assists` = somma degli `Assists` delle righe giocatore con lo stesso `GameId` e `Team`, omesso se non ci sono righe; numeri vuoti → campo omesso; `picks`/`bans` con `parseList`. I game senza partita corrispondente sono scartati. Il warning relativo è prodotto dall'ingest (Task 8): qui basta escluderli.
- `coverage.matches` = almeno una partita; `coverage.games` = almeno un game.
- Ordine: override (`applyEditionOverrides`) → `editionStatus` → `championOf` → validazione con `EditionSchema.parse`.
- `editionStatus`: `completed` se ci sono partite, tutte hanno `winner` ed `endDate` (se presente) è prima di `now`; `ongoing` se almeno una partita ha `winner`, oppure `startDate ≤ now`; altrimenti `upcoming`.
- `championOf`: solo se `completed`, il `winner` della partita con `date` più recente; altrimenti `null`.
- `applyEditionOverrides`: per ogni fase con chiave `<year>/<id>` sostituisce `name` e/o `type`, senza cambiare `id`; per ogni partita con override sostituisce solo i campi presenti. Le chiavi senza corrispondenza vengono ignorate.

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/pipeline/apply-overrides.test.ts`:

```ts
test("stage override changes type and name but not id", () => {
  const out = applyEditionOverrides(edition2026WithStage("swiss-stage", "other"), { stages: { "2026/swiss-stage": { type: "swiss", name: "Swiss Stage" } }, matches: {} });
  expect(out.stages[0]).toMatchObject({ id: "swiss-stage", type: "swiss", name: "Swiss Stage" });
});
test("match override patches only given fields and does not mutate input", () => {
  const input = edition2026WithMatch({ id: "m1", score1: 1, score2: 2, winner: "geng" });
  const out = applyEditionOverrides(input, { stages: {}, matches: { m1: { score1: 3, winner: "t1" } } });
  expect(out.stages[0]!.matches[0]).toMatchObject({ score1: 3, score2: 2, winner: "t1" });
  expect(input.stages[0]!.matches[0]!.score1).toBe(1);
});
```

`tests/pipeline/normalize.test.ts`, su dati sintetici (helper `match(...)`, `game(...)`, `identity` con `buildTeamIdentity([], [], names, { merge: [] })`, `now = new Date("2026-11-19T00:00:00Z")`):

```ts
test("inferStageType maps known stage names", () => {
  expect(inferStageType("Play-In")).toBe("play-in");
  expect(inferStageType("Swiss Stage")).toBe("swiss");
  expect(inferStageType("Group A")).toBe("groups");
  expect(inferStageType("Knockout Stage")).toBe("single-elimination");
  expect(inferStageType("Finals")).toBe("single-elimination");
  expect(inferStageType("Tiebreakers")).toBe("other");
});
test("stageNameOf falls back to the overview page suffix", () => {
  expect(stageNameOf({ ...emptyMatch, Tab: "", OverviewPage: "2026 Season World Championship/Play-In" })).toBe("Play-In");
  expect(stageNameOf({ ...emptyMatch, Tab: "", OverviewPage: "2013 Season World Championship" })).toBe("Main Event");
});
test("TBD match without scores normalizes to nulls and keeps the edition ongoing", () => {
  const e = normalizeEdition(input({ matches: [match({ Team1: "TBD", Team2: "TBD", Team1Score: "", Team2Score: "", Winner: "" }), match({ MatchId: "m0", Winner: "1" })] }), identity, noOverrides, now);
  const tbd = e.stages.flatMap((s) => s.matches).find((m) => m.team1 === null)!;
  expect(tbd).toMatchObject({ team2: null, score1: null, score2: null, winner: null });
  expect(e.status).toBe("ongoing");
  expect(e.champion).toBeNull();
});
test("game sides, deaths, assists and duration are derived", () => {
  const e = normalizeEdition(input({
    matches: [match({ MatchId: "m1", Team1: "T1", Team2: "Gen.G", Winner: "1", Team1Score: "1", Team2Score: "0" })],
    games: [game({ GameId: "g1", MatchId: "m1", Team1: "T1", Team2: "Gen.G", WinTeam: "T1", Team1Kills: "15", Team2Kills: "4", GamelengthNumber: "33.2167", Team1Picks: "Ahri, Vi" })],
    players: [{ GameId: "g1", Team: "T1", Assists: "10" }, { GameId: "g1", Team: "T1", Assists: "12" }],
  }), identity, noOverrides, now);
  const g = e.stages[0]!.matches[0]!.games[0]!;
  expect(g).toMatchObject({ number: 1, winner: "blue", durationSec: 1993 });
  expect(g.blue).toMatchObject({ team: "t1", kills: 15, deaths: 4, assists: 22, picks: ["Ahri", "Vi"] });
  expect(g.red).toMatchObject({ team: "gen-g", kills: 4, deaths: 15 });
  expect(g.red.assists).toBeUndefined();
});
test("completed edition gets the winner of the last match as champion", () => {
  const e = normalizeEdition(input({ endDate: "2026-11-09", matches: [match({ MatchId: "a", DateTimeUTC: "2026-11-01 10:00:00", Winner: "2" }), match({ MatchId: "final", DateTimeUTC: "2026-11-09 08:00:00", Team1: "T1", Team2: "Gen.G", Winner: "1" })] }), identity, noOverrides, now);
  expect(e.status).toBe("completed");
  expect(e.champion).toBe("t1");
});
test("edition without matches is upcoming with empty coverage", () => {
  const e = normalizeEdition(input({ startDate: "2027-10-01", matches: [] }), identity, noOverrides, now);
  expect(e).toMatchObject({ status: "upcoming", coverage: { matches: false, games: false }, stages: [] });
});
test("orphanGameIds lists games whose match is missing", () => {
  expect(orphanGameIds(input({ matches: [match({ MatchId: "m1" })], games: [game({ GameId: "g1", MatchId: "m1" }), game({ GameId: "g2", MatchId: "zz" })] }))).toEqual(["g2"]);
});
test("real Worlds 2026 fixture normalizes into a valid edition", async () => {
  const e = normalizeEdition(await loadFixtureInput(2026), identityFromFixtures(), noOverrides, now);
  expect(EditionSchema.safeParse(e).success).toBe(true);
  for (const m of e.stages.flatMap((s) => s.matches)) {
    expect(m.games.map((g) => g.number)).toEqual(m.games.map((_, i) => i + 1));
    for (const g of m.games) expect([m.team1, m.team2]).toContain(g.blue.team);
  }
});
```

`loadFixtureInput(year)` legge `tests/fixtures/leaguepedia/tournaments.json` (righe di quell'anno) e `worlds-<year>/*.json`. `identityFromFixtures()` usa `renames.json` e i nomi presenti nelle fixture.

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/normalize.test.ts tests/pipeline/apply-overrides.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare `apply-overrides.ts` e `normalize.ts`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/pipeline/normalize.test.ts tests/pipeline/apply-overrides.test.ts; npx tsc --noEmit`
Expected: PASS. Se il test sulla fixture 2026 fallisce per dati di forma inattesa: correggere la regola, aggiungere un test sintetico con quella forma, annotarlo nel commit.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/worlds tests/pipeline/normalize.test.ts tests/pipeline/apply-overrides.test.ts
git commit -m "feat(pipeline): normalize Leaguepedia rows into Worlds editions"
```

---

### Task 6: Override manuali

**Files:**
- Create: `scripts/pipeline/overrides.ts`, `data/overrides/editions.json`, `data/overrides/teams.json`, `data/overrides/stages.json`, `data/overrides/matches.json`
- Test: `tests/pipeline/overrides.test.ts`

**Interfaces:**
- Consumes: `StageTypeSchema`, `TeamIdSchema` (Task 2); `TeamOverrides` (Task 4); `EditionOverrides` (Task 5).
- Produces:
  ```ts
  export interface Overrides { editions: { exclude: string[] }; teams: TeamOverrides; edition: EditionOverrides }
  export const OverridesFilesSchema: { editions: ZodType; teams: ZodType; stages: ZodType; matches: ZodType };
  export function loadOverrides(dir?: string): Promise<Overrides>;     // default "data/overrides"; file mancante = vuoto; file non valido = errore con nome del file
  ```

Contenuto iniziale dei file: `editions.json` = `{ "exclude": [] }`, `teams.json` = `{ "merge": [] }`, `stages.json` = `{}`, `matches.json` = `{}`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("loadOverrides returns empty overrides for a missing directory", async () => {
  expect(await loadOverrides("does/not/exist")).toEqual({ editions: { exclude: [] }, teams: { merge: [] }, edition: { stages: {}, matches: {} } });
});
test("loadOverrides names the invalid file", async () => {
  // directory temporanea con stages.json = {"2026/x": {"type": "bogus"}}
  await expect(loadOverrides(tmpDir)).rejects.toThrow(/stages\.json/);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/overrides.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `overrides.ts` e creare i file iniziali**

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/overrides.ts data/overrides tests/pipeline/overrides.test.ts
git commit -m "feat(pipeline): load and validate manual override files"
```

---

### Task 7: Archivio JSON deterministico

**Files:**
- Create: `scripts/pipeline/store.ts`, `.gitattributes`
- Test: `tests/pipeline/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const DATA_DIR = "data";
  export function editionPath(year: number): string;   // "data/worlds/<year>.json"
  export const TEAMS_PATH: string;                     // "data/teams.json"
  export function stableStringify(value: unknown): string;   // chiavi ordinate ricorsivamente, 2 spazi, "\n" finale; omette undefined
  export function writeIfChanged(path: string, value: unknown): Promise<boolean>;  // crea le cartelle; true se ha scritto
  export function readJson<T>(path: string, schema: ZodType<T>): Promise<T | null>; // null se il file manca; errore se non valida
  ```

`.gitattributes`: `* text=auto eol=lf`. Su Windows, senza questa regola, `autocrlf` produce CRLF nei file estratti. `writeIfChanged` vede ogni file come cambiato e lo riscrive.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("stableStringify is independent of key order and omits undefined", () => {
  expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(stableStringify({ a: { d: 2 }, b: 1 }));
  expect(stableStringify({ a: 1 })).toBe('{\n  "a": 1\n}\n');
});
test("writeIfChanged skips identical content", async () => {
  const p = join(tmp, "x/y.json");
  expect(await writeIfChanged(p, { a: 1, b: 2 })).toBe(true);
  expect(await writeIfChanged(p, { b: 2, a: 1 })).toBe(false);
  expect(await writeIfChanged(p, { a: 1, b: 3 })).toBe(true);
});
test("readJson returns null for a missing file and throws on invalid data", async () => {
  expect(await readJson(join(tmp, "missing.json"), TeamsFileSchema)).toBeNull();
  await writeFile(join(tmp, "bad.json"), '{"teams":[{"id":"Bad Id"}]}');
  await expect(readJson(join(tmp, "bad.json"), TeamsFileSchema)).rejects.toThrow();
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/store.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `store.ts`, creare `.gitattributes` e rinormalizzare**

Run: `git add --renormalize .`
Expected: nessun errore; `git status` mostra al massimo file con sole differenze di fine riga.

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pipeline/store.ts tests/pipeline/store.test.ts .gitattributes
git add --renormalize .
git commit -m "feat(pipeline): add deterministic JSON store and enforce LF line endings"
```

---

### Task 8: Ingest incrementale e primo popolamento dei dati

**Files:**
- Create: `scripts/pipeline/ingest.ts`, `data/README.md`, `tests/data/integrity.test.ts`, `data/worlds/*.json`, `data/teams.json` (generati)
- Modify: `package.json` (script `"ingest": "tsx scripts/pipeline/ingest.ts"`)
- Test: `tests/pipeline/ingest.test.ts`

**Interfaces:**
- Consumes: `connectCargo`, `CargoClient` (Task 1); query e tipi delle righe (Task 3); `buildTeamIdentity`, `TeamIdentity` (Task 4); `normalizeEdition`, `editionYear` (Task 5); `loadOverrides`, `Overrides` (Task 6); `writeIfChanged`, `readJson`, `editionPath`, `TEAMS_PATH` (Task 7); `EditionSchema`, `TeamsFileSchema`, `Team` (Task 2).
- Produces:
  ```ts
  export interface IngestOptions { full: boolean; years?: number[]; now: Date }
  export interface IngestIO {
    readEdition(year: number): Promise<Edition | null>;
    readTeams(): Promise<Team[]>;
    write(path: string, value: unknown): Promise<boolean>;
    log(message: string): void;
  }
  export interface IngestResult { written: string[]; fetchedYears: number[]; skippedYears: number[]; warnings: string[] }
  export function ingest(client: CargoClient, overrides: Overrides, opts: IngestOptions, io: IngestIO): Promise<IngestResult>;
  export function needsFullRebuild(stored: Team[], identity: TeamIdentity): boolean;
  export function parseIngestArgs(argv: string[]): Pick<IngestOptions, "full" | "years">;  // --full, --year 2026[,2025]
  ```

Flusso di `ingest`:
1. `tournamentsQuery()`. Escludere le `OverviewPage` in `overrides.editions.exclude`. Raggruppare per `editionYear`.
2. Anni da scaricare: con `years`, solo quelli. Altrimenti con `full`, tutti. Altrimenti gli anni la cui edizione salvata manca o non è `completed`.
3. Per ogni anno da scaricare: `matchesQuery`, `gamesQuery`, `playersQuery` sulle sue pagine.
4. `renamesQuery()` (sempre). `namesInUse` = squadre delle righe scaricate + `aliases` delle squadre salvate. `teamsQuery(namesInUse)` a blocchi di 50 nomi.
5. `buildTeamIdentity(...)`. Se `needsFullRebuild(storedTeams, identity)` e non era già `full`: log del motivo e ripetizione dai passi 2–4 con `full = true`.
6. Normalizzare le edizioni scaricate con `opts.now`.
7. **Solo dopo che tutte le richieste sono riuscite**, scrivere con `io.write` le edizioni scaricate e `data/teams.json` (`{ teams: identity.teams() }`, unite alle squadre salvate non più in uso: un'edizione saltata può ancora riferirle).
8. `warnings`: game scartati perché senza partita (`orphanGameIds`, Task 5), anni senza partite.

`needsFullRebuild`: vero se per almeno una squadra salvata `identity.resolve(alias)` restituisce un ID diverso dal suo `id`, per almeno uno dei suoi `aliases`.

CLI (`main`, protetta come in `scripts/spike/run-all.ts`): `connectCargo` con `httpRequest`/`sleep`/env, `loadOverrides()`, IO reale con `readJson` e `writeIfChanged`, `now = new Date()`. Stampa il riepilogo. Exit code 1 se `ingest` lancia un'eccezione.

- [ ] **Step 1: Scrivere i test che falliscono**

Client finto: una mappa da `tables` alle righe restituite, con contatore delle chiamate; IO in memoria.

```ts
test("skips completed editions already stored unless full", async () => {
  const io = memoryIO({ editions: { 2025: completedEdition(2025) } });
  const res = await ingest(fakeClient(twoEditions2025and2026), noOverrides, { full: false, now }, io);
  expect(res.fetchedYears).toEqual([2026]);
  expect(res.skippedYears).toEqual([2025]);
});
test("fetches everything with --full", async () => {
  const res = await ingest(fakeClient(twoEditions2025and2026), noOverrides, { full: true, now }, memoryIO({}));
  expect(res.fetchedYears).toEqual([2025, 2026]);
});
test("writes nothing when a request fails midway", async () => {
  const io = memoryIO({});
  await expect(ingest(fakeClient(twoEditions2025and2026, { failOn: "ScoreboardGames" }), noOverrides, { full: true, now }, io)).rejects.toThrow();
  expect(io.writes).toEqual([]);
});
test("a rename after storage triggers a full rebuild", async () => {
  const io = memoryIO({ editions: { 2025: completedEdition(2025) }, teams: [{ id: "old-name", name: "Old Name", aliases: ["Old Name"] }] });
  const res = await ingest(fakeClient({ ...twoEditions2025and2026, renames: [{ Date: "2026-11-01", OriginalName: "Old Name", NewName: "New Name", Verb: "rename" }] }), noOverrides, { full: false, now }, io);
  expect(res.fetchedYears).toEqual([2025, 2026]);
});
test("excluded overview pages are ignored", async () => {
  const res = await ingest(fakeClient(twoEditions2025and2026), { ...noOverrides, editions: { exclude: ["2025 Season World Championship"] } }, { full: true, now }, memoryIO({}));
  expect(res.fetchedYears).toEqual([2026]);
});
test("parseIngestArgs reads --full and --year", () => {
  expect(parseIngestArgs(["--full", "--year", "2026,2025"])).toEqual({ full: true, years: [2026, 2025] });
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/pipeline/ingest.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `ingest.ts`**

- [ ] **Step 4: Verificare i test**

Run: `npx vitest run; npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Primo popolamento reale (rete, alcuni minuti)**

Run: `npm run ingest -- --full`
Expected: file `data/worlds/<year>.json` per ogni edizione trovata (attese 2011–2026, più 2027 se Leaguepedia ha già la pagina) e `data/teams.json`. Riepilogo senza eccezioni. Leggere i `warnings`. Se compaiono fasi `other` o squadre duplicate, aggiungere override e rieseguire.

- [ ] **Step 6: Seconda esecuzione: nessuna scrittura**

Run: `npm run ingest; git status --short data`
Expected: `written` vuoto; `git status` non mostra modifiche sotto `data/`.

- [ ] **Step 7: Test di integrità sui dati salvati**

Creare `tests/data/integrity.test.ts`, che legge `data/` con gli schemi e verifica:

```ts
test("every edition file is valid and named after its year", ...);          // EditionSchema.parse; year === nome file
test("every team id referenced by an edition exists in teams.json", ...);   // team1, team2, winner, champion, blue.team, red.team
test("game sides belong to the match teams", ...);
test("completed matches with games have consistent scores", ...);          // se coverage.games e winner: score1 + score2 === games.length
test("team ids are unique and aliases do not overlap", ...);
test("Worlds 2026 is completed with a champion and 98 games", ...);        // 98 = conteggio incrociato con lo spike livestats
test("SK Telecom T1 and T1 share the same team id", ...);
```

Run: `npx vitest run tests/data/integrity.test.ts`
Expected: PASS. Se il conteggio dei game 2026 è diverso da 98, verificare la causa (es. remake) prima di toccare il test, e documentarla in `data/README.md`.

- [ ] **Step 8: Scrivere `data/README.md` con l'agente `sintetizzatore`**

Contenuto: struttura delle cartelle, significato dei campi principali con rimando agli schemi in `src/data/schema/`, comandi (`npm run ingest`, `--full`, `--year`), uso dei file di override con un esempio per tipo, attribuzione: dati di Leaguepedia (lol.fandom.com) sotto CC BY-SA.

- [ ] **Step 9: Commit**

```bash
git add scripts/pipeline/ingest.ts tests/pipeline/ingest.test.ts tests/data package.json data
git commit -m "feat(pipeline): ingest all Worlds editions from Leaguepedia into versioned JSON"
```

---

## Roadmap aggiornata

Il Piano 2 è stato ristretto ai dati dei Worlds. Leghe e seed passano al nuovo Piano 2b. Gli altri piani restano quelli del documento della Fase 0.

| # | Piano | Contenuto | Dipende da |
|---|---|---|---|
| 2b | Leghe e seed | Stagione corrente delle leghe che qualificano al Worlds (dai dati), risultati, classifiche, seed occupati; spike sui campi Leaguepedia dei seed | 2 |
| 3 | Ingest livestats del Worlds corrente | Fotogrammi `window`/`details` dei game del Worlds corrente, scaricati una volta e compressi; dettaglio per giocatore; collegamento ai game Leaguepedia | 2 |
| 4 | Fondazione del sito e design system Broadcast | Invariato | 2 |
| 5 | Home stagionale | Invariato | 2, 2b, 4 |
| 6–9 | Come nella Fase 0 | Invariati | — |
