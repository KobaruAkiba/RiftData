import { expect, test } from "vitest";
import type { HttpResult } from "../../scripts/lib/http.js";
import { corsProbe, evaluateCors } from "../../scripts/spike/cors.js";
import type { ProbeDeps } from "../../scripts/spike/probe.js";

const r = (status: number, headers: Record<string, string>): HttpResult => ({
  status,
  headers,
  setCookie: [],
  text: "",
});
const O = "https://riftdata.pages.dev";

test("wildcard origin and allowed x-api-key is allowed", () => {
  expect(
    evaluateCors(
      r(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "Content-Type, X-Api-Key" }),
      r(200, { "access-control-allow-origin": "*" }),
      O,
    ).allowed,
  ).toBe(true);
});

test("wildcard origin without x-api-key in preflight is not allowed", () => {
  const v = evaluateCors(
    r(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }),
    r(200, { "access-control-allow-origin": "*" }),
    O,
  );
  expect(v.allowed).toBe(false);
  expect(v.reason).toMatch(/x-api-key/);
});

test("preflight failure is not allowed", () => {
  expect(evaluateCors(r(403, {}), r(200, { "access-control-allow-origin": "*" }), O).allowed).toBe(false);
});

test("GET without allow-origin is not allowed", () => {
  expect(
    evaluateCors(
      r(204, { "access-control-allow-origin": O, "access-control-allow-headers": "*" }),
      r(200, {}),
      O,
    ).allowed,
  ).toBe(false);
});

test("probe returns ok when both endpoints allow the origin", async () => {
  const deps: ProbeDeps = {
    http: async (_url, init) =>
      init?.method === "OPTIONS"
        ? r(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "x-api-key" })
        : r(200, { "access-control-allow-origin": "*" }),
    sleep: async () => {},
    saveSample: async () => {},
    env: {},
  };
  const outcome = await corsProbe.run(deps);
  expect(outcome.verdict).toBe("ok");
  expect(outcome.details.length).toBeGreaterThan(0);
});
