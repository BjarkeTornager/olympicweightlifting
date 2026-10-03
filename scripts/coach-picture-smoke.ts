// Draws one picture of a fixed dish with the real image model and prints how
// long it took and what it cost, to check the model, its zero-retention route
// (OpenRouter's activity log names the provider) and real latency. It costs
// about $0.03, so the owner runs it by hand; tests never call the model.
//
//   COACH_PICTURE_MODEL=google/gemini-3.1-flash-lite-image npx tsx scripts/coach-picture-smoke.ts
//
// Needs OPENROUTER_API_KEY (from .env.local unless set). The picture is
// written to coach-picture-smoke.jpg; nothing goes in a database.
import { writeFile } from "node:fs/promises";
import { config } from "dotenv";
import {
  normalizePicture,
  parsePictureReply,
  PICTURE_ENDPOINT,
  picturePrompt,
  pictureRequest,
  pictureSettings,
} from "../lib/coach-pictures";
config({ path: ".env.local", quiet: true });

const { model } = pictureSettings();
if (!model || !process.env.OPENROUTER_API_KEY)
  throw Error("Set COACH_PICTURE_MODEL and OPENROUTER_API_KEY first.");
const prompt = picturePrompt({
  title: "Salmon rice bowl",
  ingredients: [
    { item: "Salmon fillet" },
    { item: "Jasmine rice" },
    { item: "Edamame beans" },
    { item: "Cucumber" },
    { item: "Sesame seeds" },
  ],
});
const started = Date.now();
const response = await fetch(PICTURE_ENDPOINT, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  },
  body: JSON.stringify(pictureRequest(prompt, model)),
  signal: AbortSignal.timeout(60000),
  redirect: "error",
});
const seconds = (Date.now() - started) / 1000;
if (!response.ok)
  throw Error(
    `The model answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
  );
const reply = parsePictureReply(await response.json());
const jpeg = await normalizePicture(reply.image);
await writeFile("coach-picture-smoke.jpg", jpeg);
console.log(
  JSON.stringify({
    model: reply.model ?? model,
    seconds,
    costUsd: reply.costUsd ?? null,
    jpegBytes: jpeg.length,
    file: "coach-picture-smoke.jpg",
  }),
);
