import { checkPrivateResponse, privateRequestHeaders } from "../private-fetch";
import type { SavedVideoReview, VideoUpload } from "./types";

export type UploadProgress = {
  loaded: number;
  total: number;
  startedAt: number;
  lastProgressAt: number;
  transferred: boolean;
};

// XHR provides real byte progress on Safari as well as other browsers. Keep
// exactly the same authenticated, bounded binary endpoint and retry ID.
export function uploadLiftingVideo(
  file: File,
  metadata: VideoUpload,
  accountId: string,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<SavedVideoReview> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startedAt = Date.now();
    let loaded = 0;
    const report = (transferred = false) =>
      onProgress({
        loaded,
        total: file.size,
        startedAt,
        lastProgressAt: Date.now(),
        transferred,
      });
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => xhr.abort();
    if (signal.aborted)
      return reject(new DOMException("Upload cancelled", "AbortError"));
    xhr.open("POST", "/api/lifting-videos");
    const headers = privateRequestHeaders({
      "X-Journal-Account": accountId,
      "Content-Type": "application/octet-stream",
      "X-Video-Metadata": encodeURIComponent(JSON.stringify(metadata)),
    });
    headers.forEach((value, key) => xhr.setRequestHeader(key, value));
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (e) => {
      loaded = Math.min(file.size, e.loaded);
      report(loaded === file.size);
    };
    xhr.upload.onload = () => {
      loaded = file.size;
      report(true);
    };
    xhr.onload = () => {
      cleanup();
      checkPrivateResponse(xhr.status);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          throw Error(data.error ?? "Upload failed. Retry with the same clip.");
        resolve(data);
      } catch (e) {
        reject(
          e instanceof SyntaxError
            ? Error(
                "The upload could not be confirmed. Retry with the same clip; it will not be duplicated.",
              )
            : e,
        );
      }
    };
    xhr.onerror = () =>
      fail(
        Error(
          "Upload connection lost. Reconnect and retry with the same clip; it will not be duplicated.",
        ),
      );
    xhr.ontimeout = () =>
      fail(Error("Upload timed out. Reconnect and retry with the same clip."));
    xhr.onabort = () =>
      fail(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    report();
    xhr.send(file);
  });
}
