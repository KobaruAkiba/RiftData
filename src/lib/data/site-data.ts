import { resolve } from "node:path";
import type { Edition, Team } from "../../data/schema/index.js";
import { loadEditions, loadTeams } from "./load.js";
import { selectFeaturedEdition } from "./select.js";

export interface SiteData {
  featured: Edition;
  teams: Team[];
}

const cache = new Map<string, SiteData>();

/** Single entry point for pages: reads and validates `data/` once per directory. */
export function getSiteData(dataDir: string = resolve(process.cwd(), "data")): SiteData {
  const cached = cache.get(dataDir);
  if (cached) return cached;
  const worldsDir = resolve(dataDir, "worlds");
  const featured = selectFeaturedEdition(loadEditions(worldsDir));
  if (featured === null) throw new Error(`No Worlds editions found in ${dataDir}/worlds`);
  const data: SiteData = { featured, teams: loadTeams(resolve(dataDir, "teams.json")) };
  cache.set(dataDir, data);
  return data;
}
