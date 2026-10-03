import { test } from "node:test";
import assert from "node:assert/strict";
import { skillsFor } from "../lib/agent/skills";
import { toolsFor } from "../lib/agent/tools";

const names = (skills: Parameters<typeof toolsFor>[0]) =>
  toolsFor(skills).map((t) => t.function.name);

test("clear signals in English and Danish load the skills a message needs", () => {
  const cases: [string, string[]][] = [
    ["Plan a 5 km run route around the lakes", ["routes"]],
    ["Start my Leg day routine.", ["programmes"]],
    ["Remember that I train at 6.", ["memory"]],
    ["How did my week go?", ["review"]],
    ["Hvad er mit kaloriemål?", ["goals"]],
    ["Vis mine billeder fra i går", ["photos"]],
    ["Samme frokost som i går.", []],
    ["I did a clean and jerk at 90 kg", []],
    ["Prepare a preview of my check-in", []],
    ["Can you give me a high-protein recipe with chicken?", ["recipes"]],
    ["Any dinner ideas with what's in my fridge?", ["recipes"]],
    ["What can I cook tonight?", ["recipes"]],
    ["Lav en madplan til mig", ["recipes"]],
    ["Har du en opskrift på grød?", ["recipes"]],
    ["Hvad skal jeg spise til aftensmad?", ["recipes"]],
    ["Hvad skal jeg lave til mad i aften?", ["recipes"]],
    // A picture of the dish; photos come too, in case one is saved.
    ["Can I see a picture of that dish?", ["photos", "recipes"]],
    ["Vis mig et billede af retten", ["photos", "recipes"]],
    // "Lave" alone is to do, not to cook: a training question.
    ["Hvad skal jeg lave i dag?", []],
  ];
  for (const [message, expected] of cases)
    assert.deepEqual([...skillsFor(message)].sort(), expected.sort(), message);
  assert.deepEqual([...skillsFor("Log this", 2)], ["photos"]);
});

test("a turn is offered the core tools, then only its skills' tools and fields", () => {
  const core = names(new Set());
  for (const skillTool of [
    "plan_route",
    "search_web",
    "weekly_review",
    "coach_memory",
    "inspect_images",
    "training_library",
  ])
    assert.ok(!core.includes(skillTool), skillTool);
  assert.ok(core.includes("log_entry") && core.includes("load_skills"));
  const prepare = toolsFor(new Set()).find(
    (t) => t.function.name === "prepare_change",
  )!;
  const fields = Object.keys(
    (prepare.function.parameters as { properties: Record<string, unknown> })
      .properties,
  );
  for (const field of [
    "routine",
    "trainingProgram",
    "bodyGoals",
    "memory",
    "plan",
  ])
    assert.ok(!fields.includes(field), field);
  assert.ok(fields.includes("meal") && fields.includes("checkin"));

  const routes = names(new Set(["routes"]));
  assert.ok(
    routes.includes("plan_route") && routes.includes("show_activity_route"),
  );
  // show_visual comes with either skill that draws visuals, once.
  assert.ok(!core.includes("show_visual"));
  for (const skill of ["review", "recipes"] as const)
    assert.ok(names(new Set([skill])).includes("show_visual"), skill);
  assert.equal(
    names(new Set(["review", "recipes"])).filter((n) => n === "show_visual")
      .length,
    1,
  );
  // Skill tools come after every core tool, for the longest shared prefix.
  assert.deepEqual(routes.slice(0, core.length), core);
  const all = names(
    new Set([
      "photos",
      "routes",
      "web",
      "programmes",
      "lifting",
      "review",
      "goals",
      "memory",
      "recipes",
    ]),
  );
  assert.ok(!all.includes("load_skills"));
});
