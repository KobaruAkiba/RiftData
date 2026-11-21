import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { Game } from "../../../src/data/schema/edition.js";
import { GameTimelineSchema, type GameTimeline } from "../../../src/data/schema/timeline.js";
import type { PlayerRow } from "../../../scripts/pipeline/leaguepedia/queries.js";
import { buildIndexEntry, roleKey } from "../../../scripts/pipeline/livestats/roster.js";

const dir = "tests/fixtures/livestats";
const readFixture = <T>(name: string): T => JSON.parse(readFileSync(`${dir}/${name}`, "utf8")) as T;

const GAME_ID = "2026 Season World Championship/Main Event_Finals_1_1";
const teamIds: Record<string, string> = { "Gen.G": "gen-g", "Bilibili Gaming": "blg" };
const resolve = (name: string): string | null => teamIds[name] ?? null;

interface Meta {
  gameMetadata: {
    blueTeamMetadata: { participantMetadata: Array<{ participantId: number; championId: string; role: string }> };
    redTeamMetadata: { participantMetadata: Array<{ participantId: number; championId: string; role: string }> };
  };
}

/** Minimal valid timeline: participants from the real feed metadata, one-minute flat series. */
function timelineFromFixture(): GameTimeline {
  const meta = readFixture<Meta>("window-meta.json").gameMetadata;
  const metas = [...meta.blueTeamMetadata.participantMetadata, ...meta.redTeamMetadata.participantMetadata];
  const one = [0];
  const team = { gold: one, kills: one, towers: one, inhibitors: one, barons: one, dragons: one };
  const player = (participantId: number) => ({
    participantId,
    gold: one, level: one, kills: one, deaths: one, assists: one, cs: one,
    damageShare: one, killParticipation: one, wardsPlaced: one, wardsDestroyed: one,
  });
  return GameTimelineSchema.parse({
    gameId: "115660540726095134",
    year: 2026,
    minutes: 1,
    participants: metas.map((m) => ({
      participantId: m.participantId,
      side: m.participantId <= 5 ? "blue" : "red",
      role: m.role,
      championKey: m.championId,
      runes: { primary: 8000, secondary: 8100, perks: [8010, 9111] },
    })),
    teams: { blue: team, red: team },
    players: metas.map((m) => player(m.participantId)),
    items: metas.map((m) => ({ participantId: m.participantId, changes: [{ minute: 0, items: [] }] })),
    events: [],
  });
}

function finalGame(): Game {
  const side = (team: string) => ({ team, picks: [], bans: [] });
  return { id: GAME_ID, number: 1, blue: side("gen-g"), red: side("blg"), winner: "blue" };
}

const allRows = () => readFixture<PlayerRow[]>("scoreboard-players-final.json");
const gameRows = () => allRows().filter((r) => r.GameId === GAME_ID);


test("roleKey maps Leaguepedia and feed role names to one key", () => {
  expect(roleKey("Bot")).toBe("bottom");
  expect(roleKey("bottom")).toBe("bottom");
  expect(roleKey("ADC")).toBe("bottom");
  expect(roleKey("Mid")).toBe("mid");
  expect(roleKey("Middle")).toBe("mid");
  expect(roleKey("Top")).toBe("top");
  expect(roleKey("Jungle")).toBe("jungle");
  expect(roleKey("Support")).toBe("support");
});

test("real final: 10 participants matched by side and role", () => {
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), gameRows(), resolve);
  expect(r.entry!.gameId).toBe("115660540726095134");
  expect(r.entry!.participants).toHaveLength(10);
  expect(new Set(r.entry!.participants.map((p) => p.player)).size).toBe(10);
  expect(r.entry!.participants[0]).toMatchObject({ participantId: 1, player: "Kiin", team: "gen-g", role: "top", champion: "Olaf" });
  // Link kept as is, disambiguation included.
  expect(r.entry!.participants[5]).toMatchObject({ participantId: 6, player: "Bin (Chen Ze-Bin)", team: "blg" });
});

test("MonkeyKing and Renata keys match Wukong and Renata Glasc without any warning", () => {
  const t = timelineFromFixture();
  const swap = (id: number, key: string) => {
    t.participants.find((p) => p.participantId === id)!.championKey = key;
  };
  swap(3, "MonkeyKing");
  swap(10, "Renata");
  const rows = gameRows().map((r) => {
    if (r.Side === "1" && r.Role === "Mid") return { ...r, Champion: "Wukong" };
    if (r.Side === "2" && r.Role === "Support") return { ...r, Champion: "Renata Glasc" };
    return r;
  });
  const r = buildIndexEntry(t, finalGame(), rows, resolve);
  expect(r.entry).not.toBeNull();
  expect(r.warnings).toEqual([]);
  expect(r.entry!.participants[2]!.champion).toBe("Wukong");
});

test("a real champion mismatch warns but the entry is kept", () => {
  const t = timelineFromFixture();
  t.participants.find((p) => p.participantId === 3)!.championKey = "Ahri";
  const rows = gameRows().map((r) => (r.Side === "1" && r.Role === "Mid" ? { ...r, Champion: "Wukong" } : r));
  const r = buildIndexEntry(t, finalGame(), rows, resolve);
  expect(r.entry).not.toBeNull();
  expect(r.warnings).toEqual([expect.stringMatching(/Ahri.*Wukong/)]);
});

test("equal champions after normalization give no warning (K'Sante/KSante, Jarvan IV/JarvanIV)", () => {
  const t = timelineFromFixture();
  t.participants.find((p) => p.participantId === 10)!.championKey = "RenataGlasc";
  const r = buildIndexEntry(t, finalGame(), gameRows(), resolve);
  expect(r.warnings).toEqual([]);
});

test("missing player rows give no entry and a warning", () => {
  expect(buildIndexEntry(timelineFromFixture(), finalGame(), [], resolve)).toMatchObject({
    entry: null,
    warnings: [expect.stringMatching(/no players/i)],
  });
  // rows of other games do not count
  expect(buildIndexEntry(timelineFromFixture(), finalGame(), allRows().filter((r) => r.GameId !== GAME_ID), resolve).entry).toBeNull();
});

test("a side and role without a row gives no entry", () => {
  const rows = gameRows().filter((r) => !(r.Side === "2" && r.Role === "Bot"));
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), rows, resolve);
  expect(r.entry).toBeNull();
  expect(r.warnings).toEqual([expect.stringMatching(/participant 9/)]);
});

test("two rows for the same side and role give no entry", () => {
  const dup = gameRows().find((r) => r.Side === "1" && r.Role === "Top")!;
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), [...gameRows(), { ...dup, Link: "Other" }], resolve);
  expect(r.entry).toBeNull();
  expect(r.warnings).toEqual([expect.stringMatching(/participant 1.*2 rows/)]);
});

test("a row whose team is not the team of its side warns but the entry is kept", () => {
  const rows = gameRows().map((r) => (r.Side === "1" && r.Role === "Top" ? { ...r, Team: "Bilibili Gaming" } : r));
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), rows, resolve);
  expect(r.entry).not.toBeNull();
  expect(r.warnings[0]).toMatch(/Kiin.*Bilibili Gaming/);
});

test("rows without Side fall back to the team of the side", () => {
  const rows = gameRows().map((r) => ({ ...r, Side: "" }));
  const r = buildIndexEntry(timelineFromFixture(), finalGame(), rows, resolve);
  expect(r.entry!.participants).toHaveLength(10);
  expect(r.entry!.participants[5]!.player).toBe("Bin (Chen Ze-Bin)");
});

