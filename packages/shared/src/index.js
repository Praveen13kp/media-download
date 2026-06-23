export const DOWNLOAD_STATES = Object.freeze({
  PENDING: "Pending",
  FETCHING: "Fetching information",
  PROCESSING: "Processing",
  CONVERTING: "Converting",
  DOWNLOADING: "Downloading",
  COMPLETED: "Completed",
  FAILED: "Failed",
  PAUSED: "Paused",
  CANCELED: "Canceled"
});

export const DOWNLOAD_TYPES = Object.freeze({
  VIDEO: "video",
  VIDEO_ONLY: "video-only",
  AUDIO: "audio"
});

export const VIDEO_QUALITIES = ["144p", "240p", "360p", "480p", "720p", "1080p", "best"];
export const AUDIO_FORMATS = ["mp3", "m4a", "opus", "webm"];
export const VIDEO_FORMATS = ["mp4", "webm", "mkv"];

