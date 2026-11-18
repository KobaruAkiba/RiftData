import type { HttpResult } from "../lib/http.js";
import { LEAGUEPEDIA_API } from "../lib/sources.js";
import { loginWithBotPassword } from "./leaguepedia-auth.js";
import type { ProbeDefinition, ProbeDeps, ProbeOutcome } from "./probe.js";

const REQUEST_INTERVAL_MS = 2000;
const MAX_SAMPLE_ROWS = 5;

export interface CargoQuery {
  tables: string;
  fields: string;
  where?: string;
  limit?: number;
}

export type CargoOutcome =
  | { kind: "ok"; rows: Record<string, string>[] }
  | { kind: "rate_limited" }
  | { kind: "blocked"; status: number }
  | { kind: "error"; message: string };

export function buildCargoUrl(q: CargoQuery): string {
  const params = new URLSearchParams({ action: "cargoquery", format: "json", tables: q.tables, fields: q.fields });
  if (q.where !== undefined) params.set("where", q.where);
  if (q.limit !== undefined) params.set("limit", String(q.limit));
  return `${LEAGUEPEDIA_API}?${params.toString()}`;
}

interface CargoBody {
  cargoquery?: unknown;
  error?: { code?: string; info?: string };
}

/**
 * Maps an HTTP response to a Cargo outcome. Leaguepedia can answer 200 with an error body
 * (e.g. `ratelimited`), so the body is inspected before declaring success.
 */
export function classifyCargoResponse(res: HttpResult): CargoOutcome {
  if (res.status === 429) return { kind: "rate_limited" };
  if ([401, 402, 403].includes(res.status)) return { kind: "blocked", status: res.status };

  let body: CargoBody;
  try {
    const parsed: unknown = JSON.parse(res.text);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed as CargoBody;
  } catch {
    return { kind: "error", message: `non-JSON response (status ${res.status})` };
  }

  if (body.error?.code === "ratelimited") return { kind: "rate_limited" };
  if (res.status === 200 && Array.isArray(body.cargoquery)) {
    const rows = (body.cargoquery as { title: Record<string, string> }[]).map((entry) => entry.title);
    return { kind: "ok", rows };
  }
  const info = body.error?.info ? `: ${body.error.info}` : "";
  return { kind: "error", message: `status ${res.status}${info}` };
}

const TOURNAMENTS_QUERY: CargoQuery = {
  tables: "Tournaments",
  fields: "Name,OverviewPage,DateStart,Region",
  where: 'Name LIKE "%World Championship%" AND DateStart >= "2026-01-01"',
  limit: 20,
};

const SCOREBOARD_QUERY: CargoQuery = {
  tables: "ScoreboardGames",
  fields:
    "OverviewPage,Team1,Team2,WinTeam,Gamelength,Team1Dragons,Team2Dragons,Team1Barons,Team2Barons,Team1Picks,Team1Bans",
  where: 'OverviewPage LIKE "%2026 Season World Championship%"',
  limit: 5,
};

interface QueryRun {
  label: string;
  status: number;
  outcome: CargoOutcome;
}

function describeRun(run: QueryRun): string {
  const o = run.outcome;
  switch (o.kind) {
    case "ok":
      return `${run.label}: HTTP ${run.status}, ${o.rows.length} rows`;
    case "rate_limited":
      return `${run.label}: HTTP ${run.status}, rate limited`;
    case "blocked":
      return `${run.label}: HTTP ${run.status}, blocked`;
    case "error":
      return `${run.label}: HTTP ${run.status}, error (${o.message})`;
  }
}

function rowCount(run: QueryRun): number {
  return run.outcome.kind === "ok" ? run.outcome.rows.length : 0;
}

const isDenied = (run: QueryRun): boolean => run.outcome.kind === "blocked" || run.outcome.kind === "rate_limited";

/** Runs both queries in order, pausing between requests. `cookie` is set only in bot mode. */
async function runQueries(deps: ProbeDeps, cookie?: string): Promise<[QueryRun, QueryRun]> {
  const headers = cookie ? { cookie } : undefined;
  const run = async (label: string, query: CargoQuery): Promise<QueryRun> => {
    const res = await deps.http(buildCargoUrl(query), { headers });
    return { label, status: res.status, outcome: classifyCargoResponse(res) };
  };
  const tournaments = await run("tournaments", TOURNAMENTS_QUERY);
  await deps.sleep(REQUEST_INTERVAL_MS);
  const scoreboard = await run("scoreboard", SCOREBOARD_QUERY);
  return [tournaments, scoreboard];
}

async function saveSamples(deps: ProbeDeps, [tournaments, scoreboard]: [QueryRun, QueryRun]): Promise<void> {
  if (tournaments.outcome.kind === "ok" && tournaments.outcome.rows.length > 0) {
    await deps.saveSample("leaguepedia-tournaments", tournaments.outcome.rows.slice(0, MAX_SAMPLE_ROWS));
  }
  if (scoreboard.outcome.kind === "ok" && scoreboard.outcome.rows.length > 0) {
    await deps.saveSample("leaguepedia-scoreboard", scoreboard.outcome.rows.slice(0, MAX_SAMPLE_ROWS));
  }
}

function judge(runs: [QueryRun, QueryRun]): Pick<ProbeOutcome, "verdict" | "summary"> {
  const [tournaments, scoreboard] = runs;
  if (rowCount(tournaments) > 0 && rowCount(scoreboard) > 0) {
    return { verdict: "ok", summary: "Tournaments and scoreboards readable" };
  }
  if (rowCount(tournaments) > 0) {
    return { verdict: "partial", summary: "Tournaments readable, scoreboards missing" };
  }
  if (runs.some(isDenied)) {
    return { verdict: "blocked", summary: "Cargo access denied or rate limited" };
  }
  const failed = runs.find((r) => r.outcome.kind === "error" || rowCount(r) === 0);
  return { verdict: "fail", summary: failed ? describeRun(failed) : "No data returned" };
}

async function run(deps: ProbeDeps): Promise<ProbeOutcome> {
  const details: string[] = [];

  let runs = await runQueries(deps);
  details.push("Mode: anonymous", ...runs.map((r) => `anonymous - ${describeRun(r)}`));

  const { leaguepediaUser: user, leaguepediaPassword: password } = deps.env;
  if (runs.some(isDenied) && user && password) {
    await deps.sleep(REQUEST_INTERVAL_MS);
    let cookie: string;
    try {
      cookie = await loginWithBotPassword(deps, user, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      details.push(`Mode: bot login failed (${message})`);
      return { verdict: "fail", summary: `Bot login failed: ${message}`, details };
    }
    await deps.sleep(REQUEST_INTERVAL_MS);
    runs = await runQueries(deps, cookie);
    details.push("Mode: bot (login ok)", ...runs.map((r) => `bot - ${describeRun(r)}`));
  }

  await saveSamples(deps, runs);
  return { ...judge(runs), details };
}

export const leaguepediaProbe: ProbeDefinition = {
  id: "leaguepedia",
  question: "Can the pipeline read Leaguepedia Cargo tables (tournaments and per-game scoreboards)?",
  run,
};
