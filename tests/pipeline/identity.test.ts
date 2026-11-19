import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { buildTeamIdentity, isSameOrgVerb, slugify } from "../../scripts/pipeline/teams/identity.js";
import type { RenameRow } from "../../scripts/pipeline/leaguepedia/queries.js";

const r = (OriginalName: string, NewName: string, Verb: string, Date = "2020-01-01"): RenameRow => ({ OriginalName, NewName, Verb, Date });

describe("slugify", () => {
  test("strips diacritics and punctuation", () => {
    expect(slugify("Gen.G")).toBe("gen-g");
    expect(slugify("Team Liquid Honda")).toBe("team-liquid-honda");
    expect(slugify("Fünatic  Esports!")).toBe("funatic-esports");
  });
});

describe("buildTeamIdentity", () => {
  test("a renamed team keeps the same id across names", () => {
    const id = buildTeamIdentity([r("SK Telecom T1", "T1", "rename", "2019-10-29")], [{ Name: "T1", Short: "T1", Region: "Korea" }], ["SK Telecom T1", "T1"], { merge: [] });
    expect(id.resolve("SK Telecom T1")).toBe("t1");
    expect(id.resolve("T1")).toBe("t1");
    expect(id.teams()).toEqual([{ id: "t1", name: "T1", short: "T1", region: "Korea", aliases: ["SK Telecom T1", "T1"] }]);
  });
  test("an acquired slot is a different team", () => {
    const id = buildTeamIdentity([r("Old Org", "New Org", "acquire")], [], ["Old Org", "New Org"], { merge: [] });
    expect(id.resolve("Old Org")).toBe("old-org");
    expect(id.resolve("New Org")).toBe("new-org");
  });
  test("chains are followed and cycles do not loop", () => {
    const id = buildTeamIdentity([r("A", "B", "rename", "2018-01-01"), r("B", "C", "rename", "2019-01-01"), r("C", "A", "rename", "2017-01-01")], [], ["A"], { merge: [] });
    expect(["a", "b", "c"]).toContain(id.resolve("A"));
  });
  test("the most recent edge wins when a name has several", () => {
    const id = buildTeamIdentity([r("A", "B", "rename", "2018-01-01"), r("A", "C", "rename", "2019-01-01")], [], ["A"], { merge: [] });
    expect(id.resolve("A")).toBe("c");
  });
  test("merge override forces two names into one team", () => {
    const id = buildTeamIdentity([], [], ["Fnatic", "Fnatic Academy"], { merge: [{ from: "Fnatic Academy", into: "Fnatic" }] });
    expect(id.resolve("Fnatic Academy")).toBe("fnatic");
  });
  test("merge override wins over a more recent rename edge", () => {
    const id = buildTeamIdentity([r("A", "B", "rename", "2020-01-01")], [], ["A"], { merge: [{ from: "A", into: "Z" }] });
    expect(id.resolve("A")).toBe("z");
  });
  test("TBD placeholders resolve to null", () => {
    const id = buildTeamIdentity([], [], [], { merge: [] });
    expect(id.resolve("TBD")).toBeNull();
    expect(id.resolve("")).toBeNull();
  });
  test("slug collisions get a region suffix", () => {
    const id = buildTeamIdentity([], [{ Name: "Team X", Short: "", Region: "Europe" }, { Name: "Team-X", Short: "", Region: "Korea" }], ["Team X", "Team-X"], { merge: [] });
    expect(new Set([id.resolve("Team X"), id.resolve("Team-X")])).toEqual(new Set(["team-x", "team-x-korea"]));
  });
  test("slug collisions without a region get the -2 suffix", () => {
    const id = buildTeamIdentity([], [], ["Team X", "Team-X"], { merge: [] });
    expect(id.resolve("Team X")).toBe("team-x");
    expect(id.resolve("Team-X")).toBe("team-x-2");
  });
  test("short and region fall back to the most recent alias row", () => {
    const id = buildTeamIdentity([r("Old", "New", "rename", "2020-01-01")], [{ Name: "Old", Short: "OLD", Region: "EU" }], ["Old", "New"], { merge: [] });
    expect(id.teams()).toEqual([{ id: "new", name: "New", short: "OLD", region: "EU", aliases: ["New", "Old"] }]);
  });
  test("teams() is sorted by id and only lists teams in use", () => {
    const id = buildTeamIdentity([r("Zed", "Alpha", "rename")], [], ["Zed", "Beta"], { merge: [] });
    expect(id.teams().map((t) => t.id)).toEqual(["alpha", "beta"]);
  });
});

describe("isSameOrgVerb", () => {
  test("classifies every real Leaguepedia verb", async () => {
    const verbs: Record<string, number> = JSON.parse(await readFile("tests/fixtures/leaguepedia/rename-verbs.json", "utf8"));
    const sameOrg = new Set(["rename", "Rename", "rebrand", "reband"]);
    const differentOrg = new Set(["acquire", "Acquire", "acuire", "partner"]);
    for (const verb of Object.keys(verbs)) {
      expect(sameOrg.has(verb) || differentOrg.has(verb), `unexpected verb ${verb}`).toBe(true);
      expect(isSameOrgVerb(verb), verb).toBe(sameOrg.has(verb));
    }
  });
});

describe("real renames fixture", () => {
  test("SK Telecom T1 resolves to t1 and sister teams stay separate", async () => {
    const renames: RenameRow[] = JSON.parse(await readFile("tests/fixtures/leaguepedia/renames.json", "utf8"));
    const names = ["SK Telecom T1", "T1", "SK Telecom T1 1", "SK Telecom T1 S", "SK Telecom T1 K", "Eat Sleep Game"];
    const id = buildTeamIdentity(renames, [], names, { merge: [] });
    expect(id.resolve("SK Telecom T1")).toBe("t1");
    expect(id.resolve("T1")).toBe("t1");
    // Sister team: renamed within itself, never merged into T1; the acquire is not followed.
    expect(id.resolve("SK Telecom T1 1")).toBe("sk-telecom-t1-s");
    expect(id.resolve("Eat Sleep Game")).toBe("eat-sleep-game");
    expect(id.resolve("SK Telecom T1 K")).toBe("sk-telecom-t1-k");
  });
});
