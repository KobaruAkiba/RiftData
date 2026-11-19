import { z } from "zod";

/** Lowercase alphanumeric segments joined by single hyphens. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export type Slug = z.infer<typeof SlugSchema>;

/** Stable team identifier, stable across renames. */
export const TeamIdSchema = SlugSchema;
export type TeamId = z.infer<typeof TeamIdSchema>;

export const TeamSchema = z.object({
  id: TeamIdSchema,
  name: z.string().min(1),
  short: z.string().optional(),
  region: z.string().optional(),
  /** All historical names, including the current one, sorted. */
  aliases: z.array(z.string()).min(1),
});
export type Team = z.infer<typeof TeamSchema>;

/** Teams file content; `teams` are sorted by id. */
export const TeamsFileSchema = z.object({ teams: z.array(TeamSchema) });
export type TeamsFile = z.infer<typeof TeamsFileSchema>;
