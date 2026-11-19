# Data

Versioned JSON of every League of Legends World Championship (2011 onwards), generated from Leaguepedia.

Do not hand-edit `worlds/` or `teams.json`. The ingest pipeline overwrites them. To correct data, add an entry in `overrides/`.

## Layout

```
data/
  worlds/<year>.json   one file per edition
  teams.json           { "teams": [...] }, sorted by id
  overrides/           manual corrections (hand-edited)
    editions.json  teams.json  stages.json  matches.json
```

Schemas: `src/data/schema/edition.ts`, `src/data/schema/team.ts`.

## Edition (`worlds/<year>.json`)

| Field | Meaning |
|---|---|
| `year` | Integer, 2011 or later. |
| `name` | Edition name, e.g. `Worlds 2026`. |
| `overviewPages` | Leaguepedia pages the edition is built from (at least one). |
| `startDate`, `endDate` | `YYYY-MM-DD`, optional. |
| `status` | `upcoming`, `ongoing`, `completed`. |
| `champion` | Team id, or `null` unless `completed`. |
| `coverage` | `{ matches, games }`: at least one match / at least one game present. |
| `stages` | Sorted by `order`. |

Stage: `id` (slug of `name`), `name`, `type`, `order`, `matches`. Matches sorted by date, then id.

Match: `id`, `round`, `date` (ISO), `bestOf`, `team1`, `team2` (team id or `null` if undecided), `score1`, `score2`, `winner` (team id or `null`), `games` (sorted by `number`).

Game: `id`, `number`, `blue`, `red`, `winner` (`"blue"` or `"red"`, not a team id), `durationSec`, `patch`. Side: `team`, `kills`, `deaths`, `assists`, `gold`, `dragons`, `barons`, `towers`, `picks`, `bans`. Missing numbers are omitted.

### Stage name and type

Leaguepedia `Tab` is a round or a day, not a stage. Each match goes to one of three phases:

1. Play-In: overview page suffix matches `play-in` or `playin`. Type `play-in`.
2. Knockout: `Tab` matches `final`, `knockout`, `playoff`, `bracket` or `elimination`. Name `Knockout Stage`, type `single-elimination`.
3. Main phase: everything else. Decided by the `Tab` values:
   - `Round N` present: `Swiss Stage`, type `swiss`.
   - `Day N` or `group` present: `Group Stage`, type `groups`.
   - Otherwise: name from the page suffix (fallback `Main Event`), type `other`.

Stages are ordered by the date of their first match. Wrong results are fixed in `overrides/stages.json`.

### Status and champion

- `completed`: at least one match, every match has a winner, and `endDate` is past (or absent).
- `ongoing`: not completed, and any match has a winner or `startDate` has been reached.
- `upcoming`: otherwise.
- `champion`: winner of the latest dated match, only when `completed`. Otherwise `null`.

## Team (`teams.json`)

| Field | Meaning |
|---|---|
| `id` | Slug: lowercase alphanumerics and hyphens. |
| `name` | Latest name. |
| `short` | Short name, optional. |
| `region` | Region, optional. |
| `aliases` | Every historical name including the current one, sorted. |

Ids follow Leaguepedia rename chains (`TeamRenames`) to the latest name. The id is the slug of that terminal name. Example: `SK Telecom T1` renamed to `T1` gives id `t1`, aliases `["SK Telecom T1", "T1"]`.

Only renames of the same organisation count. Overrides win over Leaguepedia. A rename cycle (A to B, later B to A) ends at the target of its latest rename, whichever name you start from. If two terminal names give the same slug, the second id gets the region (or `-2`) appended.

## Commands

Run from the repository root.

| Command | Effect |
|---|---|
| `npm run ingest` | Incremental. Downloads only editions not stored as `completed`. |
| `npm run ingest -- --full` | Downloads and rebuilds every edition. |
| `npm run ingest -- --year 2026,2025` | Limits the run to those years. Repeatable. Takes precedence over `--full`. |
| `npm run discover` | Manual network check of the Cargo fields used by the queries. Saves test fixtures. Does not touch `data/`. |

Behaviour:

- Incremental run falls back to a full rebuild when a stored team was renamed after storage (its aliases no longer resolve to its id).
- Everything is fetched before anything is written. A failed request leaves `data/` untouched.
- Output is deterministic (sorted keys, LF). Only changed files are written.
- Warnings are printed for requested years without an edition, discarded orphan games and editions with no matches.
- A full run takes about 20 minutes: Leaguepedia rate limit, one request every 2 seconds.

Optional Leaguepedia bot login. Set environment variables, never commit credentials:

```
LEAGUEPEDIA_BOT_USER
LEAGUEPEDIA_BOT_PASSWORD
```

## Overrides

Manual corrections in `overrides/`, loaded on every ingest. A missing file means no overrides. Unknown keys fail validation.

| File | Format | Purpose |
|---|---|---|
| `editions.json` | `{ "exclude": ["<OverviewPage>"] }` | Skip Leaguepedia tournaments. |
| `teams.json` | `{ "merge": [{ "from": "A", "into": "B" }] }` | Force a rename edge `A -> B`. Beats Leaguepedia. |
| `stages.json` | `{ "<year>/<stage-id>": { "name", "type" } }` | Replace stage name and/or type. The id does not change. |
| `matches.json` | `{ "<MatchId>": { "score1", "score2", "winner", "date" } }` | Patch single fields of a match. `winner` is a team id or `null`. |

Self-edge `{ "from": "X", "into": "X" }`: pins `X` as terminal name. Use it to stop a chain at `X`, or to pick a different name for a rename cycle.

Current entries:

- `editions.json`: 2011 qualifiers excluded (`Season 1 World Championship/Qualifiers/Europe` and `.../North America`).
- `stages.json`: `2011/swiss-stage` renamed `Main Event`, type `other`.
- `teams.json`: empty.
- `matches.json`: empty.

## Known gaps

- 2011: 16 bracket games discarded. Their `MatchId` does not match the schedule (gap in Leaguepedia). The ingest reports them as orphan games. 2011 keeps 12 games, all in the `Main Event` stage. Its knockout match has no games.
- 2027: `upcoming`, no matches (`coverage` both `false`).

## Attribution

Data comes from [Leaguepedia](https://lol.fandom.com), licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).

Derived data in this folder is shared under the same license.
