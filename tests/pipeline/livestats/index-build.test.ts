import { expect, test } from "vitest";
import type { LivestatsIndex } from "../../../src/data/schema/index.js";
import { mergePreviousIndex } from "../../../scripts/pipeline/livestats/index-build.js";

const entry = (gameId: string) => ({ gameId, participants: [] });
const indexOf = (games: Record<string, string>): LivestatsIndex => ({
  games: Object.fromEntries(Object.entries(games).map(([key, gameId]) => [key, entry(gameId)])),
});
const always = (): boolean => true;

test("without a previous index the fresh one is returned as is", () => {
  expect(mergePreviousIndex(indexOf({ a: "1" }), null, always)).toEqual({ index: indexOf({ a: "1" }), warnings: [] });
});

test("a fresh entry replaces the previous one", () => {
  const r = mergePreviousIndex(indexOf({ a: "2" }), indexOf({ a: "1" }), always);
  expect(r.index.games.a!.gameId).toBe("2");
  expect(r.warnings).toEqual([]);
});

test("an entry missing from the fresh index is kept with a warning while its game file exists", () => {
  const r = mergePreviousIndex(indexOf({}), indexOf({ a: "1" }), (id) => id === "1");
  expect(r.index).toEqual(indexOf({ a: "1" }));
  expect(r.warnings).toEqual(["a: previous index entry kept, it could not be rebuilt this run"]);
});

test("an entry is dropped, with a warning, only when its game file is gone", () => {
  const r = mergePreviousIndex(indexOf({}), indexOf({ a: "1", b: "2" }), (id) => id === "2");
  expect(Object.keys(r.index.games)).toEqual(["b"]);
  expect(r.warnings).toEqual(["a: index entry dropped, game file 1.json is gone", "b: previous index entry kept, it could not be rebuilt this run"]);
});

test("keys come out sorted whatever the origin of each entry", () => {
  const r = mergePreviousIndex(indexOf({ c: "3", a: "1" }), indexOf({ b: "2" }), always);
  expect(Object.keys(r.index.games)).toEqual(["a", "b", "c"]);
});
