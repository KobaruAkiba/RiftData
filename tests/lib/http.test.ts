import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { httpRequest, NetworkError, USER_AGENT, withNetworkRetry, type HttpFn } from "../../scripts/lib/http.js";

let server: Server;
let base: string;
let lastRequestHeaders: Record<string, string | string[] | undefined> = {};

beforeAll(async () => {
  server = createServer((req, res) => {
    lastRequestHeaders = req.headers;
    if (req.url === "/missing") {
      res.statusCode = 404;
      res.end("nope");
    } else if (req.url === "/cookies") {
      res.setHeader("Set-Cookie", ["a=1; Path=/", "b=2; Path=/"]);
      res.setHeader("X-Custom", "v");
      res.end("ok");
    } else if (req.url === "/slow") {
      setTimeout(() => res.end("late"), 500);
    } else {
      res.end("ok");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("returns non-2xx status without throwing", async () => {
  const res = await httpRequest(`${base}/missing`);
  expect(res.status).toBe(404);
  expect(res.text).toBe("nope");
});

test("sends the generic User-Agent", async () => {
  await httpRequest(`${base}/echo-ua`);
  expect(lastRequestHeaders["user-agent"]).toBe(USER_AGENT);
  expect(USER_AGENT).not.toMatch(/@/);
});

test("lowercases headers and collects set-cookie", async () => {
  const res = await httpRequest(`${base}/cookies`);
  expect(res.headers["x-custom"]).toBe("v");
  expect(res.setCookie).toHaveLength(2);
});

test("rejects on timeout", async () => {
  await expect(httpRequest(`${base}/slow`, { timeoutMs: 50 })).rejects.toThrow();
});

test("a connection failure becomes a NetworkError with host, path and cause, without query or body", async () => {
  // Port 1 on loopback: nothing listens, the connection is refused.
  const error = await httpRequest("http://127.0.0.1:1/login?token=SECRET", {
    method: "POST",
    body: "lgpassword=hunter2",
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NetworkError);
  const { message, cause } = error as NetworkError;
  expect(message).toMatch(/^POST 127\.0\.0\.1:1\/login: fetch failed <- /);
  expect(message).not.toContain("SECRET");
  expect(message).not.toContain("hunter2");
  expect(cause).toBeInstanceOf(Error);
});

const okResult = { status: 200, headers: {}, setCookie: [], text: "ok" };

function flaky(failures: number, error: Error = new NetworkError("down")): { http: HttpFn; calls: () => number } {
  let n = 0;
  return {
    http: async () => {
      if (n++ < failures) throw error;
      return okResult;
    },
    calls: () => n,
  };
}

test("withNetworkRetry retries network errors with the backoff, then succeeds", async () => {
  const sleeps: number[] = [];
  const f = flaky(2);
  const retrying = withNetworkRetry(f.http, { sleep: async (ms) => void sleeps.push(ms), backoffMs: [10, 20, 30] });
  expect(await retrying("http://x/")).toBe(okResult);
  expect(f.calls()).toBe(3);
  expect(sleeps).toEqual([10, 20]);
});

test("withNetworkRetry gives up after the backoff is exhausted and rethrows the last NetworkError", async () => {
  const f = flaky(99);
  const retrying = withNetworkRetry(f.http, { sleep: async () => {}, backoffMs: [1, 1] });
  await expect(retrying("http://x/")).rejects.toBeInstanceOf(NetworkError);
  expect(f.calls()).toBe(3);
});

test("withNetworkRetry does not retry other errors", async () => {
  const f = flaky(99, new Error("boom"));
  const retrying = withNetworkRetry(f.http, { sleep: async () => {}, backoffMs: [1, 1] });
  await expect(retrying("http://x/")).rejects.toThrow("boom");
  expect(f.calls()).toBe(1);
});
