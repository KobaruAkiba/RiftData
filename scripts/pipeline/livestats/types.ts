/* Feed and API responses after normalization (see parse.ts). Raw payload shapes: docs/superpowers/spikes/2026-11-19-livestats-discovery.md. */

export interface ParticipantWindow {
  participantId: number;
  totalGold: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
}

export interface TeamFrame {
  totalGold: number;
  totalKills: number;
  towers: number;
  inhibitors: number;
  barons: number;
  /** Dragon types in the order the feed lists them (e.g. "ocean", "infernal"). */
  dragons: string[];
  participants: ParticipantWindow[];
}

export interface WindowFrame {
  /** `rfc460Timestamp` of the frame (real time, ISO 8601). */
  timestamp: string;
  gameState: string;
  blue: TeamFrame;
  red: TeamFrame;
}

export interface ParticipantDetails {
  participantId: number;
  items: number[];
  perkMetadata: { styleId: number; subStyleId: number; perks: number[] };
  killParticipation: number;
  championDamageShare: number;
  wardsPlaced: number;
  wardsDestroyed: number;
}

export interface DetailsFrame {
  timestamp: string;
  participants: ParticipantDetails[];
}

export interface ParticipantMeta {
  participantId: number;
  championId: string;
  role: string;
  summonerName: string;
}

/** Blue side = participants 1-5, red side = 6-10. */
export interface GameMetadata {
  participants: ParticipantMeta[];
}

export interface LolGame {
  id: string;
  /** 1-based position among the games of the match (played or not). */
  number: number;
  played: boolean;
}

export interface LolMatch {
  id: string;
  startTime: string;
  teams: { code: string; name: string }[];
  games: LolGame[];
}
