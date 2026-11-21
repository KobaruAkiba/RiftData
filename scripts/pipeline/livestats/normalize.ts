/** Lowercase, alphanumerics only: "Gen.G Esports" -> "gengesports", "K'Sante" -> "ksante". */
export function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
