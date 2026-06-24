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
  message: { error: "Too many analyze requests, please try again later" }
});

mediaRouter.post("/analyze", analyzeLimiter, requireAuth, async (req, res, next) => {
  try {
    validateMediaUrl(req.body.url);
    const result = await analyzeUrl(req.body.url);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

