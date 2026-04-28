/**
 * Image Scraper Route
 * POST /api/image-scraper/fetch
 * Body: { url: string }
 * Response: { success: boolean, images: [{src, width?, height?, alt}] }
 *
 * Browser-side can't iframe third-party sites due to X-Frame-Options / CORS.
 * Backend fetches HTML and extracts all <img>, <source srcset>, and og:image meta tags.
 */

const express = require("express");
const router = express.Router();
const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("../utils/logger");

const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT = 10000; // 10s
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function isValidHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// SSRF guard — reject localhost, loopback, and RFC1918 ranges so the proxy
// can't be used to probe internal networks.
function isPrivateHost(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0") return true;
  if (h.endsWith(".localhost")) return true;
  // IPv4 checks
  const parts = h.split(".").map((x) => parseInt(x, 10));
  if (parts.length === 4 && parts.every((p) => !Number.isNaN(p))) {
    const [a, b] = parts;
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  // IPv6 loopback / private
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

function resolveUrl(src, base) {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

// Parse srcset attribute → return best-resolution candidate
function pickBestFromSrcset(srcset) {
  if (!srcset || typeof srcset !== "string") return null;
  const candidates = srcset
    .split(",")
    .map((s) => s.trim())
    .map((piece) => {
      const parts = piece.split(/\s+/);
      const url = parts[0];
      const descriptor = parts[1] || "";
      const m = descriptor.match(/(\d+)(w|x)/);
      const weight = m ? parseInt(m[1], 10) : 1;
      return { url, weight };
    })
    .filter((c) => c.url);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0].url;
}

router.post("/fetch", async (req, res) => {
  const { url } = req.body || {};

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({
      success: false,
      error: "Invalid URL. Must be http(s)://...",
    });
  }

  try {
    logger.log(`[IMAGE_SCRAPER] Fetching: ${url}`);

    const response = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,tr;q=0.8",
      },
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_HTML_SIZE,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const html = response.data;
    if (typeof html !== "string" || html.length === 0) {
      return res.status(502).json({
        success: false,
        error: "Empty HTML response",
      });
    }

    const $ = cheerio.load(html);
    const base = response.request?.res?.responseUrl || url;
    const found = new Map(); // src → {src, width, height, alt}

    // <img> tags
    $("img").each((_, el) => {
      const $el = $(el);
      let src =
        $el.attr("src") ||
        $el.attr("data-src") ||
        $el.attr("data-lazy-src") ||
        $el.attr("data-original");

      // If srcset present, prefer largest variant
      const srcset = $el.attr("srcset") || $el.attr("data-srcset");
      if (srcset) {
        const best = pickBestFromSrcset(srcset);
        if (best) src = best;
      }

      if (!src) return;
      const abs = resolveUrl(src, base);
      if (!abs || abs.startsWith("data:")) return;

      const width = parseInt($el.attr("width"), 10) || undefined;
      const height = parseInt($el.attr("height"), 10) || undefined;
      const alt = $el.attr("alt") || "";

      if (!found.has(abs)) {
        found.set(abs, { src: abs, width, height, alt });
      }
    });

    // <source> inside <picture>
    $("picture source").each((_, el) => {
      const srcset = $(el).attr("srcset");
      const best = pickBestFromSrcset(srcset);
      if (!best) return;
      const abs = resolveUrl(best, base);
      if (!abs || abs.startsWith("data:")) return;
      if (!found.has(abs)) {
        found.set(abs, { src: abs, alt: "" });
      }
    });

    // <meta property="og:image">
    $('meta[property="og:image"], meta[name="og:image"], meta[property="twitter:image"]').each(
      (_, el) => {
        const content = $(el).attr("content");
        if (!content) return;
        const abs = resolveUrl(content, base);
        if (!abs || abs.startsWith("data:")) return;
        if (!found.has(abs)) {
          found.set(abs, { src: abs, alt: "og:image" });
        }
      }
    );

    const images = Array.from(found.values()).filter((img) => {
      // Drop obvious tiny icons/trackers
      if (img.width && img.width < 64) return false;
      if (img.height && img.height < 64) return false;
      // Drop data URIs and SVG tracking pixels
      const lower = img.src.toLowerCase();
      if (lower.includes("pixel") || lower.includes("tracker")) return false;
      return true;
    });

    logger.log(`[IMAGE_SCRAPER] Found ${images.length} images on ${url}`);

    return res.json({
      success: true,
      url: base,
      images,
    });
  } catch (err) {
    const status = err.response?.status || err.code || "unknown";
    logger.warn(
      `[IMAGE_SCRAPER] Fetch failed for ${url}: ${err.message} (${status})`
    );
    return res.status(502).json({
      success: false,
      error: `Fetch failed: ${err.message}`,
    });
  }
});

/**
 * GET /api/image-scraper/proxy?url=...
 *
 * Fetches an external HTML page, strips X-Frame-Options / CSP, injects a
 * <base> tag and a click handler that posts image clicks back to the parent
 * window via `postMessage`. Served from our own origin so the embedding
 * iframe is same-origin with the parent (giving the parent DOM access, and
 * allowing the injected script to talk to the parent).
 *
 * Query: url (http/https, not localhost / RFC1918)
 *
 * Response: text/html (modified) with neutered framing headers.
 */
router.get("/proxy", async (req, res) => {
  const url = req.query?.url;

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).send("Invalid URL");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    return res.status(400).send("Private / internal URLs are not allowed");
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      timeout: FETCH_TIMEOUT,
      maxContentLength: MAX_HTML_SIZE,
      maxRedirects: 5,
      responseType: "text",
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const base = response.request?.res?.responseUrl || url;
    let html = response.data;
    if (typeof html !== "string") html = String(html || "");

    // Inject <base href> so relative URLs resolve to the target origin.
    const baseTag = `<base href="${base}">`;
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (m) => m + baseTag);
    } else {
      html = baseTag + html;
    }

    // Injected click handler — runs inside the iframe, forwards image and
    // link clicks to the parent via postMessage. Uses capture phase so the
    // host page can't swallow clicks before we see them.
    const inject = `
<style>
  img[data-diress-picked="1"] {
    outline: 3px solid #8B5CF6 !important;
    outline-offset: 2px !important;
    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.35) !important;
  }
  img:hover {
    cursor: pointer !important;
    outline: 2px dashed rgba(139, 92, 246, 0.6);
    outline-offset: 2px;
  }
</style>
<script>
(function () {
  if (window.__diressPickerInjected) return;
  window.__diressPickerInjected = true;

  function resolveSrc(img) {
    try { return img.currentSrc || img.src || img.getAttribute('data-src') || ''; }
    catch (_) { return img.src || ''; }
  }

  document.addEventListener('click', function (e) {
    // Link clicks: forward to parent so it can update the URL bar / history
    var a = e.target.closest && e.target.closest('a[href]');
    if (a) {
      var href = a.href;
      if (href && !/^javascript:/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();
        try { parent.postMessage({ type: 'DIRESS_NAV', href: href }, '*'); } catch (_) {}
        return;
      }
    }

    // Image clicks: select/deselect with halo feedback
    var img = e.target.closest && e.target.closest('img');
    if (img) {
      var src = resolveSrc(img);
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      var picked = img.getAttribute('data-diress-picked') === '1';
      if (picked) {
        img.removeAttribute('data-diress-picked');
        try { parent.postMessage({ type: 'DIRESS_IMG_DESELECT', src: src }, '*'); } catch (_) {}
      } else {
        img.setAttribute('data-diress-picked', '1');
        try { parent.postMessage({ type: 'DIRESS_IMG_SELECT', src: src }, '*'); } catch (_) {}
      }
    }
  }, true);

  // On initial load notify parent that the page is ready
  function ready() {
    try { parent.postMessage({ type: 'DIRESS_READY', href: location.href }, '*'); } catch (_) {}
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(ready, 0);
  } else {
    document.addEventListener('DOMContentLoaded', ready);
  }
})();
</script>`;

    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, inject + "</body>");
    } else {
      html = html + inject;
    }

    // Strip any framing / CSP headers and serve from our origin
    res.removeHeader?.("x-frame-options");
    res.removeHeader?.("X-Frame-Options");
    res.removeHeader?.("content-security-policy");
    res.removeHeader?.("Content-Security-Policy");
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Do NOT set X-Frame-Options — we want this iframe-able
    });
    return res.send(html);
  } catch (err) {
    logger.warn(
      `[IMAGE_SCRAPER_PROXY] Failed to proxy ${url}: ${err.message || err}`
    );
    return res
      .status(502)
      .send("<html><body style='font-family:sans-serif;padding:24px;color:#6B7280'>Failed to load this page in the embedded browser.</body></html>");
  }
});

/**
 * GET /api/image-scraper/proxy-image?url=...
 *
 * Binary image proxy — used by the frontend when downloading the user's
 * selected images for import. Some CDNs block CORS on direct fetch; we
 * fetch on the server (no CORS) and stream the bytes back with permissive
 * headers.
 */
router.get("/proxy-image", async (req, res) => {
  const url = req.query?.url;

  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).send("Invalid URL");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).send("Invalid URL");
  }

  if (isPrivateHost(parsedUrl.hostname)) {
    return res.status(400).send("Private / internal URLs are not allowed");
  }

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/*,*/*;q=0.8",
      },
      timeout: FETCH_TIMEOUT,
      maxContentLength: 15 * 1024 * 1024, // 15 MB image cap
      maxRedirects: 5,
      responseType: "stream",
      validateStatus: (s) => s >= 200 && s < 400,
    });

    const contentType =
      response.headers?.["content-type"] || "application/octet-stream";
    res.set({
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    });
    response.data.pipe(res);
  } catch (err) {
    logger.warn(
      `[IMAGE_PROXY] Failed ${url}: ${err.message || err}`
    );
    res.status(502).send("Image fetch failed");
  }
});

module.exports = router;
