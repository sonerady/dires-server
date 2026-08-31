const express = require("express");
const axios = require("axios");
const fs = require("fs");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const { fal } = require("@fal-ai/client");
const {
  renderBannerVideo,
  renderBannerScreenshot,
} = require("../utils/bannerVideoRenderer");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Banner üretimi LLM ile tek çağrı (görsel üretimi yok) — düşük maliyet.
// ⚠️ 25 Ağu 2026 (kullanıcı kararı): banner ÜCRETSİZ, kredi düşülmüyor —
// arkaplan silme (BackgroundRemove) ile aynı model. Ücretli hale dönmek için
// bu sabiti >0 yapmak yeterli: kontrol, düşüm ve kayıt hepsi buna bakıyor.
const BANNER_CREDIT_COST = 0;
/** HomeScreen > Banner Stüdyosu. ⚠️ 25 Ağu 2026 (kullanıcı kararı): çağrı
 *  OpenRouter'dan DOĞRUDAN Replicate'e alındı — OpenRouter bakiyesi bitince her
 *  üretim 402 ile düşüyordu. Aynı hesap/token projedeki diğer Replicate
 *  çağrılarıyla ortak (REPLICATE_API_TOKEN), model env ile değiştirilebilir. */
/** Kullanıcı kararı (25 Ağu 2026): default `google/gemini-3.5-flash`.
 *  ⚠️ Replicate'te `gemini-3.5-pro` YOK (404, iki kez doğrulandı — 3.5 yalnız
 *  flash); 3.1-pro kısaca denendi, kullanıcı flash'ta karar kıldı. Env ile
 *  deploy gerekmeden değiştirilebilir; doğrulanmış alternatifler:
 *  `google/gemini-3.1-pro`, `google/gemini-3-pro`, `google/gemini-3-flash`,
 *  `openai/gpt-5.6-sol`.
 *  ⚠️ Girdi alanları model ailesine göre değişiyor → buildReplicateInput(). */
const REPLICATE_BANNER_STUDIO_MODEL =
  process.env.REPLICATE_BANNER_STUDIO_MODEL || "google/gemini-3.5-flash";

/** Sağlayıcı env'den seçilir — model/sağlayıcı değiştirmek için deploy gerekmesin
 *  (promptEnhanceProvider.js'teki kalıp).
 *    "replicate" (varsayılan) → Replicate, REPLICATE_BANNER_STUDIO_MODEL
 *    "fal"                    → openrouter/router/vision (fal üzerinden
 *                                OpenRouter — HERHANGİ bir OpenRouter slug'ı)
 *  ⚠️ 26 Ağu 2026: fal şubesi any-llm'den `openrouter/router/vision`a taşındı —
 *  any-llm'in model listesi sınırlıydı (Gemini 3.x / Fable yok); router ucunda
 *  `model` SERBEST metin, `anthropic/claude-fable-5` canlı çağrıyla doğrulandı.
 *  Faturalama fal kredisinden (OpenRouter bakiyesi/402 derdi yok).
 *  ⚠️ Bu uçta `reasoning` bazı modeller için ZORUNLU (Fable öyle) — hep true. */
const BANNER_STUDIO_PROVIDER = (
  process.env.BANNER_STUDIO_PROVIDER || "fal"
).toLowerCase();
const FAL_OPENROUTER_VISION_ENDPOINT = "openrouter/router/vision";
// 26 Ağu 2026 (kullanıcı): HTML banner hattı fal/openrouter üzerinden
// Gemini 3.7 Flash'a gider. Fable pahalı kalıyordu, Replicate varsayılanı bırakıldı.
const FAL_BANNER_STUDIO_MODEL =
  process.env.FAL_BANNER_STUDIO_MODEL || "google/gemini-3.7-flash";
// Replicate'in `Prefer: wait` başlığı en fazla ~60 sn bekletir; banner HTML'i
// bundan uzun sürebiliyor, o yüzden bitmediyse prediction'ı yoklamaya geçiyoruz.
const REPLICATE_POLL_INTERVAL_MS = 2000;
const REPLICATE_POLL_TIMEOUT_MS = 180000;

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
- NEVER emit editing affordances: no contenteditable, no designMode, no spellcheck, no input/textarea/button elements. The banner is a finished artwork, not an editor.
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
      // ⚠️ Anahtar listesi istemcideki TONES ile sözleşme (BannerStudioScreen).
      // Yeni ton eklenirse tarifi de BURAYA yazılmalı, yoksa model anahtarı
      // yorumlamak zorunda kalıyor.
      `Tone: ${options.tone} (elegant = quiet restraint, bold = loud promo energy, minimal = whitespace and silence, playful = warm and fun, editorial = fashion-magazine art direction, vintage = retro print aesthetic of a chosen era, romantic = soft and tender, street = urban streetwear energy, modern = clean contemporary precision, festive = celebration and seasonal warmth, luxury = high-end opulence with generous space).`
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

/** ⚠️ Düzenleme artıklarını söker. İki kaynağı var:
 *  1) Model bazen kendiliğinden `contenteditable` üretiyor — banner açılır
 *     açılmaz metinler düzenlenebilir/imleçli geliyordu (kullanıcı şikâyeti,
 *     25 Ağu 2026).
 *  2) Viewer'daki editör moduna ait sınıf/stil kalıntıları.
 *  Kaydetme yolunda (PUT) da uygulanıyor: istemcinin temizliği atlanırsa
 *  bayat artık DB'ye yazılmasın. */
function stripEditingArtifacts(html) {
  if (!html) return html;
  return (
    html
      // contenteditable="true" | contenteditable | contenteditable='true'
      .replace(/\scontenteditable(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
      .replace(/\sdesignMode(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, "")
      // Editörün seçim sınıfı ve enjekte ettiği stil bloğu
      .replace(/\s*__ed_sel\s*/g, " ")
      .replace(/<style[^>]*id=["']__editor_style["'][\s\S]*?<\/style>/gi, "")
  );
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
  return stripEditingArtifacts(text);
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

/** 🔒 Banner Stüdyosu ücretsiz ama PRO/deneme kullanıcılarına özel
 *  (kullanıcı kararı, 25 Ağu 2026). ⚠️ `is_pro` DENEME SÜRESİNİ DE kapsıyor —
 *  trial'da is_pro=TRUE (bkz. Diress PRO modeli), o yüzden ayrıca is_in_trial
 *  bakılmıyor. Kredi kapısı kalktığı için erişimi tutan tek şey bu. */
async function isProUser(userId) {
  if (!userId || userId === "anonymous_user") return false;
  const { data, error } = await supabase
    .from("users")
    .select("is_pro")
    .eq("id", userId)
    .single();
  if (error) {
    console.error("🎨 [BANNER_STUDIO] pro check failed:", error?.message);
    return false;
  }
  return data?.is_pro === true;
}

async function deductUserCredit(userId, cost) {
  if (!userId || userId === "anonymous_user") return true;
  const { error } = await supabase.rpc("deduct_user_credit", {
    user_id: userId,
    credit_amount: cost,
  });
  return !error;
}

// ⚠️ Replicate'te her modelin girdi alanları FARKLI. GPT ailesi
// prompt/system_prompt/image_input kullanırken Gemini ailesi
// prompt/system_instruction/images kullanıyor; env ile model değiştirilebildiği
// için ikisi de destekleniyor.
function buildReplicateInput(options, ratio, language) {
  const prompt = buildUserPrompt(options, ratio, language);
  // Ürün fotoğrafı modele GÖRSEL olarak veriliyor; prompt'taki URL yalnız
  // <img src> için, model onu indirmiyor.
  const imageUrl = options.imageUrl;

  if (/^google\/gemini/i.test(REPLICATE_BANNER_STUDIO_MODEL)) {
    return {
      prompt,
      images: [imageUrl],
      videos: [],
      system_instruction: BANNER_SYSTEM_PROMPT,
      temperature: 1,
      top_p: 0.95,
      // enum: none | low | high. Tasarım kararı için biraz düşünme gerekli ama
      // reasoning çıktı bütçesini yiyor (Luna'da yaşandı) → "low".
      thinking_level: "low",
      max_output_tokens: 65535,
    };
  }

  return {
    prompt,
    system_prompt: BANNER_SYSTEM_PROMPT,
    image_input: [imageUrl],
    // Tek dosya HTML uzun: model kısa cevap vermeye çalışmasın.
    verbosity: "high",
    // ⚠️ Reasoning çıktı bütçesinden yiyor (Luna'da yaşandı). Tasarım kararı
    // için biraz düşünme gerekli ama "none" ile "low" arasında kalınıyor.
    reasoning_effort: "low",
    max_completion_tokens: 32000,
  };
}

// Replicate prediction'ı bitene kadar yokla. `Prefer: wait` ile çoğu üretim
// tek istekte döner; dönmezse burada bekleriz.
async function waitForReplicatePrediction(prediction, token) {
  let current = prediction;
  const startedAt = Date.now();
  const pollUrl =
    current?.urls?.get ||
    (current?.id ? `https://api.replicate.com/v1/predictions/${current.id}` : null);

  while (
    current &&
    current.status !== "succeeded" &&
    current.status !== "failed" &&
    current.status !== "canceled"
  ) {
    if (!pollUrl) break;
    if (Date.now() - startedAt > REPLICATE_POLL_TIMEOUT_MS) {
      throw new Error("Replicate prediction timed out");
    }
    await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
    const polled = await axios.get(pollUrl, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
    current = polled.data;
  }
  return current;
}

async function callBannerModelViaFal(options, ratio, language) {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY missing");
  fal.config({ credentials });

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fal.subscribe(FAL_OPENROUTER_VISION_ENDPOINT, {
        input: {
          model: FAL_BANNER_STUDIO_MODEL,
          prompt: buildUserPrompt(options, ratio, language),
          system_prompt: BANNER_SYSTEM_PROMPT,
          // Ürün fotoğrafı modele GÖRSEL olarak veriliyor; prompt'taki URL
          // yalnız <img src> için, model onu indirmiyor.
          image_urls: [options.imageUrl],
          temperature: 1,
          // Tek dosya HTML uzun — çıktı sınırı geniş tutuluyor.
          max_tokens: 32000,
          // ⚠️ Bu uçta reasoning UÇ GENELİNDE zorunlu (400: "Reasoning is
          // mandatory for this endpoint") — model fark etmeksizin true.
          reasoning: true,
        },
        logs: false,
      });

      // fal hatayı 200 içinde `error` alanıyla da döndürebiliyor
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(falError);

      const html = extractHtml(result?.data?.output || result?.output || "");
      if (html) return html;
      lastError = new Error("Model output did not contain valid banner HTML");
    } catch (err) {
      lastError = err;
      console.error(
        `🎨 [BANNER_STUDIO] fal/openrouter ${FAL_BANNER_STUDIO_MODEL} attempt ${attempt} failed:`,
        err?.status,
        err?.message
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError || new Error("Banner generation failed");
}

async function callBannerModelViaReplicate(options, ratio, language) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN missing");

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(
        `https://api.replicate.com/v1/models/${REPLICATE_BANNER_STUDIO_MODEL}/predictions`,
        {
          input: buildReplicateInput(options, ratio, language),
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 180000,
        }
      );

      const prediction = await waitForReplicatePrediction(response.data, token);
      if (prediction?.error) throw new Error(prediction.error);
      if (prediction?.status !== "succeeded") {
        throw new Error(
          `Prediction failed with status: ${prediction?.status || "unknown"}`
        );
      }

      const output = prediction.output;
      const outputText = (
        Array.isArray(output) ? output.join("") : output || ""
      ).trim();

      const html = extractHtml(outputText);
      if (html) return html;
      lastError = new Error("Model output did not contain valid banner HTML");
    } catch (err) {
      lastError = err;
      console.error(
        `🎨 [BANNER_STUDIO] Replicate ${REPLICATE_BANNER_STUDIO_MODEL} attempt ${attempt} failed:`,
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

// ─── 🎨 Banner stil havuzu (26 Ağu 2026) ────────────────────────────────
// CreateModelPhoto'daki stil referansı mantığının banner karşılığı, ama
// GÖRSEL-tabanlı (kullanıcı kararı: HTML değil): havuzdaki referans banner
// görseli + kullanıcının ürün fotoğrafı nano-banana-2/edit'e gider — üründeki
// kare yenisiyle DEĞİŞİR, metin/fiyat kampanya verisiyle güncellenir. Çıktı
// bir GÖRSELDİR; mevcut HTML altyapısı (viewer/JPG/liste) bozulmasın diye tam
// ekran <img> sarmalayıcıyla `html` alanına yazılır (22 Ağu'daki görsel-banner
// denemesinde kanıtlanan yaklaşım).
const FAL_STYLE_SWAP_ENDPOINT = "https://fal.run/fal-ai/nano-banana-2/edit";

function buildStyleSwapPrompt(options, language) {
  const lines = [
    "You are given two images.",
    "IMAGE 1 is a finished promotional fashion banner. It is the MASTER CANVAS: the output must BE this banner, rebuilt. Keep its composition, layout grid, background environment, lighting mood, color grading, typography style, text placement and every graphic device EXACTLY as they are.",
    "IMAGE 2 is only a SOURCE of the new subject: take the person, pose and garment from it — nothing else. Do NOT use IMAGE 2's background, framing, lighting or composition in the output.",
    "So: transplant the person+garment from IMAGE 2 into IMAGE 1's banner, in the same position and scale the original subject occupied. The new garment must be the hero and fully visible.",
    "Regrade the transplanted subject with IMAGE 1's photographic treatment so it looks native to the banner — match its light direction, white balance, contrast, and reproduce any gaussian blur, soft-focus, grain, color wash, duotone or reflections the reference applies; never let it look like a raw pasted photo.",
    `REPLACE ALL text, prices, codes and buttons with the new campaign data below, written in language "${language || "en"}". Never keep any text, brand name, price or product from the reference banner.`,
  ];
  // 🗂️ Şablondan üretimde LLM'in yazdığı tasarım tarifi ek yönerge olur:
  // model referansın dilini "neden öyle" olduğunu bilerek korur.
  if (options.__templateDesignPrompt) {
    lines.push(
      `Design intent of the reference (follow it): ${options.__templateDesignPrompt}`
    );
  }
  if (options.details) {
    lines.push(
      `New campaign data (free text — extract product name, prices, discount, code, CTA, deadline; use prices/codes verbatim):\n"""\n${options.details}\n"""`
    );
  } else {
    lines.push(
      "No campaign data was provided: keep the reference's text slots but fill them with tasteful generic copy in the requested language (no fake brand names)."
    );
  }
  lines.push(
    "If the reference sets a word vertically, rotated or letter-stacked and the new text cannot reproduce that device with PERFECT spelling, set that text horizontally in the same typeface instead — a broken or misspelled word is never acceptable.",
    "Output exactly ONE image: the finished banner. Photorealistic garment, crisp legible typography, no watermark."
  );
  return lines.join("\n");
}

async function generateBannerViaStyleImage(styleImageUrl, options, ratio, language) {
  const apiKey = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!apiKey) throw new Error("FAL_API_KEY missing");

  const response = await axios.post(
    FAL_STYLE_SWAP_ENDPOINT,
    {
      prompt: buildStyleSwapPrompt(options, language),
      // Sıra sözleşme: 1 = referans banner, 2 = yeni ürün fotoğrafı (prompt öyle anlatıyor)
      image_urls: [styleImageUrl, options.imageUrl],
      output_format: "jpeg",
      // "original" seçiliyken referansın kendi oranına sadık kal ("auto")
      aspect_ratio: ratio === "original" ? "auto" : ratio,
      num_images: 1,
      resolution: "2K",
      safety_tolerance: "6",
    },
    {
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 300000,
    }
  );
  const url = response.data?.images?.[0]?.url;
  if (!url) throw new Error("Style swap returned no image");
  return url;
}

// Görsel banner'ı HTML sözleşmesine sarar: extractHtml <style> ve <img> arar,
// viewer/JPG/video altyapısı olduğu gibi çalışır.
function wrapImageBanner(imageUrl) {
  return (
    '<!DOCTYPE html><html><head>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">' +
    "<style>html,body{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;background:#000}" +
    ".b{position:fixed;inset:0;width:100%;height:100%;object-fit:cover}</style>" +
    '</head><body><img class="b" src="' + imageUrl + '"></body></html>'
  );
}

function callBannerModel(options, ratio, language) {
  return BANNER_STUDIO_PROVIDER === "fal"
    ? callBannerModelViaFal(options, ratio, language)
    : callBannerModelViaReplicate(options, ratio, language);
}

// 🕵️ Havuza eklenen her referans banner nano-banana-lite'ten geçirilir
// (kullanıcı kararı, 26 Ağu 2026): mankenin yüzü/kimliği ve kıyafet DEĞİŞİR,
// banner'ın tasarım dili (yerleşim/tipografi/metin/renk) aynen kalır. Amaç
// Pinterest vb. kaynaklardan alınan görsellerin telifinden kaçınmak —
// ⚠️ ORİJİNAL ASLA SAKLANMAZ ve anonimleştirme patlarsa kayıt REDDEDİLİR
// (açık düşmek amacı boşa çıkarırdı).
const STYLE_ANONYMIZE_MODEL = "google/nano-banana-lite/edit";
const STYLE_ANONYMIZE_PROMPT = [
  "Recreate this promotional fashion banner as a NEW original work while keeping its design language intact:",
  "- KEEP exactly: the layout, composition, typography style, text positions and sizes, buttons, graphic devices, background treatment and overall color mood.",
  "- REWRITE every piece of text into DIFFERENT content of the same kind, same language and similar length, set in the identical typeface, size and position: change any discount percentage or price to a different plausible value, reword slogans, headlines, occasion greetings and CTAs into fresh phrasings that carry the same commercial intent — no text string from the original may survive verbatim (except single generic words that cannot be reworded). Every word must be spelled perfectly.",
  "- EXCEPTION: ONLY IF the banner already contains a brand name, logo or wordmark, replace that existing mark with the word 'Diress' set in the same typographic style and position. If the banner has NO brand mark, DO NOT add one — never introduce 'Diress' or any other brand into a banner that had none (26 Ağu 2026: markasız görsellere Diress ekleniyordu, yasak).",
  "- REPLACE the model with a COMPLETELY DIFFERENT person: different face, different identity, different hair; similar pose and framing so the layout still works.",
  "- REDESIGN the garment into a clearly different design in the same category (e.g. a different dress if it was a dress) with a similar color family so the palette still harmonizes.",
  "Photorealistic, crisp typography identical to the original, one single image, no watermark.",
].join("\n");

/** Kart başlığı: eklenti başlık göndermiyor — havuza düşen her stile Luna
 *  kısa İNGİLİZCE bir başlık yazar (kullanıcı kararı, 26 Ağu 2026; kartlarda
 *  gösteriliyor). Başarısızlık ÜRETİMİ DÜŞÜRMEZ: başlık null kalır. */
async function generateStyleTitle(buffer) {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) return null;
  fal.config({ credentials });
  try {
    const result = await fal.subscribe("openrouter/router/vision", {
      input: {
        model: "openai/gpt-5.6-luna",
        prompt:
          "Give a very short English title (2-4 words) describing this fashion banner's DESIGN STYLE, e.g. 'Bold Sale Typography' or 'Quiet Luxury Layout'. Return ONLY the title, no quotes, no punctuation at the end.",
        image_urls: [`data:image/jpeg;base64,${buffer.toString("base64")}`],
        temperature: 0,
        max_tokens: 200,
      },
      logs: false,
    });
    const raw = String(result?.data?.output || result?.output || "").trim();
    if (!raw) return null;
    // Tek satır, tırnaksız, makul uzunlukta
    const title = raw.split("\n")[0].replace(/^["']|["']$/g, "").trim();
    return title && title.length <= 60 ? title : null;
  } catch (err) {
    console.warn("🎨 [BANNER_STUDIO] style title failed:", err?.message);
    return null;
  }
}

async function anonymizeStyleImage(buffer) {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY missing");
  fal.config({ credentials });

  const dataUri = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  const result = await fal.subscribe(STYLE_ANONYMIZE_MODEL, {
    input: {
      prompt: STYLE_ANONYMIZE_PROMPT,
      image_urls: [dataUri],
      aspect_ratio: "auto",
      num_images: 1,
      output_format: "jpeg",
      safety_tolerance: "6",
      limit_generations: true,
    },
    logs: false,
  });
  const url =
    result?.data?.images?.[0]?.url || result?.images?.[0]?.url || null;
  if (!url) throw new Error("anonymize returned no image");
  const dl = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000,
  });
  return Buffer.from(dl.data);
}

// GET /api/banner-studio/styles — stil havuzu (istemcideki seçim kartı)
router.get("/styles", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("banner_styles")
      .select("id, title, image_url, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({ success: true, styles: data || [] });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] styles list error:", error?.message);
    return res.status(500).json({ success: false, error: "STYLES_FAILED" });
  }
});

// POST /api/banner-studio/styles — havuza referans banner ekle
// (auto-style-clipper eklentisi / admin). Girdi imageBase64 VEYA imageUrl;
// ⚠️ style-profiles kuralı burada da geçerli: HAVUZDA HOTLİNK SAKLANMAZ —
// URL gelse bile sunucu indirir ve kendi storage'ına yazar.
// BANNER_STYLE_ADMIN_KEY env'i tanımlıysa x-admin-key başlığı eşleşmek zorunda;
// tanımlı değilse (dev) serbest.
router.post("/styles", async (req, res) => {
  try {
    const adminKey = process.env.BANNER_STYLE_ADMIN_KEY;
    if (adminKey && req.headers["x-admin-key"] !== adminKey) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    const { imageUrl, imageBase64, title, sortOrder } = req.body || {};
    if (!imageUrl && !imageBase64) {
      return res
        .status(400)
        .json({ success: false, error: "imageUrl or imageBase64 is required" });
    }

    let buffer;
    if (imageBase64) {
      const raw = String(imageBase64).replace(/^data:image\/[a-z+]+;base64,/i, "");
      buffer = Buffer.from(raw, "base64");
    } else {
      const dl = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      buffer = Buffer.from(dl.data);
    }
    if (!buffer || buffer.length < 1000) {
      return res.status(400).json({ success: false, error: "IMAGE_INVALID" });
    }

    // 🕵️ Telif: storage'a yalnız ANONİMLEŞTİRİLMİŞ türev yazılır.
    try {
      buffer = await anonymizeStyleImage(buffer);
    } catch (anonErr) {
      console.error(
        "🎨 [BANNER_STUDIO] style anonymize failed:",
        anonErr?.message
      );
      return res
        .status(502)
        .json({ success: false, error: "STYLE_ANONYMIZE_FAILED" });
    }

    // Başlık gelmediyse (eklenti banner modu göndermiyor) Luna yazsın —
    // anonim görsel üzerinden, İngilizce, kart etiketi için.
    let finalTitle = title || null;
    if (!finalTitle) {
      finalTitle = await generateStyleTitle(buffer);
    }

    const storagePath = `bannerStudio/styles/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: upErr } = await supabase.storage
      .from("images")
      .upload(storagePath, buffer, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "31536000",
      });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage
      .from("images")
      .getPublicUrl(storagePath);
    if (!pub?.publicUrl) throw new Error("public url missing");

    const { data, error } = await supabase
      .from("banner_styles")
      .insert({
        image_url: pub.publicUrl,
        title: finalTitle,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      })
      .select("id, title, image_url, sort_order")
      .single();
    if (error) throw error;
    return res.json({ success: true, style: data });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] style create error:", error?.message);
    return res.status(500).json({ success: false, error: "STYLE_CREATE_FAILED" });
  }
});

// DELETE /api/banner-studio/styles/:id — havuzdan kaldır (admin kuralı POST ile aynı)
router.delete("/styles/:id", async (req, res) => {
  try {
    const adminKey = process.env.BANNER_STYLE_ADMIN_KEY;
    if (adminKey && req.headers["x-admin-key"] !== adminKey) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }
    const { error } = await supabase
      .from("banner_styles")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (error) {
    console.error("🎨 [BANNER_STUDIO] style delete error:", error?.message);
    return res.status(500).json({ success: false, error: "STYLE_DELETE_FAILED" });
  }
});

// 🗂️ GET /api/banner-studio/templates — hazır şablon galerisi.
// Etiketlenmiş + önizlemeli + şalteri açık banner'lar, en yeni önce.
// İstemci Tinder-tarzı seçim ekranında bu listeyi kaydırıyor.
router.get("/templates", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 40, 1),
      80
    );
    const category = String(req.query.category || "").trim() || null;
    let q = supabase
      .from("banner_studio_results")
      .select("id, preview_url, ratio, template_category, template_title, created_at")
      .eq("is_template", true)
      .not("template_category", "is", null)
      .not("preview_url", "is", null)
      .order("template_meta_at", { ascending: false })
      .limit(limit);
    if (category) q = q.eq("template_category", category);
    const { data, error } = await q;
    if (error) throw error;
    return res.json({
      success: true,
      templates: (data || []).map((r) => ({
        id: r.id,
        previewUrl: r.preview_url,
        ratio: r.ratio,
        category: r.template_category,
        title: r.template_title,
      })),
      categories: TEMPLATE_CATEGORIES,
    });
  } catch (err) {
    console.error("🗂️ [TEMPLATES] list error:", err?.message);
    return res.status(500).json({ success: false, error: "TEMPLATES_FAILED" });
  }
});

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

    // 🔒 Erişim kapısı (26 Ağu 2026, kullanıcı): PRO/deneme YA DA kredisi
    // olan herkes — CMP'deki oluşturma mantığına yaklaştırıldı. Üretim yine
    // ücretsiz (BANNER_CREDIT_COST=0), kredi yalnız kapıyı açan anahtar.
    if (!(await isProUser(effectiveUserId))) {
      const gateCredit = await getUserCredit(effectiveUserId);
      if (!(typeof gateCredit === "number" && gateCredit > 0)) {
        return res.status(403).json({
          success: false,
          error: "PRO_REQUIRED",
        });
      }
    }

    // Kredi kontrolü (anonim kullanıcı kredi akışının dışında).
    // Ücretsizken (maliyet 0) hiç sorgulanmıyor.
    if (BANNER_CREDIT_COST > 0 && effectiveUserId !== "anonymous_user") {
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

    // 🎨 Stil seçiliyse GÖRSEL hattı: nb2/edit referans banner'ı yeni ürünle
    // yeniden kurar; HTML hattı hiç çalışmaz. Çıktı <img> sarmalayıcıyla
    // html alanına yazılır, preview doğrudan görselin kendisidir (puppeteer
    // gerekmez), animasyon bu hatta anlamsızdır (statik görsel).
    // 🗂️ ŞABLONDAN ÜRETİM (27 Ağu 2026): kullanıcı hazır şablon seçtiyse
    // referans, o banner'ın render edilmiş önizlemesidir. Görsel-takas hattı
    // (nb2/edit) çalışır; şablonun LLM'ce yazılmış tasarım tarifi
    // (template_prompt) prompt'a ek yönerge olarak eklenir — üretim şablonun
    // dilini korurken kullanıcının ürünü ve kampanya verisiyle kurulur.
    if (options.templateId && !options.styleId) {
      const { data: tpl, error: tplError } = await supabase
        .from("banner_studio_results")
        .select("id, preview_url, template_prompt")
        .eq("id", options.templateId)
        .eq("is_template", true)
        .single();
      if (tplError || !tpl?.preview_url) {
        return res
          .status(404)
          .json({ success: false, error: "TEMPLATE_NOT_FOUND" });
      }
      // styleId hattıyla aynı akış: referans görsel = şablon önizlemesi.
      // template_prompt'u options üzerinden buildStyleSwapPrompt'a taşımak
      // yerine burada options.details'e dokunmadan ayrı alanda geçiriyoruz.
      options.__templateDesignPrompt = tpl.template_prompt || null;
      options.styleId = null;
      req.__templateRef = tpl.preview_url;
    }

    // Referans görsel: şablon önizlemesi (templateId) ya da stil havuzu (styleId)
    let styleRefImageUrl = req.__templateRef || null;
    if (!styleRefImageUrl && options.styleId) {
      const { data: styleRecord, error: styleError } = await supabase
        .from("banner_styles")
        .select("id, image_url")
        .eq("id", options.styleId)
        .eq("is_active", true)
        .single();
      if (styleError || !styleRecord?.image_url) {
        return res
          .status(404)
          .json({ success: false, error: "STYLE_NOT_FOUND" });
      }
      styleRefImageUrl = styleRecord.image_url;
    }

    if (styleRefImageUrl) {
      const falImageUrl = await generateBannerViaStyleImage(
        styleRefImageUrl,
        { ...options, imageUrl },
        ratio,
        language
      );

      // Kalıcılık: fal URL'i storage'a kopyalanır; kopya patlarsa fal URL'iyle
      // devam edilir (üretim asla bu yüzden düşmez).
      let bannerImageUrl = falImageUrl;
      try {
        const dl = await axios.get(falImageUrl, {
          responseType: "arraybuffer",
          timeout: 60000,
        });
        const storagePath = `bannerStudio/styleBanners/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error: upErr } = await supabase.storage
          .from("images")
          .upload(storagePath, Buffer.from(dl.data), {
            contentType: "image/jpeg",
            upsert: true,
            cacheControl: "31536000",
          });
        if (!upErr) {
          const { data: pub } = supabase.storage
            .from("images")
            .getPublicUrl(storagePath);
          if (pub?.publicUrl) bannerImageUrl = pub.publicUrl;
        }
      } catch (copyErr) {
        console.error(
          "🎨 [BANNER_STUDIO] style banner copy failed:",
          copyErr?.message
        );
      }

      // Geçici iç alan kayda yazılmasın
      delete options.__templateDesignPrompt;
      const styleHtml = wrapImageBanner(bannerImageUrl);
      const { data: styleRow, error: styleInsertErr } = await supabase
        .from("banner_studio_results")
        .insert({
          user_id: effectiveUserId,
          image_url: imageUrl,
          banner_type: options.bannerType || "style",
          ratio,
          options,
          html: styleHtml,
          preview_url: bannerImageUrl,
          credits_used:
            effectiveUserId === "anonymous_user" ? 0 : BANNER_CREDIT_COST,
          processing_time_seconds: Math.round((Date.now() - startedAt) / 1000),
        })
        .select("id, created_at")
        .single();
      if (styleInsertErr) {
        console.error("🎨 [BANNER_STUDIO] style insert failed:", styleInsertErr);
      }
      // 🗂️ Şablon etiketi arka planda — yanıtı bekletmez
      if (styleRow?.id) generateTemplateMeta(styleRow.id);

      if (BANNER_CREDIT_COST > 0) {
        await deductUserCredit(effectiveUserId, BANNER_CREDIT_COST);
      }
      const styleCredit = await getUserCredit(effectiveUserId);
      return res.json({
        success: true,
        result: {
          id: styleRow?.id || null,
          html: styleHtml,
          ratio,
          bannerType: options.bannerType || "style",
          imageUrl,
          options,
          createdAt: styleRow?.created_at || new Date().toISOString(),
          previewUrl: bannerImageUrl,
          currentCredit: styleCredit,
        },
      });
    }

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

    // 🖼️ Önizleme JPG'i — istemcideki Results kartları görsel istiyor (banner
    // HTML olduğu için gösterilecek bir kare yoktu). Tek ekran görüntüsü
    // (~1-3 sn) yanıtı bekletir ama üretimin toplam süresi yanında önemsiz.
    // HATA OLURSA AKIŞI BOZMAZ: istemci kaynak fotoğrafa düşer.
    let previewUrl = null;
    if (record?.id) {
      try {
        const arn = ratioToArn(ratio, options);
        const shot = await renderBannerScreenshot(html, arn);
        const previewPath = `bannerStudio/previews/${record.id}.jpg`;
        const { error: previewUploadError } = await supabase.storage
          .from("images")
          .upload(previewPath, shot, {
            contentType: "image/jpeg",
            upsert: true,
            cacheControl: "31536000",
          });
        if (!previewUploadError) {
          const { data: pub } = supabase.storage
            .from("images")
            .getPublicUrl(previewPath);
          if (pub?.publicUrl) {
            previewUrl = pub.publicUrl;
            await supabase
              .from("banner_studio_results")
              .update({ preview_url: previewUrl })
              .eq("id", record.id);
          }
        }
      } catch (previewError) {
        console.error(
          "🎨 [BANNER_STUDIO] preview render failed:",
          previewError?.message
        );
      }
    }

    // 🗂️ Şablon etiketi (statik dahil her HTML banner) — arka planda
    if (record?.id) generateTemplateMeta(record.id);

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

    if (BANNER_CREDIT_COST > 0) {
      await deductUserCredit(effectiveUserId, BANNER_CREDIT_COST);
    }
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
        previewUrl,
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
      .select("id, image_url, preview_url, banner_type, ratio, options, created_at")
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
      .select("id, user_id, image_url, preview_url, banner_type, ratio, options, html, created_at")
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
// 🗂️ ŞABLON METADATA'SI (27 Ağu 2026, kullanıcı isteği)
// Her biten banner arka planda LLM ile etiketlenir: kategori + konu başlığı +
// yeniden üretilebilir tasarım tarifi. Bu üçlü, banner'ı "hazır şablon"
// yapar: başka bir kullanıcı şablonu seçince kendi fotoğrafı + kendi kampanya
// verisiyle aynı tasarım dilinde banner üretilir (nb2/edit görsel-takas hattı).
// Etiketleme yanıtı BLOKLAMAZ; hata olursa kayıt etiketsiz kalır, listeye
// çıkmaz, üretim akışı etkilenmez.
const TEMPLATE_CATEGORIES = [
  "flash-sale",       // saatli/acele indirim
  "seasonal-sale",    // sezon sonu / dönemsel indirim
  "new-collection",   // yeni sezon & koleksiyon lansmanı
  "product-launch",   // tekil ürün lansmanı
  "holiday-special",  // bayram / özel gün (anneler günü, yılbaşı…)
  "brand-story",      // marka imajı, kampanyasız vitrin
  "editorial-lookbook", // dergi/lookbook havası
  "minimal-showcase", // sade ürün vitrini
  "giveaway",         // çekiliş / hediye
  "restock",          // yeniden stokta
  "free-shipping",    // kargo/kampanya koşulu odaklı
  "announcement",     // genel duyuru
];

async function generateTemplateMeta(recordId) {
  try {
    const { data: record } = await supabase
      .from("banner_studio_results")
      .select("id, html, options")
      .eq("id", recordId)
      .single();
    if (!record?.html) return;

    const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
    if (!credentials) return;
    fal.config({ credentials });

    // HTML'in metin içeriği yeter — tüm markup token israfı olur.
    const textContent = record.html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 1500);

    const prompt = [
      "You are cataloguing a finished promotional fashion banner for a template gallery.",
      `Banner's visible text content: """${textContent}"""`,
      record.options?.details
        ? `The campaign brief it was built from: """${String(record.options.details).slice(0, 400)}"""`
        : "",
      record.options?.bannerType ? `Requested banner type: ${record.options.bannerType}` : "",
      "",
      "Return STRICT JSON, nothing else:",
      '{"category":"<one of the list>","title":"<2-4 word English title describing the banner topic>","designPrompt":"<2-3 English sentences describing the reusable DESIGN: layout structure, typography character, color/mood, graphic devices. Written as a directive another designer could follow. No brand names, no product specifics.>"}',
      "",
      "category must be EXACTLY one of: " + TEMPLATE_CATEGORIES.join(", "),
    ].filter(Boolean).join("\n");

    const result = await fal.subscribe(FAL_OPENROUTER_VISION_ENDPOINT, {
      input: {
        model: FAL_BANNER_STUDIO_MODEL,
        prompt,
        temperature: 0.3,
        max_tokens: 2000,
        reasoning: true,
      },
      logs: false,
    });
    const out = String(result?.data?.output || result?.output || "");
    const m = out.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error("meta JSON yok");
    const meta = JSON.parse(m[0]);
    const category = TEMPLATE_CATEGORIES.includes(meta.category)
      ? meta.category
      : "announcement";
    const title = String(meta.title || "").trim().slice(0, 60) || null;
    const designPrompt = String(meta.designPrompt || "").trim().slice(0, 600) || null;
    if (!title || !designPrompt) throw new Error("meta alanları eksik");

    await supabase
      .from("banner_studio_results")
      .update({
        template_category: category,
        template_title: title,
        template_prompt: designPrompt,
        template_meta_at: new Date().toISOString(),
      })
      .eq("id", recordId);
    console.log(`🗂️ [TEMPLATE_META] ${recordId} → ${category} · "${title}"`);
  } catch (err) {
    console.error("🗂️ [TEMPLATE_META] hata:", err?.message);
  }
}

// 🪄 AI düzenleme (27 Ağu 2026, kullanıcı isteği): viewer'daki "Düzenle"
// artık serbest metin talimat alıyor — banner'ın MEVCUT HTML'i + talimat
// LLM'e gider, model yalnız isteneni değiştirip TAM HTML döner. Kayıt
// güncellenir, önizleme yeniden çekilir, animasyonluysa video tazelenir.
async function callBannerEditModel(html, instructions, language) {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) throw new Error("FAL_API_KEY missing");
  fal.config({ credentials });

  const prompt = [
    "You are a senior front-end developer and banner designer.",
    "Below is an EXISTING single-file HTML promotional banner, followed by the user's edit request.",
    "Apply ONLY the requested changes. Keep everything else — layout, styles, images, animations, texts not mentioned — byte-for-byte where possible.",
    `The user's request may be in any language (banner language: "${language || "tr"}"); interpret it faithfully. If the request asks for new copy, write it in the banner's existing language unless told otherwise.`,
    "Never add watermarks, never change the <img> product photo source, never add external resources.",
    "Return the COMPLETE updated single-file HTML and nothing else.",
    "",
    "----- CURRENT BANNER HTML -----",
    html,
    "----- END HTML -----",
    "",
    "----- USER EDIT REQUEST -----",
    instructions,
    "----- END REQUEST -----",
  ].join("\n");

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fal.subscribe(FAL_OPENROUTER_VISION_ENDPOINT, {
        input: {
          model: FAL_BANNER_STUDIO_MODEL,
          prompt,
          temperature: 0.4,
          max_tokens: 32000,
          // ⚠️ Bu uçta reasoning uç genelinde zorunlu.
          reasoning: true,
        },
        logs: false,
      });
      const falError = result?.data?.error || result?.error;
      if (falError) throw new Error(falError);
      const out = extractHtml(result?.data?.output || result?.output || "");
      if (out) return out;
      lastError = new Error("Edit output did not contain valid banner HTML");
    } catch (err) {
      lastError = err;
      console.error(
        `🪄 [BANNER_EDIT] attempt ${attempt} failed:`,
        err?.status,
        err?.message
      );
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError || new Error("Banner edit failed");
}

router.post("/edit", async (req, res) => {
  try {
    const { userId, resultId, instructions } = req.body || {};
    const text = String(instructions || "").trim();
    if (!userId || !resultId || !text) {
      return res.status(400).json({
        success: false,
        error: "userId, resultId and instructions are required",
      });
    }
    if (text.length > 2000) {
      return res
        .status(400)
        .json({ success: false, error: "INSTRUCTIONS_TOO_LONG" });
    }

    const { data: record, error } = await supabase
      .from("banner_studio_results")
      .select("id, user_id, html, ratio, options")
      .eq("id", resultId)
      .single();
    if (error || !record?.html) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    if (record.user_id !== userId) {
      return res.status(403).json({ success: false, error: "FORBIDDEN" });
    }

    const language = record.options?.language || "tr";
    const edited = await callBannerEditModel(
      stripEditingArtifacts(record.html),
      text,
      language
    );
    const cleanHtml = stripEditingArtifacts(edited);
    // PUT ile aynı sağlamlık çizgisi: stil bloğu + ürün görseli yerinde olmalı
    if (!/<style[\s>]/i.test(cleanHtml) || !/<img[\s>]/i.test(cleanHtml)) {
      return res.status(422).json({ success: false, error: "EDIT_BROKE_HTML" });
    }

    const { error: updateError } = await supabase
      .from("banner_studio_results")
      .update({ html: cleanHtml, video_url: null })
      .eq("id", record.id);
    if (updateError) throw updateError;

    // Önizlemeyi tazele — başarısızlık akışı bozmaz, eski JPG kalır.
    let previewUrl = null;
    try {
      const arn = ratioToArn(record.ratio, record.options || {});
      const shot = await renderBannerScreenshot(cleanHtml, arn);
      const previewPath = `bannerStudio/previews/${record.id}.jpg`;
      const { error: upErr } = await supabase.storage
        .from("images")
        .upload(previewPath, shot, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "31536000",
        });
      if (!upErr) {
        const { data: pub } = supabase.storage
          .from("images")
          .getPublicUrl(previewPath);
        if (pub?.publicUrl) {
          previewUrl = pub.publicUrl;
          await supabase
            .from("banner_studio_results")
            .update({ preview_url: previewUrl })
            .eq("id", record.id);
        }
      }
    } catch (previewError) {
      console.error(
        "🪄 [BANNER_EDIT] preview render failed:",
        previewError?.message
      );
    }

    if (record.options?.animated && !videoRenderJobs.has(record.id)) {
      queueVideoRender({
        id: record.id,
        html: cleanHtml,
        ratio: record.ratio,
        options: record.options,
      }).catch((err) => {
        console.error(
          "🪄 [BANNER_EDIT] post-edit video render failed:",
          err?.message
        );
      });
    }

    // Tasarım değişti → şablon etiketi tazelensin (arka planda)
    generateTemplateMeta(record.id);

    return res.json({ success: true, html: cleanHtml, previewUrl });
  } catch (error) {
    console.error("🪄 [BANNER_EDIT] error:", error?.message);
    return res.status(500).json({ success: false, error: "EDIT_FAILED" });
  }
});

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
    const cleanHtml = stripEditingArtifacts(html);
    if (!/<style[\s>]/i.test(cleanHtml) || !/<img[\s>]/i.test(cleanHtml)) {
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
      // ⚠️ Kaydederken de artıkları sök: istemcinin __getBannerHtml temizliği
      // atlanırsa `contenteditable` DB'ye yazılıp banner bir daha hep
      // düzenlenebilir açılıyordu.
      .update({ html: cleanHtml, video_url: null })
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
