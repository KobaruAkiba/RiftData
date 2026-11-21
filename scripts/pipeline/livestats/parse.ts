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
 * Raw lolesports payloads -> normalized types. Window/details parsing tolerates unexpected shapes by
 * dropping the incomplete record (a frame or participant lacking a required numeric field is never
 * padded with zeros), so the builder fails loudly on the gap. `parseCompletedEvents` throws instead:
 * an unrecognized response must never look like "no matches".
 */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The listed fields as finite numbers; null when any is missing or not a number (never defaulted to 0). */
function requiredNumbers<K extends string>(raw: Rec, keys: readonly K[]): Record<K, number> | null {
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    out[key] = value;
  }
  return out;
}

/** An array whose elements all pass `guard`; null when `v` is not an array or any element fails. */
function arrayOf<T>(v: unknown, guard: (x: unknown) => x is T): T[] | null {
  return Array.isArray(v) && v.every(guard) ? v : null;
}
const isNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isString = (x: unknown): x is string => typeof x === "string";

function parseParticipantWindow(raw: unknown): ParticipantWindow | null {
  if (!isRec(raw)) return null;
  return requiredNumbers(raw, ["participantId", "totalGold", "level", "kills", "deaths", "assists", "creepScore"]);
}

function parseTeamFrame(raw: unknown): TeamFrame | null {
  if (!isRec(raw)) return null;
  const counts = requiredNumbers(raw, ["totalGold", "totalKills", "towers", "inhibitors", "barons"]);
  const dragons = arrayOf(raw.dragons, isString);
  if (counts === null || dragons === null) return null;
  return { ...counts, dragons, participants: arr(raw.participants).flatMap((p) => parseParticipantWindow(p) ?? []) };
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

/** Runes are required: a participant without them is dropped rather than stored as runes 0/0/[]. */
function parsePerkMetadata(raw: unknown): ParticipantDetails["perkMetadata"] | null {
  if (!isRec(raw)) return null;
  const styles = requiredNumbers(raw, ["styleId", "subStyleId"]);
  const perks = arrayOf(raw.perks, isNumber);
  if (styles === null || perks === null || perks.length === 0) return null;
  return { ...styles, perks };
}

function parseParticipantDetails(raw: unknown): ParticipantDetails | null {
  if (!isRec(raw)) return null;
  const stats = requiredNumbers(raw, [
    "participantId",
    "killParticipation",
    "championDamageShare",
    "wardsPlaced",
    "wardsDestroyed",
  ]);
  const items = arrayOf(raw.items, isNumber);
  const perkMetadata = parsePerkMetadata(raw.perkMetadata);
  if (stats === null || items === null || perkMetadata === null) return null;
  return { ...stats, items, perkMetadata };
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
  else if (isRec(json) && isRec(json.data) && isRec(json.data.schedule) && Array.isArray(json.data.schedule.events)) {
    events = json.data.schedule.events;
  } else if (parseEvent(json) !== null) events = [json];
  else throw new Error("Unrecognized completed events response: expected data.schedule.events[], a list of events or one event");
  // Single entries without a match id (not a match) are skipped; the response itself must be recognized.
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
