import { withNetworkRetry, type HttpInit, type HttpResult } from "../http.js";
import { loginWithBotPassword } from "./auth.js";
import { buildCargoUrl, classifyCargoResponse, type CargoOutcome, type CargoQuery } from "./cargo.js";

export const CARGO_PAGE_SIZE = 500;
export const CARGO_INTERVAL_MS = 2000;
export const CARGO_BACKOFF_MS = [10_000, 30_000, 60_000];

export type Row = Record<string, string>;

export class CargoError extends Error {
  // Declared explicitly (not a parameter property) to stay valid under erasableSyntaxOnly.
  public kind: "blocked" | "rate_limited" | "error";

  constructor(kind: "blocked" | "rate_limited" | "error", message: string) {
    super(message);
    this.name = "CargoError";
    this.kind = kind;
  }
}

export interface CargoClientDeps {
  http: (url: string, init?: HttpInit) => Promise<HttpResult>;
  sleep: (ms: number) => Promise<void>;
  cookie?: string;
}

export interface CargoClient {
  query(q: Omit<CargoQuery, "limit" | "offset"> & { orderBy: string }): Promise<Row[]>;
}

/** Enforces the minimum interval: every request but the first is preceded by a pause. */
type Pacer = () => Promise<void>;

function createPacer(sleep: (ms: number) => Promise<void>): Pacer {
  let first = true;
  return async () => {
    if (!first) await sleep(CARGO_INTERVAL_MS);
    first = false;
  };
}

/** One paced request, retrying rate limits with the configured backoff. Blocked fails at once. */
async function requestWithRetry(deps: CargoClientDeps, pace: Pacer, url: string): Promise<Row[]> {
  const headers = deps.cookie ? { cookie: deps.cookie } : undefined;
  for (let attempt = 0; ; attempt++) {
    await pace();
    const outcome = classifyCargoResponse(await deps.http(url, { headers }));
    switch (outcome.kind) {
      case "ok":
        return outcome.rows;
      case "blocked":
        throw new CargoError("blocked", `Leaguepedia Cargo access blocked (status ${outcome.status})`);
      case "error":
        throw new CargoError("error", outcome.message);
      case "rate_limited": {
        const wait = CARGO_BACKOFF_MS[attempt];
        if (wait === undefined) {
          throw new CargoError("rate_limited", "Leaguepedia Cargo rate limit persists after retries");
        }
        await deps.sleep(wait);
      }
    }
  }
}

function buildClient(deps: CargoClientDeps, pace: Pacer): CargoClient {
  return {
    async query(q) {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += CARGO_PAGE_SIZE) {
        const url = buildCargoUrl({ ...q, limit: CARGO_PAGE_SIZE, offset });
        const page = await requestWithRetry(deps, pace, url);
        rows.push(...page);
        if (page.length < CARGO_PAGE_SIZE) return rows;
      }
    },
  };
}

export function createCargoClient(deps: CargoClientDeps): CargoClient {
  return buildClient(deps, createPacer(deps.sleep));
}

const PROBE_QUERY: CargoQuery = { tables: "Tournaments", fields: "Name", limit: 1 };

/**
 * Connects anonymously when possible. A probe query decides: if access is blocked or rate limited
 * and bot credentials exist, logs in and returns a client with the session cookie.
 * The probe, the login and the returned client share one pacer, so the 2000 ms interval holds throughout.
 * Network errors are retried with backoff on every request, login included.
 */
export async function connectCargo(
  deps: Omit<CargoClientDeps, "cookie"> & { env: { user?: string; password?: string } },
): Promise<CargoClient> {
  const { env, ...raw } = deps;
  // Probe, login and Cargo queries all go through the same network retry: a transient reset must not abort a run.
  const base = { ...raw, http: withNetworkRetry(raw.http, { sleep: raw.sleep }) };
  const pace = createPacer(base.sleep);

  await pace();
  const probe: CargoOutcome = classifyCargoResponse(await base.http(buildCargoUrl(PROBE_QUERY)));
  const denied = probe.kind === "blocked" || probe.kind === "rate_limited";

  if (!denied) return buildClient(base, pace);
  if (env.user && env.password) {
    await pace();
    const cookie = await loginWithBotPassword({ http: base.http, sleep: base.sleep }, env.user, env.password);
    return buildClient({ ...base, cookie }, pace);
  }
  if (probe.kind === "blocked") {
    throw new CargoError("blocked", `Leaguepedia Cargo access blocked (status ${probe.status}); set bot credentials`);
  }
  // Rate limited without credentials: the client's own backoff handles it.
  return buildClient(base, pace);
}
