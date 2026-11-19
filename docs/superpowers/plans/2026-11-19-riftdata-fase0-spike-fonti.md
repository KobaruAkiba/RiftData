# RiftData — Fase 0: fondazione repo e spike fonti dati — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Creare il repo. Verificare con sonde automatiche le tre fonti dati aperte (§6.4 del documento di progetto). Produrre un report: esito per fonte e decisione conseguente.

**Architecture:** Uno script TypeScript per fonte, eseguito con `tsx`. Dipendenze iniettate (HTTP, attesa, salvataggio campioni): la logica si testa senza rete. Un unico runner esegue le sonde, raccoglie gli esiti, scrive un report Markdown. Il runner gira in locale e su GitHub Actions, dove girerà la pipeline definitiva.

**Tech Stack:** Node 22 LTS, TypeScript (strict, ESM), tsx, Vitest, `fetch` nativo di Node, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-18-riftdata-design.md` (approvato il 2026-11-19). Leggere §6, §8.2, §8.3, §13.

## Perimetro di questo piano

Il documento di progetto (§13.3) impone l'ordine: **spike → conferma fonti o fallback → solo dopo, schema dati**. Questo piano copre solo la Fase 0. I piani successivi (sezione "Roadmap" in fondo) si scrivono dopo il Task 7: il loro contenuto dipende dagli esiti.

## Global Constraints

- Node 22 LTS: `.nvmrc` contiene `22`. Moduli ESM (`"type": "module"`), TypeScript `strict: true`.
- User-Agent di ogni richiesta: `RiftData-bot/0.1 (League of Legends esports fan site data pipeline)`. Nessun nome, email o dato personale.
- Intervallo minimo tra richieste: Leaguepedia 2000 ms; lolesports API e feed livestats 500 ms.
- Credenziali Leaguepedia solo da variabili d'ambiente `LEAGUEPEDIA_BOT_USER` e `LEAGUEPEDIA_BOT_PASSWORD`. Le imposta l'utente nei secrets di GitHub. Mai stampate, mai nei report, mai nel repo, mai richieste in chat.
- `.gitignore` contiene almeno: `node_modules/`, `dist/`, `.env`, `.superpowers/`, `spike-report.md`, `spike-ci/`.
- Ogni messaggio di commit termina con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omessa negli esempi).
- Nei passi di commit, aggiungere i file `spike-samples/*.json` solo se la sonda li ha prodotti.
- Nessuna creazione di repo remoto, push o lancio di workflow senza conferma esplicita dell'utente in chat.
- Campioni salvati in `spike-samples/`: troncati (massimo 3 fotogrammi, 5 righe, 1 evento), ognuno sotto i 200 KB. I campioni Leaguepedia sono CC BY-SA: `spike-samples/README.md` riporta l'attribuzione.
- Costanti delle fonti in un solo modulo (`scripts/lib/sources.ts`). Valori da confermare durante lo spike:
  - `LEAGUEPEDIA_API = "https://lol.fandom.com/api.php"`
  - `LOLESPORTS_API = "https://esports-api.lolesports.com/persisted/gw"`
  - `LOLESPORTS_PUBLIC_KEY = "0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z"` (chiave pubblica del front-end lolesports.com, non un segreto)
  - `WORLDS_LEAGUE_ID = "98767975604431411"`
  - `LIVESTATS_FEED = "https://feed.lolesports.com/livestats/v1"`

## Review Focus

1. **Leaguepedia risponde 200 con un errore nel corpo** (`{"error":{"code":"ratelimited"}}`): l'esito deve essere `rate_limited`, mai `ok`. → test nel Task 3.
2. **Il feed risponde 204 o con corpo vuoto** per game vecchi: copertura `none`, nessun crash sul parsing JSON. → test nel Task 4.
3. **Il feed ha i primi fotogrammi ma non quelli a metà partita**: copertura `partial`, non `full`. → test nel Task 4.
4. **CORS con `Access-Control-Allow-Origin: *` ma senza `x-api-key` nel preflight**: il browser non legge la risposta: esito `allowed: false`. → test nel Task 5.
5. **Una sonda lancia un'eccezione** (DNS, timeout): il report si scrive comunque. Quella sonda in `fail`, le altre con il proprio esito. → test nel Task 2.

---

## File Structure

| File | Responsabilità |
|---|---|
| `package.json`, `tsconfig.json`, `.nvmrc`, `.gitignore` | Fondazione del repo |
| `scripts/lib/http.ts` | Richiesta HTTP con User-Agent, timeout, nessuna eccezione sugli status non-2xx. Riusato dalla pipeline definitiva. |
| `scripts/lib/sources.ts` | Costanti delle fonti (URL, chiave pubblica, ID lega) |
| `scripts/spike/probe.ts` | Tipi comuni delle sonde, `runProbe`, `renderReport` |
| `scripts/spike/run-all.ts` | CLI: esegue le sonde scelte, salva i campioni, scrive il report |
| `scripts/spike/leaguepedia.ts` | Sonda Leaguepedia (query Cargo, classificazione risposta) |
| `scripts/spike/leaguepedia-auth.ts` | Login con bot password Fandom (usato solo se l'accesso anonimo fallisce) |
| `scripts/spike/livestats.ts` | Sonda profondità storica del feed livestats |
| `scripts/spike/cors.ts` | Sonda CORS del calendario lolesports |
| `scripts/spike/cors-check.html` | Conferma CORS da un browser reale |
| `.github/workflows/spike.yml` | Esecuzione delle sonde da GitHub Actions |
| `tests/**` | Test Vitest, uno per modulo |
| `docs/superpowers/spikes/2026-11-19-data-sources-report.md` | Report finale dello spike |

---

### Task 1: Fondazione repo e client HTTP

**Files:**
- Create: `.gitignore`, `.nvmrc`, `package.json`, `tsconfig.json`, `scripts/lib/http.ts`, `scripts/lib/sources.ts`
- Test: `tests/lib/http.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // scripts/lib/http.ts
  export const USER_AGENT: string; // valore dai Global Constraints
  export interface HttpInit { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }
  export interface HttpResult { status: number; headers: Record<string, string>; setCookie: string[]; text: string }
  export function httpRequest(url: string, init?: HttpInit): Promise<HttpResult>;
  export function sleep(ms: number): Promise<void>;
  // scripts/lib/sources.ts: le cinque costanti dei Global Constraints
  ```
- `httpRequest`: chiavi di `headers` in minuscolo; `setCookie` da `response.headers.getSetCookie()`; timeout predefinito 15000 ms via `AbortSignal.timeout`; non lancia su status non-2xx; lancia solo su errore di rete o timeout. Aggiunge sempre `user-agent: USER_AGENT`.

- [ ] **Step 1: Inizializzare il repo**

```bash
git init
npm init -y
npm install -D typescript tsx vitest @types/node
```

In `package.json`: `"type": "module"`, `"private": true`, script `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`, `"spike": "tsx scripts/spike/run-all.ts"`. `.nvmrc` = `22`. `tsconfig.json`: `strict`, `module`/`moduleResolution` = `NodeNext`, `target` = `ES2023`, `noEmit`, `include: ["scripts", "tests"]`. `.gitignore` come nei Global Constraints.

- [ ] **Step 2: Scrivere il test che fallisce**

Il test avvia un server locale con `node:http` (porta 0) e verifica:

```ts
test("returns non-2xx status without throwing", async () => {
  const res = await httpRequest(`${base}/missing`); // il server risponde 404 "nope"
  expect(res.status).toBe(404);
  expect(res.text).toBe("nope");
});
test("sends the generic User-Agent", async () => {
  await httpRequest(`${base}/echo-ua`);
  expect(lastRequestHeaders["user-agent"]).toBe(USER_AGENT);
  expect(USER_AGENT).not.toMatch(/@/);
});
test("lowercases headers and collects set-cookie", async () => {
  const res = await httpRequest(`${base}/cookies`); // Set-Cookie: a=1; Path=/  e  b=2; Path=/ ; X-Custom: v
  expect(res.headers["x-custom"]).toBe("v");
  expect(res.setCookie).toHaveLength(2);
});
test("rejects on timeout", async () => {
  await expect(httpRequest(`${base}/slow`, { timeoutMs: 50 })).rejects.toThrow(); // il server non risponde per 500 ms
});
```

- [ ] **Step 3: Verificare che fallisca**

Run: `npx vitest run tests/lib/http.test.ts`
Expected: FAIL, modulo `scripts/lib/http.ts` inesistente.

- [ ] **Step 4: Implementare `httpRequest`, `sleep` e `sources.ts`**

- [ ] **Step 5: Verificare che passi**

Run: `npx vitest run tests/lib/http.test.ts; npm run typecheck`
Expected: 4 test PASS; typecheck senza errori.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .nvmrc package.json package-lock.json tsconfig.json scripts/lib tests/lib
git commit -m "chore: bootstrap repo with TypeScript tooling and HTTP client"
```

Verificare prima del commit: `git status` non mostra `.superpowers/`.

---

### Task 2: Infrastruttura delle sonde e runner

**Files:**
- Create: `scripts/spike/probe.ts`, `scripts/spike/run-all.ts`, `spike-samples/README.md`
- Test: `tests/spike/probe.test.ts`

**Interfaces:**
- Consumes: `httpRequest`, `sleep`, `HttpInit`, `HttpResult` (Task 1).
- Produces:
  ```ts
  // scripts/spike/probe.ts
  export type ProbeId = "leaguepedia" | "livestats" | "cors";
  export type Verdict = "ok" | "partial" | "blocked" | "fail";
  export interface ProbeOutcome { verdict: Verdict; summary: string; details: string[] }
  export interface ProbeResult extends ProbeOutcome { id: ProbeId; question: string }
  export interface ProbeDeps {
    http: (url: string, init?: HttpInit) => Promise<HttpResult>;
    sleep: (ms: number) => Promise<void>;
    saveSample: (name: string, data: unknown) => Promise<void>; // scrive spike-samples/<name>.json
    env: { leaguepediaUser?: string; leaguepediaPassword?: string };
  }
  export interface ProbeDefinition { id: ProbeId; question: string; run: (deps: ProbeDeps) => Promise<ProbeOutcome> }
  export function runProbe(def: ProbeDefinition, deps: ProbeDeps): Promise<ProbeResult>;
  export function renderReport(results: ProbeResult[], generatedAt: Date): string;
  ```
- `runProbe`: intercetta ogni eccezione. Restituisce `verdict: "fail"`, con `summary` uguale al messaggio dell'errore.
- `renderReport`: titolo `# RiftData — Spike fonti dati`, riga con data ISO, tabella `| Sonda | Domanda | Esito | Sintesi |`, poi una sezione `## <id>` per sonda con i `details` in elenco puntato.
- `run-all.ts`: argomenti `--only <id,id>` (default: tutte) e `--out <path>` (default `docs/superpowers/spikes/2026-11-19-data-sources-report.md`). Registro `PROBES: ProbeDefinition[]`, vuoto in questo task, popolato dai Task 3–5. Legge `LEAGUEPEDIA_BOT_USER` / `LEAGUEPEDIA_BOT_PASSWORD` da `process.env`. Esegue le sonde in sequenza, scrive il report e lo stampa. Exit code 0 anche con esiti negativi: lo spike misura, non fallisce.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
test("runProbe turns a thrown error into a fail verdict", async () => {
  const def = { id: "cors", question: "q", run: async () => { throw new Error("getaddrinfo ENOTFOUND") } } as const;
  const r = await runProbe(def, fakeDeps);
  expect(r).toMatchObject({ id: "cors", verdict: "fail", summary: "getaddrinfo ENOTFOUND" });
});
test("renderReport lists every probe, including failed ones", () => {
  const md = renderReport([
    { id: "leaguepedia", question: "A?", verdict: "ok", summary: "fine", details: ["d1"] },
    { id: "cors", question: "B?", verdict: "fail", summary: "boom", details: [] },
  ], new Date("2026-11-19T10:00:00Z"));
  expect(md).toContain("2026-11-19T10:00:00.000Z");
  expect(md).toMatch(/\| leaguepedia \| A\? \| ok \| fine \|/);
  expect(md).toMatch(/\| cors \| B\? \| fail \| boom \|/);
  expect(md).toContain("- d1");
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/spike/probe.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `probe.ts` e `run-all.ts`; scrivere `spike-samples/README.md`**

README: una riga di scopo, poi l'attribuzione: dati Leaguepedia (lol.fandom.com) sotto licenza CC BY-SA (versione indicata nel footer di lol.fandom.com).

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/spike/probe.test.ts; npm run spike -- --out spike-report.md`
Expected: test PASS; il runner scrive `spike-report.md` con la tabella vuota ed esce con codice 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike/probe.ts scripts/spike/run-all.ts spike-samples/README.md tests/spike/probe.test.ts
git commit -m "feat(spike): add probe harness and report runner"
```

---

### Task 3: Sonda Leaguepedia (accesso anonimo e con bot password)

Domanda della sonda: *"Can the pipeline read Leaguepedia Cargo tables (tournaments and per-game scoreboards)?"*

**Files:**
- Create: `scripts/spike/leaguepedia.ts`, `scripts/spike/leaguepedia-auth.ts`
- Modify: `scripts/spike/run-all.ts` (registrare la sonda)
- Test: `tests/spike/leaguepedia.test.ts`, `tests/spike/leaguepedia-auth.test.ts`

**Interfaces:**
- Consumes: `ProbeDeps`, `ProbeDefinition`, `ProbeOutcome` (Task 2); `LEAGUEPEDIA_API` (Task 1).
- Produces:
  ```ts
  // scripts/spike/leaguepedia.ts
  export interface CargoQuery { tables: string; fields: string; where?: string; limit?: number }
  export type CargoOutcome =
    | { kind: "ok"; rows: Record<string, string>[] }
    | { kind: "rate_limited" }
    | { kind: "blocked"; status: number }
    | { kind: "error"; message: string };
  export function buildCargoUrl(q: CargoQuery): string;
  export function classifyCargoResponse(res: HttpResult): CargoOutcome;
  export const leaguepediaProbe: ProbeDefinition;
  // scripts/spike/leaguepedia-auth.ts
  export function cookieHeader(setCookie: string[]): string; // "a=1; b=2", solo la coppia nome=valore
  export function loginWithBotPassword(deps: Pick<ProbeDeps, "http">, user: string, password: string): Promise<string>; // ritorna l'header Cookie; lancia se il login non dà "Success"
  ```

Regole di `classifyCargoResponse`:

| Condizione | Esito |
|---|---|
| status 200, JSON con array `cargoquery` | `ok`, `rows` = `cargoquery[].title` |
| status 200, JSON con `error.code === "ratelimited"`, oppure status 429 | `rate_limited` |
| status 401, 402, 403 | `blocked` |
| corpo non JSON (es. HTML) | `error`, messaggio `"non-JSON response (status N)"` |
| altri casi | `error` con status e `error.info` se presente |

Query della sonda (`format=json`, parametri codificati con `URLSearchParams`):
1. `tables=Tournaments`, `fields=Name,OverviewPage,DateStart,Region`, `where=Name LIKE "%World Championship%" AND DateStart >= "2026-01-01"`, `limit=20`.
2. `tables=ScoreboardGames`, `fields=OverviewPage,Team1,Team2,WinTeam,Gamelength,Team1Dragons,Team2Dragons,Team1Barons,Team2Barons,Team1Picks,Team1Bans`, `where=OverviewPage LIKE "%2026 Season World Championship%"`, `limit=5`.

Se la query 2 dà `error` per un campo sconosciuto: correggere i nomi dei campi su `https://lol.fandom.com/wiki/Special:CargoTables/ScoreboardGames`; annotare la correzione nei `details`.

Flusso della sonda:
1. Query 1 e 2 anonime, con `sleep(2000)` tra le richieste.
2. Se una query dà `blocked` o `rate_limited` e `env` contiene le credenziali: `loginWithBotPassword`, poi ripetere le query con l'header `cookie`.
3. Login: `GET ?action=query&meta=tokens&type=login&format=json` → `query.tokens.logintoken`; poi `POST action=login` con form `lgname`, `lgpassword`, `lgtoken`, `format=json` e i cookie della prima risposta. Successo solo se `login.result === "Success"`.
4. Campioni: `leaguepedia-tournaments` (righe query 1), `leaguepedia-scoreboard` (righe query 2, massimo 5).
5. Esito: `ok` se entrambe le query hanno righe; `partial` se solo la query 1 ha righe; `blocked` se resta `blocked`/`rate_limited`; `fail` per errori. `details` riporta: modalità (anonima / bot), status di ogni richiesta, numero di righe.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const res = (status: number, text: string): HttpResult => ({ status, headers: {}, setCookie: [], text });

test("buildCargoUrl encodes the where clause", () => {
  const url = new URL(buildCargoUrl({ tables: "Tournaments", fields: "Name", where: 'Name LIKE "%Worlds%"', limit: 5 }));
  expect(url.searchParams.get("action")).toBe("cargoquery");
  expect(url.searchParams.get("format")).toBe("json");
  expect(url.searchParams.get("where")).toBe('Name LIKE "%Worlds%"');
  expect(url.searchParams.get("limit")).toBe("5");
});
test("200 with cargoquery rows is ok", () => {
  expect(classifyCargoResponse(res(200, '{"cargoquery":[{"title":{"Name":"X"}}]}')))
    .toEqual({ kind: "ok", rows: [{ Name: "X" }] });
});
test("200 with ratelimited error body is rate_limited, not ok", () => {
  expect(classifyCargoResponse(res(200, '{"error":{"code":"ratelimited","info":"slow down"}}')).kind).toBe("rate_limited");
});
test("402 is blocked", () => {
  expect(classifyCargoResponse(res(402, "Payment Required"))).toEqual({ kind: "blocked", status: 402 });
});
test("HTML body is an error, not a crash", () => {
  expect(classifyCargoResponse(res(200, "<html>captcha</html>")).kind).toBe("error");
});
test("probe falls back to bot login and never leaks the password", async () => {
  // fake http: richieste anonime → 402; token e login → Success; richieste con cookie → righe
  const out = await leaguepediaProbe.run(fakeDeps({ leaguepediaUser: "Bot@spike", leaguepediaPassword: "s3cr3t-pw" }));
  expect(out.verdict).toBe("ok");
  expect(out.details.join("\n")).toMatch(/bot/i);
  expect(JSON.stringify(out)).not.toContain("s3cr3t-pw");
});
test("probe without credentials reports blocked on 402", async () => {
  const out = await leaguepediaProbe.run(fakeDeps({}));
  expect(out.verdict).toBe("blocked");
});
```

`tests/spike/leaguepedia-auth.test.ts`:

```ts
test("cookieHeader keeps only name=value pairs", () => {
  expect(cookieHeader(["a=1; Path=/; HttpOnly", "b=2; Secure"])).toBe("a=1; b=2");
});
test("loginWithBotPassword throws when result is not Success", async () => {
  // fake http: token ok, login → {"login":{"result":"Failed"}}
  await expect(loginWithBotPassword({ http: fakeHttp }, "u", "p")).rejects.toThrow(/Failed/);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/spike/leaguepedia.test.ts tests/spike/leaguepedia-auth.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare i due moduli e registrare `leaguepediaProbe` in `PROBES`**

- [ ] **Step 4: Verificare i test**

Run: `npx vitest run tests/spike; npm run typecheck`
Expected: tutti PASS.

- [ ] **Step 5: Eseguire la sonda reale in locale**

Run: `npm run spike -- --only leaguepedia --out spike-report.md`
Expected: report scritto con un esito qualsiasi (`ok` / `partial` / `blocked` / `fail`); campioni in `spike-samples/` se ci sono righe. Annotare l'esito: il confronto con l'esito di GitHub Actions avviene nel Task 7.

- [ ] **Step 6: Commit**

```bash
git add scripts/spike/leaguepedia.ts scripts/spike/leaguepedia-auth.ts scripts/spike/run-all.ts tests/spike/leaguepedia*.test.ts spike-samples/leaguepedia-*.json
git commit -m "feat(spike): probe Leaguepedia Cargo access with optional bot login"
```

---

### Task 4: Sonda profondità storica del feed livestats

Domanda della sonda: *"How far back does the livestats feed keep frames, and is every Worlds 2026 game recoverable?"*

**Files:**
- Create: `scripts/spike/livestats.ts`
- Modify: `scripts/spike/run-all.ts`
- Test: `tests/spike/livestats.test.ts`

**Interfaces:**
- Consumes: `ProbeDeps`, `ProbeDefinition` (Task 2); `LOLESPORTS_API`, `LOLESPORTS_PUBLIC_KEY`, `WORLDS_LEAGUE_ID`, `LIVESTATS_FEED` (Task 1).
- Produces:
  ```ts
  export type FeedCoverage = "full" | "partial" | "none";
  export interface Tournament { id: string; slug: string; startDate: string }
  export function toStartingTime(d: Date): string;          // arrotonda per difetto a 10 s, ISO senza millisecondi
  export function buildFeedUrl(kind: "window" | "details", gameId: string, startingTime?: string): string;
  export function firstFrameTime(res: HttpResult): Date | null; // frames[0].rfc460Timestamp, null se 204/vuoto/non JSON/frames vuoti
  export function classifyFeed(first: HttpResult, mid: HttpResult | null): FeedCoverage;
  export function pickWorldsTournament(list: Tournament[], year: number): Tournament | undefined;
  export function extractGameIds(completedEvents: unknown): string[];
  export const livestatsProbe: ProbeDefinition;
  ```

Regole:
- `classifyFeed`: `none` se `firstFrameTime(first)` è `null`; `full` se `mid` ha status 200 e almeno un fotogramma; altrimenti `partial`.
- `pickWorldsTournament`: prima scelta, `slug` che contiene `"worlds"` e l'anno; seconda scelta, `startDate` nell'anno.
- `extractGameIds`: percorso `data.schedule.events[].games[].id`, solo game con `state === "completed"`. Confermare il percorso sul primo campione reale. Se diverso: correggerlo e annotare la correzione nei `details`.

Flusso della sonda (header `x-api-key: LOLESPORTS_PUBLIC_KEY` sulle chiamate a `LOLESPORTS_API`):
1. `GET {LOLESPORTS_API}/getTournamentsForLeague?hl=en-US&leagueId={WORLDS_LEAGUE_ID}`.
2. Per ogni anno dal 2019 al 2026: `pickWorldsTournament`, poi `GET {LOLESPORTS_API}/getCompletedEvents?hl=en-US&tournamentId={id}`, poi `extractGameIds`.
3. Game da sondare: per gli anni 2019–2025, il primo e l'ultimo; per il 2026, **tutti**.
4. Per ogni game: `window` senza `startingTime` → `firstFrameTime`; se non è `null`, `window` con `startingTime = toStartingTime(first + 10 min)`; poi `classifyFeed`. `sleep(500)` tra le richieste.
5. Su un game 2026 con copertura `full`: una chiamata `details` allo stesso `startingTime`, per confermare la presenza di `items` e `perkMetadata`.
6. Campioni: `lolesports-completed-events-2026` (primo evento), `livestats-window-2026` (primi 3 fotogrammi), `livestats-details-2026` (primi 3 fotogrammi).
7. `details`: una riga per anno (`2019: full 2/2`, …), più `2026: full X / partial Y / none Z su N`.
8. Esito: `ok` se tutti i game 2026 sono `full`; `partial` se almeno uno è `full` o `partial`; `fail` se sono tutti `none` o se non si trova il torneo 2026.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const res = (status: number, text: string): HttpResult => ({ status, headers: {}, setCookie: [], text });
const frames = (ts: string) => JSON.stringify({ frames: [{ rfc460Timestamp: ts }] });

test("toStartingTime floors to 10 seconds and drops milliseconds", () => {
  expect(toStartingTime(new Date("2026-10-12T08:15:37.912Z"))).toBe("2026-10-12T08:15:30Z");
});
test("buildFeedUrl adds startingTime only when given", () => {
  expect(buildFeedUrl("window", "123")).toBe("https://feed.lolesports.com/livestats/v1/window/123");
  expect(buildFeedUrl("details", "123", "2026-10-12T08:15:30Z"))
    .toBe("https://feed.lolesports.com/livestats/v1/details/123?startingTime=2026-10-12T08%3A15%3A30Z");
});
test("204 or empty body means no coverage, without throwing", () => {
  expect(classifyFeed(res(204, ""), null)).toBe("none");
  expect(classifyFeed(res(200, ""), null)).toBe("none");
  expect(classifyFeed(res(200, '{"frames":[]}'), null)).toBe("none");
});
test("first frames without mid-game frames is partial", () => {
  expect(classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), res(204, ""))).toBe("partial");
});
test("frames at start and mid-game is full", () => {
  expect(classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), res(200, frames("2026-10-12T08:10:00Z")))).toBe("full");
});
test("pickWorldsTournament matches slug, then start year", () => {
  const list = [
    { id: "a", slug: "msi_2026", startDate: "2026-06-27" },
    { id: "b", slug: "worlds_2026", startDate: "2026-09-29" },
    { id: "c", slug: "championship", startDate: "2019-10-02" },
  ];
  expect(pickWorldsTournament(list, 2026)?.id).toBe("b");
  expect(pickWorldsTournament(list, 2019)?.id).toBe("c");
  expect(pickWorldsTournament(list, 2018)).toBeUndefined();
});
test("extractGameIds keeps only completed games", () => {
  const json = { data: { schedule: { events: [{ match: {}, games: [{ id: "g1", state: "completed" }, { id: "g2", state: "unneeded" }] }] } } };
  expect(extractGameIds(json)).toEqual(["g1"]);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/spike/livestats.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `livestats.ts` e registrare `livestatsProbe`**

- [ ] **Step 4: Verificare i test**

Run: `npx vitest run tests/spike; npm run typecheck`
Expected: tutti PASS.

- [ ] **Step 5: Eseguire la sonda reale**

Run: `npm run spike -- --only livestats --out spike-report.md`
Expected: righe per anno nel report; tre campioni in `spike-samples/`, ognuno sotto i 200 KB (`ls -l spike-samples`). Se `extractGameIds` restituisce 0 game: controllare il campione `lolesports-completed-events-2026`, correggere il percorso, aggiungere un test con la struttura reale, rieseguire.

- [ ] **Step 6: Commit**

```bash
git add scripts/spike/livestats.ts scripts/spike/run-all.ts tests/spike/livestats.test.ts spike-samples/lolesports-*.json spike-samples/livestats-*.json
git commit -m "feat(spike): probe livestats feed historical depth"
```

---

### Task 5: Sonda CORS del calendario lolesports

Domanda della sonda: *"Can a visitor's browser read the lolesports schedule directly (CORS with x-api-key)?"*

**Files:**
- Create: `scripts/spike/cors.ts`, `scripts/spike/cors-check.html`
- Modify: `scripts/spike/run-all.ts`
- Test: `tests/spike/cors.test.ts`

**Interfaces:**
- Consumes: `ProbeDeps`, `ProbeDefinition` (Task 2); `LOLESPORTS_API`, `LOLESPORTS_PUBLIC_KEY`, `WORLDS_LEAGUE_ID` (Task 1).
- Produces:
  ```ts
  export const TEST_ORIGIN = "https://riftdata.pages.dev";
  export interface CorsVerdict { allowed: boolean; reason: string }
  export function evaluateCors(preflight: HttpResult, get: HttpResult, origin: string): CorsVerdict;
  export const corsProbe: ProbeDefinition;
  ```

`evaluateCors` dà `allowed: true` solo se valgono tutte le condizioni:
1. Il preflight ha status 200–299.
2. Il preflight ha `access-control-allow-origin` uguale a `*` oppure a `origin`.
3. Il preflight ha `access-control-allow-headers` uguale a `*` oppure con `x-api-key` nella lista (confronto che ignora maiuscole/minuscole, separatore virgola).
4. La GET ha `access-control-allow-origin` uguale a `*` oppure a `origin`.

Altrimenti `reason` nomina la prima condizione mancata.

Flusso della sonda, per `getLive?hl=en-US` e `getSchedule?hl=en-US&leagueId={WORLDS_LEAGUE_ID}`:
1. `OPTIONS` con header `origin: TEST_ORIGIN`, `access-control-request-method: GET`, `access-control-request-headers: x-api-key`.
2. `GET` con `origin: TEST_ORIGIN` e `x-api-key`.
3. `evaluateCors`. I `details` riportano gli header CORS ricevuti.
4. Esito: `ok` se entrambi gli endpoint sono consentiti; `blocked` altrimenti.

`cors-check.html`: pagina statica senza dipendenze. Esegue `fetch` su `getLive` con l'header `x-api-key` e scrive nel `<body>` `CORS OK · status N` oppure `CORS FAIL · <messaggio>`.

- [ ] **Step 1: Scrivere i test che falliscono**

```ts
const r = (status: number, headers: Record<string, string>): HttpResult => ({ status, headers, setCookie: [], text: "" });
const O = "https://riftdata.pages.dev";

test("wildcard origin and allowed x-api-key is allowed", () => {
  expect(evaluateCors(
    r(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, X-Api-Key" }),
    r(200, { "access-control-allow-origin": "*" }), O).allowed).toBe(true);
});
test("wildcard origin without x-api-key in preflight is not allowed", () => {
  const v = evaluateCors(
    r(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }),
    r(200, { "access-control-allow-origin": "*" }), O);
  expect(v.allowed).toBe(false);
  expect(v.reason).toMatch(/x-api-key/);
});
test("preflight failure is not allowed", () => {
  expect(evaluateCors(r(403, {}), r(200, { "access-control-allow-origin": "*" }), O).allowed).toBe(false);
});
test("GET without allow-origin is not allowed", () => {
  expect(evaluateCors(
    r(204, { "access-control-allow-origin": O, "access-control-allow-headers": "*" }),
    r(200, {}), O).allowed).toBe(false);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/spike/cors.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `cors.ts` e `cors-check.html`; registrare `corsProbe`**

- [ ] **Step 4: Verificare i test e la sonda reale**

Run: `npx vitest run tests/spike; npm run spike -- --only cors --out spike-report.md`
Expected: test PASS; il report contiene gli header CORS reali dei due endpoint.

- [ ] **Step 5: Conferma da browser reale**

Run: `npx --yes http-server scripts/spike -p 8080` (in background), poi aprire `http://localhost:8080/cors-check.html` nel browser integrato e leggere il testo della pagina.
Expected: `CORS OK` o `CORS FAIL` coerente con l'esito della sonda. Se diverge, prevale il browser: annotare la divergenza nel report del Task 7. Fermare il server.

- [ ] **Step 6: Commit**

```bash
git add scripts/spike/cors.ts scripts/spike/cors-check.html scripts/spike/run-all.ts tests/spike/cors.test.ts
git commit -m "feat(spike): probe lolesports schedule CORS from the browser"
```

---

### Task 6: Esecuzione da GitHub Actions

Scopo: ottenere l'esito dal runner GitHub, l'unico che conta. Leaguepedia e il feed possono rispondere diversamente a un IP di GitHub e a un IP domestico.

**Files:**
- Create: `.github/workflows/spike.yml`

**Interfaces:**
- Consumes: `npm run spike` con `--out` (Task 2); variabili `LEAGUEPEDIA_BOT_USER` / `LEAGUEPEDIA_BOT_PASSWORD`.

- [ ] **Step 1: Scrivere il workflow**

```yaml
name: spike
on: workflow_dispatch
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run spike -- --out spike-report.md
        env:
          LEAGUEPEDIA_BOT_USER: ${{ secrets.LEAGUEPEDIA_BOT_USER }}
          LEAGUEPEDIA_BOT_PASSWORD: ${{ secrets.LEAGUEPEDIA_BOT_PASSWORD }}
      - if: always()
        run: cat spike-report.md >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: spike-report
          path: |
            spike-report.md
            spike-samples/
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/spike.yml
git commit -m "ci: add manual workflow to run data source probes on GitHub runners"
```

- [ ] **Step 3: Collegare il repo GitHub (richiede l'utente)**

Chiedere all'utente di creare su GitHub un repo vuoto **pubblico** (§5: minuti Actions illimitati) e di indicarne l'URL. Ottenere conferma esplicita, poi eseguire:

```bash
git branch -M main
git remote add origin <URL indicato dall'utente>
git push -u origin main
```

- [ ] **Step 4: Lanciare il workflow (con conferma dell'utente)**

Run: `gh workflow run spike.yml; gh run watch $(gh run list --workflow=spike.yml --limit 1 --json databaseId -q '.[0].databaseId')`
Expected: run completato; scaricare il report con `gh run download --name spike-report --dir spike-ci`.

- [ ] **Step 5: Solo se Leaguepedia risulta `blocked` dal runner senza credenziali**

Guidare l'utente, senza ricevere valori in chat:
1. Creare un account Fandom, se non lo ha già.
2. Aprire `https://lol.fandom.com/wiki/Special:BotPasswords` e creare una bot password con i permessi di lettura base.
3. Impostare i secrets: l'utente lancia nel proprio terminale `gh secret set LEAGUEPEDIA_BOT_USER` e `gh secret set LEAGUEPEDIA_BOT_PASSWORD` (valore richiesto in modo interattivo).

Poi rilanciare lo Step 4.

---

### Task 7: Esiti, decisioni e aggiornamento del documento di progetto

**Files:**
- Create: `docs/superpowers/spikes/2026-11-19-data-sources-report.md`
- Modify: `docs/superpowers/specs/2026-11-18-riftdata-design.md` (§6.4, §8.3, §13.1, §13.3)

- [ ] **Step 1: Scrivere il report definitivo**

Partire dal report del runner (Task 6). Aggiungere: confronto con gli esiti locali, conferma da browser (Task 5), costanti corrette rispetto ai Global Constraints, decisione per ogni esito secondo la tabella:

| Esito | Decisione |
|---|---|
| Leaguepedia `ok` anonimo dal runner | Fonte confermata, nessun account |
| Leaguepedia `blocked` anonimo, `ok` con bot | Fonte confermata; secrets bot obbligatori nella pipeline |
| Leaguepedia `blocked` anche con bot | Ridurre le edizioni passate (§13.1); aprire uno spike dedicato a Oracle's Elixir (§6.4-4) prima del Piano 2 |
| Leaguepedia `partial` (tornei sì, tabellini no) | Annotare i campi mancanti; il Piano 2 valuta Oracle's Elixir solo per le statistiche per game |
| Livestats 2026 `ok` | Worlds 2026 con pagine complete (tabellino + timeline) |
| Livestats 2026 `partial` o `fail` | Pagina partita su due livelli; Worlds 2026 col solo tabellino finale Leaguepedia, come deciso dall'utente (§6.4-2) |
| CORS `ok` | Badge live letto direttamente dal browser |
| CORS `blocked` | Proxy serverless (Cloudflare Pages Function) nel piano del badge live |

Usare l'agente `sintetizzatore` per la stesura.

- [ ] **Step 2: Aggiornare il documento di progetto**

Con l'agente `sintetizzatore`: in §6.4 aggiungere la colonna "Esito spike" con link al report; aggiornare §8.3 (proxy sì/no); aggiornare §13.1 se un rischio si è concretizzato o è caduto; in §13.3 segnare il passo 1 come completato.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/spikes docs/superpowers/specs spike-samples
git commit -m "docs: record data source spike results and decisions"
```

- [ ] **Step 4: Presentare gli esiti all'utente**

Presentare le decisioni della tabella che dipendono dall'utente (account bot, riduzione delle edizioni). Poi scrivere il Piano 2 con `superpowers:writing-plans`.

---

## Roadmap dei piani successivi

Ogni piano si scrive con `superpowers:writing-plans` dopo il precedente. Ogni piano produce software funzionante e testabile in autonomia. L'ordine segue le dipendenze.

| # | Piano | Contenuto | Dipende da |
|---|---|---|---|
| 2 | Schema dati e ingest Leaguepedia | Schema JSON normalizzato (tornei, fasi, squadre con catena di rinomine, roster, partite, classifiche, seed), file di override, ingest incrementale, campioni dello spike come fixture | Fase 0 |
| 3 | Ingest livestats del Worlds corrente | Download una sola volta a partita conclusa, compressione dei fotogrammi, modello partita su due livelli (tabellino / tabellino + timeline) | 2 |
| 4 | Fondazione del sito e design system Broadcast | Astro statico, token di stile (§11.2), font, layout, footer con disclaimer Riot e attribuzione CC BY-SA, View Transitions, Lenis + GSAP con `prefers-reduced-motion` | 2 (forma dei dati) |
| 5 | Home stagionale | Funzione pura della fase (§9) con soglia di 6 mesi configurabile, test su ogni confine di fase, contenuti delle 4 fasi | 2, 4 |
| 6 | Pagina partita, grafici D3 e tabelloni | Pagina partita nei due livelli, grafici oro / gold diff / draghi, componente tabellone generico per tipo di fase (Play-In, svizzera, eliminazione, gironi storici) | 3, 4 |
| 7 | Leagues, Teams, Worlds History | Pagine per lega, scheda squadra con andamento negli anni, edizioni passate | 2, 4, 6 |
| 8 | Badge live | Isola client che legge il calendario (o il proxy, secondo lo spike), punteggio della serie, sparizione silenziosa in caso di errore | 4, Fase 0 |
| 9 | Pipeline automatica e deploy | Workflow programmato (6 h / 15–30 min nei giorni del Worlds), commit dei JSON solo se cambiati, build, deploy su Cloudflare Pages con secrets forniti dall'utente | 2, 3, 4 |
