# RiftData — Piano 4: fondazione del sito e home provvisoria — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sito Astro statico con design system Broadcast, layout comune, animazioni e una home provvisoria costruita dai dati veri dell'ultima edizione completata dei Worlds.

**Architecture:** Astro nello stesso package della pipeline. La logica sta in moduli TypeScript puri sotto `src/lib/` (lettura e validazione dei JSON, scelta dell'edizione, modello della home, formattazione), testati con Vitest e controllati da `tsc`. I file `.astro` ricevono modelli già pronti e li mostrano. Stile in CSS nativo con token in custom properties. Animazioni GSAP + Lenis caricate dal layout, inizializzate e ripulite a ogni navigazione del ClientRouter, attenuate con `prefers-reduced-motion`.

**Tech Stack:** Node 22, TypeScript 7 strict ESM, Astro 7 (output statico), GSAP 3 (ScrollTrigger, SplitText), Lenis, Fontsource, Vitest 5, zod 4.

**Spec:** `docs/superpowers/specs/2026-11-19-riftdata-piano4-fondazione-sito-design.md` (questo piano), che integra `docs/superpowers/specs/2026-11-18-riftdata-design.md` (§2, §4, §5, §11).

**Mockup di riferimento (fuori da git):** `G:\HOME\Repos\RiftData\.superpowers\brainstorm\853-1795041992\content\visual-style-v2.html`. Etichette in italiano = segnaposto.

## Global Constraints

- Lavorare in `G:\HOME\Repos\RiftData`, branch `develop`. Il push lo fa l'utente con GitHub Desktop.
- Ogni messaggio di commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (omesso negli esempi).
- Interfaccia in inglese. Nomi di squadre e campioni in originale.
- Nessun valore di colore, font, durata o easing fuori da `src/styles/tokens.css` (gli script GSAP li leggono dalle custom properties).
- Colori: fondo `#07070a`; testo secondario `#9a9aab` / `#8a8a9a`; bordi `#1c1c24` / `#23232e`; accento dati `#00e5ff` con bagliore; accento fasi `#ff2e63`; lato squadra 1 `#1b2cff`; lato squadra 2 `#ff2e63`. Turchese `#0ac8b9` vietato in questo piano.
- Font self-hosted con Fontsource, solo i pesi usati: Barlow Condensed 700, 800, 800 italic; Inter 400, 600. Nessuna richiesta a Google Fonts.
- `@astrojs/check` non si installa (supporta solo TypeScript ≤ 6). `npm run typecheck` e `npm test` restano verdi a ogni task.
- `src/lib/` non importa nulla da `astro`. Gli import interni usano l'estensione `.js` (NodeNext), come nel resto del repo.
- Nessun anno, edizione o squadra cablati nel codice.
- Animazioni solo su `transform` e `opacity`. Nessun elemento nascosto via CSS in attesa del JavaScript: senza JS la pagina è completa.
- Nessun framework UI lato client.

## Review Focus

1. **Nomi lunghi su telefono a 375 px** (`Hanwha Life Esports`, `CTBC Flying Oyster`): nessuno scroll orizzontale della pagina; le righe partita usano la forma compatta sotto il breakpoint. → verifica nel Task 5, Step 5.
2. **JavaScript disattivato o fallito**: contatori al valore finale, tutte le righe visibili, nessun elemento a opacità 0. → verifica nel Task 6, Step 6.
3. **Navigazione home → 404 → home con il ClientRouter**: animazioni reinizializzate senza duplicati, una sola istanza Lenis, ScrollTrigger della pagina precedente eliminati. → test del ciclo di vita nel Task 6, Step 1, più verifica nel browser nel Task 6, Step 6.
4. **Partita a cavallo della mezzanotte UTC** (`2026-10-15T23:30:00Z`): la data mostrata è `Oct 15` per ogni visitatore. → test nel Task 2.
5. **Edizione in corso con squadre `TBD` e punteggi `null`** (sarà il caso del Worlds 2027): nessun vincitore evidenziato, `–` al posto del punteggio, nessuna card del campione. → test nel Task 4.

---

## File Structure

| File | Responsabilità |
|---|---|
| `astro.config.mjs` | Config Astro: output statico |
| `src/pages/index.astro`, `src/pages/404.astro` | Pagine |
| `src/layouts/BaseLayout.astro` | `<head>`, font, ClientRouter, intestazione, footer, avvio script di movimento |
| `src/components/layout/Logo.astro`, `SiteHeader.astro`, `SiteFooter.astro` | Layout comune |
| `src/components/broadcast/PhaseTag.astro`, `ScoreBox.astro`, `MatchupBar.astro`, `StatCounter.astro`, `SectionTitle.astro`, `Panel.astro` | Componenti di stile riusabili |
| `src/components/home/HomeHero.astro`, `ChampionCard.astro`, `StageSection.astro` | Sezioni della home |
| `src/styles/tokens.css`, `src/styles/global.css` | Token; reset, tipografia, fondo, focus, transizione tra pagine |
| `src/lib/nav/sections.ts` | Voci del menu |
| `src/lib/format/team.ts`, `date.ts`, `score.ts`, `labels.ts` | Formattazione |
| `src/lib/data/load.ts`, `select.ts`, `site-data.ts` | Lettura validata, scelta edizione, accesso per le pagine |
| `src/lib/home/model.ts` | Edizione → modello della home |
| `src/scripts/motion/settings.ts`, `lifecycle.ts`, `lenis.ts`, `reveals.ts`, `counters.ts`, `index.ts` | Movimento |
| `tests/site/**` | Test di `src/lib/` e di `settings.ts` / `lifecycle.ts` |

---

### Task 1: Progetto Astro, token e layout comune

**Files:**
- Create: `astro.config.mjs`, `src/styles/tokens.css`, `src/styles/global.css`, `src/layouts/BaseLayout.astro`, `src/components/layout/Logo.astro`, `src/components/layout/SiteHeader.astro`, `src/components/layout/SiteFooter.astro`, `src/pages/index.astro` (segnaposto), `src/pages/404.astro`, `src/lib/nav/sections.ts`
- Modify: `package.json` (dipendenze e script), `tsconfig.json` (solo se serve), `.gitignore` (`.astro/`)
- Test: `tests/site/nav.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/lib/nav/sections.ts
  export interface NavItem { label: string; href: string | null }   // href null = sezione non ancora disponibile
  export function buildNav(featuredYear: number): NavItem[];
  ```
  ```astro
  <!-- BaseLayout.astro props -->
  interface Props { title: string; description?: string; nav: NavItem[] }
  ```
- Script npm: `dev` (`astro dev`), `dev:lan` (`astro dev --host`), `build` (`astro build`), `preview` (`astro preview --host`). `test` e `typecheck` invariati.

- [ ] **Step 1: Scrivere il test che fallisce**

`tests/site/nav.test.ts`:

```ts
test("nav lists the four sections with only the featured Worlds available", () => {
  expect(buildNav(2026)).toEqual([
    { label: "Worlds 2026", href: "/" },
    { label: "Leagues", href: null },
    { label: "Teams", href: null },
    { label: "Worlds History", href: null },
  ]);
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `npx vitest run tests/site/nav.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Installare Astro, GSAP, Lenis, Fontsource; implementare `buildNav`, token, global CSS, layout e pagine**

- Dipendenze: `astro`, `gsap`, `lenis`, `@fontsource/barlow-condensed`, `@fontsource/inter`.
- `tokens.css`: tutti i valori dei Global Constraints più scala tipografica fluida con `clamp()`, scala di spaziatura, larghezza massima del contenuto, breakpoint (come custom property di riferimento), `clip-path` dei tagli diagonali, durate ed easing.
- `global.css`: reset, `body` con fondo `#07070a` e motivo a linee diagonali del mockup (`repeating-linear-gradient(115deg, …)`), Inter per il testo, `:focus-visible` evidente in `#00e5ff`, classe `.visually-hidden`.
- `BaseLayout`: importa i CSS dei font Fontsource (`700.css`, `800.css`, `800-italic.css` di Barlow Condensed; `400.css`, `600.css` di Inter), `tokens.css`, `global.css`; `<html lang="en">`; `<ClientRouter />` di `astro:transitions`; `SiteHeader`, `<main>`, `SiteFooter`.
- `SiteHeader`: `Logo` ("RIFT" bianco + "DATA" `#00e5ff`, Barlow Condensed 800 corsivo, link a `/`); voci di `nav`: con `href` → `<a>` (voce corrente marcata con `aria-current="page"` e sottolineatura azzurra); con `href: null` → `<span aria-disabled="true">` attenuato, con `title="Coming soon"` e testo `.visually-hidden` ` (coming soon)`. Su telefono le voci vanno a capo sotto il logo: nessun menu a scomparsa, nessuno scroll orizzontale.
- `SiteFooter`, testo esatto:
  - `RiftData isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.`
  - `Data from <a href="https://lol.fandom.com">Leaguepedia</a>, licensed <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>.`
- `index.astro`: segnaposto con titolo display, sostituito nel Task 5. Per il menu usa `buildNav(2026)` solo qui, temporaneamente; il Task 5 lo sostituisce con l'anno dai dati.
- `404.astro`: titolo display `404`, testo `Page not found.`, link `Back to Worlds` verso `/`.
- `tsconfig.json`: `npm run typecheck` (TypeScript 7) deve restare verde. Se i tipi generati da Astro (`.astro/`, `astro/client`) rompono `tsc`, non includerli: i file `.astro` non sono controllati in questo piano.

- [ ] **Step 4: Verificare**

Run: `npx vitest run; npm run typecheck; npm run build`
Expected: test PASS (137 esistenti + 1), typecheck senza errori, build completata con `dist/index.html` e `dist/404.html`.

Run: `grep -c "isn't endorsed by Riot Games" dist/index.html dist/404.html; grep -c "fonts.googleapis" dist/index.html`
Expected: `1` per entrambe le pagine; `0` richieste a Google Fonts.

- [ ] **Step 5: Commit**

```bash
git add astro.config.mjs package.json package-lock.json tsconfig.json .gitignore src/styles src/layouts src/components/layout src/pages src/lib/nav tests/site/nav.test.ts
git commit -m "feat(site): scaffold Astro with Broadcast tokens and shared layout"
```

---

### Task 2: Formattazione

**Files:**
- Create: `src/lib/format/team.ts`, `src/lib/format/date.ts`, `src/lib/format/score.ts`, `src/lib/format/labels.ts`
- Test: `tests/site/format.test.ts`

**Interfaces:**
- Consumes: `Team`, `TeamId`, `EditionStatus`, `StageType` da `src/data/schema/index.js`.
- Produces:
  ```ts
  // team.ts
  export interface TeamLabel { id: TeamId | null; name: string; short: string; region?: string }
  export type TeamLookup = (id: TeamId | null) => TeamLabel;
  export function stripDisambiguation(name: string): string;   // toglie solo un " (…)" finale
  export function createTeamLookup(teams: Team[]): TeamLookup; // null → TBD; id sconosciuto → l'id come name e short
  // date.ts
  export function formatMatchDay(iso: string | undefined): string | null;  // giorno in UTC, "Nov 14"
  // score.ts
  export function formatScore(score: number | null): string;              // null → "–" (U+2013)
  // labels.ts
  export function statusLabel(status: EditionStatus): string;  // "Completed" | "Ongoing" | "Upcoming"
  export function stageTypeLabel(type: StageType): string;     // play-in "Play-In", swiss "Swiss", groups "Groups", single-elimination "Knockout", other "Main Event"
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/site/format.test.ts`:

```ts
const teams: Team[] = [
  { id: "gen-g", name: "Gen.G", short: "GEN", region: "Korea", aliases: ["Gen.G"] },
  { id: "lyon-2024-american-team", name: "LYON (2024 American Team)", aliases: ["LYON (2024 American Team)"] },
];
const lookup = createTeamLookup(teams);

test("strips only a trailing Leaguepedia disambiguation", () => {
  expect(stripDisambiguation("LYON (2024 American Team)")).toBe("LYON");
  expect(stripDisambiguation("Gen.G")).toBe("Gen.G");
  expect(stripDisambiguation("Team (A) Name")).toBe("Team (A) Name");
});
test("team labels use short when present, else the stripped name", () => {
  expect(lookup("gen-g")).toEqual({ id: "gen-g", name: "Gen.G", short: "GEN", region: "Korea" });
  expect(lookup("lyon-2024-american-team")).toEqual({ id: "lyon-2024-american-team", name: "LYON", short: "LYON" });
});
test("null team is TBD and unknown id falls back to the id", () => {
  expect(lookup(null)).toEqual({ id: null, name: "TBD", short: "TBD" });
  expect(lookup("ghost-team")).toEqual({ id: "ghost-team", name: "ghost-team", short: "ghost-team" });
});
test("match day is computed in UTC", () => {
  expect(formatMatchDay("2026-11-14T19:00:00Z")).toBe("Nov 14");
  expect(formatMatchDay("2026-10-15T23:30:00Z")).toBe("Oct 15");
  expect(formatMatchDay(undefined)).toBeNull();
});
test("scores and labels", () => {
  expect(formatScore(3)).toBe("3");
  expect(formatScore(null)).toBe("–");
  expect(statusLabel("completed")).toBe("Completed");
  expect(stageTypeLabel("single-elimination")).toBe("Knockout");
  expect(stageTypeLabel("other")).toBe("Main Event");
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/site/format.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare i quattro moduli**

`formatMatchDay` usa `Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })`.

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/site/format.test.ts; npm run typecheck`
Expected: PASS, nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format tests/site/format.test.ts
git commit -m "feat(site): add team, date, score and label formatting"
```

---

### Task 3: Lettura dei dati e scelta dell'edizione

**Files:**
- Create: `src/lib/data/load.ts`, `src/lib/data/select.ts`, `src/lib/data/site-data.ts`
- Test: `tests/site/data.test.ts`

**Interfaces:**
- Consumes: `EditionSchema`, `TeamsFileSchema`, `Edition`, `Team`.
- Produces:
  ```ts
  // load.ts
  export class DataValidationError extends Error { readonly file: string }   // message: percorso del file + errore zod leggibile (z.prettifyError), con il percorso del campo
  export function loadEditions(worldsDir: string): Edition[];   // tutti i *.json, ordinati per year crescente
  export function loadTeams(teamsFile: string): Team[];
  // select.ts
  export function selectFeaturedEdition(editions: Edition[]): Edition | null;  // year massimo tra le completed; se nessuna, year massimo; vuoto → null
  // site-data.ts — unico punto usato dalle pagine; memoizza
  export interface SiteData { featured: Edition; teams: Team[] }
  export function getSiteData(dataDir?: string): SiteData;   // default resolve(process.cwd(), "data"); nessuna edizione → Error("No Worlds editions found in <dir>/worlds")
  ```

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/site/data.test.ts` (cartelle temporanee con `mkdtempSync` per i casi sintetici; `edition(year, status)` helper che produce un'`Edition` valida):

```ts
test("featured edition is the latest completed one", () => {
  expect(selectFeaturedEdition([edition(2025, "completed"), edition(2026, "completed"), edition(2027, "upcoming")])?.year).toBe(2026);
});
test("without completed editions the latest one is featured", () => {
  expect(selectFeaturedEdition([edition(2026, "ongoing"), edition(2027, "upcoming")])?.year).toBe(2027);
  expect(selectFeaturedEdition([])).toBeNull();
});
test("invalid edition file fails with file name and field path", () => {
  const dir = tempWorldsDir({ "2026.json": { ...edition(2026, "completed"), year: "2026" } });
  expect(() => loadEditions(dir)).toThrow(DataValidationError);
  expect(() => loadEditions(dir)).toThrow(/2026\.json[\s\S]*year/);
});
test("real data: featured edition is Worlds 2026", () => {
  const { featured, teams } = getSiteData();
  expect(featured.name).toBe("Worlds 2026");
  expect(teams.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/site/data.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare `load.ts`, `select.ts`, `site-data.ts`**

Lettura con `node:fs` sincrona. Nessun uso di `import.meta.glob`: il modulo resta testabile fuori da Vite.

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/site/data.test.ts; npm run typecheck`
Expected: PASS, nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data tests/site/data.test.ts
git commit -m "feat(site): load validated Worlds data and pick the featured edition"
```

---

### Task 4: Modello della home

**Files:**
- Create: `src/lib/home/model.ts`
- Test: `tests/site/home-model.test.ts`

**Interfaces:**
- Consumes: `Edition`, `Match` (schema); `TeamLabel`, `TeamLookup`, `createTeamLookup`, `formatMatchDay`, `formatScore`, `statusLabel`, `stageTypeLabel` (Task 2); `getSiteData` (Task 3, solo nel test sui dati reali).
- Produces:
  ```ts
  export interface MatchView { id: string; day: string | null; team1: TeamLabel; team2: TeamLabel; score1: string; score2: string; winner: 1 | 2 | null }
  export interface RoundView { name: string | null; matches: MatchView[] }
  export interface StageView { id: string; name: string; typeLabel: string; rounds: RoundView[] }
  export interface ChampionView { team: TeamLabel; final: MatchView; finalRound: string | null }
  export interface HomeModel {
    year: number;
    name: string;            // edition.name, es. "Worlds 2026"
    statusLabel: string;
    stats: { teams: number; regions: number; games: number };
    champion: ChampionView | null;
    stages: StageView[];     // in ordine di `order`, senza fasi vuote
  }
  export function toMatchView(match: Match, lookup: TeamLookup): MatchView;
  export function buildHomeModel(edition: Edition, lookup: TeamLookup): HomeModel;
  ```

Regole:
- `stats.teams`: id distinti non `null` tra `team1`/`team2` di tutte le partite. `stats.regions`: `region` distinte delle relative `TeamLabel`, ignorando quelle senza `region`. `stats.games`: numero totale di game.
- `winner`: `1` se `match.winner === match.team1`, `2` se `=== match.team2`, altrimenti `null`.
- Round: gruppi per `match.round` nell'ordine di prima apparizione; partite senza `round` nel gruppo `name: null`.
- `champion`: solo se `status === "completed"` e `champion !== null`. `final` = partita con `date` più recente tra quelle con `winner`; `finalRound` = il suo `round` o `null`.

- [ ] **Step 1: Scrivere i test che falliscono**

`tests/site/home-model.test.ts` (helper `match({...})` e `edition({...})` che producono oggetti validi):

```ts
test("ongoing edition with TBD teams and null scores", () => {
  const e = edition({ status: "ongoing", champion: null, stages: [stage("knockout-stage", "single-elimination", [
    match({ id: "sf", round: "Semifinals", team1: "t1", team2: "gen-g", score1: 3, score2: 1, winner: "t1" }),
    match({ id: "f", round: "Finals", team1: "t1", team2: null, score1: null, score2: null, winner: null }),
  ])] });
  const m = buildHomeModel(e, lookup);
  expect(m.champion).toBeNull();
  expect(m.statusLabel).toBe("Ongoing");
  expect(m.stages[0]!.rounds.map((r) => r.name)).toEqual(["Semifinals", "Finals"]);
  expect(m.stages[0]!.rounds[1]!.matches[0]).toMatchObject({ team2: { name: "TBD" }, score1: "–", score2: "–", winner: null });
});
test("empty stages are dropped and unnamed rounds are grouped", () => {
  const e = edition({ stages: [stage("play-in", "play-in", []), stage("main-event", "other", [match({ id: "a", round: undefined }), match({ id: "b", round: undefined })])] });
  const m = buildHomeModel(e, lookup);
  expect(m.stages.map((s) => s.id)).toEqual(["main-event"]);
  expect(m.stages[0]!.rounds).toHaveLength(1);
  expect(m.stages[0]!.rounds[0]!.name).toBeNull();
});
test("real Worlds 2026 home model", () => {
  const { featured, teams } = getSiteData();
  const m = buildHomeModel(featured, createTeamLookup(teams));
  expect(m.name).toBe("Worlds 2026");
  expect(m.stats).toEqual({ teams: 19, regions: 6, games: 98 });
  expect(m.champion).toMatchObject({ team: { id: "bilibili-gaming", short: "BLG" }, finalRound: "Finals", final: { score1: "3", score2: "1", winner: 1, team2: { short: "GEN" } } });
  expect(m.stages.map((s) => s.typeLabel)).toEqual(["Play-In", "Swiss", "Knockout"]);
  expect(m.stages.flatMap((s) => s.rounds.flatMap((r) => r.matches))).toHaveLength(46);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/site/home-model.test.ts`
Expected: FAIL, modulo inesistente.

- [ ] **Step 3: Implementare `toMatchView` e `buildHomeModel` in `src/lib/home/model.ts`**

- [ ] **Step 4: Verificare**

Run: `npx vitest run tests/site/home-model.test.ts; npm run typecheck`
Expected: PASS, nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home tests/site/home-model.test.ts
git commit -m "feat(site): build the provisional home model from an edition"
```

---

### Task 5: Componenti Broadcast e home provvisoria

**Files:**
- Create: `src/components/broadcast/PhaseTag.astro`, `ScoreBox.astro`, `MatchupBar.astro`, `StatCounter.astro`, `SectionTitle.astro`, `Panel.astro`; `src/components/home/HomeHero.astro`, `ChampionCard.astro`, `StageSection.astro`
- Modify: `src/pages/index.astro`, `src/pages/404.astro` (menu dall'anno dei dati)

**Interfaces:**
- Consumes: `HomeModel`, `MatchView`, `StageView`, `ChampionView`, `buildHomeModel` (Task 4); `getSiteData` (Task 3); `createTeamLookup` (Task 2); `buildNav` (Task 1).
- Produces (props e attributi usati dal Task 6):
  ```astro
  PhaseTag      { label: string }
  ScoreBox      { score1: string; score2: string; size?: "lg" | "sm" }
  MatchupBar    { match: MatchView; compact?: boolean }   → radice con data-match-id={match.id} e data-reveal
  StatCounter   { value: number; label: string }          → numero con data-count-to={value}, testo iniziale = value
  SectionTitle  { text: string; accent?: string; level?: 1 | 2 | 3 }  → titolo con data-split (rivelazione SplitText)
  Panel         { label?: string }                         → slot
  HomeHero      { model: HomeModel }
  ChampionCard  { champion: ChampionView }
  StageSection  { stage: StageView }
  ```

Regole di presentazione (spec §7.4–7.5):
- `PhaseTag`: fondo `#ff2e63`, testo `#07070a`, taglio diagonale, Barlow Condensed 800 maiuscolo.
- `ScoreBox`: riquadro bianco inclinato, cifre `#07070a`.
- `MatchupBar`: squadra 1 con gradiente laterale `#1b2cff`, squadra 2 con `#ff2e63`, `ScoreBox` al centro, data (`day`) a lato se presente. Vincitore evidenziato (testo pieno), perdente attenuato; `winner: null` → nessuna evidenza. Sotto il breakpoint mostra `short`, sopra `name`; il nome completo resta disponibile ai lettori di schermo. Ogni riga è un elemento di elenco.
- `HomeHero`: `SectionTitle` livello 1 con "Worlds" e l'anno in accento `#00e5ff` con bagliore; `PhaseTag` con `statusLabel`; tre `StatCounter` (`Teams`, `Regions`, `Games`). Desktop: due colonne, titolo a sinistra e `ChampionCard` a destra.
- `ChampionCard`: `Panel` con etichetta `Champion`, nome esteso del campione, `MatchupBar` della finale, `finalRound`.
- `StageSection`: `SectionTitle` livello 2 con il nome della fase, `PhaseTag` con `typeLabel`, per ogni round un titolo livello 3 (omesso se `name` è `null`) e l'elenco dei `MatchupBar` compatti. Partite su più colonne quando lo spazio lo consente.
- `index.astro`: `getSiteData()` → `buildHomeModel(featured, createTeamLookup(teams))` → `HomeHero`, `ChampionCard` se `champion`, poi `StageSection` per fase. Nessuna partita → `No matches yet` sotto l'hero. Menu: `buildNav(featured.year)`. Titolo pagina: `RiftData — Worlds 2026` (dall'anno).
- `404.astro`: menu `buildNav(getSiteData().featured.year)`.

- [ ] **Step 1: Implementare i componenti Broadcast**

- [ ] **Step 2: Implementare le sezioni della home e collegare `index.astro` e `404.astro`**

- [ ] **Step 3: Verificare la build sui dati veri**

Run: `npm run build; grep -o 'data-match-id' dist/index.html | wc -l; grep -c 'Bilibili Gaming' dist/index.html; grep -o 'data-count-to="[0-9]*"' dist/index.html`
Expected: build completata; `46`; almeno `1`; `data-count-to="19"`, `data-count-to="6"`, `data-count-to="98"`.

- [ ] **Step 4: Verificare test e tipi**

Run: `npx vitest run; npm run typecheck`
Expected: PASS, nessun errore.

- [ ] **Step 5: Verificare a 375 px (Review Focus 1) e i casi visivi**

Run: `npm run preview`, aprire la home nel browser con viewport 375×812 ed eseguire nella console `document.documentElement.scrollWidth <= window.innerWidth`.
Expected: `true`. Le righe con `Hanwha Life Esports` e `CTBC Flying Oyster` mostrano la forma compatta; la home a 1280 px mostra l'hero su due colonne. Confronto visivo con il mockup: fondo a righe, accenti, tagli diagonali coerenti.

- [ ] **Step 6: Commit**

```bash
git add src/components src/pages
git commit -m "feat(site): render the provisional home from real Worlds data"
```

---

### Task 6: Movimento e transizioni tra pagine

**Files:**
- Create: `src/scripts/motion/settings.ts`, `src/scripts/motion/lifecycle.ts`, `src/scripts/motion/lenis.ts`, `src/scripts/motion/reveals.ts`, `src/scripts/motion/counters.ts`, `src/scripts/motion/index.ts`
- Modify: `src/layouts/BaseLayout.astro` (carica `index.ts`), `src/styles/global.css` (transizione diagonale)
- Test: `tests/site/motion.test.ts`

**Interfaces:**
- Consumes: attributi `data-split`, `data-count-to`, `data-reveal` (Task 5); durate ed easing da `tokens.css`.
- Produces:
  ```ts
  // settings.ts
  export interface MotionSettings { smoothScroll: boolean; splitTitles: boolean; countUp: boolean; staggerReveal: boolean; diagonalTransition: boolean }
  export function motionSettings(prefersReducedMotion: boolean): MotionSettings;
  // lifecycle.ts — nessuna dipendenza da GSAP o dal DOM reale
  export type MotionStarter = (root: ParentNode, settings: MotionSettings) => () => void;   // restituisce la pulizia
  export interface MotionLifecycle { mount(root: ParentNode, settings: MotionSettings): void; unmount(): void; readonly active: number }
  export function createMotionLifecycle(starters: MotionStarter[]): MotionLifecycle;   // mount su istanza già montata: prima unmount
  // lenis.ts / reveals.ts / counters.ts: ognuno esporta `start: MotionStarter`
  // index.ts: un solo lifecycle; su "astro:page-load" mount(document, motionSettings(matchMedia("(prefers-reduced-motion: reduce)").matches)); su "astro:before-swap" unmount()
  ```

Regole (spec §7.7):
- `motionSettings(false)` → tutto `true`. `motionSettings(true)` → tutto `false`.
- Contatori: da 0 al valore di `data-count-to` all'entrata in vista; il testo nell'HTML è già il valore finale, quindi senza JS o con reduced motion non cambia nulla.
- Titoli `data-split`: SplitText per caratteri, entrata veloce e decisa; `revert()` alla pulizia.
- Righe `data-reveal`: entrata a scaglioni con ScrollTrigger (`gsap.from`, mai stati iniziali nel CSS).
- Lenis collegato a ScrollTrigger (`lenis.on("scroll", ScrollTrigger.update)`, `gsap.ticker` che chiama `lenis.raf`, `lagSmoothing(0)`); `destroy()` alla pulizia.
- Pulizia: `gsap.context(...).revert()` per pagina; dopo la pulizia `ScrollTrigger.getAll().length === 0`.
- Transizione tra pagine: taglio diagonale con `clip-path` su `::view-transition-old(root)` / `::view-transition-new(root)` in `global.css`; dentro `@media (prefers-reduced-motion: reduce)` nessun taglio.

- [ ] **Step 1: Scrivere il test che fallisce**

`tests/site/motion.test.ts`:

```ts
test("full motion enables every effect", () => {
  expect(Object.values(motionSettings(false)).every(Boolean)).toBe(true);
});
test("reduced motion disables every effect", () => {
  expect(motionSettings(true)).toEqual({ smoothScroll: false, splitTitles: false, countUp: false, staggerReveal: false, diagonalTransition: false });
});
test("remounting cleans up the previous page before starting again", () => {
  const cleanups = [vi.fn(), vi.fn()];
  const starters = cleanups.map((c) => vi.fn(() => c));
  const life = createMotionLifecycle(starters);
  life.mount({} as ParentNode, motionSettings(false));
  life.mount({} as ParentNode, motionSettings(false));   // navigazione senza before-swap
  expect(cleanups.map((c) => c.mock.calls.length)).toEqual([1, 1]);
  expect(starters.map((s) => s.mock.calls.length)).toEqual([2, 2]);
  expect(life.active).toBe(2);
  life.unmount();
  life.unmount();
  expect(cleanups.map((c) => c.mock.calls.length)).toEqual([2, 2]);
  expect(life.active).toBe(0);
});
```

- [ ] **Step 2: Verificare che falliscano**

Run: `npx vitest run tests/site/motion.test.ts`
Expected: FAIL, moduli inesistenti.

- [ ] **Step 3: Implementare `settings.ts` e `lifecycle.ts`**

- [ ] **Step 4: Implementare `lenis.ts`, `reveals.ts`, `counters.ts`, `index.ts`, la transizione in `global.css` e il caricamento nel layout**

- [ ] **Step 5: Verificare test, tipi e build**

Run: `npx vitest run; npm run typecheck; npm run build`
Expected: PASS, nessun errore, build completata.

- [ ] **Step 6: Verificare nel browser (Review Focus 2 e 3)**

Con `npm run preview`:
1. Home → link inesistente (es. `/nope`) → `Back to Worlds` → home, tre volte. Nessun errore in console; lo scroll ha la stessa morbidezza della prima visita (un solo Lenis attivo); contatori e rivelazioni ripartono una sola volta.
2. Emulazione `prefers-reduced-motion: reduce`: nessuna rivelazione per caratteri, contatori fermi al valore finale, passaggio di pagina senza taglio.
3. JavaScript disattivato: tutte le 46 righe visibili, contatori a 19 / 6 / 98, nessun elemento a opacità 0.

Expected: tutti e tre i controlli superati.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/motion src/layouts/BaseLayout.astro src/styles/global.css tests/site/motion.test.ts
git commit -m "feat(site): add GSAP and Lenis motion with diagonal page transitions"
```

---

### Task 7: Verifica di qualità, prova su telefono e documentazione

**Files:**
- Modify: `README.md`
- Modify (solo se le verifiche lo richiedono): file dei Task 1–6

- [ ] **Step 1: Lighthouse mobile sulla build**

Run: `npm run build; npm run preview`, poi Lighthouse in modalità mobile sulla home.
Expected: Performance ≥ 90, Accessibility ≥ 90, CLS < 0,1. Se un valore non passa: correggere la causa, annotarla nel commit.

- [ ] **Step 2: Accessibilità manuale**

Controlli: contrasto AA del testo (incluso `PhaseTag`), focus visibile su ogni link, un solo `h1` e gerarchia dei titoli corretta, menu percorribile con Tab, voci `Coming soon` annunciate come non disponibili.
Expected: tutti superati.

- [ ] **Step 3: Script `dev:lan`**

Run: `npm run dev:lan`
Expected: Astro stampa un indirizzo `Network` raggiungibile dalla rete locale. La prova su telefono reale la fa l'utente (Windows può chiedere il permesso del firewall).

- [ ] **Step 4: Aggiornare `README.md` con l'agente `sintetizzatore`**

Contenuto: cos'è RiftData in una riga; comandi `dev`, `dev:lan`, `build`, `preview`, `test`, `typecheck`, `ingest`; rimando a `data/README.md`; disclaimer Riot e attribuzione Leaguepedia. In inglese.

- [ ] **Step 5: Verifica finale**

Run: `npx vitest run; npm run typecheck; npm run build`
Expected: PASS, nessun errore, build completata.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: document site commands and attribution"
```
