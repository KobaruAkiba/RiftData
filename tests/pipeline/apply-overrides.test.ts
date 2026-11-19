import { describe, expect, test } from "vitest";
import type { Edition, Match, StageType } from "../../src/data/schema/index.js";
import { applyEditionOverrides } from "../../scripts/pipeline/worlds/apply-overrides.js";

const emptyMatch: Match = { id: "m", team1: "t1", team2: "geng", score1: 0, score2: 0, winner: null, games: [] };

function edition2026(stage: { id: string; type: StageType; matches: Match[] }): Edition {
  return {
    year: 2026,
    name: "Worlds 2026",
    overviewPages: ["2026 Season World Championship"],
    status: "ongoing",
    champion: null,
    coverage: { matches: stage.matches.length > 0, games: false },
    stages: [{ id: stage.id, name: stage.id, type: stage.type, order: 0, matches: stage.matches }],
  };
}

const edition2026WithStage = (id: string, type: StageType): Edition => edition2026({ id, type, matches: [] });
const edition2026WithMatch = (match: Partial<Match> & { id: string }): Edition => edition2026({ id: "main-event", type: "other", matches: [{ ...emptyMatch, ...match }] });

describe("applyEditionOverrides", () => {
  test("stage override changes type and name but not id", () => {
    const out = applyEditionOverrides(edition2026WithStage("swiss-stage", "other"), { stages: { "2026/swiss-stage": { type: "swiss", name: "Swiss Stage" } }, matches: {} });
    expect(out.stages[0]).toMatchObject({ id: "swiss-stage", type: "swiss", name: "Swiss Stage" });
  });

  test("match override patches only given fields and does not mutate input", () => {
    const input = edition2026WithMatch({ id: "m1", score1: 1, score2: 2, winner: "geng" });
    const out = applyEditionOverrides(input, { stages: {}, matches: { m1: { score1: 3, winner: "t1" } } });
    expect(out.stages[0]!.matches[0]).toMatchObject({ score1: 3, score2: 2, winner: "t1" });
    expect(input.stages[0]!.matches[0]!.score1).toBe(1);
    expect(input.stages[0]!.matches[0]!.winner).toBe("geng");
  });

  test("a null winner override clears the winner", () => {
    const out = applyEditionOverrides(edition2026WithMatch({ id: "m1", winner: "geng" }), { stages: {}, matches: { m1: { winner: null } } });
    expect(out.stages[0]!.matches[0]!.winner).toBeNull();
  });

  test("a date override keeps matches sorted by date", () => {
    const input = edition2026({
      id: "main-event",
      type: "other",
      matches: [
        { ...emptyMatch, id: "a", date: "2026-10-23T10:00:00Z" },
        { ...emptyMatch, id: "b", date: "2026-10-24T10:00:00Z" },
      ],
    });
    const out = applyEditionOverrides(input, { stages: {}, matches: { a: { date: "2026-10-25T10:00:00Z" } } });
    expect(out.stages[0]!.matches.map((m) => m.id)).toEqual(["b", "a"]);
  });

  test("keys without a matching stage or match are ignored", () => {
    const input = edition2026WithMatch({ id: "m1" });
    const out = applyEditionOverrides(input, { stages: { "2025/main-event": { name: "X" }, "2026/nope": { type: "swiss" } }, matches: { zz: { score1: 9 } } });
    expect(out).toEqual(input);
  });
});
