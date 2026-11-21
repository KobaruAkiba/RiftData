import { beforeEach, expect, test } from "vitest";
import type { HttpInit, HttpResult } from "../../../scripts/lib/http.js";
import {
  LOLESPORTS_BACKOFF_MS,
  LOLESPORTS_INTERVAL_MS,
  LolesportsRequestError,
  createLolesportsClient,
  toStartingTime,
} from "../../../scripts/lib/lolesports/client.js";
import { LOLESPORTS_PUBLIC_KEY } from "../../../scripts/lib/sources.js";

const res = (status: number, text = ""): HttpResult => ({ status, headers: {}, setCookie: [], text });

let urls: string[];
let headersSeen: Array<Record<string, string> | undefined>;
let sleeps: number[];

beforeEach(() => {
  urls = [];
  headersSeen = [];
  sleeps = [];
});

/** Fake http answering with the queued outcomes in order; the last one repeats. An Error outcome is thrown. */
function makeDeps(outcomes: Array<HttpResult | Error>) {
  let i = 0;
  return {
    http: async (url: string, init?: HttpInit): Promise<HttpResult> => {
      urls.push(url);
      headersSeen.push(init?.headers);
      const outcome = outcomes[Math.min(i++, outcomes.length - 1)]!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
  };
}

test("consecutive requests are spaced by at least 500 ms", async () => {
  const client = createLolesportsClient(makeDeps([res(200, '{"frames":[]}')]));
  await client.window("1");
  expect(sleeps).toEqual([]);
  await client.window("1");
  await client.details("1");
  expect(sleeps).toHaveLength(2);
  for (const ms of sleeps) expect(ms).toBeGreaterThanOrEqual(LOLESPORTS_INTERVAL_MS);
});

test("api requests send x-api-key, feed requests do not", async () => {
  const client = createLolesportsClient(makeDeps([res(200, "{}")]));
  await client.tournaments();
  await client.completedEvents("42");
  await client.window("7");
  expect(urls[0]).toContain("/getTournamentsForLeague?hl=en-US&leagueId=98767975604431411");
  expect(urls[1]).toContain("/getCompletedEvents?hl=en-US&tournamentId=42");
  expect(headersSeen[0]).toEqual({ "x-api-key": LOLESPORTS_PUBLIC_KEY });
  expect(headersSeen[1]).toEqual({ "x-api-key": LOLESPORTS_PUBLIC_KEY });
  expect(Object.keys(headersSeen[2] ?? {})).not.toContain("x-api-key");
});

test("startingTime goes in the query string", async () => {
  const client = createLolesportsClient(makeDeps([res(200, "{}")]));
  await client.window("7", "2026-10-15T18:26:30Z");
  await client.details("7");
  expect(urls[0]).toMatch(/\/window\/7\?startingTime=2026-10-15T18%3A26%3A30Z$/);
  expect(urls[1]).toMatch(/\/details\/7$/);
});

test("204 and empty body return null", async () => {
  expect(await createLolesportsClient(makeDeps([res(204)])).window("1")).toBeNull();
  expect(await createLolesportsClient(makeDeps([res(200, "")])).details("1")).toBeNull();
  expect(await createLolesportsClient(makeDeps([res(200, "not json")])).window("1")).toBeNull();
});

test("a 200 body is returned parsed", async () => {
  const body = await createLolesportsClient(makeDeps([res(200, '{"frames":[1]}')])).window("1");
  expect(body).toEqual({ frames: [1] });
});

test("429 then 200 retries and succeeds; the wait grows", async () => {
  const client = createLolesportsClient(makeDeps([res(429), res(503), res(200, '{"a":1}')]));
  expect(await client.completedEvents("1")).toEqual({ a: 1 });
  expect(urls).toHaveLength(3);
  expect(sleeps).toContain(LOLESPORTS_BACKOFF_MS[0]);
  expect(sleeps).toContain(LOLESPORTS_BACKOFF_MS[1]);
});

test("a network error is retried", async () => {
  const client = createLolesportsClient(makeDeps([new Error("socket hang up"), res(200, "{}")]));
  expect(await client.tournaments()).toEqual({});
  expect(urls).toHaveLength(2);
});

test("persistent 5xx throws after the last attempt", async () => {
  const client = createLolesportsClient(makeDeps([res(503)]));
  await expect(client.window("1")).rejects.toThrow(/503/);
  expect(urls).toHaveLength(LOLESPORTS_BACKOFF_MS.length + 1);
});

test("exhausted retries throw LolesportsRequestError (5xx and network); a 403 does not", async () => {
  await expect(createLolesportsClient(makeDeps([res(503)])).window("1")).rejects.toBeInstanceOf(LolesportsRequestError);
  await expect(createLolesportsClient(makeDeps([new Error("socket hang up")])).details("1")).rejects.toBeInstanceOf(LolesportsRequestError);
  const forbidden = createLolesportsClient(makeDeps([res(403)])).completedEvents("1");
  await expect(forbidden).rejects.not.toBeInstanceOf(LolesportsRequestError);
});

test("a client error other than 429 throws without retrying (api), and a missing game is null (feed)", async () => {
  const api = createLolesportsClient(makeDeps([res(403)]));
  await expect(api.completedEvents("1")).rejects.toThrow(/403/);
  expect(urls).toHaveLength(1);
  expect(await createLolesportsClient(makeDeps([res(404)])).window("1")).toBeNull();
});

test("toStartingTime floors to 10 seconds and drops milliseconds", () => {
  expect(toStartingTime(new Date("2026-10-12T08:15:37.912Z"))).toBe("2026-10-12T08:15:30Z");
});
