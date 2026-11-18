import { expect, test } from "vitest";
import { renderReport, runProbe, type ProbeDeps } from "../../scripts/spike/probe.js";

const fakeDeps: ProbeDeps = {
  http: async () => ({ status: 200, headers: {}, setCookie: [], text: "" }),
  sleep: async () => {},
  saveSample: async () => {},
  env: {},
};

test("runProbe turns a thrown error into a fail verdict", async () => {
  const def = {
    id: "cors",
    question: "q",
    run: async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    },
  } as const;
  const r = await runProbe(def, fakeDeps);
  expect(r).toMatchObject({ id: "cors", verdict: "fail", summary: "getaddrinfo ENOTFOUND" });
});

test("renderReport lists every probe, including failed ones", () => {
  const md = renderReport(
    [
      { id: "leaguepedia", question: "A?", verdict: "ok", summary: "fine", details: ["d1"] },
      { id: "cors", question: "B?", verdict: "fail", summary: "boom", details: [] },
    ],
    new Date("2026-11-19T10:00:00Z"),
  );
  expect(md).toContain("2026-11-19T10:00:00.000Z");
  expect(md).toMatch(/\| leaguepedia \| A\? \| ok \| fine \|/);
  expect(md).toMatch(/\| cors \| B\? \| fail \| boom \|/);
  expect(md).toContain("- d1");
});
