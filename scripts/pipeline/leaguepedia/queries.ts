import { cargoString, type CargoQuery } from "../../lib/leaguepedia/cargo.js";

/*
 * Typed Cargo queries. Each row interface uses the aliases Cargo returns (`Field=Alias`):
 * Cargo hands back underscored fields with a space ("DateTime UTC"), so every underscored
 * field is aliased to a name without underscores.
 * All values are strings, exactly as Cargo returns them; parsing happens in normalization.
 */

export interface TournamentRow {
  Name: string;
  OverviewPage: string;
  DateStart: string;
  DateEnd: string;
  League: string;
  Region: string;
}

export interface MatchRow {
  MatchId: string;
  OverviewPage: string;
  Tab: string;
  Round: string;
  DateTimeUTC: string;
  BestOf: string;
  Team1: string;
  Team2: string;
  Team1Score: string;
  Team2Score: string;
  /** "1" | "2" | "" */
  Winner: string;
}

/** In ScoreboardGames, Team1 is the blue side. */
export interface GameRow {
  GameId: string;
  MatchId: string;
  NGameInMatch: string;
  Team1: string;
  Team2: string;
  WinTeam: string;
  GamelengthNumber: string;
  Patch: string;
  Team1Kills: string;
  Team2Kills: string;
  Team1Gold: string;
  Team2Gold: string;
  Team1Dragons: string;
  Team2Dragons: string;
  Team1Barons: string;
  Team2Barons: string;
  Team1Towers: string;
  Team2Towers: string;
  Team1Picks: string;
  Team2Picks: string;
  Team1Bans: string;
  Team2Bans: string;
}

export interface PlayerRow {
  GameId: string;
  Team: string;
  /** In-game name. */
  Name: string;
  /** Page name, may carry a disambiguation: "Bin (Chen Ze-Bin)". */
  Link: string;
  /** Full champion name: "Jarvan IV". */
  Champion: string;
  /** Top | Jungle | Mid | Bot | Support */
  Role: string;
  RoleNumber: string;
  /** "1" = blue, "2" = red. */
  Side: string;
  Assists: string;
}

export interface RenameRow {
  Date: string;
  OriginalName: string;
  NewName: string;
  Verb: string;
}

export interface TeamRow {
  Name: string;
  Short: string;
  Region: string;
}

export type QueryDef = Omit<CargoQuery, "limit" | "offset"> & { orderBy: string };

/** `("A","B")` with each value quoted and escaped for Cargo. */
export function inList(values: string[]): string {
  return `(${values.map(cargoString).join(",")})`;
}

/** Builds a field list from `[field, alias?]` pairs in Cargo's `Field=Alias` syntax. */
function fieldList(fields: Array<string | [string, string]>): string {
  return fields.map((f) => (typeof f === "string" ? f : `${f[0]}=${f[1]}`)).join(", ");
}

/*
 * The league `World Championship` also holds regional finals and qualifying events whose pages do not
 * contain "World Championship" (e.g. `LPL/2026 Season/Regional Finals`). Worlds pages always do
 * (`2026 Season World Championship`, `.../Play-In`, `.../Main Event`, `Season 1 World Championship/Qualifiers/...`),
 * so the page name narrows the league to Worlds proper.
 */
export function tournamentsQuery(): QueryDef {
  return {
    tables: "Tournaments",
    fields: fieldList(["Name", "OverviewPage", "DateStart", ["Date", "DateEnd"], "League", "Region"]),
    where: `Tournaments.League = ${cargoString("World Championship")} AND Tournaments.OverviewPage LIKE "%World Championship%"`,
    orderBy: "Tournaments.DateStart, Tournaments.OverviewPage",
  };
}

export function matchesQuery(overviewPages: string[]): QueryDef {
  return {
    tables: "MatchSchedule",
    fields: fieldList([
      "MatchId",
      "OverviewPage",
      "Tab",
      "Round",
      ["DateTime_UTC", "DateTimeUTC"],
      "BestOf",
      "Team1",
      "Team2",
      "Team1Score",
      "Team2Score",
      "Winner",
    ]),
    where: `MatchSchedule.OverviewPage IN ${inList(overviewPages)}`,
    orderBy: "MatchSchedule.DateTime_UTC, MatchSchedule.MatchId",
  };
}

export function gamesQuery(overviewPages: string[]): QueryDef {
  return {
    tables: "ScoreboardGames",
    fields: fieldList([
      "GameId",
      "MatchId",
      ["N_GameInMatch", "NGameInMatch"],
      "Team1",
      "Team2",
      "WinTeam",
      ["Gamelength_Number", "GamelengthNumber"],
      "Patch",
      "Team1Kills",
      "Team2Kills",
      "Team1Gold",
      "Team2Gold",
      "Team1Dragons",
      "Team2Dragons",
      "Team1Barons",
      "Team2Barons",
      "Team1Towers",
      "Team2Towers",
      "Team1Picks",
      "Team2Picks",
      "Team1Bans",
      "Team2Bans",
    ]),
    where: `ScoreboardGames.OverviewPage IN ${inList(overviewPages)}`,
    orderBy: "ScoreboardGames.GameId",
  };
}

export function playersQuery(overviewPages: string[]): QueryDef {
  return {
    tables: "ScoreboardPlayers",
    fields: fieldList(["GameId", "Team", "Name", "Link", "Champion", "Role", ["Role_Number", "RoleNumber"], "Side", "Assists"]),
    where: `ScoreboardPlayers.OverviewPage IN ${inList(overviewPages)}`,
    orderBy: "ScoreboardPlayers.GameId, ScoreboardPlayers.Team",
  };
}

export function renamesQuery(): QueryDef {
  return {
    tables: "TeamRenames",
    fields: fieldList(["Date", "OriginalName", "NewName", "Verb"]),
    orderBy: "TeamRenames.Date, TeamRenames.OriginalName",
  };
}

export function teamsQuery(names: string[]): QueryDef {
  return {
    tables: "Teams",
    fields: fieldList(["Name", "Short", "Region"]),
    where: `Teams.Name IN ${inList(names)}`,
    orderBy: "Teams.Name",
  };
}
