import { beforeEach, expect, test } from "vitest";
import { NetworkError, type HttpInit, type HttpResult } from "../../../scripts/lib/http.js";
import { buildCargoUrl, cargoString } from "../../../scripts/lib/leaguepedia/cargo.js";
import { connectCargo, createCargoClient } from "../../../scripts/lib/leaguepedia/client.js";

const page = (n: number) =>
  JSON.stringify({ cargoquery: Array.from({ length: n }, (_, i) => ({ title: { N: String(i) } })) });
const res = (status: number, text: string): HttpResult => ({ status, headers: {}, setCookie: [], text });
const ok = (n: number) => res(200, page(n));

let requestedUrls: string[];
let sleeps: number[];
let lastHeaders: Record<string, string>;

beforeEach(() => {
  requestedUrls = [];
  sleeps = [];
  lastHeaders = {};
});

/** Fake http answering with the queued responses in order; the last one repeats. */
function makeDeps(responses: HttpResult[]) {
  let i = 0;
  return {
    http: async (url: string, init?: HttpInit): Promise<HttpResult> => {
      requestedUrls.push(url);
      lastHeaders = init?.headers ?? {};
      return responses[Math.min(i++, responses.length - 1)]!;
    },
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
    },
  };
}

const QUERY = { tables: "T", fields: "N", orderBy: "T.N" };

test("buildCargoUrl adds order_by and offset", () => {
  const u = new URL(buildCargoUrl({ tables: "T", fields: "A", orderBy: "T.A", offset: 500, limit: 500 }));
  expect(u.searchParams.get("order_by")).toBe("T.A");
  expect(u.searchParams.get("offset")).toBe("500");
});

test("cargoString escapes quotes and backslashes", () => {
  expect(cargoString('Team "X" \\ Y')).toBe('"Team \\"X\\" \\\\ Y"');
});

test("query paginates until a short page and waits between requests", async () => {
  const rows = await createCargoClient(makeDeps([ok(500), ok(3)])).query(QUERY);
  expect(rows).toHaveLength(503);
  expect(requestedUrls.map((u) => new URL(u).searchParams.get("offset"))).toEqual(["0", "500"]);
  expect(sleeps).toEqual([2000]);
});

test("query retries rate_limited with backoff, then succeeds", async () => {
  const rows = await createCargoClient(makeDeps([res(429, ""), ok(2)])).query(QUERY);
  expect(rows).toHaveLength(2);
  expect(sleeps).toContain(10_000);
});

test("query gives up with rate_limited after the backoff is exhausted", async () => {
  await expect(createCargoClient(makeDeps([res(429, "")])).query(QUERY)).rejects.toMatchObject({
    kind: "rate_limited",
  });
  expect(sleeps.filter((ms) => ms >= 10_000)).toEqual([10_000, 30_000, 60_000]);
});

test("query throws CargoError blocked on 402 without retry", async () => {
  await expect(createCargoClient(makeDeps([res(402, "")])).query(QUERY)).rejects.toMatchObject({ kind: "blocked" });
  expect(requestedUrls).toHaveLength(1);
});

test("query sends the cookie when configured", async () => {
  await createCargoClient({ ...makeDeps([ok(1)]), cookie: "a=1" }).query(QUERY);
  expect(lastHeaders.cookie).toBe("a=1");
});

test("connectCargo without credentials throws blocked when anonymous access is blocked", async () => {
  await expect(connectCargo({ ...makeDeps([res(402, "")]), env: {} })).rejects.toMatchObject({ kind: "blocked" });
});

test("connectCargo logs in with bot credentials when anonymous access is blocked", async () => {
  const token = res(200, JSON.stringify({ query: { tokens: { logintoken: "tok" } } }));
  const login = { ...res(200, JSON.stringify({ login: { result: "Success" } })), setCookie: ["s=1; Path=/"] };
  const client = await connectCargo({
    ...makeDeps([res(402, ""), token, login, ok(1)]),
    env: { user: "u", password: "p" },
  });
  await client.query(QUERY);
  expect(lastHeaders.cookie).toBe("s=1");
});

test("connectCargo returns an anonymous client when the probe succeeds", async () => {
  const client = await connectCargo({ ...makeDeps([ok(1), ok(2)]), env: {} });
  expect(await client.query(QUERY)).toHaveLength(2);
  expect(lastHeaders.cookie).toBeUndefined();
});

test("connectCargo retries a network error on the probe and on the login", async () => {
  let probes = 0;
  let logins = 0;
  const http = async (url: string, init?: HttpInit): Promise<HttpResult> => {
    if (url.includes("cargoquery")) {
      if (probes++ === 0) throw new NetworkError("GET host/path: fetch failed <- read ECONNRESET");
      return res(402, "");
    }
    if (init?.method === "POST") return res(200, JSON.stringify({ login: { result: "Success" } }));
    if (logins++ === 0) throw new NetworkError("GET host/path: fetch failed <- getaddrinfo ENOTFOUND");
    return res(200, JSON.stringify({ query: { tokens: { logintoken: "tok" } } }));
  };
  await connectCargo({ http, sleep: async (ms) => void sleeps.push(ms), env: { user: "bot", password: "s3cret-pw" } });
  expect(probes).toBe(2);
  expect(logins).toBe(2);
  expect(sleeps).toContain(2000);
});

test("connectCargo gives up with a NetworkError that carries no credentials once the backoff is exhausted", async () => {
  const http = async (): Promise<HttpResult> => {
    throw new NetworkError("GET host/path: fetch failed");
  };
  const error = await connectCargo({ http, sleep: async () => {}, env: { user: "bot", password: "s3cret-pw" } }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(NetworkError);
  expect((error as Error).message).not.toContain("s3cret-pw");
});
