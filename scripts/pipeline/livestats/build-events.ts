import type { GameTimeline } from "../../../src/data/schema/timeline.js";
import type { Sample } from "./sampling.js";
import type { TeamFrame } from "./types.js";

type GameEvent = GameTimeline["events"][number];
type Side = "blue" | "red";

const COUNTED = [
  ["tower", "towers"],
  ["baron", "barons"],
  ["inhibitor", "inhibitors"],
] as const;

/** Events of one side between two consecutive samples: count differences, dragons from the new list tail. */
function sideEvents(minute: number, side: Side, prev: TeamFrame | undefined, next: TeamFrame): GameEvent[] {
  const events: GameEvent[] = next.dragons
    .slice(prev?.dragons.length ?? 0)
    .map((dragonType) => ({ minute, side, type: "dragon", dragonType }));
  for (const [type, key] of COUNTED) {
    const added = next[key] - (prev?.[key] ?? 0);
    for (let n = 0; n < added; n++) events.push({ minute, side, type });
  }
  return events;
}

/** Events in sample order; within a sample blue before red, dragons before towers, barons, inhibitors. */
export function buildEvents(samples: Sample[]): GameEvent[] {
  return samples.flatMap((s, i) =>
    (["blue", "red"] as const).flatMap((side) => sideEvents(s.minute, side, samples[i - 1]?.frame[side], s.frame[side])),
  );
}
