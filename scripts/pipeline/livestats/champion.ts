import { normalizeKey } from "./normalize.js";

/**
 * Data Dragon keys (used by the feed) that are not the champion name Leaguepedia uses.
 * Both sides are normalized: "MonkeyKing" -> "monkeyking" is "Wukong" -> "wukong".
 */
const KEY_QUIRKS: Readonly<Record<string, string>> = {
  monkeyking: "wukong",
  renata: "renataglasc",
  nunu: "nunuwillump",
};

/** True when the feed champion key and the Leaguepedia champion name denote the same champion. */
export function sameChampion(feedKey: string, name: string): boolean {
  const key = normalizeKey(feedKey);
  const target = normalizeKey(name);
  return key === target || KEY_QUIRKS[key] === target;
}
