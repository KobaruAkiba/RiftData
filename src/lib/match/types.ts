import type { TeamLabel } from "../format/team.js";

export interface MatchView { id: string; day: string | null; team1: TeamLabel; team2: TeamLabel; score1: string; score2: string; winner: 1 | 2 | null }
