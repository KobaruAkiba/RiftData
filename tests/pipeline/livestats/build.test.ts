import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildGameTimeline, checkDuration, expectedMinutes, type BuildInput } from "../../../scripts/pipeline/livestats/build.js";
import type { Sample } from "../../../scripts/pipeline/livestats/sampling.js";
import type { DetailsFrame, GameMetadata, ParticipantDetails, TeamFrame, WindowFrame } from "../../../scripts/pipeline/livestats/types.js";
import { parseDetails, parseWindow } from "../../../scripts/pipeline/livestats/parse.js";
import { stableStringify } from "../../../scripts/pipeline/store.js";

const ROLES = ["top", "jungle", "mid", "bottom", "support"];
const metadata: GameMetadata = {
  participants: Array.from({ length: 10 }, (_, i) => ({
    participantId: i + 1,
    championId: `Champ${i + 1}`,
    role: ROLES[i % 5]!,
    summonerName: `P${i + 1}`,
  })),
};

interface SampleSpec {
  blue?: Partial<TeamFrame>;
  red?: Partial<TeamFrame>;
  /** Items of participant 1. */
  items?: number[];
  damageShare?: number;
  gold?: number;
}

function team(base: number, spec: Partial<TeamFrame> | undefined, firstId: number): TeamFrame {
  return {
    totalGold: base,
    totalKills: 0,
    towers: 0,
    inhibitors: 0,
    barons: 0,
    dragons: [],
    participants: Array.from({ length: 5 }, (_, i) => ({
      participantId: firstId + i,
      totalGold: base / 5,
      level: 1,
      kills: 0,
      deaths: 0,
      assists: 0,
      creepScore: 0,
    })),
    ...spec,
  };
}

/** Samples + aligned details from per-minute specs. */
function inputFrom(specs: SampleSpec[]): BuildInput {
  const samples: Sample[] = [];
  const details: DetailsFrame[] = [];
  specs.forEach((s, minute) => {
    const timestamp = new Date(Date.UTC(2026, 10, 14, 20, minute)).toISOString();
    const blue = team(2500 + minute * 100, s.blue, 1);
    if (s.gold !== undefined) blue.participants[0]!.totalGold = s.gold;
    const frame: WindowFrame = { timestamp, gameState: "in_game", blue, red: team(2500, s.red, 6) };
    samples.push({ minute, wall: new Date(timestamp), frame });
    details.push({
      timestamp,
      participants: Array.from({ length: 10 }, (_, i): ParticipantDetails => ({
        participantId: i + 1,
        items: i === 0 ? (s.items ?? []) : [],
        perkMetadata: { styleId: 8000 + minute, subStyleId: 8300, perks: [1, 2, 3] },
        killParticipation: 0.5,
        championDamageShare: i === 0 ? (s.damageShare ?? 0.1) : 0.1,
        wardsPlaced: minute,
        wardsDestroyed: 0,
      })),
    });
  });
  return { gameId: "115660540726095134", year: 2026, metadata, samples, details };
}

describe("buildGameTimeline", () => {
  test("series have one value per sample and match the frames", () => {
    const t = buildGameTimeline(inputFrom([{}, {}, { gold: 900, blue: { totalKills: 3 } }]));
    expect(t.minutes).toBe(3);
    expect(t.teams.blue.gold).toEqual([2500, 2600, 2700]);
    expect(t.teams.blue.kills).toEqual([0, 0, 3]);
    expect(t.players).toHaveLength(10);
    expect(t.players[0]!.gold).toEqual([500, 520, 900]);
    expect(t.players[0]!.wardsPlaced).toEqual([0, 1, 2]);
    expect(t.participants[3]).toMatchObject({ participantId: 4, side: "blue", role: "bottom", championKey: "Champ4" });
    expect(t.participants[5]).toMatchObject({ participantId: 6, side: "red", role: "top" });
  });

  test("runes come from the last details frame", () => {
    const t = buildGameTimeline(inputFrom([{}, {}, {}]));
    expect(t.participants[0]!.runes).toEqual({ primary: 8002, secondary: 8300, perks: [1, 2, 3] });
  });

  test("dragon events carry the type in the order the feed lists them", () => {
    const t = buildGameTimeline(
      inputFrom([
        {},
        { blue: { dragons: ["ocean"] } },
        { blue: { dragons: ["ocean", "infernal"] }, red: { dragons: ["cloud"] } },
      ]),
    );
    expect(t.teams.blue.dragons).toEqual([0, 1, 2]);
    expect(t.events).toEqual([
      { minute: 1, side: "blue", type: "dragon", dragonType: "ocean" },
      { minute: 2, side: "blue", type: "dragon", dragonType: "infernal" },
      { minute: 2, side: "red", type: "dragon", dragonType: "cloud" },
    ]);
  });

  test("two towers in the same minute give two events", () => {
    const t = buildGameTimeline(inputFrom([{}, { red: { towers: 2, inhibitors: 1 }, blue: { barons: 1 } }]));
    expect(t.events.filter((e) => e.type === "tower")).toEqual([
      { minute: 1, side: "red", type: "tower" },
      { minute: 1, side: "red", type: "tower" },
    ]);
    expect(t.events.map((e) => e.type).sort()).toEqual(["baron", "inhibitor", "tower", "tower"]);
  });

  test("items are stored only when the inventory changes", () => {
    const t = buildGameTimeline(
      inputFrom([{ items: [2003, 1056] }, { items: [1056, 2003] }, { items: [2003, 1056] }, { items: [3070, 1056, 2003] }]),
    );
    expect(t.items[0]!.changes).toEqual([
      { minute: 0, items: [1056, 2003] },
      { minute: 3, items: [1056, 2003, 3070] },
    ]);
    expect(t.items[1]!.changes).toEqual([{ minute: 0, items: [] }]);
  });

  test("shares are rounded to 3 decimals", () => {
    const t = buildGameTimeline(inputFrom([{ damageShare: 0.2439999 }, { damageShare: 0.2444 }]));
    expect(t.players[0]!.damageShare).toEqual([0.244, 0.244]);
    expect(t.players[0]!.killParticipation).toEqual([0.5, 0.5]);
  });

  test("rejects misaligned details and missing participants", () => {
    const input = inputFrom([{}, {}]);
    expect(() => buildGameTimeline({ ...input, details: input.details.slice(1) })).toThrow(/details/);
    input.samples[1]!.frame.red.participants.pop();
    expect(() => buildGameTimeline(input)).toThrow(/participant/i);
  });
});

describe("duration check", () => {
  const withMinutes = (n: number) => buildGameTimeline(inputFrom(Array.from({ length: n }, () => ({}))));
  test("expectedMinutes is floor(sec/60)+2", () => {
    expect(expectedMinutes(1993)).toBe(35);
  });
  test("duration check tolerates one minute", () => {
    expect(checkDuration(withMinutes(34), 1993)).toBeNull(); // expected 35
    expect(checkDuration(withMinutes(36), 1993)).toBeNull();
    expect(checkDuration(withMinutes(32), 1993)).toMatch(/minutes/);
  });
});

describe("real fixtures", () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(new URL(`../../fixtures/livestats/${name}`, import.meta.url), "utf8"));
  const meta = parseWindow(read("window-meta.json")).metadata!;
  const realWindow = parseWindow(read("window-minute-10.json")).frames;
  const realDetails = parseDetails(read("details-minute-10.json"));

  /**
   * Plausible 40-minute game from the real frames: minute i takes the real frame (and its details
   * with the same timestamp) number i mod N, then scales the cumulative stats to i/10 of the minute-10
   * values, and grows the inventory by one item every 3 minutes, so that the output is not trivially empty.
   */
  function syntheticGame(minutes: number): BuildInput {
    const samples: Sample[] = [];
    const details: DetailsFrame[] = [];
    for (let i = 0; i < minutes; i++) {
      const k = i % realWindow.length;
      const f = structuredClone(realWindow[k]!);
      const d = structuredClone(realDetails.find((x) => x.timestamp === f.timestamp)!);
      const scale = i / 10;
      for (const side of [f.blue, f.red]) {
        side.totalGold = Math.round(side.totalGold * scale);
        side.totalKills = Math.round(side.totalKills * scale);
        side.towers = Math.min(11, Math.floor(i / 4));
        side.dragons = ["ocean", "infernal", "cloud", "mountain"].slice(0, Math.floor(i / 9));
        for (const p of side.participants) {
          p.totalGold = Math.round(p.totalGold * scale);
          p.creepScore = Math.round(p.creepScore * scale);
          p.kills = Math.round(p.kills * scale);
          p.level = Math.min(18, Math.round(p.level * Math.max(scale, 0.2)));
        }
      }
      for (const p of d.participants) p.items = p.items.slice(0, Math.min(p.items.length, Math.floor(i / 3)));
      samples.push({ minute: i, wall: new Date(Date.parse("2026-11-14T20:00:00Z") + i * 60_000), frame: f });
      details.push(d);
    }
    return { gameId: "115660540726095134", year: 2026, metadata: meta, samples, details };
  }

  test("real fixture frames build a valid timeline under 100 KB in compact form", () => {
    const t = buildGameTimeline(syntheticGame(40));
    expect(t.minutes).toBe(40);
    expect(t.participants).toHaveLength(10);
    expect(t.participants[0]).toMatchObject({ role: "top", side: "blue" });
    const size = Buffer.byteLength(stableStringify(t, { compactArrays: true }));
    console.log(`timeline size: ${(size / 1024).toFixed(1)} KB`);
    expect(size).toBeLessThan(100_000);
  });
});
