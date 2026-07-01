import express from "express";
import rateLimit from "express-rate-limit";
import { analyzeUrl } from "../services/processor.js";
import { requireAuth, validateMediaUrl } from "../services/validation.js";

export const mediaRouter = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many analyze requests, please try again later", message: "Too many analyze requests, please try again later" }
});

// IMPORTANT: yt-dlp failures must NEVER produce a 5xx response. analyzeUrl()
// always returns a structured { success, error?, message?, data? } envelope,
// so this route always responds with 200 (or 400 for client-side URL errors).
mediaRouter.post("/analyze", analyzeLimiter, requireAuth, async (req, res) => {
  try {
    validateMediaUrl(req.body.url);
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
      message: err.message
    });
  }
  try {
    const result = await analyzeUrl(req.body.url);
    return res.status(200).json(result);
  } catch (err) {
    // Defensive — analyzeUrl() should never throw, but if anything escapes,
    // we still respond 200 with a structured failure rather than 5xx.
    console.error("analyze route caught unexpected error:", err?.message || err);
    return res.status(200).json({
      success: false,
      error: err?.message || "unexpected error",
      message: "Video not accessible — please try again."
    });
  }
});
