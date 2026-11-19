import { describe, expect, test } from "vitest";
import { GameTimelineSchema, LivestatsIndexSchema, LolGameIdSchema } from "../../src/data/schema/index.js";

const series = (n: number, v = 0) => Array.from({ length: n }, () => v);

function timeline(over: { minutes?: number } = {}) {
  const minutes = over.minutes ?? 3;
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const teamSeries = () => ({
    gold: series(minutes), kills: series(minutes), towers: series(minutes),
    inhibitors: series(minutes), barons: series(minutes), dragons: series(minutes),
  });
  return {
    gameId: "112345678901234567",
    year: 2026,
    minutes,
    participants: ids.map((id) => ({
      participantId: id,
      side: id <= 5 ? "blue" : "red",
      role: "top",
      championKey: "Aatrox",
      runes: { primary: 8000, secondary: 8100, perks: [1, 2, 3] },
    })),
    teams: { blue: teamSeries(), red: teamSeries() },
    players: ids.map((id) => ({
      participantId: id,
      gold: series(minutes), level: series(minutes), kills: series(minutes), deaths: series(minutes),
      assists: series(minutes), cs: series(minutes), damageShare: series(minutes),
      killParticipation: series(minutes), wardsPlaced: series(minutes), wardsDestroyed: series(minutes),
    })),
    items: ids.map((id) => ({ participantId: id, changes: [{ minute: 0, items: [1055] }] })),
    events: [] as Array<Record<string, unknown>>,
  };
}

describe("GameTimelineSchema", () => {
  test("a valid timeline parses; series of wrong length are rejected", () => {
    expect(GameTimelineSchema.safeParse(timeline({ minutes: 3 })).success).toBe(true);
    const bad = timeline({ minutes: 3 });
    bad.players[0]!.gold = [0, 500];
    expect(GameTimelineSchema.safeParse(bad).success).toBe(false);
    const badTeam = timeline({ minutes: 3 });
    badTeam.teams.red.towers = [0];
    expect(GameTimelineSchema.safeParse(badTeam).success).toBe(false);
  });

  test("dragonType is required for dragons and forbidden otherwise", () => {
    const withEvent = (e: Record<string, unknown>) => ({ ...timeline(), events: [e] });
    expect(GameTimelineSchema.safeParse(withEvent({ minute: 5, side: "blue", type: "dragon", dragonType: "ocean" })).success).toBe(true);
    expect(GameTimelineSchema.safeParse(withEvent({ minute: 5, side: "blue", type: "dragon" })).success).toBe(false);
    expect(GameTimelineSchema.safeParse(withEvent({ minute: 5, side: "red", type: "baron", dragonType: "ocean" })).success).toBe(false);
    expect(GameTimelineSchema.safeParse(withEvent({ minute: 5, side: "red", type: "baron" })).success).toBe(true);
  });

  test("participants must be 10 with blue 1-5 and red 6-10", () => {
    const few = timeline();
    few.participants.pop();
    expect(GameTimelineSchema.safeParse(few).success).toBe(false);
    const dup = timeline();
    dup.participants[9]!.participantId = 9;
    expect(GameTimelineSchema.safeParse(dup).success).toBe(false);
    const wrongSide = timeline();
    wrongSide.participants[0]!.side = "red";
    expect(GameTimelineSchema.safeParse(wrongSide).success).toBe(false);
  });

  test("the first item change must be at minute 0", () => {
    const t = timeline();
    t.items[0]!.changes = [{ minute: 1, items: [1] }];
    expect(GameTimelineSchema.safeParse(t).success).toBe(false);
  });
});

describe("LolGameIdSchema and LivestatsIndexSchema", () => {
  test("game id is digits only", () => {
    expect(LolGameIdSchema.safeParse("1123").success).toBe(true);
    expect(LolGameIdSchema.safeParse("11a3").success).toBe(false);
    expect(LolGameIdSchema.safeParse("").success).toBe(false);
  });
  test("index maps a Leaguepedia GameId to participants", () => {
    const idx = {
      games: {
        "Worlds 2026/Main Event_1_1": {
          gameId: "1123",
          participants: [{ participantId: 1, player: "Faker", team: "T1", role: "mid", champion: "Ahri" }],
        },
      },
    };
    expect(LivestatsIndexSchema.safeParse(idx).success).toBe(true);
    expect(LivestatsIndexSchema.safeParse({ games: { x: { gameId: "abc", participants: [] } } }).success).toBe(false);
  });
});
