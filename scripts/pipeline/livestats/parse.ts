import type {
  DetailsFrame,
  GameMetadata,
  LolGame,
  LolMatch,
  ParticipantDetails,
  ParticipantMeta,
  ParticipantWindow,
  TeamFrame,
  WindowFrame,
} from "./types.js";

/*
 * Raw lolesports payloads -> normalized types. Every function tolerates unexpected shapes:
 * it returns an empty result instead of throwing, so the caller decides what a missing piece means.
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseParticipantWindow(raw: unknown): ParticipantWindow | null {
  if (!isRec(raw) || typeof raw.participantId !== "number") return null;
  return {
    participantId: raw.participantId,
    totalGold: num(raw.totalGold),
    level: num(raw.level),
    kills: num(raw.kills),
    deaths: num(raw.deaths),
    assists: num(raw.assists),
    creepScore: num(raw.creepScore),
  };
}

function parseTeamFrame(raw: unknown): TeamFrame | null {
  if (!isRec(raw)) return null;
  return {
    totalGold: num(raw.totalGold),
    totalKills: num(raw.totalKills),
    towers: num(raw.towers),
    inhibitors: num(raw.inhibitors),
    barons: num(raw.barons),
    dragons: arr(raw.dragons).filter((d): d is string => typeof d === "string"),
    participants: arr(raw.participants).flatMap((p) => parseParticipantWindow(p) ?? []),
  };
}

function parseWindowFrame(raw: unknown): WindowFrame | null {
  if (!isRec(raw) || typeof raw.rfc460Timestamp !== "string" || typeof raw.gameState !== "string") return null;
  const blue = parseTeamFrame(raw.blueTeam);
  const red = parseTeamFrame(raw.redTeam);
  if (blue === null || red === null) return null;
  return { timestamp: raw.rfc460Timestamp, gameState: raw.gameState, blue, red };
}

function parseParticipantMeta(raw: unknown): ParticipantMeta | null {
  if (!isRec(raw) || typeof raw.participantId !== "number") return null;
  return {
    participantId: raw.participantId,
    championId: str(raw.championId),
    role: str(raw.role),
    summonerName: str(raw.summonerName),
  };
}

function parseMetadata(raw: unknown): GameMetadata | null {
  if (!isRec(raw)) return null;
  const participants = [raw.blueTeamMetadata, raw.redTeamMetadata].flatMap((team) =>
    isRec(team) ? arr(team.participantMetadata).flatMap((p) => parseParticipantMeta(p) ?? []) : [],
  );
  return participants.length > 0 ? { participants } : null;
}

export function parseWindow(json: unknown): { metadata: GameMetadata | null; frames: WindowFrame[] } {
  if (!isRec(json)) return { metadata: null, frames: [] };
  return {
    metadata: parseMetadata(json.gameMetadata),
    frames: arr(json.frames).flatMap((f) => parseWindowFrame(f) ?? []),
  };
}

function parseParticipantDetails(raw: unknown): ParticipantDetails | null {
  if (!isRec(raw) || typeof raw.participantId !== "number") return null;
  const perks = isRec(raw.perkMetadata) ? raw.perkMetadata : {};
  return {
    participantId: raw.participantId,
    items: arr(raw.items).filter((i): i is number => typeof i === "number"),
    perkMetadata: {
      styleId: num(perks.styleId),
      subStyleId: num(perks.subStyleId),
      perks: arr(perks.perks).filter((p): p is number => typeof p === "number"),
    },
    killParticipation: num(raw.killParticipation),
    championDamageShare: num(raw.championDamageShare),
    wardsPlaced: num(raw.wardsPlaced),
    wardsDestroyed: num(raw.wardsDestroyed),
  };
}

export function parseDetails(json: unknown): DetailsFrame[] {
  if (!isRec(json)) return [];
  return arr(json.frames).flatMap((raw): DetailsFrame[] => {
    if (!isRec(raw) || typeof raw.rfc460Timestamp !== "string") return [];
    return [
      {
        timestamp: raw.rfc460Timestamp,
        participants: arr(raw.participants).flatMap((p) => parseParticipantDetails(p) ?? []),
      },
    ];
  });
}

/** A game counts as played when it has VODs (getCompletedEvents games carry no `state`). */
function parseGames(raw: unknown): LolGame[] {
  return arr(raw).flatMap((g, index): LolGame[] => {
    if (!isRec(g) || typeof g.id !== "string") return [];
    return [{ id: g.id, number: index + 1, played: arr(g.vods).length > 0 }];
  });
}

function parseEvent(raw: unknown): LolMatch | null {
  if (!isRec(raw) || !isRec(raw.match) || typeof raw.match.id !== "string") return null;
  return {
    id: raw.match.id,
    startTime: str(raw.startTime),
    teams: arr(raw.match.teams).flatMap((t) => (isRec(t) ? [{ code: str(t.code), name: str(t.name) }] : [])),
    games: parseGames(raw.games),
  };
}

/** Accepts the API response (`data.schedule.events[]`), a bare list of events, or a single event. */
export function parseCompletedEvents(json: unknown): LolMatch[] {
  let events: unknown[];
  if (Array.isArray(json)) events = json;
  else if (isRec(json) && isRec(json.data) && isRec(json.data.schedule)) events = arr(json.data.schedule.events);
  else events = [json];
  return events.flatMap((e) => parseEvent(e) ?? []);
}

/** Tournament of the Worlds league for a year, from the `getTournamentsForLeague` response. */
export function pickWorldsTournamentId(json: unknown, year: number): string | null {
  if (!isRec(json) || !isRec(json.data)) return null;
  const league: unknown = arr(json.data.leagues)[0];
  if (!isRec(league)) return null;
  const tournaments = arr(league.tournaments).filter(isRec).filter((t) => typeof t.id === "string");
  const bySlug = tournaments.find((t) => {
    const slug = str(t.slug).toLowerCase();
    return slug.includes("worlds") && slug.includes(String(year));
  });
  const found = bySlug ?? tournaments.find((t) => str(t.startDate).startsWith(`${year}-`));
  return found ? (found.id as string) : null;
}
