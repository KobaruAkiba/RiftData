import { expect, test } from "vitest";
import { downloadGame } from "../../../scripts/pipeline/livestats/download.js";
import { fakeFeed } from "./fake-feed.js";
import { fakeLolesports } from "./fake-lolesports.js";

const GAME = "115660588583171787";
const LATER = () => Date.parse("2027-01-01T00:00:00Z");

test("the final state comes from the true last finished frame, with aligned details", async () => {
  // `finished` frames run on for 4 s with rising gold and spill into the window after the first one.
  const feed = fakeFeed({ lengthSec: 303, finishedTailSec: 4 });
  const lol = fakeLolesports({ feeds: { [GAME]: feed }, events: [] });
  const { timeline, durationSec } = await downloadGame(lol.client, GAME, 2026, LATER);

  const final = feed.frames.at(-1)!;
  expect(timeline.teams.blue.gold.at(-1)).toBe(final.blue.totalGold);
  expect(timeline.teams.red.gold.at(-1)).toBe(final.red.totalGold);
  // The fake details carry the blue gold of their frame: the last details frame is the final one too.
  expect(timeline.players.find((p) => p.participantId === 1)!.wardsPlaced.at(-1)).toBe(final.blue.totalGold);
  // The details of the final sample are asked at the request past the end, like its window.
  expect(lol.detailsCalls.at(-1)!.startingTime).toBe(lol.windowCalls.at(-1)!.startingTime);
  expect(durationSec).toBeGreaterThanOrEqual(303);
  expect(durationSec).toBeLessThan(304);
});
