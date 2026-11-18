import { expect, test } from "vitest";
import type { HttpResult } from "../../scripts/lib/http.js";
import {
  buildFeedUrl,
  classifyFeed,
  extractGameIds,
  firstFrameTime,
  livestatsProbe,
  pickWorldsTournament,
  toStartingTime,
} from "../../scripts/spike/livestats.js";
import type { ProbeDeps } from "../../scripts/spike/probe.js";

const res = (status: number, text: string): HttpResult => ({ status, headers: {}, setCookie: [], text });
const frames = (ts: string) => JSON.stringify({ frames: [{ rfc460Timestamp: ts }] });

test("toStartingTime floors to 10 seconds and drops milliseconds", () => {
  expect(toStartingTime(new Date("2026-10-12T08:15:37.912Z"))).toBe("2026-10-12T08:15:30Z");
});

test("buildFeedUrl adds startingTime only when given", () => {
  expect(buildFeedUrl("window", "123")).toBe("https://feed.lolesports.com/livestats/v1/window/123");
  expect(buildFeedUrl("details", "123", "2026-10-12T08:15:30Z")).toBe(
    "https://feed.lolesports.com/livestats/v1/details/123?startingTime=2026-10-12T08%3A15%3A30Z",
  );
});

test("204 or empty body means no coverage, without throwing", () => {
  expect(classifyFeed(res(204, ""), null)).toBe("none");
  expect(classifyFeed(res(200, ""), null)).toBe("none");
  expect(classifyFeed(res(200, '{"frames":[]}'), null)).toBe("none");
});

test("first frames without mid-game frames is partial", () => {
  expect(classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), res(204, ""))).toBe("partial");
});

test("frames at start and mid-game is full", () => {
  expect(
    classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), res(200, frames("2026-10-12T08:10:00Z"))),
  ).toBe("full");
});

test("pickWorldsTournament matches slug, then start year", () => {
  const list = [
    { id: "a", slug: "msi_2026", startDate: "2026-06-27" },
    { id: "b", slug: "worlds_2026", startDate: "2026-09-29" },
    { id: "c", slug: "championship", startDate: "2019-10-02" },
  ];
  expect(pickWorldsTournament(list, 2026)?.id).toBe("b");
  expect(pickWorldsTournament(list, 2019)?.id).toBe("c");
  expect(pickWorldsTournament(list, 2018)).toBeUndefined();
});

test("extractGameIds keeps only completed games", () => {
  const json = {
    data: {
      schedule: {
        events: [{ match: {}, games: [{ id: "g1", state: "completed" }, { id: "g2", state: "unneeded" }] }],
      },
    },
  };
  expect(extractGameIds(json)).toEqual(["g1"]);
});

test("parsers never throw on non-JSON or unexpected shapes", () => {
  expect(firstFrameTime(res(200, "<html>nope</html>"))).toBeNull();
  expect(firstFrameTime(res(200, "null"))).toBeNull();
  expect(firstFrameTime(res(200, '{"frames":[{"rfc460Timestamp":"garbage"}]}'))).toBeNull();
  expect(firstFrameTime(res(200, '{"frames":[null]}'))).toBeNull();
  expect(firstFrameTime(res(200, frames("2026-10-12T08:00:00Z")))?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
  expect(classifyFeed(res(200, "<html>"), res(200, "<html>"))).toBe("none");
  expect(classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), res(200, "not json"))).toBe("partial");
  expect(classifyFeed(res(200, frames("2026-10-12T08:00:00Z")), null)).toBe("partial");
  for (const junk of [undefined, null, 42, "x", [], {}, { data: null }, { data: { schedule: { events: "x" } } }]) {
    expect(extractGameIds(junk)).toEqual([]);
  }
  expect(extractGameIds({ data: { schedule: { events: [null, { games: null }, { games: [null, 3] }] } } })).toEqual([]);
});

test("probe reports partial when one 2026 game is full and the other has no frames", async () => {
  const samples: Record<string, unknown> = {};
  const sleeps: number[] = [];
  const requested: string[] = [];
  const first = "2026-10-12T08:00:00Z";
  const json = (data: unknown) => res(200, JSON.stringify(data));

  const http: ProbeDeps["http"] = async (url) => {
    requested.push(url);
    if (url.includes("getTournamentsForLeague")) {
      return json({
        data: { leagues: [{ tournaments: [{ id: "t26", slug: "worlds_2026", startDate: "2026-09-29" }] }] },
      });
    }
    if (url.includes("getCompletedEvents")) {
      return json({
        data: {
          schedule: {
            events: [
              {
                match: {},
                games: [
                  { id: "g1", state: "completed" },
                  { id: "g2", state: "completed" },
                ],
              },
            ],
          },
        },
      });
    }
    if (url.includes("/details/g1")) {
      return json({ frames: [{ rfc460Timestamp: first, participants: [{ items: [1], perkMetadata: {} }] }] });
    }
    if (url.includes("/window/g1")) return json({ frames: [{ rfc460Timestamp: first }] });
    return res(204, "");
  };

  const deps: ProbeDeps = {
    http,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    saveSample: async (name, data) => {
      samples[name] = data;
    },
    env: {},
  };

  expect(livestatsProbe.question).toBe(
    "How far back does the livestats feed keep frames, and is every Worlds 2026 game recoverable?",
  );
  const out = await livestatsProbe.run(deps);

  expect(out.verdict).toBe("partial");
  expect(out.details.join("\n")).toContain("2026: full 1 / partial 0 / none 1 su 2");
  expect(out.details.join("\n")).toMatch(/items.*perkMetadata|perkMetadata.*items/);
  expect(sleeps.length).toBeGreaterThan(0);
  expect(sleeps.every((ms) => ms === 500)).toBe(true);
  expect(Object.keys(samples).sort()).toEqual([
    "livestats-details-2026",
    "livestats-window-2026",
    "lolesports-completed-events-2026",
  ]);
  expect(requested.some((u) => u.includes("startingTime=2026-10-12T08%3A10%3A00Z"))).toBe(true);
});

test("probe fails when the 2026 tournament cannot be found", async () => {
  const deps: ProbeDeps = {
    http: async () => res(200, JSON.stringify({ data: { leagues: [{ tournaments: [] }] } })),
    sleep: async () => {},
    saveSample: async () => {},
    env: {},
  };
  const out = await livestatsProbe.run(deps);
  expect(out.verdict).toBe("fail");
});
