import { expect, test } from "vitest";
import { sameChampion } from "../../../scripts/pipeline/livestats/champion.js";
import { normalizeKey } from "../../../scripts/pipeline/livestats/normalize.js";

test("normalizeKey lowercases and keeps only alphanumerics", () => {
  expect(normalizeKey("Gen.G Esports")).toBe("gengesports");
  expect(normalizeKey("BILIBILI GAMING")).toBe("bilibiligaming");
});

test("sameChampion: equal after normalization", () => {
  expect(sameChampion("KSante", "K'Sante")).toBe(true);
  expect(sameChampion("JarvanIV", "Jarvan IV")).toBe(true);
});

test("sameChampion: known Data Dragon key quirks", () => {
  expect(sameChampion("MonkeyKing", "Wukong")).toBe(true);
  expect(sameChampion("Renata", "Renata Glasc")).toBe(true);
  expect(sameChampion("Nunu", "Nunu & Willump")).toBe(true);
});

test("sameChampion: a real mismatch, and quirks do not apply the other way round", () => {
  expect(sameChampion("Ahri", "Annie")).toBe(false);
  expect(sameChampion("MonkeyKing", "Ahri")).toBe(false);
  expect(sameChampion("Wukong", "MonkeyKing")).toBe(false);
});
