import { z } from "zod";

// Coach can look up public facts it does not hold, such as the ingredients on a
// packaged food. Everything here is bounded: the query that leaves this server,
// the bytes read back, and the text handed to the model.
const MAX_BYTES = 256000;
const RESULTS = 5;
const SNIPPET_CHARS = 700;
const TIMEOUT_MS = 9000;

export const webSearchSchema = z
  .object({
    query: z.string().trim().min(3).max(200),
  })
  .strict();
export type WebSearchRequest = z.infer<typeof webSearchSchema>;
export type WebSearchResult = {
  title: string;
  url: string;
  published?: string;
  snippet: string;
};

export function webSearchKey() {
  return process.env.EXA_API_KEY?.trim() ?? "";
}
export const webSearchEnabled = () => Boolean(webSearchKey());

const responseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().nullish(),
        url: z.string().nullish(),
        publishedDate: z.string().nullish(),
        text: z.string().nullish(),
        highlights: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
});

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw Error("Web search is unavailable right now. Try again shortly.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Web search returned an empty response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw Error("Web search returned too much data.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Error("Web search returned an unreadable response.");
  }
}

// Retrieved pages are strangers' text. Collapse control characters and
// whitespace so nothing arrives dressed up as a new instruction or role.
function flatten(value: string, limit: number) {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function onlyHttps(raw: string | null | undefined) {
  if (!raw) return;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    if (url.username || url.password) return;
    return url.href.slice(0, 500);
  } catch {
    return;
  }
}

export async function searchWeb(
  input: WebSearchRequest,
  deps: { fetch?: typeof fetch; key?: string; signal?: AbortSignal } = {},
): Promise<WebSearchResult[]> {
  const { query } = webSearchSchema.parse(input);
  const key = deps.key ?? webSearchKey();
  if (!key)
    throw Error(
      "Web search is not connected yet. The app owner needs to add an Exa API key.",
    );
  const response = await (deps.fetch ?? fetch)("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults: RESULTS,
      type: "auto",
      contents: { text: { maxCharacters: SNIPPET_CHARS * 2 } },
    }),
    redirect: "error",
    signal: deps.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = responseSchema.safeParse(await readJson(response));
  if (!body.success) throw Error("Web search returned an unexpected response.");
  const seen = new Set<string>();
  const results: WebSearchResult[] = [];
  for (const hit of body.data.results ?? []) {
    const url = onlyHttps(hit.url);
    if (!url || seen.has(url)) continue;
    const snippet = flatten(
      hit.text || (hit.highlights ?? []).join(" ") || "",
      SNIPPET_CHARS,
    );
    if (!snippet) continue;
    seen.add(url);
    results.push({
      title: flatten(hit.title || url, 160),
      url,
      ...(hit.publishedDate
        ? { published: flatten(hit.publishedDate, 40) }
        : {}),
      snippet,
    });
    if (results.length >= RESULTS) break;
  }
  return results;
}
