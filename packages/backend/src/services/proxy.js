/**
 * Proxy service for yt-dlp routing.
 *
 * Reads two optional environment variables:
 *   PROXY_LIST  — newline-separated list of proxy URLs (one per line).
 *                 Empty lines are ignored.
 *   YOUTUBE_PROXY — single proxy URL fallback.
 *
 * Security: proxy URLs are never logged or included in API responses.
 */

/**
 * Returns a single proxy URL to use, or null if none are configured.
 * When PROXY_LIST contains multiple entries a random one is chosen.
 */
export function getProxy() {
  const list = process.env.PROXY_LIST;
  if (list && list.trim()) {
    const proxies = list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (proxies.length > 0) {
      return proxies[Math.floor(Math.random() * proxies.length)];
    }
  }

  const single = process.env.YOUTUBE_PROXY;
  if (single && single.trim()) {
    return single.trim();
  }

  return null;
}

/**
 * Returns a proxy that is different from `exclude`, if possible.
 * Falls back to any available proxy when the list has only one entry.
 *
 * @param {string|null} exclude - Proxy URL to avoid.
 * @returns {string|null}
 */
export function getDifferentProxy(exclude) {
  const list = process.env.PROXY_LIST;
  if (list && list.trim()) {
    const proxies = list
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (proxies.length > 1) {
      const candidates = proxies.filter((p) => p !== exclude);
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
  }
  // Single proxy or no list — return whatever is available
  return getProxy();
}

/** Returns true if any proxy is configured. */
export function hasProxy() {
  return getProxy() !== null;
}
