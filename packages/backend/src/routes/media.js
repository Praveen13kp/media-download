import express from "express";
import rateLimit from "express-rate-limit";
import { analyzeUrl } from "../services/processor.js";
import { requireAuth, validateMediaUrl, extractCookies } from "../services/validation.js";
import { validateCookieContent } from "../services/cookies.js";

export const mediaRouter = express.Router();

const analyzeLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many analyze requests, please try again later" }
});

mediaRouter.post("/analyze", analyzeLimiter, requireAuth, async (req, res, next) => {
  try {
    validateMediaUrl(req.body.url);
    const cookies = extractCookies(req.body);
    if (cookies !== null) validateCookieContent(cookies);
    const result = await analyzeUrl(req.body.url, cookies);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
