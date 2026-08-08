const express = require("express");
const axios = require("axios");
const fs = require("fs");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { renderBannerVideo } = require("../utils/bannerVideoRenderer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Banner üretimi LLM ile tek çağrı (görsel üretimi yok) — düşük maliyet
const BANNER_CREDIT_COST = 10;
const OPENROUTER_BANNER_MODEL =
  process.env.OPENROUTER_BANNER_MODEL || "anthropic/claude-fable-5";

// Modal'daki popüler oranlar + "original" (fotoğrafın kendi oranı, arn client'tan gelir)
const SUPPORTED_RATIOS = {
  "1:1": 1,
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
  "16:9": 16 / 9,
  "3:2": 3 / 2,
  "2:3": 2 / 3,
  "4:3": 4 / 3,
  "5:4": 5 / 4,
  "21:9": 21 / 9,
  "9:21": 9 / 21,
};

const BANNER_SYSTEM_PROMPT = `You are a senior e-commerce fashion art director and front-end craftsman. You produce ONE self-contained HTML document that is a finished, retail-quality promotional banner for the product photo you are shown.

## Output contract (strict — the only fixed rules)
- Return ONLY the raw HTML document. No markdown fences, no commentary before or after.
- Single file: all CSS inline in one <style> block. No JavaScript. No external stylesheets, fonts, or scripts.
- Animation: obey the request's Animation setting exactly. STATIC = zero CSS animations/transitions, a completely still frame. ANIMATED = the motion is a DESIGNED, CLEARLY VISIBLE feature of the banner, not a barely-perceptible drift: a viewer must notice within the first second that this banner is alive. Choreograph it — give the composition one bold hero movement plus supporting accents on the elements that matter commercially (the offer, the call to action), each with its own rhythm. Invent the effects yourself from this banner's concept; different projects must move differently, never one stock treatment. Pure CSS keyframes only; motion never harms legibility, and the frame must still look complete when frozen at any moment, because a JPG may be captured from it. The whole choreography must LOOP SEAMLESSLY with one master period between 3 and 8 seconds (every animation's duration divides the master period, and the final frame flows back into the first with no jump — the banner is also exported as a looping video). Declare the master period in <head> as <meta name="loop-duration" content="<seconds>">.
- Include <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"> in <head> — the banner renders inside a mobile WebView.
- The ONLY external resource allowed is the product image URL provided in the request, in an <img> tag.
- The banner must fill the viewport exactly: html,body { margin:0; width:100vw; height:100vh; overflow:hidden; } and the banner root uses position:fixed; inset:0. The host app sizes the viewport to the requested aspect ratio and captures a JPG — nothing may scroll or overflow.
- System font stacks only (serif, sans, mono — any families you choose, with safe fallbacks).
- Size type and spacing in vh/vw units so the composition scales with the frame.
- Respect the frame: on story ratios (ar < 0.66) keep the top and bottom ~12% free of critical text (platform UI safe zones). The garment itself must never be hidden or heavily washed out — the product is the hero.
- If prices are provided, both must be clearly readable (old price visibly struck or de-emphasized, new price dominant). Use the merchant's texts (prices, code, CTA, brand) verbatim.
- Write copy in the requested language, in the register the tone option asks for — specific, no clichés, no lorem.

## Art direction — design fresh every time
You are not filling a template. There is no house style. Each garment deserves its own visual identity, discovered from the photo:

- READ THE PHOTO like an art director: the garment's fabric, silhouette, color story, mood, the setting's light. A silk evening gown, a streetwear hoodie, a linen summer set and a kids' raincoat should produce four banners that look like they came from four different studios.
- Derive the palette from what you actually see — and decide yourself how to use it. The same palette can be deployed in radically different ways; that decision is part of the design.
- Choose typography by asking what this garment's character sounds like, then find the type treatment that speaks in that voice. Vary weight, case, and scale relationships between projects — don't fall into one signature headline formula.
- Invent the composition for THIS frame and THIS photo — anything that fits the aspect ratio and keeps the garment fully visible. Let the aspect ratio inform the layout, not dictate a fixed recipe.
- Graphic devices are a vocabulary, not a checklist. Pick the one or two that serve this campaign's energy; skip the rest. A quiet luxury banner may need almost nothing; a flash-sale banner may shout.
- OVERUSED DEFAULTS — do NOT reach for these unless the concept genuinely demands them: a thin keyline/hairline border framing the whole banner; a matted or boxed "framed photo" treatment; corner rule lines; an outlined rectangle around the copy block. If your draft's main visual device is a frame or border, that is a signal you have defaulted to a habit — discard the draft and find the idea inside this garment instead.
- Craft standard for blends: when a photo edge meets a color panel or an overlay sits on the photo, ease the transition smoothly (many-stop eased gradients, not an abrupt 2-3 stop fade), and keep overlays off the product.

## Legibility over the photo (non-negotiable)
Before placing ANY text, map the photo region by region: where is it bright, where dark, where busy with detail, where calm? Then, for EVERY text block, check the actual pixels that will sit BEHIND that specific block at its final position and size — not the photo's average:
- Text color must strongly contrast with its local background (aim for the equivalent of WCAG AA ~4.5:1 for body-size text, more for thin/small type). Light text on dark regions, dark ink on light regions — never mid-tone on mid-tone, never accent-colored text over a photo area of a similar hue (e.g. pink text on a pink dress, white text on a bright wall, dark plum on a shadowed corner).
- Prefer placing copy over the photo's calm, uniform regions (empty wall, sky, floor, negative space) — never across the garment or the model's face.
- If the only available region is busy or mid-tone, don't fight it: put the text on a solid or softly-blurred panel, a scrim, or a smoothly-eased local gradient that guarantees the contrast, and blend that layer in without covering the product.
- Small functional text (prices, promo code, urgency line) needs the strictest check — it is the first thing to disappear on a bad background.
- After composing, re-verify each block mentally against the photo: "if I screenshot this exact frame, is every word instantly readable?" Fix any block that fails before returning the HTML.

Before writing code, silently decide: what is the one distinctive visual idea of THIS banner? If your plan would look interchangeable with a generic fashion-sale template, discard it and take the bolder direction.

Quality bar: this ships to a paying merchant's Instagram. Kerning, spacing rhythm, and contrast must look hand-finished, not generated.`;

function buildUserPrompt(options, ratio, language) {
  const knownTypes = {
    auto: "your choice — read the photo and the brief, pick the most fitting intent yourself",
    sale: "sale (price-led hard offer)",
    campaign: "campaign (thematic promotion)",
    new_season: "new season (collection launch)",
    brand: "brand (image/awareness, no price)",
  };
  const bannerType = options.bannerType || "auto";
  const ratioLine =
    ratio === "original"
      ? typeof options.ratioValue === "number" && options.ratioValue > 0
        ? `Aspect ratio: the product photo's own ratio (ar=${options.ratioValue.toFixed(4)}).`
        : `Aspect ratio: match the product photo's own aspect ratio.`
      : `Aspect ratio: ${ratio} (ar=${SUPPORTED_RATIOS[ratio].toFixed(4)}).`;
  const lines = [
    `Create the banner for the attached product photo.`,
    ratioLine,
    `Copy language: ${language || "tr"}.`,
    `Banner intent: ${knownTypes[bannerType] || `"${bannerType}" (merchant's own description of the banner's purpose — interpret it)`}.`,
  ];
  if (options.tone && options.tone !== "auto") {
    lines.push(
      `Tone: ${options.tone} (elegant = quiet luxury, bold = loud promo energy, minimal = whitespace and restraint, playful = warm and fun).`
    );
  } else {
    lines.push(
      `Tone: your choice — pick the register that serves this garment and campaign best.`
    );
  }
  if (options.details) {
    lines.push(
      `Merchant's campaign brief (free text — extract whatever it contains: product name, brand, old/new prices, discount, promo code, CTA text, deadlines, perks. Use prices, codes and named CTAs verbatim; interpret the rest):\n"""\n${options.details}\n"""`
    );
  }
  lines.push(
    options.animated
      ? `Animation: ANIMATED — add tasteful pure-CSS keyframe motion per the contract.`
      : `Animation: STATIC — no CSS animations or transitions at all.`
  );
  lines.push(
    `Use this exact URL for the product image src: ${options.imageUrl}`
  );
  return lines.join("\n");
}

function extractHtml(raw) {
  if (!raw) return null;
  let text = raw.trim();
  // Olası markdown çitlerini soy
  const fenceMatch = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  // İlk < karakterinden önceki açıklama artıklarını at
  const firstTag = text.indexOf("<");
  if (firstTag > 0) text = text.slice(firstTag);
  if (!/<style[\s>]/i.test(text) || !/<img[\s>]/i.test(text)) return null;
  // WebView 980px sanal genişliğe düşmesin: viewport meta garantisi
  if (!/name=["']viewport["']/i.test(text)) {
    const meta =
      '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">';
    if (/<head[^>]*>/i.test(text)) {
      text = text.replace(/<head[^>]*>/i, (m) => m + meta);
    } else {
      text = meta + text;
    }
  }
  return text;
}

async function getUserCredit(userId) {
  if (!userId || userId === "anonymous_user") return null;
  const { data, error } = await supabase
    .from("users")
    .select("credit_balance")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data?.credit_balance ?? null;
}

async function deductUserCredit(userId, cost) {
  if (!userId || userId === "anonymous_user") return true;
  const { error } = await supabase.rpc("deduct_user_credit", {
    user_id: userId,
    credit_amount: cost,
  });
  return !error;
}

async function callBannerModel(options, ratio, language) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const messages = [
    { role: "system", content: BANNER_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: buildUserPrompt(options, ratio, language) },
        { type: "image_url", image_url: { url: options.imageUrl } },
      ],
    },
  ];

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: OPENROUTER_BANNER_MODEL,
          messages,
          temperature: 1,
          max_tokens: 32000,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://diress.ai",
            "X-OpenRouter-Title": "Diress Banner Studio",
          },
          timeout: 180000,
        }
      );

      const content = response.data?.choices?.[0]?.message?.content;
      const outputText = (
        Array.isArray(content)
          ? content
              .map((p) => (typeof p === "string" ? p : p?.text || ""))
              .join("")
          : content || ""
      ).trim();

      const html = extractHtml(outputText);
      if (html) return html;
      lastError = new Error("Model output did not contain valid banner HTML");
    } catch (err) {
      lastError = err;
      console.error(
        `🎨 [BANNER_STUDIO] OpenRouter attempt ${attempt} failed:`,
        err?.response?.status,
        err?.message
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError || new Error("Banner generation failed");
}

// POST /api/banner-studio/generate
router.post("/generate", async (req, res) => {
  try {
    const { userId, imageUrl, options = {} } = req.body || {};

    if (!imageUrl || typeof imageUrl !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "imageUrl is required" });
    }
    // Varsayılan: fotoğrafın kendi oranı; modal'dan gelen popüler oranlar da geçerli
    const ratio =
      options.ratio === "original" || SUPPORTED_RATIOS[options.ratio]
        ? options.ratio
        : "original";
    const language = options.language || "tr";
    const effectiveUserId = userId || "anonymous_user";

    // Kredi kontrolü (anonim kullanıcı kredi akışının dışında)
    if (effectiveUserId !== "anonymous_user") {
      const balance = await getUserCredit(effectiveUserId);
      if (balance !== null && balance < BANNER_CREDIT_COST) {
        return res.status(402).json({
          success: false,
          error: "INSUFFICIENT_CREDITS",
          required: BANNER_CREDIT_COST,
          currentCredit: balance,
        });
      }
    }

    const startedAt = Date.now();
    const html = await callBannerModel({ ...options, imageUrl }, ratio, language);

    // Sonucu kaydet
    const { data: record, error: insertError } = await supabase
      .from("banner_studio_results")
      .insert({
        user_id: effectiveUserId,
        image_url: imageUrl,
        banner_type: options.bannerType || "auto",
        ratio,
        options,
        html,
        credits_used:
          effectiveUserId === "anonymous_user" ? 0 : BANNER_CREDIT_COST,
        processing_time_seconds: Math.round((Date.now() - startedAt) / 1000),
      })
      .select("id, created_at")
      .single();

    if (insertError) {
      console.error("🎨 [BANNER_STUDIO] insert failed:", insertError);
    }

    // Proaktif video render: animasyonlu banner'ın MP4'ü arka planda hazırlanır,
    // kullanıcı "Video indir" dediğinde cache'ten anında döner. Yanıtı bloklamaz.
    if (options.animated && record?.id) {
      queueVideoRender({ id: record.id, html, ratio, options }).catch((err) => {
        console.error(
          "🎨 [BANNER_STUDIO] background video render failed:",
          err?.message
        );
      });
    }

    await deductUserCredit(effectiveUserId, BANNER_CREDIT_COST);
    const currentCredit = await getUserCredit(effectiveUserId);

    return res.json({
      success: true,
      result: {
        id: record?.id || null,
        html,
        ratio,
        bannerType: options.bannerType || "auto",
        imageUrl,
        options,
        createdAt: record?.created_at || new Date().toISOString(),
        currentCredit,
      },
    });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] generate error:", error?.message);
    return res.status(500).json({
      success: false,
      error: "BANNER_GENERATION_FAILED",
      message: error?.message,
    });
  }
});

function ratioToArn(ratio, options) {
  return ratio === "original"
    ? options?.ratioValue || 4 / 5
    : SUPPORTED_RATIOS[ratio] || 4 / 5;
}

// Aynı kayıt için eşzamanlı çift render'ı önleyen in-flight harita: id → Promise<videoUrl>
const videoRenderJobs = new Map();

async function renderAndStoreVideo(record) {
  const arn = ratioToArn(record.ratio, record.options);
  const { filePath, cleanup } = await renderBannerVideo(record.html, arn);
  try {
    const buffer = fs.readFileSync(filePath);
    const storagePath = `bannerStudio/videos/${record.id}.mp4`;
    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(storagePath, buffer, {
        contentType: "video/mp4",
        upsert: true,
        cacheControl: "31536000",
      });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage
      .from("images")
      .getPublicUrl(storagePath);
    if (!pub?.publicUrl) throw new Error("public url missing");

    // Render sürerken banner düzenlenmiş olabilir — bayat videoyu cache'leme
    const { data: fresh } = await supabase
      .from("banner_studio_results")
      .select("html")
      .eq("id", record.id)
      .single();
    if (fresh && fresh.html !== record.html) {
      return null;
    }

    await supabase
      .from("banner_studio_results")
      .update({ video_url: pub.publicUrl })
      .eq("id", record.id);
    return pub.publicUrl;
  } finally {
    cleanup();
  }
}

function queueVideoRender(record) {
  if (videoRenderJobs.has(record.id)) return videoRenderJobs.get(record.id);
  const job = renderAndStoreVideo(record).finally(() =>
    videoRenderJobs.delete(record.id)
  );
  videoRenderJobs.set(record.id, job);
  return job;
}

// POST /api/banner-studio/render-video — animasyonlu banner'ı loop MP4'e çevirir
router.post("/render-video", async (req, res) => {
  try {
    const { resultId, userId } = req.body || {};
    if (!resultId) {
      return res
        .status(400)
        .json({ success: false, error: "resultId is required" });
    }

    const { data: record, error } = await supabase
      .from("banner_studio_results")
      .select("id, user_id, html, ratio, options, video_url")
      .eq("id", resultId)
      .single();

    if (error || !record) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    if (userId && record.user_id !== userId) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    if (!record.options?.animated) {
      return res
        .status(400)
        .json({ success: false, error: "NOT_ANIMATED" });
    }
    // Daha önce render edildiyse tekrar üretme
    if (record.video_url) {
      return res.json({ success: true, videoUrl: record.video_url, cached: true });
    }

    // Arka planda render sürüyorsa ona katıl, yoksa başlat.
    // null dönerse render sırasında html değişmiş demektir — taze kayıtla bir kez daha dene.
    let videoUrl = await queueVideoRender(record);
    if (!videoUrl) {
      const { data: fresh } = await supabase
        .from("banner_studio_results")
        .select("id, html, ratio, options, video_url")
        .eq("id", resultId)
        .single();
      if (fresh?.video_url) {
        videoUrl = fresh.video_url;
      } else if (fresh) {
        videoUrl = await queueVideoRender(fresh);
      }
    }
    if (!videoUrl) throw new Error("video render did not produce a url");
    return res.json({ success: true, videoUrl });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] render-video error:", error?.message);
    return res.status(500).json({
      success: false,
      error: "VIDEO_RENDER_FAILED",
      message: error?.message,
    });
  }
});

// GET /api/banner-studio/results/:userId — liste (html hariç, hafif)
router.get("/results/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (page - 1) * limit;

    const { data, error } = await supabase
      .from("banner_studio_results")
      .select("id, image_url, banner_type, ratio, options, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const { count } = await supabase
      .from("banner_studio_results")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    return res.json({
      success: true,
      data: data || [],
      pagination: {
        page,
        limit,
        totalCount: count || 0,
        hasMore: offset + (data?.length || 0) < (count || 0),
      },
    });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] results error:", error?.message);
    return res.status(500).json({ success: false, error: "FETCH_FAILED" });
  }
});

// GET /api/banner-studio/result/:id?userId= — tek kayıt, html dahil
router.get("/result/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;

    const { data, error } = await supabase
      .from("banner_studio_results")
      .select("id, user_id, image_url, banner_type, ratio, options, html, created_at")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    if (userId && data.user_id !== userId) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] result error:", error?.message);
    return res.status(500).json({ success: false, error: "FETCH_FAILED" });
  }
});

// PUT /api/banner-studio/result/:id — düzenlenmiş HTML'i kaydet (sürükle/metin editörü)
router.put("/result/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, html } = req.body || {};
    if (!userId || !html || typeof html !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "userId and html are required" });
    }
    // Minimum sağlamlık: stil bloğu ve görsel hâlâ yerinde olmalı
    if (!/<style[\s>]/i.test(html) || !/<img[\s>]/i.test(html)) {
      return res.status(400).json({ success: false, error: "INVALID_HTML" });
    }

    const { data: record, error } = await supabase
      .from("banner_studio_results")
      .select("id, user_id, ratio, options")
      .eq("id", id)
      .single();
    if (error || !record) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    if (record.user_id !== userId) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }

    // Yeni HTML → eski video bayat; cache'i sıfırla
    const { error: updateError } = await supabase
      .from("banner_studio_results")
      .update({ html, video_url: null })
      .eq("id", id);
    if (updateError) throw updateError;

    // Animasyonluysa videoyu arka planda tazele (in-flight varsa dokunma —
    // bayat sonucu renderAndStoreVideo'daki html karşılaştırması eler)
    if (record.options?.animated && !videoRenderJobs.has(id)) {
      queueVideoRender({
        id,
        html,
        ratio: record.ratio,
        options: record.options,
      }).catch((err) => {
        console.error(
          "🎨 [BANNER_STUDIO] post-edit video render failed:",
          err?.message
        );
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] update error:", error?.message);
    return res.status(500).json({ success: false, error: "UPDATE_FAILED" });
  }
});

// DELETE /api/banner-studio/result/:id
router.delete("/result/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body || {};
    if (!userId) {
      return res.status(400).json({ success: false, error: "userId required" });
    }
    const { error } = await supabase
      .from("banner_studio_results")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] delete error:", error?.message);
    return res.status(500).json({ success: false, error: "DELETE_FAILED" });
  }
});

module.exports = router;
