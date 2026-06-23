import express from "express";
import { analyzeUrl } from "../services/processor.js";
import { requireAuth, validateMediaUrl } from "../services/validation.js";

export const mediaRouter = express.Router();

mediaRouter.post("/analyze", requireAuth, async (req, res, next) => {
  try {
    validateMediaUrl(req.body.url);
    const result = await analyzeUrl(req.body.url);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

