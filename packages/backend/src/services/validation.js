const supportedProtocols = new Set(["http:", "https:"]);

export function requireAuth(req, res, next) {
  const token = process.env.API_TOKEN;
  if (!token) return next();

  const header = req.get("authorization") || "";
  if (header === `Bearer ${token}` || req.query.token === token) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

export function validateMediaUrl(url) {
  if (!url || typeof url !== "string") {
    const error = new Error("A URL is required");
    error.status = 400;
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error("Invalid URL");
    error.status = 400;
    throw error;
  }

  if (!supportedProtocols.has(parsed.protocol)) {
    const error = new Error("Only http and https URLs are supported");
    error.status = 400;
    throw error;
  }
}

export function validateDownloadRequest(body) {
  validateMediaUrl(body.url);
  if (!["video", "video-only", "audio"].includes(body.type)) {
    const error = new Error("type must be video, video-only, or audio");
    error.status = 400;
    throw error;
  }
  if (!body.quality || typeof body.quality !== "string") {
    const error = new Error("quality is required");
    error.status = 400;
    throw error;
  }
  if (!body.format || typeof body.format !== "string") {
    const error = new Error("format is required");
    error.status = 400;
    throw error;
  }
  if (body.outputDir !== undefined && typeof body.outputDir !== "string") {
    const error = new Error("outputDir must be a string path");
    error.status = 400;
    throw error;
  }
}
