import { analyzeUrl } from "./packages/backend/src/services/processor.js";

async function main() {
  console.log("--- Test 1: bad URL (yt-dlp will fail) ---");
  const r1 = await analyzeUrl("https://www.youtube.com/watch?v=THIS_DOES_NOT_EXIST_XXXXXX");
  console.log("result:", JSON.stringify(r1, null, 2));

  console.log("\n--- Test 2: not a URL at all ---");
  const r2 = await analyzeUrl("not even a url");
  console.log("result:", JSON.stringify(r2, null, 2));

  console.log("\n--- Test 3: real-ish YouTube URL (will likely hit bot detection in anonymous mode) ---");
  const r3 = await analyzeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  console.log("result:", JSON.stringify(r3, null, 2).slice(0, 800));
}

main().catch((e) => console.error("smoke run error:", e));
