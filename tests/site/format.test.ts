import { expect, test } from "vitest";
import type { Team } from "../../src/data/schema/index.js";
import { formatMatchDay } from "../../src/lib/format/date.js";
import { stageTypeLabel, statusLabel } from "../../src/lib/format/labels.js";
import { formatScore } from "../../src/lib/format/score.js";
import { createTeamLookup, stripDisambiguation } from "../../src/lib/format/team.js";

const teams: Team[] = [
  { id: "gen-g", name: "Gen.G", short: "GEN", region: "Korea", aliases: ["Gen.G"] },
  { id: "lyon-2024-american-team", name: "LYON (2024 American Team)", aliases: ["LYON (2024 American Team)"] },
];
const lookup = createTeamLookup(teams);

test("strips only a trailing Leaguepedia disambiguation", () => {
  expect(stripDisambiguation("LYON (2024 American Team)")).toBe("LYON");
  expect(stripDisambiguation("Gen.G")).toBe("Gen.G");
  expect(stripDisambiguation("Team (A) Name")).toBe("Team (A) Name");
});
test("team labels use short when present, else the stripped name", () => {
  expect(lookup("gen-g")).toEqual({ id: "gen-g", name: "Gen.G", short: "GEN", region: "Korea" });
  expect(lookup("lyon-2024-american-team")).toEqual({ id: "lyon-2024-american-team", name: "LYON", short: "LYON" });
});
test("null team is TBD and unknown id falls back to the id", () => {
  expect(lookup(null)).toEqual({ id: null, name: "TBD", short: "TBD" });
  expect(lookup("ghost-team")).toEqual({ id: "ghost-team", name: "ghost-team", short: "ghost-team" });
});
test("match day is computed in UTC", () => {
  expect(formatMatchDay("2026-11-14T19:00:00Z")).toBe("Nov 14");
  expect(formatMatchDay("2026-10-15T23:30:00Z")).toBe("Oct 15");
  expect(formatMatchDay(undefined)).toBeNull();
});
test("scores and labels", () => {
  expect(formatScore(3)).toBe("3");
  expect(formatScore(null)).toBe("–");
  expect(statusLabel("completed")).toBe("Completed");
  expect(stageTypeLabel("single-elimination")).toBe("Knockout");
  expect(stageTypeLabel("other")).toBe("Main Event");
});
