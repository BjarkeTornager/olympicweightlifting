// Parts of Coach's instructions and tools that only some turns need. Every
// turn gets the core prompt with a one-line list of these skills; a skill's
// paragraphs, tools and prepare_change fields are added only when the turn
// needs it: loaded up front from a clear signal in the message, by the model
// through load_skills, or automatically when it calls one of the skill's
// tools. Everyday logging and questions run on the smaller core context,
// which the hard Coach benchmark found just as accurate, with about 27% fewer
// tokens per model call.
export const skillNames = [
  "photos",
  "routes",
  "web",
  "programmes",
  "lifting",
  "review",
  "goals",
  "memory",
  "recipes",
] as const;
export type SkillName = (typeof skillNames)[number];

type Skill = {
  summary: string;
  // How each of the skill's prompt paragraphs starts. A test checks each
  // matches exactly one paragraph, so an edit can't silently move text.
  paragraphs: string[];
  tools: string[];
  // prepare_change fields only this skill's changes use.
  fields: string[];
  // A clear sign in the athlete's message that the turn needs the skill.
  signal?: RegExp;
};

// Whole words or phrases, Danish letters included (\\b is ASCII-only).
const words = (...alternatives: string[]) =>
  new RegExp(`(?<!\\p{L})(${alternatives.join("|")})(?!\\p{L})`, "iu");

export const skills: Record<SkillName, Skill> = {
  photos: {
    summary:
      "finding, showing, reading or comparing saved photos and screenshots",
    paragraphs: [
      "Attachments are general images",
      "You CAN retrieve and display saved photos",
      "Showing photos does not require visual analysis",
    ],
    tools: ["show_images", "inspect_images", "image_library", "food_photos"],
    fields: [],
    signal: words(
      "photos?",
      "pictures?",
      "images?",
      "screenshots?",
      "pics?",
      "billede[rt]?",
      "billederne",
      "fotos?",
      "skærmbilleder?",
    ),
  },
  routes: {
    summary:
      "planning a running, walking or cycling route, or showing a recorded GPS route on a map",
    paragraphs: [
      "When the athlete asks for a running, walking or cycling route",
    ],
    tools: ["plan_route", "show_activity_route"],
    fields: [],
    signal: words("routes?", "maps?", "rute[rn]?", "ruterne", "kortet"),
  },
  web: {
    summary:
      "looking up public information on the web, such as a product's ingredients",
    paragraphs: ["When the athlete asks about something outside this journal"],
    tools: ["search_web"],
    fields: [],
    signal: words(
      "search",
      "google",
      "look (it )?up",
      "website",
      "online",
      "internet",
      "søg",
      "slå .{1,40} op",
      "nettet",
    ),
  },
  programmes: {
    summary:
      "creating, editing or starting reusable routines and multi-day training programmes",
    paragraphs: ["When asked to create or edit a reusable training routine"],
    tools: ["training_library"],
    fields: ["routine", "trainingProgram", "programChanges"],
    signal: words(
      "routines?",
      "programmes?",
      "programs?",
      "training plan",
      "plan my (week|training)",
      "rutiner?",
      "rutinen",
      "programmer",
      "programmet",
      "træningsplan",
    ),
  },
  lifting: {
    summary:
      "Olympic weightlifting assessment, technique, lift videos and the lifting brief",
    paragraphs: ["For individualized Olympic weightlifting assessment"],
    tools: ["lifting_review", "lifting_knowledge", "lifting_videos"],
    fields: ["liftingBrief"],
    signal: words(
      "technique",
      "videos?",
      "assess",
      "assessment",
      "lifting brief",
      "debrief",
      "teknik(ken)?",
      "vurder(ing)?",
    ),
  },
  review: {
    summary:
      "weekly reviews, and visuals in chat: charts, trend lines, progress against targets, headline numbers, comparisons, splits such as macros, calendars of days, tables and diagrams",
    paragraphs: ["For weekly reflection"],
    tools: ["weekly_review", "show_visual"],
    fields: [],
    signal: words(
      "week",
      "weekly",
      "review",
      "chart",
      "graph",
      "table",
      "diagram",
      "trend",
      "visuali[sz]e",
      "progress",
      "how am i doing",
      "on track",
      "compare[ds]?",
      "comparison",
      "split",
      "breakdown",
      "macros?",
      "calendar",
      "which days",
      "streak",
      "overview",
      "uge[n]?",
      "ugentlig",
      "graf",
      "tabel",
      "fremskridt",
      "sammenlign(ing)?",
      "kalender",
      "overblik",
    ),
  },
  goals: {
    summary:
      "body goals, calorie and macro targets, and fat-loss, muscle-gain or recomposition coaching",
    paragraphs: [
      "When the athlete wants to set goals",
      "At a goals follow-up",
      "Coach fat loss, muscle gain and recomposition",
    ],
    tools: [],
    fields: ["bodyGoals", "targets"],
    signal: words(
      "goals?",
      "targets?",
      "lose (weight|fat)",
      "fat loss",
      "weight loss",
      "cut(ting)?",
      "bulk(ing)?",
      "build muscle",
      "muscle gain",
      "recomp(osition)?",
      "macros?",
      "deficit",
      "surplus",
      "weight class(es)?",
      "make weight",
      "weigh-?in (date|day)",
      "mål(et)?",
      "vægttab",
      "tabe",
      "fedttab",
      "muskler",
      "kaloriemål",
      "underskud",
      "overskud",
      "vægtklassen?",
      "indvejning(en)?",
    ),
  },
  memory: {
    summary:
      "remembering preferences and saving, revising or dismissing agreed plans",
    paragraphs: [],
    tools: ["coach_memory"],
    fields: ["memory", "plan"],
    signal: words(
      "remember",
      "forget",
      "memory",
      "memories",
      "follow[- ]up",
      "(my|our|the|agreed) plans?",
      "husk",
      "glem",
      "hukommelse",
      "(min|mine|vores|den aftalte) plan(er)?",
      "planen",
      "planerne",
    ),
  },
  recipes: {
    summary:
      "recipes and meal ideas as recipe cards, with an optional picture of the dish",
    paragraphs: ["When the athlete asks for a recipe"],
    tools: ["show_visual"],
    fields: [],
    signal: words(
      "recipes?",
      "(meal|dinner|lunch|breakfast|snack) ideas?",
      "meal plan",
      "what (should|can) i (cook|eat|make)",
      "opskrift(en|er|erne)?",
      "madplan(en)?",
      "hvad skal jeg (spise|lave (til )?(mad|aftensmad|frokost|morgenmad))",
      // Not "photo of the meal", which is usually the athlete's own.
      "(picture|photo|image) of (the|that|this) (dish|recipe)",
      "billede af (retten|opskriften)",
    ),
  },
};

// Each skill tool and the skills that offer it: show_visual comes with both
// review and recipes.
export const skillTools = new Map<string, SkillName[]>();
for (const name of skillNames)
  for (const tool of skills[name].tools)
    skillTools.set(tool, [...(skillTools.get(tool) ?? []), name]);

// Skills a message clearly needs before the model is asked. Photos attached
// to the message always need the photos skill.
export function skillsFor(message: string, photoCount = 0): Set<SkillName> {
  const loaded = new Set<SkillName>();
  if (photoCount > 0) loaded.add("photos");
  for (const name of skillNames)
    if (skills[name].signal?.test(message)) loaded.add(name);
  return loaded;
}

export function isSkillParagraph(line: string, name?: SkillName) {
  return (name ? [name] : skillNames).some((n) =>
    skills[n].paragraphs.some((start) => line.startsWith(start)),
  );
}

// The core prompt's paragraph listing the skills, the same for every turn.
export const skillList = `Some abilities are skills, loaded only when a message needs them: ${skillNames
  .map(
    (name) =>
      `${name} (${skills[name].summary}${skills[name].tools.length ? `; tools ${skills[name].tools.join(", ")}` : ""})`,
  )
  .join(
    "; ",
  )}. The skills already loaded for this message and their instructions are in the system message after the date. To use another skill, call load_skills with its name first; its instructions and tools are then available in the next step. Never tell the athlete you can't do something a skill covers: load it.`;
