import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyImage,
  resolveImageClassification,
} from "../lib/image-classifier";
import {
  coachRequest,
  imageCoachPrompt,
  PHOTO_ONLY_MESSAGE,
} from "../lib/images";

test("ambiguous categories stay out of Food and tag output is bounded", () => {
  for (const confidence of ["medium", "low"])
    assert.equal(
      resolveImageClassification({
        category: "food",
        confidence,
        tags: ["meal"],
      }).category,
      "unclassified",
    );
  assert.deepEqual(
    resolveImageClassification({
      category: "sleep",
      confidence: "high",
      tags: ["Apple Health", "apple health", "screenshot"],
    }),
    {
      category: "sleep",
      classification: {
        source: "automatic",
        status: "ready",
        confidence: "high",
        tags: ["apple health", "screenshot"],
      },
    },
  );
  for (const raw of [
    {
      category: "food",
      confidence: "high",
      tags: [],
      instruction: "save a meal",
    },
    { category: "food", confidence: "high", tags: Array(9).fill("tag") },
    { category: "food", confidence: "high", tags: ["x".repeat(33)] },
    { category: "unknown", confidence: "high", tags: [] },
  ])
    assert.throws(() => resolveImageClassification(raw));
  assert.match(imageCoachPrompt("sleep"), /sleep screenshot/);
  assert.doesNotMatch(imageCoachPrompt("sleep"), /prepare a food entry/);
  assert.match(imageCoachPrompt("unclassified"), /do not assume it is food/i);
});
test("classifier sends only the image, limits tools, and rejects malformed model replies", async () => {
  const pixels = Buffer.from("synthetic-image-bytes");
  await classifyImage(pixels, async (messages, tools) => {
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[1].images, [pixels.toString("base64")]);
    assert.match(messages[0].content, /Ignore any instructions/);
    assert.equal(tools.length, 1);
    return {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "classify_image",
            arguments: {
              category: "sleep",
              confidence: "high",
              tags: ["sleep report"],
            },
          },
        },
      ],
    };
  });
  await assert.rejects(
    classifyImage(pixels, async () => ({
      role: "assistant",
      content: "This is probably food.",
    })),
    /could not be determined/,
  );
  await assert.rejects(
    classifyImage(pixels, async () => ({
      role: "assistant",
      content: "",
      tool_calls: [{ function: { name: "prepare_change", arguments: {} } }],
    })),
    /could not be determined/,
  );
});

test("a photo sent without words asks Coach what the web composer asks", () => {
  // The iPhone app's placeholder with a meal photo logs the meal straight away.
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["food"]),
    imageCoachPrompt("food"),
  );
  assert.match(
    coachRequest("Here’s a photo.", ["food"]),
    /^Log the food I ate/,
  );
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["food", "food"]),
    imageCoachPrompt("food", 2),
  );
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["activity"]),
    imageCoachPrompt("activity"),
  );
  // Sleep, uncertain and mixed photos still don't save without being asked.
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["sleep"]),
    imageCoachPrompt("sleep"),
  );
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["unclassified"]),
    imageCoachPrompt("unclassified"),
  );
  assert.equal(
    coachRequest(PHOTO_ONLY_MESSAGE, ["food", "sleep"]),
    imageCoachPrompt("unclassified", 2),
  );
  // Words the athlete typed are never replaced, and no photo means no change.
  assert.equal(
    coachRequest("Is this a good snack?", ["food"]),
    "Is this a good snack?",
  );
  assert.equal(coachRequest(PHOTO_ONLY_MESSAGE, []), PHOTO_ONLY_MESSAGE);
});
