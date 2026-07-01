import express from "express";
import { requireAuth } from "../services/validation.js";
import { getCookieStatus, updateCookies, validateCookieContent, cookiesEnabled } from "../services/cookies.js";

export const cookiesRouter = express.Router();

cookiesRouter.get("/status", requireAuth, (_req, res) => {
  const status = getCookieStatus();
  res.json({
    success: true,
    data: {
      configured: status.enabled,
      fileExists: status.fileExists,
      size: status.size,
      sampleDomain: status.sampleDomain,
      cookiesEnabled: cookiesEnabled()
    }
  });
});

cookiesRouter.post("/update", requireAuth, async (req, res) => {
  try {
    const { cookies } = req.body;
    if (!cookies || typeof cookies !== "string") {
      return res.status(400).json({ success: false, error: "Missing 'cookies' field in request body" });
    }

    const validation = validateCookieContent(cookies);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.reason });
    }

    await updateCookies(cookies);
    const status = getCookieStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
