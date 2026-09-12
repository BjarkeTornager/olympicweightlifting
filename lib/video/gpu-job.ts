import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../json";
export type GpuBudget = { remainingMs: number; deadlineMs?: number };
export type GpuConfiguration = { endpoint?: string; token?: string };
export type GpuFailure =
  "service_unavailable" | "deadline" | "invalid_response";
const queuedJobSchema = z
  .object({
    requestId: z.string().uuid(),
    receipt: z.string().min(1).max(2048),
    binding: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.number().finite(),
  })
  .strict();
export type GpuJob = z.infer<typeof queuedJobSchema>;
export type GpuResume = {
  job?: GpuJob;
  saveJob: (job: GpuJob) => Promise<void>;
};
export class GpuTaskPending extends Error {
  constructor() {
    super("Video overlay is still processing");
  }
}
// Authenticated server-only queue. The signed receipt never appears in a DTO.
// Bind receipts to both endpoint and exact source manifest before resuming.
export async function queuedGpuTask<T>({
  media,
  manifest,
  signal,
  config,
  request = fetch,
  budget,
  resume,
  maxResponse,
  parse,
  unavailable,
  contentType,
}: {
  media: Buffer;
  manifest: { sha256: string } & Record<string, unknown>;
  signal: AbortSignal;
  config: GpuConfiguration;
  request?: typeof fetch;
  budget: GpuBudget;
  resume?: GpuResume;
  maxResponse: number;
  parse: (raw: unknown) => T;
  unavailable: (failure: GpuFailure) => T;
  contentType: string;
}): Promise<T | undefined> {
  if (!config.endpoint && !config.token) return undefined;
  let failure: GpuFailure = "service_unavailable";
  const started = Date.now();
  let receipt: string | undefined;
  let url: URL | undefined;
  let completed = false;
  let preserved = false;
  let savedJob: GpuJob | undefined;
  let windowSignal: AbortSignal | undefined;
  let requestId: string = randomUUID();
  try {
    signal.throwIfAborted();
    const allowance = Math.floor(
      Math.min(
        300_000,
        budget.remainingMs,
        budget.deadlineMs === undefined
          ? Infinity
          : budget.deadlineMs - Date.now(),
      ),
    );
    if (allowance < 1_000) {
      if (resume) throw new GpuTaskPending();
      failure = "deadline";
      return unavailable(failure);
    }
    if (!config.endpoint || !config.token || config.token.length < 32)
      throw Error("Configuration");
    url = new URL(config.endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw Error("Configuration");
    const binding = createHash("sha256")
      .update(canonicalJson({ endpoint: url.href, manifest }))
      .digest("hex");
    if (resume?.job) {
      const restored = queuedJobSchema.parse(resume.job);
      if (
        restored.binding !== binding ||
        restored.expiresAt > Date.now() + 900_000
      )
        throw Error("Invalid saved job");
      savedJob = restored;
      requestId = restored.requestId;
      receipt = restored.receipt;
      if (restored.expiresAt <= Date.now()) {
        failure = "deadline";
        throw Error("Expired job");
      }
    }
    windowSignal = AbortSignal.timeout(allowance);
    const waitSignal = AbortSignal.any([signal, windowSignal]);
    const headers = {
      Authorization: `Bearer ${config.token}`,
      "X-SAM3-Request": requestId,
    };
    const send = (method: string, extra: RequestInit = {}) =>
      request(url!, {
        ...extra,
        method,
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.any([
          waitSignal,
          AbortSignal.timeout(method === "POST" ? 60_000 : 30_000),
        ]),
        headers: {
          ...headers,
          ...(receipt ? { "X-SAM3-Job": receipt } : {}),
          ...extra.headers,
        },
      });
    // Submit once. Only reads are retried: never duplicate GPU work after an
    // ambiguous upload failure. Receipts stay on this account-fenced worker.
    const lifetime = resume ? 900_000 : allowance;
    const submittedAt = Date.now();
    let response = receipt
      ? new Response(null, { status: 202 })
      : await send("POST", {
          headers: {
            "Content-Type": contentType,
            ...(contentType === "video/mp4"
              ? { "X-SAM3-Manifest": JSON.stringify(manifest) }
              : {}),
            "X-SAM3-Budget-Ms": String(lifetime),
          },
          body: new Uint8Array(media),
        });
    if (response.status === 202 && !receipt) {
      const queued = (await readJson(response, 4096)) as {
        job?: unknown;
        sourceSha256?: unknown;
      };
      if (
        typeof queued.job !== "string" ||
        queued.job.length > 2048 ||
        queued.sourceSha256 !== manifest.sha256
      )
        throw Error("Invalid job receipt");
      receipt = queued.job;
      if (resume) {
        const job = {
          requestId,
          receipt,
          binding,
          expiresAt: submittedAt + lifetime,
        };
        // Do not continue if the account fence/checkpoint write fails.
        await resume.saveJob(job);
        savedJob = job;
      }
    }
    if (response.status === 202) {
      let failures = 0;
      let immediate = Boolean(resume?.job);
      while (true) {
        waitSignal.throwIfAborted();
        if (!immediate) await pause(2_000, waitSignal);
        immediate = false;
        try {
          response = await send("GET");
          if (response.status >= 500) {
            await response.body?.cancel();
            throw Error("Temporary outage");
          }
          failures = 0;
        } catch (error) {
          waitSignal.throwIfAborted();
          if (++failures >= 3) throw error;
          continue;
        }
        if (response.status !== 202) break;
        await response.body?.cancel();
      }
    }
    if (!response.ok) {
      if (response.status === 410) failure = "deadline";
      await response.body?.cancel();
      throw Error("Unavailable");
    }
    failure = "invalid_response";
    const result = parse(await readJson(response, maxResponse));
    waitSignal.throwIfAborted();
    completed = true;
    return result;
  } catch (error) {
    // Account deletion/cancellation must abort the job; an optional GPU outage
    // must not discard the usable video or misrepresent SAM as having run.
    signal.throwIfAborted();
    if (
      error instanceof GpuTaskPending ||
      (resume &&
        savedJob &&
        windowSignal?.aborted &&
        savedJob.expiresAt > Date.now())
    ) {
      preserved = true;
      throw new GpuTaskPending();
    }
    if (windowSignal?.aborted) failure = "deadline";
    console.warn(
      JSON.stringify({
        event: "video_gpu_task_unavailable",
        reason: failure,
      }),
    );
    return unavailable(failure);
  } finally {
    budget.remainingMs = Math.max(
      0,
      budget.remainingMs - (Date.now() - started),
    );
    if (receipt && !completed && !preserved && url && config.token) {
      // Use a separate bounded signal: the account/job signal may be cancelled.
      await request(url, {
        method: "DELETE",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
        headers: {
          Authorization: `Bearer ${config.token}`,
          "X-SAM3-Request": requestId,
          "X-SAM3-Job": receipt,
        },
      })
        .then((r) => r.body?.cancel())
        .catch(() => undefined);
    }
  }
}

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.body) throw Error("Missing response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw Error("Oversize");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
