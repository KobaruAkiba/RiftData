import { z } from "zod";

/** lolesports game id: digits only (also safe as a file name). */
export const LolGameIdSchema = z.string().regex(/^\d+$/);
export type LolGameId = z.infer<typeof LolGameIdSchema>;

const SideSchema = z.enum(["blue", "red"]);
const Series = z.array(z.number());

const ParticipantSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  side: SideSchema,
  role: z.string().min(1),
  championKey: z.string().min(1),
  runes: z.object({
    primary: z.number().int(),
    secondary: z.number().int(),
    perks: z.array(z.number().int()),
  }),
});

const TeamSeriesSchema = z.object({
  gold: Series,
  kills: Series,
  towers: Series,
  inhibitors: Series,
  barons: Series,
  dragons: Series,
});
type TeamSeries = z.infer<typeof TeamSeriesSchema>;

const PlayerSeriesSchema = z.object({
  participantId: z.number().int().min(1).max(10),
  gold: Series,
  level: Series,
  kills: Series,
  deaths: Series,
  assists: Series,
  cs: Series,
  damageShare: Series,
  killParticipation: Series,
  wardsPlaced: Series,
  wardsDestroyed: Series,
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
