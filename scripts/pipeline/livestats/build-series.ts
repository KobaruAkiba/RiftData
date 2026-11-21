import type { GameTimeline } from "../../../src/data/schema/timeline.js";
import type { Sample } from "./sampling.js";
import type { DetailsFrame, GameMetadata, ParticipantDetails, ParticipantWindow, TeamFrame } from "./types.js";

type Side = "blue" | "red";
type TeamSeries = GameTimeline["teams"]["blue"];
type PlayerSeries = GameTimeline["players"][number];

/** Blue side = participants 1-5, red side = 6-10. */
export const sideOf = (participantId: number): Side => (participantId <= 5 ? "blue" : "red");

export const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Sample i and details i describe the same instant: any other layout is a caller bug. */
export function assertAligned(samples: Sample[], details: DetailsFrame[]): void {
  if (samples.length === 0) throw new Error("no samples to build a timeline from");
  if (samples.length !== details.length) {
    throw new Error(`details (${details.length}) not aligned with samples (${samples.length})`);
  }
}

export function teamSeries(samples: Sample[], side: Side): TeamSeries {
  const teams = samples.map((s): TeamFrame => s.frame[side]);
  return {
    gold: teams.map((t) => t.totalGold),
    kills: teams.map((t) => t.totalKills),
    towers: teams.map((t) => t.towers),
    inhibitors: teams.map((t) => t.inhibitors),
    barons: teams.map((t) => t.barons),
    dragons: teams.map((t) => t.dragons.length),
  };
}

function windowOf(sample: Sample, participantId: number): ParticipantWindow {
  const found = sample.frame[sideOf(participantId)].participants.find((p) => p.participantId === participantId);
  if (found === undefined) throw new Error(`participant ${participantId} missing from window at minute ${sample.minute}`);
  return found;
}

export function detailsOf(frame: DetailsFrame, participantId: number, minute: number): ParticipantDetails {
  const found = frame.participants.find((p) => p.participantId === participantId);
  if (found === undefined) throw new Error(`participant ${participantId} missing from details at minute ${minute}`);
  return found;
}

export function playerSeries(
  samples: Sample[],
  details: DetailsFrame[],
  metadata: GameMetadata,
): PlayerSeries[] {
  return participantIds(metadata).map((id) => {
    const w = samples.map((s) => windowOf(s, id));
    const d = samples.map((s, i) => detailsOf(details[i]!, id, s.minute));
    return {
      participantId: id,
      gold: w.map((p) => p.totalGold),
      level: w.map((p) => p.level),
      kills: w.map((p) => p.kills),
      deaths: w.map((p) => p.deaths),
      assists: w.map((p) => p.assists),
      cs: w.map((p) => p.creepScore),
      damageShare: d.map((p) => round3(p.championDamageShare)),
      killParticipation: d.map((p) => round3(p.killParticipation)),
      wardsPlaced: d.map((p) => p.wardsPlaced),
      wardsDestroyed: d.map((p) => p.wardsDestroyed),
    };
  });
}

export const participantIds = (metadata: GameMetadata): number[] =>
  metadata.participants.map((p) => p.participantId).sort((a, b) => a - b);

const sameItems = (a: number[], b: number[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Inventory (sorted: slot order is noise) only when it changes; the first entry is always minute 0. */
export function itemChanges(
  samples: Sample[],
  details: DetailsFrame[],
  metadata: GameMetadata,
): GameTimeline["items"] {
  return participantIds(metadata).map((id) => {
    const changes: GameTimeline["items"][number]["changes"] = [];
    samples.forEach((s, i) => {
      const items = [...detailsOf(details[i]!, id, s.minute).items].sort((a, b) => a - b);
      const last = changes[changes.length - 1];
      if (last === undefined || !sameItems(last.items, items)) changes.push({ minute: i === 0 ? 0 : s.minute, items });
    });
    return { participantId: id, changes };
  });
}
