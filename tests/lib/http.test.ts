import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { httpRequest, USER_AGENT } from "../../scripts/lib/http.js";

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
