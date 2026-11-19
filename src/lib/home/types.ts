import type { TeamLabel } from "../format/team.js";
import type { MatchView } from "../match/types.js";

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
