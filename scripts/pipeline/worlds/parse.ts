/*
 * Cargo returns every value as a string; empty strings mean "missing".
 * These helpers turn them into numbers or lists without ever throwing.
 */

/** "A, B,,C" → ["A","B","C"]. */
export function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/** Non-negative integer, or `undefined` when empty or not a number. */
export function parseCount(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Finite number, or `undefined` when empty or not a number. */
export function parseDecimal(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Cargo `YYYY-MM-DD HH:MM:SS` (UTC) → `YYYY-MM-DDTHH:MM:SSZ`; `undefined` when empty. */
export function toIsoUtc(value: string): string | undefined {
  const v = value.trim();
  return v === "" ? undefined : `${v.replace(" ", "T")}Z`;
}
