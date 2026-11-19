import type { TeamLabel } from "../format/team.js";

export interface MatchView { id: string; day: string | null; team1: TeamLabel; team2: TeamLabel; score1: string; score2: string; winner: 1 | 2 | null }
export interface RoundView { name: string | null; matches: MatchView[] }
export interface StageView { id: string; name: string; typeLabel: string; rounds: RoundView[] }
export interface ChampionView { team: TeamLabel; final: MatchView; finalRound: string | null }
export interface HomeModel {
  year: number;
  name: string;
  statusLabel: string;
  stats: { teams: number; regions: number; games: number };
  champion: ChampionView | null;
  stages: StageView[];
}
