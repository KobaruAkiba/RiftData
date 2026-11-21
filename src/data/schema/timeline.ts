import { z } from "zod";

/** lolesports game id: digits only (also safe as a file name). */
export const LolGameIdSchema = z.string().regex(/^\d+$/);
export type LolGameId = z.infer<typeof LolGameIdSchema>;

const SideSchema = z.enum(["blue", "red"]);
/** One non-negative integer per sampled minute (gold, kills, towers, wards...). */
const CountSeries = z.array(z.number().int().nonnegative());
/** One share in [0, 1] per sampled minute (damage share). */
const ShareSeries = z.array(z.number().min(0).max(1));
/**
 * Kill participation is only non-negative: the feed itself reports values above 1 when assists
 * outrun the team kill counter (game 115660540726095080, 1.2 for 10 minutes).
 */
const KillParticipationSeries = z.array(z.number().nonnegative());

const ParticipantSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  side: SideSchema,
  role: z.string().min(1),
  championKey: z.string().min(1),
  runes: z.object({
    primary: z.number().int().positive(),
    secondary: z.number().int().positive(),
    perks: z.array(z.number().int().positive()).min(1),
  }),
});

const TeamSeriesSchema = z.object({
  gold: CountSeries,
  kills: CountSeries,
  towers: CountSeries,
  inhibitors: CountSeries,
  barons: CountSeries,
  dragons: CountSeries,
});
type TeamSeries = z.infer<typeof TeamSeriesSchema>;

const PlayerSeriesSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  gold: CountSeries,
  level: CountSeries,
  kills: CountSeries,
  deaths: CountSeries,
  assists: CountSeries,
  cs: CountSeries,
  damageShare: ShareSeries,
  killParticipation: KillParticipationSeries,
  wardsPlaced: CountSeries,
  wardsDestroyed: CountSeries,
});

const ItemsSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  changes: z.array(z.object({ minute: z.number().int().min(0), items: z.array(z.number().int()) })),
});

const EventSchema = z
  .object({
    minute: z.number().int().min(0),
    side: SideSchema,
    type: z.enum(["dragon", "baron", "tower", "inhibitor"]),
    dragonType: z.string().min(1).optional(),
  })
  .refine((e) => (e.type === "dragon") === (e.dragonType !== undefined), {
    message: "dragonType is required for dragons and forbidden otherwise",
  });

/** Participants: exactly 10, unique ids, 1-5 blue and 6-10 red. */
function participantsAreValid(ps: Array<z.infer<typeof ParticipantSchema>>): boolean {
  if (ps.length !== 10) return false;
  const ids = new Set(ps.map((p) => p.participantId));
  return ids.size === 10 && ps.every((p) => p.side === (p.participantId <= 5 ? "blue" : "red"));
}

/** True when `rows` hold exactly one row per participant id (no missing, duplicate or foreign ids). */
function coversParticipants(rows: Array<{ participantId: number }>, ids: Set<number>): boolean {
  const seen = new Set(rows.map((r) => r.participantId));
  return rows.length === ids.size && seen.size === ids.size && [...seen].every((id) => ids.has(id));
}

/** Time series of one game from the lolesports feed, one sample per game minute (minute 0 included). */
export const GameTimelineSchema = z
  .object({
    gameId: LolGameIdSchema,
    year: z.number().int(),
    minutes: z.number().int().min(1),
    participants: z.array(ParticipantSchema),
    teams: z.object({ blue: TeamSeriesSchema, red: TeamSeriesSchema }),
    players: z.array(PlayerSeriesSchema),
    items: z.array(ItemsSchema),
    events: z.array(EventSchema),
  })
  .refine((t) => participantsAreValid(t.participants), {
    message: "participants must be 10 with unique ids, blue 1-5 and red 6-10",
    path: ["participants"],
  })
  .superRefine((t, ctx) => {
    const ids = new Set(t.participants.map((p) => p.participantId));
    for (const key of ["players", "items"] as const) {
      if (!coversParticipants(t[key], ids)) {
        ctx.addIssue({ code: "custom", message: `${key} must have exactly one row per participant`, path: [key] });
      }
    }
    const check = (series: number[], path: Array<string | number>) => {
      if (series.length !== t.minutes) {
        ctx.addIssue({ code: "custom", message: `series length ${series.length} != minutes ${t.minutes}`, path });
      }
    };
    for (const side of ["blue", "red"] as const) {
      for (const [key, series] of Object.entries(t.teams[side]) as Array<[keyof TeamSeries, number[]]>) {
        check(series, ["teams", side, key]);
      }
    }
    t.players.forEach((p, i) => {
      for (const [key, value] of Object.entries(p)) {
        if (Array.isArray(value)) check(value, ["players", i, key]);
      }
    });
    t.items.forEach((it, i) => {
      if (it.changes[0]?.minute !== 0) {
        ctx.addIssue({ code: "custom", message: "first item change must be at minute 0", path: ["items", i, "changes", 0] });
      }
    });
  });
export type GameTimeline = z.infer<typeof GameTimelineSchema>;

/** Per-year index: Leaguepedia GameId -> lolesports game id and participants (names from Leaguepedia). */
export const LivestatsIndexSchema = z.object({
  games: z.record(
    z.string(),
    z.object({
      gameId: LolGameIdSchema,
      participants: z.array(
        z.object({
          participantId: z.number().int().min(1).max(10),
          player: z.string(),
          team: z.string(),
          role: z.string(),
          champion: z.string(),
        }),
      ),
    }),
  ),
});
export type LivestatsIndex = z.infer<typeof LivestatsIndexSchema>;
