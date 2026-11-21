import { LolesportsRequestError, type LolesportsClient } from "../../../scripts/lib/lolesports/client.js";
import type { TeamFrame, WindowFrame } from "../../../scripts/pipeline/livestats/types.js";
import type { FakeFeed } from "./fake-feed.js";

/*
 * Fake lolesports client in the RAW payload shapes (docs/superpowers/spikes/2026-11-19-livestats-discovery.md),
 * on top of fake feeds. Participants of the feed frames are filled in (the fake feed has none) and the
 * details of a frame carry the blue team gold in `wardsPlaced`, so a test can check the alignment
 * between `window` and `details`.
 */

export const ROLES = ["top", "jungle", "mid", "bottom", "support"];
export const champion = (participantId: number): string => `Champ${participantId}`;

export interface FeedCall {
  gameId: string;
  startingTime?: string;
}

export interface FakeLolesports {
  client: LolesportsClient;
  windowCalls: FeedCall[];
  detailsCalls: FeedCall[];
  callsOf(gameId: string): number;
  reset(): void;
}

export interface FakeLolOptions {
  feeds: Record<string, FakeFeed>;
  /** `data.schedule.events` of getCompletedEvents. */
  events: unknown[];
  tournaments?: unknown;
  /** Games whose requests fail as after exhausted retries (feed unreachable). */
  unreachable?: string[];
}

const rawTeam = (t: TeamFrame, firstId: number) => ({
  ...t,
  participants: Array.from({ length: 5 }, (_, i) => ({
    participantId: firstId + i,
    totalGold: t.totalGold / 5,
    level: 1,
    kills: 0,
    deaths: 0,
    assists: 0,
    creepScore: 0,
  })),
});

const rawFrame = (f: WindowFrame) => ({
  rfc460Timestamp: f.timestamp,
  gameState: f.gameState,
  blueTeam: rawTeam(f.blue, 1),
  redTeam: rawTeam(f.red, 6),
});

const rawDetails = (f: WindowFrame) => ({
  rfc460Timestamp: f.timestamp,
  participants: Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1,
    items: [1055],
    perkMetadata: { styleId: 8000, subStyleId: 8300, perks: [1, 2, 3] },
    killParticipation: 0.5,
    championDamageShare: 0.1,
    wardsPlaced: f.blue.totalGold,
    wardsDestroyed: 0,
  })),
});

const metadata = () => {
  const side = (firstId: number) => ({
    participantMetadata: Array.from({ length: 5 }, (_, i) => ({
      participantId: firstId + i,
      championId: champion(firstId + i),
      role: ROLES[i],
      summonerName: `P${firstId + i}`,
    })),
  });
  return { blueTeamMetadata: side(1), redTeamMetadata: side(6) };
};

export function fakeLolesports(opts: FakeLolOptions): FakeLolesports {
  const windowCalls: FeedCall[] = [];
  const detailsCalls: FeedCall[] = [];

  const framesOf = async (gameId: string, startingTime?: string): Promise<WindowFrame[] | null> => {
    const feed = opts.feeds[gameId];
    if (feed === undefined) return null; // unknown game: 404
    if (startingTime === undefined) return feed.frames.slice(0, 10);
    const frames = await feed.windowAt(new Date(startingTime));
    return frames.length > 0 ? frames : null; // 204
  };

  const client: LolesportsClient = {
    tournaments: async () =>
      opts.tournaments ?? { data: { leagues: [{ tournaments: [{ id: "T26", slug: "worlds_2026", startDate: "2026-10-01" }] }] } },
    completedEvents: async () => ({ data: { schedule: { events: opts.events } } }),
    window: async (gameId, startingTime) => {
      if (opts.unreachable?.includes(gameId)) throw new LolesportsRequestError("feed down");
      windowCalls.push({ gameId, ...(startingTime !== undefined ? { startingTime } : {}) });
      const frames = await framesOf(gameId, startingTime);
      if (frames === null) return null;
      return { esportsGameId: gameId, gameMetadata: metadata(), frames: frames.map(rawFrame) };
    },
    details: async (gameId, startingTime) => {
      if (opts.unreachable?.includes(gameId)) throw new LolesportsRequestError("feed down");
      detailsCalls.push({ gameId, ...(startingTime !== undefined ? { startingTime } : {}) });
      const frames = await framesOf(gameId, startingTime);
      return frames === null ? null : { frames: frames.map(rawDetails) };
    },
  };

  return {
    client,
    windowCalls,
    detailsCalls,
    callsOf: (gameId) => [...windowCalls, ...detailsCalls].filter((c) => c.gameId === gameId).length,
    reset: () => {
      windowCalls.length = 0;
      detailsCalls.length = 0;
    },
  };
}
