import type { Edition } from "../../data/schema/index.js";

const latest = (editions: Edition[]): Edition | null =>
  editions.reduce<Edition | null>((best, e) => (best === null || e.year > best.year ? e : best), null);

/** Latest completed edition; if none is completed, the latest one overall; null when there are none. */
export function selectFeaturedEdition(editions: Edition[]): Edition | null {
  return latest(editions.filter((e) => e.status === "completed")) ?? latest(editions);
}
