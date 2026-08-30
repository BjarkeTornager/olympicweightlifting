import { EXERCISES } from "../js/data.js";

const videos = [
  ...new Map(
    EXERCISES.filter((exercise) => exercise.videoId).map((exercise) => [exercise.videoId, exercise]),
  ).values(),
];

async function fetchWithTimeout(url, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Lift-Journal-Video-Verification/1.0" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verify(exercise) {
  const watchUrl = `https://www.youtube.com/watch?v=${exercise.videoId}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${exercise.videoId}?rel=0&playsinline=1`;

  try {
    const [oembedResponse, embedResponse] = await Promise.all([
      fetchWithTimeout(oembedUrl),
      fetchWithTimeout(embedUrl),
    ]);
    const metadata = oembedResponse.ok ? await oembedResponse.json() : null;
    const embedHtml = embedResponse.ok ? await embedResponse.text() : "";
    const explicitlyBlocked =
      /playableInEmbed(?:\\?&quot;|\\?")?\s*:\s*false/i.test(embedHtml) ||
      /playback on other websites has been disabled|video unavailable/i.test(embedHtml);
    const validMetadata =
      oembedResponse.ok &&
      metadata?.provider_name === "YouTube" &&
      typeof metadata?.html === "string" &&
      metadata.html.includes(exercise.videoId);
    const passed = validMetadata && embedResponse.ok && !explicitlyBlocked;

    return {
      exercise: exercise.name,
      videoId: exercise.videoId,
      title: metadata?.title ?? "Unavailable",
      author: metadata?.author_name ?? "Unknown",
      oembedStatus: oembedResponse.status,
      embedStatus: embedResponse.status,
      passed,
      explicitlyBlocked,
    };
  } catch (error) {
    return {
      exercise: exercise.name,
      videoId: exercise.videoId,
      title: "Unavailable",
      author: "Unknown",
      oembedStatus: 0,
      embedStatus: 0,
      passed: false,
      error: error.message,
    };
  }
}

const results = await Promise.all(videos.map(verify));

for (const result of results) {
  const status = result.passed ? "PASS" : "FAIL";
  console.log(
    `${status}\t${result.exercise}\t${result.videoId}\t${result.author}\t${result.title}\toEmbed ${result.oembedStatus} / embed ${result.embedStatus}`,
  );
  if (result.error) console.log(`     ${result.error}`);
}

const failures = results.filter((result) => !result.passed);
if (failures.length) {
  console.error(`\n${failures.length} of ${results.length} unique videos failed availability/embed verification.`);
  process.exitCode = 1;
} else {
  console.log(`\nVerified ${results.length} unique public, embeddable YouTube videos.`);
}
