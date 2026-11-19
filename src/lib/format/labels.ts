import type { EditionStatus, StageType } from "../../data/schema/index.js";

const STATUS_LABELS: Record<EditionStatus, string> = {
  completed: "Completed",
  ongoing: "Ongoing",
  upcoming: "Upcoming",
};

const STAGE_TYPE_LABELS: Record<StageType, string> = {
  "play-in": "Play-In",
  swiss: "Swiss",
  groups: "Groups",
  "single-elimination": "Knockout",
  other: "Main Event",
};

export function statusLabel(status: EditionStatus): string {
  return STATUS_LABELS[status];
}

export function stageTypeLabel(type: StageType): string {
  return STAGE_TYPE_LABELS[type];
}
