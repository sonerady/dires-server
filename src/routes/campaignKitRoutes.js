const express = require("express");
const router = express.Router();
const axios = require("axios");

/**
 * Call Replicate Gemini 3.1 Pro API with image URLs and prompt
 */
async function callReplicateGeminiPro(prompt, imageUrls = [], maxRetries = 3) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN environment variable is not set");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🤖 [CAMPAIGN-GEMINI-PRO] API call attempt ${attempt}/${maxRetries}`);

      const requestBody = {
        input: {
          prompt: prompt,
          images: imageUrls,
          temperature: 0.7,
          max_output_tokens: 16384,
        }
      };

      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3.1-pro/predictions",
        requestBody,
        {
          headers: {
            "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            "Prefer": "wait"
          },
          timeout: 180000
        }
      );

      const data = response.data;

      if (data.error) {
        console.error(`❌ [CAMPAIGN-GEMINI-PRO] API error:`, data.error);
        throw new Error(data.error);
      }

      if (data.status !== "succeeded") {
        console.error(`❌ [CAMPAIGN-GEMINI-PRO] Prediction failed with status:`, data.status);
        throw new Error(`Prediction failed with status: ${data.status}`);
      }

      let outputText = "";
      if (Array.isArray(data.output)) {
        outputText = data.output.join("");
      } else if (typeof data.output === "string") {
        outputText = data.output;
      }

      if (!outputText || outputText.trim() === "") {
        throw new Error("Replicate Gemini 3.1 Pro response is empty");
      }

      console.log(`✅ [CAMPAIGN-GEMINI-PRO] Success (attempt ${attempt})`);
      return outputText.trim();

    } catch (error) {
      console.error(`❌ [CAMPAIGN-GEMINI-PRO] Attempt ${attempt} failed:`, error.message);

      if (attempt === maxRetries) {
        throw error;
      }

      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * POST /api/campaign-kit/generate-html
 * Receives an image URL, sends it to Gemini 3.1 Pro via Replicate for analysis,
 * and returns a complete campaign banner HTML.
 */
router.post("/generate-html", async (req, res) => {
  try {
    const { imageUrl, userPrompt } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ success: false, error: "imageUrl is required" });
    }

    console.log("🎨 [CAMPAIGN_KIT] Generating campaign HTML for image:", imageUrl);
    console.log("📝 [CAMPAIGN_KIT] User prompt:", userPrompt || "(none - using defaults)");

    const userBrief = userPrompt
      ? `\n\nUSER'S CAMPAIGN BRIEF:\n"${userPrompt}"\n\nYou MUST incorporate the user's requests into the design.`
      : "";

    const prompt = `You are a world-class campaign poster designer. Analyze this product image carefully and design a beautiful mobile campaign poster (390×844px canvas).

The product photo fills the entire background. You will place text and badge overlay elements on top. Study the image — find where the empty spaces are, where the product is, and make your own creative decisions about layout.
${userBrief}

RESPOND WITH ONLY A RAW JSON OBJECT. No markdown, no code blocks, no explanation.

{
  "accentColor": "#hex color that suits the image",
  "overlayGradient": "CSS linear-gradient — MUST strongly darken the area where you place text elements. Use at least rgba(0,0,0,0.6) opacity where text sits. Example: linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 60%, rgba(0,0,0,0.85) 100%)",
  "elements": [
    {
      "text": "string",
      "x": number (0-390),
      "y": number (0-844),
      "fontSize": number,
      "fontWeight": "string",
      "fontFamily": "serif | sans-serif | condensed",
      "color": "string",
      "bgColor": "string or null",
      "padding": "CSS padding or null",
      "borderRadius": "CSS border-radius or null",
      "textTransform": "uppercase | lowercase | none",
      "letterSpacing": "CSS value or null",
      "lineHeight": "CSS value or null",
      "maxWidth": "number as string or null",
      "textShadow": "CSS value or null",
      "opacity": "string or null",
      "backdropBlur": "CSS blur value or null",
      "border": "CSS border or null",
      "boxShadow": "CSS box-shadow or null"
    }
  ]
}

QUALITY RULES (MANDATORY — FOLLOW STRICTLY):
- ALIGNMENT: ALL text elements in a group MUST share the exact same x value. For example, if headline is at x=30, then subtitle, body text, and CTA button MUST also be at x=30. Never scatter elements at different random x positions — this is the #1 cause of messy layouts.
- NO OVERLAP: Elements must NEVER overlap each other. Calculate carefully: next element y = previous element y + previous fontSize + gap (minimum 16px). If an element has padding, add the full padding to height calculation. Double-check your y values before responding.
- TYPOGRAPHIC HIERARCHY: Maximum 3-4 elements total. Keep it simple and clean. Use clear size contrast: headline 36-52px, subtitle 16-20px, body/CTA 12-15px. Don't create too many elements — fewer elements = cleaner design.
- CLEAN SPACING: Use consistent vertical gaps between elements — pick ONE gap size (16px or 20px) and use it everywhere in the group. Never use random or tight spacing.
- READABILITY (CRITICAL):
  * Every text MUST be clearly readable against the background.
  * Use overlayGradient to strongly darken the area where text is placed.
  * Text color must be high contrast — prefer pure white (#ffffff) or very light colors on dark gradients.
  * If using colored text, ensure it has strong textShadow (e.g., "0 2px 12px rgba(0,0,0,0.8)") for readability.
  * Never use semi-transparent or low-opacity text colors like rgba(255,255,255,0.5) — they become invisible.
  * Minimum fontSize is 13px — anything smaller is unreadable on mobile.
- SAFE ZONES: Avoid y=0-60 (status bar) and y=780-844 (bottom bar). Place all elements between y=80 and y=760.
- Every element needs at minimum: text, x, y, fontSize, fontWeight, color
- Keep total element count between 2-5. More than 5 elements almost always looks cluttered.

LANGUAGE & TEXT RULES:
- CRITICAL: Detect the language the user wrote their brief in. You MUST write ALL text elements in that SAME language. If the user writes in Turkish, all banner texts must be in Turkish. If in French, write in French. If in English, write in English. Match the user's language exactly.
- Do NOT copy the user's text word-for-word. Take their ideas and intentions, then rewrite them as polished, professional banner copy — short, punchy, and magazine-quality. Think like a creative director: transform casual input into compelling marketing language while preserving the core message.
- If no user brief is provided, default to English.

CREATIVE FREEDOM:
- You decide WHERE on the canvas to place elements — analyze the image and pick the best spot
- You decide WHAT elements to include — headlines, badges, prices, CTAs, tags — whatever fits the brief
- You decide the STYLE — colors, fonts, gradient direction, element shapes
- You decide the OVERLAY — gradient angle, opacity, color — whatever makes text readable on this specific image
- Every poster should feel unique, polished, and magazine-quality`;

    const responseText = await callReplicateGeminiPro(prompt, [imageUrl]);
    console.log("🤖 [CAMPAIGN_KIT] Gemini 3.1 Pro response:", responseText.substring(0, 200) + "...");

    let campaignData;
    try {
      let cleanJson = responseText;
      if (cleanJson.startsWith("```")) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
      }
      campaignData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error("❌ [CAMPAIGN_KIT] Failed to parse Gemini 3.1 Pro response:", parseError.message);
      campaignData = {
        accentColor: "#d88d4d",
        overlayGradient: "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, rgba(0,0,0,0.7) 100%)",
        elements: [
          { text: "THE NEW EDIT", x: 20, y: 520, fontSize: 48, fontWeight: "800", fontFamily: "serif", color: "#ffffff", textTransform: "uppercase", letterSpacing: "-0.04em", lineHeight: "0.92", textShadow: "0 4px 20px rgba(0,0,0,0.3)" },
          { text: "Refined silhouettes for the modern eye.", x: 20, y: 600, fontSize: 14, fontWeight: "400", fontFamily: "sans-serif", color: "rgba(255,255,255,0.85)", maxWidth: "300" },
          { text: "Explore Now", x: 20, y: 650, fontSize: 13, fontWeight: "700", fontFamily: "sans-serif", color: "#ffffff", bgColor: "#d88d4d", padding: "12px 24px", borderRadius: "999px" },
        ],
      };
    }

    const html = generateCampaignHTML(imageUrl, campaignData);

    res.json({ success: true, html });
  } catch (error) {
    console.error("❌ [CAMPAIGN_KIT] Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});


/**
 * Generate campaign banner HTML from dynamic elements array
 */
function generateCampaignHTML(imageUrl, data) {
  const accent = data.accentColor || "#d88d4d";
  const overlayGradient = data.overlayGradient || "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 40%, rgba(0,0,0,0.7) 100%)";

  // Font mapping
  const fontMap = {
    "serif": 'Georgia, "Times New Roman", serif',
    "sans-serif": 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
    "condensed": '"Impact", "Arial Narrow", sans-serif',
  };

  // Build elements HTML dynamically from Gemini's array
  const elements = Array.isArray(data.elements) ? data.elements : [];
  const elementsHtml = elements.map((el, i) => {
    const styles = [];
    styles.push(`left:${el.x || 20}px`);
    styles.push(`top:${el.y || 100}px`);
    styles.push(`font-size:${el.fontSize || 14}px`);
    styles.push(`font-weight:${el.fontWeight || "400"}`);
    styles.push(`color:${el.color || "#fff"}`);
    styles.push(`font-family:${fontMap[el.fontFamily] || fontMap["sans-serif"]}`);
    if (el.bgColor) styles.push(`background:${el.bgColor}`);
    if (el.padding) styles.push(`padding:${el.padding}`);
    if (el.borderRadius) styles.push(`border-radius:${el.borderRadius}`);
    if (el.textTransform && el.textTransform !== "none") styles.push(`text-transform:${el.textTransform}`);
    if (el.letterSpacing) styles.push(`letter-spacing:${el.letterSpacing}`);
    if (el.lineHeight) styles.push(`line-height:${el.lineHeight}`);
    if (el.maxWidth) styles.push(`max-width:${el.maxWidth}px`);
    if (el.textShadow) styles.push(`text-shadow:${el.textShadow}`);
    if (el.opacity && el.opacity !== "1") styles.push(`opacity:${el.opacity}`);
    if (el.border) styles.push(`border:${el.border}`);
    if (el.boxShadow) styles.push(`box-shadow:${el.boxShadow}`);
    if (el.backdropBlur) {
      styles.push(`backdrop-filter:blur(${el.backdropBlur})`);
      styles.push(`-webkit-backdrop-filter:blur(${el.backdropBlur})`);
    }

    return `<div class="draggable" data-drag="true" id="el${i}" style="${styles.join(";")}">${escapeHtml(el.text || "")}</div>`;
  }).join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Campaign Kit</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%; overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
      -webkit-font-smoothing: antialiased;
      background: #000;
    }
    .fullscreen { position: fixed; inset: 0; width: 100%; height: 100%; }
    .bg-image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: center; }
    .overlay { position: absolute; inset: 0; background: ${overlayGradient}; pointer-events: none; }
    .canvas { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
    .draggable {
      position: absolute; pointer-events: auto; touch-action: none;
      user-select: none; -webkit-user-select: none; cursor: grab;
    }
    .draggable.dragging {
      cursor: grabbing;
      box-shadow: 0 0 0 2px ${hexToRgba(accent, 0.6)}, 0 8px 24px rgba(0,0,0,0.3);
      z-index: 50;
    }
    .guide-line { position: fixed; z-index: 40; pointer-events: none; opacity: 0; transition: opacity 80ms ease; }
    .guide-line.visible { opacity: 1; }
    .guide-line.h { left: 0; right: 0; height: 1px; background: ${hexToRgba(accent, 0.7)}; }
    .guide-line.v { top: 0; bottom: 0; width: 1px; background: ${hexToRgba(accent, 0.7)}; }

    .top-actions {
      position: fixed; top: 54px; right: 16px; z-index: 100;
      display: flex; flex-direction: column; gap: 10px;
    }
    .action-btn {
      width: 40px; height: 40px; border-radius: 20px;
      background: rgba(0,0,0,0.45); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255,255,255,0.15);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
    }
    .menu-btn {
      flex-direction: column; gap: 4px;
    }
    .menu-btn span { display: block; width: 18px; height: 2px; background: #fff; border-radius: 2px; transition: 200ms ease; }
    .menu-btn.open span:nth-child(1) { transform: rotate(45deg) translate(3px, 3px); }
    .menu-btn.open span:nth-child(2) { opacity: 0; }
    .menu-btn.open span:nth-child(3) { transform: rotate(-45deg) translate(3px, -3px); }

    .sidebar-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 90; opacity: 0; pointer-events: none; transition: opacity 250ms ease; }
    .sidebar-backdrop.open { opacity: 1; pointer-events: auto; }
    .sidebar {
      position: fixed; top: 0; right: 0; bottom: 0; width: 280px; max-width: 80vw; z-index: 95;
      background: rgba(18,18,20,0.92); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      border-left: 1px solid rgba(255,255,255,0.1);
      transform: translateX(100%); transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
      overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 70px 20px 40px;
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar .section-title { font-size: 11px; color: rgba(255,255,255,0.45); text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 12px; }
    .sidebar .field { margin-bottom: 16px; }
    .sidebar label { display: block; font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
    .sidebar textarea, .sidebar input {
      width: 100%; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06);
      color: #fff; border-radius: 12px; padding: 10px 12px; font-size: 13px; outline: none; font-family: inherit;
    }
    .sidebar textarea:focus, .sidebar input:focus { border-color: ${hexToRgba(accent, 0.5)}; box-shadow: 0 0 0 3px ${hexToRgba(accent, 0.1)}; }
    .apply-btn {
      width: 100%; border: 0; border-radius: 14px; padding: 12px; font-size: 13px; font-weight: 700;
      color: #fff; cursor: pointer; margin-top: 8px; font-family: inherit;
    }
    .divider { height: 1px; background: rgba(255,255,255,0.08); margin: 16px 0; }
  </style>
</head>
<body>
  <div class="fullscreen">
    <img class="bg-image" src="${escapeHtml(imageUrl)}" alt="" />
    <div class="overlay"></div>

    <div class="canvas">
      ${elementsHtml}
    </div>

    <div class="guide-line h" id="guideH1"></div>
    <div class="guide-line h" id="guideH2"></div>
    <div class="guide-line v" id="guideV1"></div>
    <div class="guide-line v" id="guideV2"></div>
  </div>

  <div class="top-actions">
    <div class="action-btn menu-btn" id="menuBtn" onclick="toggleSidebar()">
      <span></span><span></span><span></span>
    </div>
    <div class="action-btn" id="downloadBtn" onclick="downloadPoster()">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
  </div>

  <div class="sidebar-backdrop" id="sidebarBackdrop" onclick="toggleSidebar()"></div>

  <div class="sidebar" id="sidebar">
    <div class="section-title">Elements</div>
    <div id="elementsListSidebar"></div>
  </div>

  <script>
    var sidebarOpen = false;
    var currentImageUrl = '${escapeHtml(imageUrl)}';

    function toggleSidebar() {
      sidebarOpen = !sidebarOpen;
      document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
      document.getElementById('sidebarBackdrop').classList.toggle('open', sidebarOpen);
      document.getElementById('menuBtn').classList.toggle('open', sidebarOpen);
    }

    /* ─── Download Poster ─── */
    function downloadPoster() {
      var btn = document.getElementById('downloadBtn');
      btn.style.opacity = '0.5';
      btn.style.pointerEvents = 'none';

      // Hide UI elements
      var topActions = document.querySelector('.top-actions');
      var guides = document.querySelectorAll('.guide-line');
      var sidebar = document.getElementById('sidebar');
      var backdrop = document.getElementById('sidebarBackdrop');
      topActions.style.display = 'none';
      guides.forEach(function(g) { g.style.display = 'none'; });
      if (sidebarOpen) toggleSidebar();
      sidebar.style.display = 'none';
      backdrop.style.display = 'none';

      // Remove dragging styles temporarily
      var allDraggables = document.querySelectorAll('.draggable');
      allDraggables.forEach(function(el) { el.classList.remove('dragging'); });

      // Wait for bg image to get natural size, then capture
      var bgImg = document.querySelector('.bg-image');
      var imgW = bgImg.naturalWidth || 1080;
      var imgH = bgImg.naturalHeight || 1920;

      // Use canvas to capture at image resolution
      var fullscreen = document.querySelector('.fullscreen');
      var scaleX = imgW / window.innerWidth;
      var scaleY = imgH / window.innerHeight;
      var scale = Math.max(scaleX, scaleY);

      // Create offscreen canvas
      var canvas = document.createElement('canvas');
      canvas.width = imgW;
      canvas.height = imgH;
      var ctx = canvas.getContext('2d');

      // Draw background image
      ctx.drawImage(bgImg, 0, 0, imgW, imgH);

      // Draw overlay gradient
      var overlayEl = document.querySelector('.overlay');
      var overlayStyle = window.getComputedStyle(overlayEl);
      var bgImage = overlayStyle.backgroundImage;
      if (bgImage && bgImage !== 'none') {
        // Approximate with semi-transparent overlay
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        // Actually use a gradient canvas
        var gradCanvas = document.createElement('canvas');
        gradCanvas.width = imgW;
        gradCanvas.height = imgH;
        var gCtx = gradCanvas.getContext('2d');
        var grad = gCtx.createLinearGradient(0, 0, 0, imgH);
        grad.addColorStop(0, 'rgba(0,0,0,0.3)');
        grad.addColorStop(0.35, 'rgba(0,0,0,0.02)');
        grad.addColorStop(0.7, 'rgba(0,0,0,0.6)');
        grad.addColorStop(1, 'rgba(0,0,0,0.85)');
        gCtx.fillStyle = grad;
        gCtx.fillRect(0, 0, imgW, imgH);
        ctx.drawImage(gradCanvas, 0, 0);
      }

      // Draw each draggable element
      allDraggables.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        var sx = rect.left * scale;
        var sy = rect.top * scale;
        var sw = rect.width * scale;
        var sh = rect.height * scale;

        var cs = window.getComputedStyle(el);

        // Draw background if present
        if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') {
          var br = parseFloat(cs.borderRadius) * scale || 0;
          ctx.fillStyle = cs.backgroundColor;
          if (br > 0) {
            roundRect(ctx, sx, sy, sw, sh, br);
            ctx.fill();
          } else {
            ctx.fillRect(sx, sy, sw, sh);
          }
        }

        // Draw text
        var fontSize = parseFloat(cs.fontSize) * scale;
        var fontWeight = cs.fontWeight;
        var fontFamily = cs.fontFamily;
        ctx.font = fontWeight + ' ' + fontSize + 'px ' + fontFamily;
        ctx.fillStyle = cs.color;
        ctx.textBaseline = 'top';

        var textX = sx + (parseFloat(cs.paddingLeft) || 0) * scale;
        var textY = sy + (parseFloat(cs.paddingTop) || 0) * scale;
        var maxW = sw - ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) * scale;

        // Shadow
        if (cs.textShadow && cs.textShadow !== 'none') {
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 12 * scale;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 2 * scale;
        }

        wrapText(ctx, el.textContent, textX, textY, maxW, fontSize * 1.2);

        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      });

      // Convert to data URL and send to React Native
      var dataUrl = canvas.toDataURL('image/png', 1.0);

      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'downloadPoster',
          dataUrl: dataUrl,
          width: imgW,
          height: imgH
        }));
      }

      // Restore UI
      topActions.style.display = '';
      guides.forEach(function(g) { g.style.display = ''; });
      sidebar.style.display = '';
      backdrop.style.display = '';
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
      var words = text.split(' ');
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var testLine = line + words[i] + ' ';
        var metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
          ctx.fillText(line.trim(), x, y);
          line = words[i] + ' ';
          y += lineHeight;
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line.trim(), x, y);
    }

    /* ─── Drag & Alignment Guides ─── */
    var SNAP_THRESHOLD = 6;
    var guideLines = { h1: document.getElementById('guideH1'), h2: document.getElementById('guideH2'), v1: document.getElementById('guideV1'), v2: document.getElementById('guideV2') };
    var draggables = document.querySelectorAll('.draggable');

    // Build editable elements list in sidebar
    (function buildElementsList() {
      var container = document.getElementById('elementsListSidebar');
      if (!container) return;
      draggables.forEach(function(el, i) {
        var field = document.createElement('div');
        field.className = 'field';
        field.innerHTML = '<label>Element ' + (i+1) + '</label><input type="text" value="' + el.textContent.replace(/"/g, '&quot;') + '" data-el-id="' + el.id + '" onchange="updateElText(this)" />';
        container.appendChild(field);
      });
    })();

    function updateElText(input) {
      var target = document.getElementById(input.dataset.elId);
      if (target) target.textContent = input.value;
    }

    // Freeze size and normalize to top/left on load
    window.addEventListener('load', function() {
      draggables.forEach(function(el) {
        var rect = el.getBoundingClientRect();
        el.style.width = rect.width + 'px';
        el.style.height = rect.height + 'px';
        el.style.top = rect.top + 'px';
        el.style.left = rect.left + 'px';
        el.style.bottom = 'auto';
        el.style.right = 'auto';
        el.style.transform = 'none';
      });
    });

    var activeDrag = null, dragOffsetX = 0, dragOffsetY = 0;

    function getCenter(el) {
      var r = el.getBoundingClientRect();
      return { cx: r.left + r.width/2, cy: r.top + r.height/2, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    }
    function hideGuides() {
      Object.keys(guideLines).forEach(function(k) { guideLines[k].classList.remove('visible'); });
    }
    function checkSnap(el) {
      var me = getCenter(el), W = window.innerWidth, H = window.innerHeight;
      var centerX = W/2, centerY = H/2, guides = [], snapX = null, snapY = null;
      if (Math.abs(me.cx - centerX) < SNAP_THRESHOLD) { guides.push({type:'v',pos:centerX}); snapX = centerX - me.w/2; }
      if (Math.abs(me.cy - centerY) < SNAP_THRESHOLD) { guides.push({type:'h',pos:centerY}); snapY = centerY - me.h/2; }
      draggables.forEach(function(other) {
        if (other === el) return;
        var o = getCenter(other);
        if (Math.abs(me.cy - o.cy) < SNAP_THRESHOLD) { guides.push({type:'h',pos:o.cy}); snapY = o.cy - me.h/2; }
        if (Math.abs(me.cx - o.cx) < SNAP_THRESHOLD) { guides.push({type:'v',pos:o.cx}); snapX = o.cx - me.w/2; }
        if (Math.abs(me.l - o.l) < SNAP_THRESHOLD) { guides.push({type:'v',pos:o.l}); snapX = o.l; }
        if (Math.abs(me.r - o.r) < SNAP_THRESHOLD) { guides.push({type:'v',pos:o.r}); snapX = o.r - me.w; }
        if (Math.abs(me.t - o.t) < SNAP_THRESHOLD) { guides.push({type:'h',pos:o.t}); snapY = o.t; }
        if (Math.abs(me.b - o.b) < SNAP_THRESHOLD) { guides.push({type:'h',pos:o.b}); snapY = o.b - me.h; }
      });
      hideGuides();
      var hIdx=0, vIdx=0, hKeys=['h1','h2'], vKeys=['v1','v2'];
      guides.forEach(function(g) {
        if (g.type==='h' && hIdx<2) { var gl=guideLines[hKeys[hIdx++]]; gl.style.top=g.pos+'px'; gl.classList.add('visible'); }
        else if (g.type==='v' && vIdx<2) { var gl=guideLines[vKeys[vIdx++]]; gl.style.left=g.pos+'px'; gl.classList.add('visible'); }
      });
      if (snapX !== null) el.style.left = snapX + 'px';
      if (snapY !== null) el.style.top = snapY + 'px';
    }

    draggables.forEach(function(el) {
      el.addEventListener('touchstart', function(e) {
        if (sidebarOpen) return; e.preventDefault(); e.stopPropagation();
        var touch = e.touches[0], rect = el.getBoundingClientRect();
        dragOffsetX = touch.clientX - rect.left; dragOffsetY = touch.clientY - rect.top;
        activeDrag = el; el.classList.add('dragging');
      }, { passive: false });
      el.addEventListener('touchmove', function(e) {
        if (activeDrag !== el) return; e.preventDefault(); e.stopPropagation();
        var touch = e.touches[0];
        el.style.left = (touch.clientX - dragOffsetX) + 'px';
        el.style.top = (touch.clientY - dragOffsetY) + 'px';
        checkSnap(el);
      }, { passive: false });
      el.addEventListener('touchend', function() {
        if (activeDrag !== el) return;
        el.classList.remove('dragging'); activeDrag = null; setTimeout(hideGuides, 300);
      });
      el.addEventListener('mousedown', function(e) {
        if (sidebarOpen) return; e.preventDefault();
        var rect = el.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left; dragOffsetY = e.clientY - rect.top;
        activeDrag = el; el.classList.add('dragging');
      });
    });
    document.addEventListener('mousemove', function(e) {
      if (!activeDrag) return;
      activeDrag.style.left = (e.clientX - dragOffsetX) + 'px';
      activeDrag.style.top = (e.clientY - dragOffsetY) + 'px';
      checkSnap(activeDrag);
    });
    document.addEventListener('mouseup', function() {
      if (!activeDrag) return;
      activeDrag.classList.remove('dragging'); activeDrag = null; setTimeout(hideGuides, 300);
    });
  </script>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Convert hex color to rgba string
 */
function hexToRgba(hex, alpha) {
  if (!hex) hex = "#d88d4d";
  hex = hex.replace("#", "");
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

module.exports = router;
