import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
  gamesQuery,
  inList,
  matchesQuery,
  playersQuery,
  renamesQuery,
  teamsQuery,
  tournamentsQuery,
} from "../../scripts/pipeline/leaguepedia/queries.js";

const defs = [
  tournamentsQuery(),
  matchesQuery(["P"]),
  gamesQuery(["P"]),
  playersQuery(["P"]),
  renamesQuery(),
  teamsQuery(["X"]),
];

const fieldsOf = (fields: string) => fields.split(",").map((s) => s.trim());

test("every field with an underscore has an alias without underscores", () => {
  for (const d of defs) {
    for (const f of fieldsOf(d.fields)) {
      const [name, alias] = f.split("=");
      if (name!.includes("_")) expect(alias, `${d.tables}.${name}`).toMatch(/^[A-Za-z0-9]+$/);
    }
  }
});

test("inList quotes and escapes values", () => {
  expect(inList(["A", 'B "C"'])).toBe('("A","B \\"C\\"")');
});

test("matchesQuery filters by overview pages", () => {
  expect(matchesQuery(["2026 Season World Championship/Main Event"]).where).toBe(
    'MatchSchedule.OverviewPage IN ("2026 Season World Championship/Main Event")',
  );
});

test("every queried field exists in the real Cargo schema", async () => {
  const fields = JSON.parse(await readFile("tests/fixtures/leaguepedia/fields.json", "utf8")) as Record<
    string,
    Record<string, string>
  >;
  for (const d of defs) {
    for (const f of fieldsOf(d.fields)) {
      const name = f.split("=")[0]!;
      expect(Object.keys(fields[d.tables] ?? {}), `${d.tables}.${name}`).toContain(name);
    }
  }
});

test("tournamentsQuery keeps Worlds pages only, excluding regional finals in the same league", () => {
  const where = tournamentsQuery().where;
  expect(where).toContain('Tournaments.League = "World Championship"');
  expect(where).toContain('Tournaments.OverviewPage LIKE "%World Championship%"');
});
