import { privateFetch } from "./private-fetch";
import type { UserImage } from "./images";
import { videoSampleTimes, VIDEO_SHEET_COUNT } from "./lifting-video";

export type VideoSheet = {
  id: string;
  image: string;
  label: string;
  date: string;
};
function mediaEvent(
  video: HTMLVideoElement,
  event: string,
  signal: AbortSignal,
  trigger?: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const clean = () => {
      clearTimeout(timer);
      video.removeEventListener(event, success);
      video.removeEventListener("error", failure);
      signal.removeEventListener("abort", abort);
    };
    const success = () => {
      clean();
      resolve();
    };
    const failure = () => {
      clean();
      reject(
        Error(
          "This video could not be decoded. Try exporting it as an MP4 (H.264), or attach still photos.",
        ),
      );
    };
    const abort = () => {
      clean();
      reject(signal.reason);
    };
    const timer = setTimeout(failure, 10000);
    video.addEventListener(event, success, { once: true });
    video.addEventListener("error", failure, { once: true });
    signal.addEventListener("abort", abort, { once: true });
    try {
      trigger?.();
    } catch (e) {
      clean();
      reject(e);
    }
  });
}
export async function sampleLiftingVideo(
  video: HTMLVideoElement,
  start: number,
  end: number,
  date: string,
  lift: string,
  group: string,
  signal: AbortSignal,
  progress: (done: number) => void,
) {
  const times = videoSampleTimes(start, end, video.duration);
  video.pause();
  if (video.readyState < 2) await mediaEvent(video, "loadeddata", signal);
  if (!video.videoWidth || !video.videoHeight)
    throw Error("The video has no readable picture.");
  const sheets: VideoSheet[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw Error("Video frame processing is unavailable in this browser.");
  const scale = Math.min(640 / video.videoWidth, 584 / video.videoHeight);
  const width = Math.round(video.videoWidth * scale),
    height = Math.round(video.videoHeight * scale);
  for (let sheet = 0; sheet < VIDEO_SHEET_COUNT; sheet++) {
    ctx.fillStyle = "#101010";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let tile = 0; tile < 6; tile++) {
      signal.throwIfAborted();
      const index = sheet * 6 + tile,
        time = times[index];
      if (Math.abs(video.currentTime - time) > 0.001 || video.seeking)
        await mediaEvent(video, "seeked", signal, () => {
          video.currentTime = time;
        });
      if (video.readyState < 2) await mediaEvent(video, "loadeddata", signal);
      signal.throwIfAborted();
      const x = (tile % 2) * 640,
        y = Math.floor(tile / 2) * 640;
      // Letterbox the entire frame; never crop out feet, plates or the overhead bar.
      ctx.drawImage(
        video,
        x + (640 - width) / 2,
        y + 56 + (584 - height) / 2,
        width,
        height,
      );
      ctx.fillStyle = "#ffffff";
      ctx.font = "28px sans-serif";
      ctx.fillText(`${index + 1} · ${time.toFixed(2)}s`, x + 18, y + 38);
      progress(index + 1);
    }
    const image = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    if (!image || image.length > 2800000)
      throw Error(
        "The sampled images are too large. Try a lower-resolution clip.",
      );
    sheets.push({
      id: crypto.randomUUID(),
      image,
      date,
      label: `${lift} · video ${group} · sheet ${sheet + 1}/4 · ${times[sheet * 6].toFixed(2)}–${times[sheet * 6 + 5].toFixed(2)}s`,
    });
  }
  return { sheets, times };
}
export async function saveVideoSheet(
  sheet: VideoSheet,
  accountId: string,
  signal: AbortSignal,
): Promise<UserImage> {
  const response = await privateFetch("/api/images", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Journal-Account": accountId,
    },
    body: JSON.stringify({
      ...sheet,
      autoTag: false,
      purpose: "lifting-video-frames",
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(data.error ?? "Could not save the video frames. Try again.");
  return data;
}
