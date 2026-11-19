import { z } from "zod";
import { SlugSchema, TeamIdSchema } from "./team.js";

export const StageTypeSchema = z.enum(["play-in", "swiss", "groups", "single-elimination", "other"]);
export type StageType = z.infer<typeof StageTypeSchema>;

export const EditionStatusSchema = z.enum(["upcoming", "ongoing", "completed"]);
export type EditionStatus = z.infer<typeof EditionStatusSchema>;

const stat = () => z.number().int().min(0).optional();

export const GameSideSchema = z.object({
  team: TeamIdSchema,
  kills: stat(),
  deaths: stat(),
  assists: stat(),
  gold: stat(),
  dragons: stat(),
  barons: stat(),
  towers: stat(),
  picks: z.array(z.string()),
  bans: z.array(z.string()),
});
export type GameSide = z.infer<typeof GameSideSchema>;

export const GameSchema = z.object({
  id: z.string(),
  number: z.number().int().min(1),
  blue: GameSideSchema,
  red: GameSideSchema,
  /** Winning side, not a team id. */
  winner: z.enum(["blue", "red"]),
  durationSec: z.number().int().positive().optional(),
  patch: z.string().optional(),
});
export type Game = z.infer<typeof GameSchema>;

export const MatchSchema = z.object({
  id: z.string(),
  round: z.string().optional(),
  date: z.iso.datetime().optional(),
  bestOf: z.number().int().positive().optional(),
  /** null = team still to be determined. */
  team1: TeamIdSchema.nullable(),
  team2: TeamIdSchema.nullable(),
  score1: z.number().int().min(0).nullable(),
  score2: z.number().int().min(0).nullable(),
  winner: TeamIdSchema.nullable(),
  /** Sorted by `number`. */
  games: z.array(GameSchema),
});
export type Match = z.infer<typeof MatchSchema>;

export const StageSchema = z.object({
  id: SlugSchema,
  name: z.string(),
  type: StageTypeSchema,
  order: z.number().int().min(0),
  /** Sorted by date, then id. */
  matches: z.array(MatchSchema),
});
export type Stage = z.infer<typeof StageSchema>;

export const EditionSchema = z.object({
  year: z.number().int().min(2011),
  name: z.string(),
  overviewPages: z.array(z.string()).min(1),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  status: EditionStatusSchema,
  champion: TeamIdSchema.nullable(),
  coverage: z.object({ matches: z.boolean(), games: z.boolean() }),
  /** Sorted by `order`. */
  stages: z.array(StageSchema),
});
export type Edition = z.infer<typeof EditionSchema>;
