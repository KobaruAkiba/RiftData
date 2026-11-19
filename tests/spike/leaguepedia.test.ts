import { expect, test } from "vitest";
import type { HttpInit, HttpResult } from "../../scripts/lib/http.js";
import type { ProbeDeps } from "../../scripts/spike/probe.js";
import {
  buildCargoUrl,
  classifyCargoResponse,
  leaguepediaProbe,
} from "../../scripts/spike/leaguepedia.js";

const res = (status: number, text: string, setCookie: string[] = []): HttpResult => ({
  status,
  headers: {},
  setCookie,
  text,
});

const PASSWORD = "s3cr3t-pw";
const TOURNAMENT_ROWS = [{ title: { Name: "Worlds 2026", OverviewPage: "2026 Season World Championship" } }];
const SCOREBOARD_ROWS = Array.from({ length: 7 }, (_, i) => ({ title: { OverviewPage: "p", Team1: `T${i}` } }));

interface Log {
  sleeps: number[];
  requests: string[];
  samples: Record<string, unknown>;
}

interface FakeOptions {
  /** Anonymous cargo requests get this response (default 402). */
  anonymous?: () => HttpResult;
  /** When true, cargo queries succeed without login. */
  anonymousAccess?: boolean;
  /** Whether the scoreboard query returns rows (default true). */
  scoreboardRows?: boolean;
}

/** Fake http routed by URL/method: login flow sets a session cookie that unlocks cargo queries. */
function fakeHttp(opts: FakeOptions = {}) {
  return async (url: string, init: HttpInit = {}): Promise<HttpResult> => {
    if (url.includes("meta=tokens")) {
      return res(200, JSON.stringify({ query: { tokens: { logintoken: "tok" } } }), ["pre=1; Path=/"]);
    }
    if (init.method === "POST") {
      const form = new URLSearchParams(init.body);
      const good = form.get("lgpassword") === PASSWORD && init.headers?.cookie === "pre=1";
      return res(200, JSON.stringify({ login: { result: good ? "Success" : "Failed" } }), [
        "session=ok; Path=/; HttpOnly",
      ]);
    }
    const authed = opts.anonymousAccess === true || (init.headers?.cookie?.includes("session=ok") ?? false);
    if (!authed) return (opts.anonymous ?? (() => res(402, "Payment Required")))();
    const isTournaments = new URL(url).searchParams.get("tables") === "Tournaments";
    if (isTournaments) return res(200, JSON.stringify({ cargoquery: TOURNAMENT_ROWS }));
    return res(200, JSON.stringify({ cargoquery: opts.scoreboardRows === false ? [] : SCOREBOARD_ROWS }));
  };
}

function fakeDeps(
  env: ProbeDeps["env"],
  opts: FakeOptions = {},
  log: Log = { sleeps: [], requests: [], samples: {} },
): ProbeDeps {
  const http = fakeHttp(opts);
  return {
    http: async (url, init) => {
      log.requests.push(`${init?.method ?? "GET"} ${url}`);
      return http(url, init);
    },
    sleep: async (ms) => {
      log.sleeps.push(ms);
    },
    saveSample: async (name, data) => {
      log.samples[name] = data;
    },
    env,
  };
}

test("buildCargoUrl encodes the where clause", () => {
  const url = new URL(
    buildCargoUrl({ tables: "Tournaments", fields: "Name", where: 'Name LIKE "%Worlds%"', limit: 5 }),
  );
  expect(url.searchParams.get("action")).toBe("cargoquery");
  expect(url.searchParams.get("format")).toBe("json");
  expect(url.searchParams.get("where")).toBe('Name LIKE "%Worlds%"');
  expect(url.searchParams.get("limit")).toBe("5");
});

test("200 with cargoquery rows is ok", () => {
  expect(classifyCargoResponse(res(200, '{"cargoquery":[{"title":{"Name":"X"}}]}'))).toEqual({
    kind: "ok",
    rows: [{ Name: "X" }],
  });
});

test("200 with ratelimited error body is rate_limited, not ok", () => {
  expect(
    classifyCargoResponse(res(200, '{"error":{"code":"ratelimited","info":"slow down"}}')).kind,
  ).toBe("rate_limited");
});

test("429 is rate_limited", () => {
  expect(classifyCargoResponse(res(429, "Too Many Requests")).kind).toBe("rate_limited");
});

test("401, 402 and 403 are blocked", () => {
  for (const status of [401, 402, 403]) {
    expect(classifyCargoResponse(res(status, "nope"))).toEqual({ kind: "blocked", status });
  }
});

test("HTML body is an error, not a crash", () => {
  const out = classifyCargoResponse(res(200, "<html>captcha</html>"));
  expect(out).toEqual({ kind: "error", message: "non-JSON response (status 200)" });
});

test("other JSON errors report status and error.info", () => {
  const out = classifyCargoResponse(res(200, '{"error":{"code":"badfield","info":"Unknown field X"}}'));
  expect(out.kind).toBe("error");
  expect(out.kind === "error" && out.message).toContain("200");
  expect(out.kind === "error" && out.message).toContain("Unknown field X");
});

test("probe falls back to bot login and never leaks the password", async () => {
  const out = await leaguepediaProbe.run(
    fakeDeps({ leaguepediaUser: "Bot@spike", leaguepediaPassword: PASSWORD }),
  );
  expect(out.verdict).toBe("ok");
  expect(out.details.join("\n")).toMatch(/bot/i);
  expect(JSON.stringify(out)).not.toContain(PASSWORD);
});

test("probe without credentials reports blocked on 402", async () => {
  const out = await leaguepediaProbe.run(fakeDeps({}));
  expect(out.verdict).toBe("blocked");
});

test("probe falls back to bot login on a rate_limited 200 body", async () => {
  const limited = () => res(200, '{"error":{"code":"ratelimited"}}');
  const out = await leaguepediaProbe.run(
    fakeDeps({ leaguepediaUser: "Bot@spike", leaguepediaPassword: PASSWORD }, { anonymous: limited }),
  );
  expect(out.verdict).toBe("ok");
});

test("anonymous success: no login, 2000 ms pause between requests, truncated samples", async () => {
  const log: Log = { sleeps: [], requests: [], samples: {} };
  const out = await leaguepediaProbe.run(fakeDeps({}, { anonymousAccess: true }, log));
  expect(out.verdict).toBe("ok");
  expect(log.requests).toHaveLength(2);
  expect(log.sleeps).toEqual([2000]);
  expect(out.details.join("\n")).toMatch(/anonymous/i);
  expect(log.samples["leaguepedia-tournaments"]).toEqual([TOURNAMENT_ROWS[0]!.title]);
  expect((log.samples["leaguepedia-scoreboard"] as unknown[]).length).toBe(5);
});

test("tournaments without scoreboard rows is partial", async () => {
  const out = await leaguepediaProbe.run(
    fakeDeps({ leaguepediaUser: "Bot@spike", leaguepediaPassword: PASSWORD }, { scoreboardRows: false }),
  );
  expect(out.verdict).toBe("partial");
});

test("failed bot login reports fail without leaking the password", async () => {
  const out = await leaguepediaProbe.run(
    fakeDeps({ leaguepediaUser: "Bot@spike", leaguepediaPassword: "wrong-" + PASSWORD }),
  );
  expect(out.verdict).toBe("fail");
  expect(JSON.stringify(out)).not.toContain(PASSWORD);
});

test("probe declares the expected question", () => {
  expect(leaguepediaProbe.id).toBe("leaguepedia");
  expect(leaguepediaProbe.question).toBe(
    "Can the pipeline read Leaguepedia Cargo tables (tournaments and per-game scoreboards)?",
  );
});
