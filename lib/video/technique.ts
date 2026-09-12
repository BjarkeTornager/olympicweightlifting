import type { TechniqueIssue } from "./correction";

export const techniqueRubric: Record<TechniqueIssue, string> = {
  early_pull_posture:
    "Before the bar passes the knees: only flag hips rising ahead of shoulders when chronological frames establish a loss of the starting pulling posture. Normal changes after the knees are not this fault.",
  bar_separation:
    "Check visible bar-to-body separation in the pull and turnover, not conformity to a perfectly straight bar path. Explain the actual event and avoid guessing its cause.",
  clean_turnover:
    "Check the transition onto the front shoulders for a visibly delayed or disconnected receipt. A low elbow in an intermediate frame alone is not a fault.",
  jerk_dip_posture:
    "Compare the stable front-rack hold with the bottom of the dip. Look for a visible loss of upright trunk position before the drive; do not confuse recovery from the clean with a jerk dip.",
  overhead_control:
    "Check consecutive overhead receiving and recovery frames for loss of support or control. Do not infer an elbow press-out or competition judgment from sparse frames.",
  split_recovery:
    "Review visible split foot placement and the recovery sequence. Do not treat a deliberate pause as an error or prescribe an arbitrary stance width.",
  other:
    "A different supported issue. Describe it precisely and give one relevant, observable next-attempt check.",
};
export const techniqueDrills = {
  jerk_dip: {
    name: "Controlled jerk dip",
    instruction:
      "Use an empty bar to rehearse a few controlled dips. Keep the rack settled and practise the torso position shown in the reference frame.",
    url: "https://www.youtube.com/watch?v=NYIgTh-XyYQ",
    source: "Catalyst Athletics · Jerk Dip",
    issues: ["jerk_dip_posture"],
    lifts: ["Jerk", "Clean & jerk"],
  },
  snatch_lift_off: {
    name: "Controlled snatch lift-off",
    instruction:
      "With a light load, move from the floor to just below the knee and pause. Rehearse keeping your starting pulling posture while hips and shoulders rise together.",
    url: "https://www.catalystathletics.com/exercise/187/Snatch-Deadlift/",
    source: "Catalyst Athletics · Snatch Deadlift",
    issues: ["early_pull_posture"],
    lifts: ["Snatch"],
  },
  tall_clean: {
    name: "Tall clean",
    instruction:
      "Practise with an empty bar or very light load. Focus on moving under and meeting the bar smoothly at the shoulders; use the demonstration for the setup.",
    url: "https://www.catalystathletics.com/exercise/150/Tall-Clean/",
    source: "Catalyst Athletics · Tall Clean",
    issues: ["clean_turnover"],
    lifts: ["Clean", "Clean & jerk"],
  },
} as const;
export type TechniqueDrill = keyof typeof techniqueDrills;
export function compatibleDrill(
  id: TechniqueDrill | undefined,
  issue: TechniqueIssue | undefined,
  lift: string | null | undefined,
) {
  if (!id || !issue || !lift) return undefined;
  const drill = techniqueDrills[id];
  return drill &&
    (drill.issues as readonly string[]).includes(issue) &&
    (drill.lifts as readonly string[]).includes(lift)
    ? drill
    : undefined;
}
