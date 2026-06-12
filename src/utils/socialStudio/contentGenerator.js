// Social Studio — içerik üretim pipeline'ı (özellik bazlı, prompt'suz)
//
// Tasarım dili SABİTTİR: assets/demo'daki onaylanmış 4K posterleri üreten
// prompt iskeleti aşağıda kilitli şablon olarak durur. Gemini 3.1 Pro yalnızca
// değişken slotları doldurur (sahne, ürün, palet, masthead, yan kartlar);
// "FULL-BLEED", "letters passing DIRECTLY BEHIND the model", store rozetleri
// gibi tasarım cümleleri AYNEN korunur.
//
// İki şablon:
//  - feature_spotlight: tek atış 4K poster (ANY LOCATION / EVERY COLOR / ANY HAIR kalitesi)
//  - before_after: 3 adımlı zincir (amatör foto → editorial çekim → poster kompozisyon)
const axios = require("axios");
const { supabaseAdmin } = require("../../supabaseClient");

const BUCKET = "social-studio";

// ---------------------------------------------------------------
// KİLİTLİ TASARIM DİLİ — onaylanmış prompt iskeletleri
// ---------------------------------------------------------------
// Fotorealizm bloğu — 12 Haz testinde gözle görülür fark yarattı (çil, gözenek, saç teli)
const PHOTOREALISM_BLOCK = `PHOTOREALISM DIRECTIVES (critical): skin must show natural texture with soft visible pores, faint freckles and fine vellus hair — absolutely no plastic, airbrushed or CGI look; individual hair strands sharply resolved with natural flyaways catching the light; realistic fabric weave; subtle 35mm film grain and photographic color grading; catchlights in the eyes must look like real softbox reflections.`;

const SPOTLIGHT_SKELETON = `Design a stunning MAGAZINE COVER style Instagram post (4:5) for an AI fashion photoshoot app, showcasing the {FEATURE_NAME} feature. FULL-BLEED hero: hyper-realistic editorial photo of {HERO_SCENE} — confident relaxed editorial pose, campaign-ready quality. ${PHOTOREALISM_BLOCK} MASTHEAD: huge elegant fashion-serif headline {MASTHEAD} stacked on two lines in {MASTHEAD_COLOR}, filling almost the full width — the letters passing DIRECTLY BEHIND the model so her head and shoulders cut in front of the letterforms (strong text-behind-subject effect). {SIDE_CARDS_BLOCK} FOOTER: small clean sans-serif line reading {FOOTER_LINE} above two official app badges side by side: a black rounded Download on the App Store badge with Apple logo and a black rounded GET IT ON Google Play badge, correctly rendered text. Poster-level hierarchy, perfectly kerned typography, {PALETTE}, no spelling errors, no watermark.`;

// Story varyantı — 12 Haz testinde doğrulanan kurallar: kenardan kenara fon
// (bant/letterbox YASAK) + IG arayüzü için üst/alt %12 temiz bölge.
const SPOTLIGHT_STORY_SKELETON = `Design a stunning FULL-SCREEN Instagram STORY (9:16 vertical) for an AI fashion photoshoot app, showcasing the {FEATURE_NAME} feature — luxury magazine cover design language. CRITICAL FRAMING RULE: the photographic scene must extend EDGE TO EDGE across the ENTIRE frame, top to bottom — absolutely NO solid bars, NO borders, NO frames, NO letterboxing anywhere; the top 12 percent and bottom 12 percent of the frame stay as clean empty backdrop with no text or graphics on them (Instagram UI overlays these areas). FULL-BLEED vertical hero: hyper-realistic editorial photo of {HERO_SCENE} — confident relaxed editorial pose, campaign-ready quality. ${PHOTOREALISM_BLOCK} MASTHEAD: huge elegant fashion-serif headline {MASTHEAD} stacked on two lines in {MASTHEAD_COLOR}, placed in the upper-middle area (well below the very top of the frame) — letters passing DIRECTLY BEHIND the model so her head and shoulders clearly cut in front of the letterforms (strong text-behind-subject effect). {SIDE_CARDS_BLOCK} LOWER-MIDDLE area (clearly above the bottom edge): small clean sans-serif line reading {FOOTER_LINE} above two official app badges side by side: a black rounded Download on the App Store badge with Apple logo and a black rounded GET IT ON Google Play badge, correctly rendered text. Poster-level hierarchy, perfectly kerned typography, {PALETTE}, no spelling errors, no watermark.`;

const BA_STEP1_SKELETON = `Authentic amateur smartphone photo of {CHIC_PRODUCT} {AMATEUR_SCENE}. The product itself is clearly a high-quality chic designer piece, but the photo is badly taken: harsh mixed indoor lighting with slight color cast, slightly tilted framing, soft focus, a bit of clutter at the edges, typical quick listing photo by a small boutique seller. No people, no text, no watermark.`;

const BA_STEP2_SKELETON = `Transform this amateur product photo into a hyper-realistic, editorial-quality fashion photograph at campaign-ready standards. Take the EXACT {PRODUCT_SHORT} from the reference — preserve its exact color, fabric texture, cut and every design detail — and present it worn by a striking female model with editorial features. ${PHOTOREALISM_BLOCK} FASHION POSE DIRECTIVE: stiff mannequin stance is absolutely forbidden — {POSE_DIRECTIVE}. SETTING: {EDITORIAL_SETTING}. Shot on medium format, 85mm look, shallow depth of field, crisp focus on fabric texture. The final result must be a single, hyper-realistic, editorial-quality fashion photograph, seamlessly integrating model, garment, and environment — like a Vogue campaign page. No text, no watermark.`;

const BA_STEP3_SKELETON = `Art-direct a stunning MAGAZINE COVER style Instagram post (4:5) for an AI fashion photoshoot app, using the SECOND image (editorial model photo) as the FULL-BLEED background — keep the model, garment and lighting exactly as they are, do not redraw them. THIS MUST LOOK LIKE A COLLECTIBLE FASHION POSTER, with bold confident graphic design: (1) MASTHEAD: huge elegant fashion-serif headline {MASTHEAD} stacked on two lines, filling almost the full width like a VOGUE magazine masthead, in {MASTHEAD_COLOR} — the letters must overlap DIRECTLY BEHIND the model so her head and shoulders clearly cut in FRONT of the letterforms (strong text-behind-subject depth, big overlap, immediately readable effect). (2) BEFORE INSET: upper-left, the FIRST image (amateur product photo) as a tilted instant-photo with thick white border, a strip of translucent washi tape holding its corner, casting a real soft shadow on the background, tiny clean caps label YOUR PHOTO under it. (3) ARROW: a BOLD, expressive hand-painted brush-stroke arrow in deep espresso ink — thick, confident, with a clear pronounced arrowhead — sweeping in an elegant S-curve from the inset photo down toward the garment, clearly visible as a deliberate graphic design element, not a thin line. (4) FOOTER: centered at the bottom, official-looking app download badges side by side: a black rounded Download on the App Store badge with Apple logo and a black rounded GET IT ON Google Play badge, properly rendered with correct text, above them one small clean sans-serif line reading {FOOTER_LINE}. Cohesive {PALETTE}, poster-level visual hierarchy, perfectly kerned typography, no spelling errors, no watermark, nothing else.`;

// Before/After story varyantı — aynı iki kaynak görselden 9:16 kompozisyon
const BA_STEP3_STORY_SKELETON = `Art-direct a stunning FULL-SCREEN Instagram STORY (9:16 vertical) for an AI fashion photoshoot app, using the SECOND image (editorial model photo) as the FULL-BLEED background — keep the model, garment and lighting exactly as they are, do not redraw them; extend the scene naturally to fill the taller frame. CRITICAL FRAMING RULE: the scene must extend EDGE TO EDGE across the ENTIRE frame, top to bottom — absolutely NO solid bars, NO borders, NO letterboxing; the top 12 percent and bottom 12 percent stay as clean background with no text or graphics (Instagram UI overlays these areas). DESIGN LAYERS: (1) MASTHEAD: huge elegant fashion-serif headline {MASTHEAD} stacked on two lines in {MASTHEAD_COLOR}, placed in the upper-middle area — letters overlapping DIRECTLY BEHIND the model so her head and shoulders clearly cut in FRONT of the letterforms (strong text-behind-subject depth). (2) BEFORE INSET: upper-left within the safe zone, the FIRST image (amateur product photo) as a tilted instant-photo with thick white border and translucent washi tape, casting a real soft shadow, tiny clean caps label YOUR PHOTO under it. (3) ARROW: a BOLD, expressive hand-painted brush-stroke arrow in deep espresso ink — thick, confident, with a clear pronounced arrowhead — sweeping in an elegant S-curve from the inset toward the garment. (4) LOWER-MIDDLE area (clearly above the bottom edge): one small clean sans-serif line reading {FOOTER_LINE} above two official app badges side by side: a black rounded Download on the App Store badge with Apple logo and a black rounded GET IT ON Google Play badge, properly rendered. Cohesive {PALETTE}, poster-level visual hierarchy, perfectly kerned typography, no spelling errors, no watermark, nothing else.`;

// ---------------------------------------------------------------
// Gemini 3.1 Pro — yalnızca slot doldurur, iskelet değişmez
// ---------------------------------------------------------------
async function callGemini(prompt) {
  const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN is not set");

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await axios.post(
        "https://api.replicate.com/v1/models/google/gemini-3.1-pro/predictions",
        { input: { prompt, max_output_tokens: 4096 } },
        {
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          timeout: 180000,
        },
      );
      const data = response.data;
      if (data.error) throw new Error(String(data.error));
      if (data.status !== "succeeded")
        throw new Error(`Prediction status: ${data.status}`);
      let text = "";
      if (Array.isArray(data.output)) text = data.output.join("");
      else if (typeof data.output === "string") text = data.output;
      if (!text.trim()) throw new Error("Empty Gemini response");
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object in Gemini response");
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      lastError = error;
      console.error(`❌ [SOCIAL_GEMINI] Attempt ${attempt}:`, error.message);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastError;
}

function fillSkeleton(skeleton, slots) {
  return skeleton.replace(/\{([A-Z_]+)\}/g, (m, key) =>
    slots[key] != null ? String(slots[key]) : m,
  );
}

// ---------------------------------------------------------------
// Nano Banana Pro — fal.ai (nano-banana-2 fallback'li)
// ---------------------------------------------------------------
async function callFal({ prompt, imageUrls = null, aspectRatio = "4:5", resolution = "2K" }) {
  const FAL_API_KEY = process.env.FAL_API_KEY;
  if (!FAL_API_KEY) throw new Error("FAL_API_KEY is not set");

  const edit = Array.isArray(imageUrls) && imageUrls.length > 0;
  const models = [
    { name: "nano-banana-pro", url: `https://fal.run/fal-ai/nano-banana-pro${edit ? "/edit" : ""}` },
    { name: "nano-banana-2", url: `https://fal.run/fal-ai/nano-banana-2${edit ? "/edit" : ""}` },
  ];

  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`🍌 [SOCIAL_FAL] ${model.name} (${resolution}) attempt ${attempt}`);
        const body = {
          prompt,
          aspect_ratio: aspectRatio,
          resolution,
          output_format: "jpeg",
          num_images: 1,
        };
        if (edit) body.image_urls = imageUrls;
        const response = await axios.post(model.url, body, {
          headers: {
            Authorization: `Key ${FAL_API_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 300000,
        });
        if (response.data.images?.[0]?.url) {
          return { url: response.data.images[0].url, model: model.name };
        }
        throw new Error("No image URL in fal.ai response");
      } catch (error) {
        const errMsg = error.response?.data?.detail || error.message || "unknown";
        console.error(`❌ [SOCIAL_FAL] ${model.name} attempt ${attempt}:`, errMsg);
        const isCapacity =
          typeof errMsg === "string" &&
          (errMsg.includes("E003") || errMsg.includes("unavailable") ||
            errMsg.includes("capacity") || errMsg.includes("overloaded"));
        if (isCapacity) break;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
  throw new Error("All Nano Banana models failed on fal.ai");
}

async function persistImage(falUrl, accountId) {
  const imageResponse = await axios.get(falUrl, {
    responseType: "arraybuffer",
    timeout: 120000,
  });
  const buffer = Buffer.from(imageResponse.data);
  const path = `${accountId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: "image/jpeg", upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  const { data: urlData } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return { publicUrl: urlData.publicUrl, storagePath: path };
}

// Geçmiş post özetlerinden anti-tekrar bloğu üret
function buildHistoryBlock(history) {
  if (!history || history.length === 0) return "";
  return `
RECENT POSTS HISTORY (most recent first) — these were already published:
${history.map((h, i) => `${i + 1}. ${h}`).join("\n")}

ANTI-REPETITION RULES (mandatory):
- Do NOT reuse any masthead wording from the history.
- The model's look (hair color/length, ethnicity vibe, styling) must clearly differ from the most recent posts.
- The garment type, its color, the setting/location and the overall palette must all be clearly different from the last few posts.
- If this feature appeared in the history before, this new post must feel like a completely different campaign for the same feature.`;
}

// Palet çeşitliliği zorunluluğu — kullanıcı geri bildirimi: AI sürekli
// "golden hour / warm gold / champagne" tonuna kayıyor. Bunu yasakla, her
// posta belirgin farklı bir ışık & renk dünyası kurdur.
const PALETTE_DIVERSITY = `LIGHTING & PALETTE DIVERSITY (mandatory): Do NOT default to golden hour, warm gold tones, champagne or amber palettes — these are overused. Deliberately pick a DISTINCT lighting+color world for this post, varying widely across posts: e.g. crisp cool daylight, bright high-key white studio, moody low-key dramatic shadow, fresh pastel, bold high-contrast color-pop, clean blue-hour twilight, overcast soft grey, vivid editorial saturation. Choose whatever best fits this specific garment and scene — but it must clearly differ from a warm/golden look.`;

// ---------------------------------------------------------------
// Şablon 1: feature_spotlight (tek atış, 4K) + 9:16 story varyantı
// ---------------------------------------------------------------
async function generateSpotlight(account, feature, history = []) {
  const slotPrompt = `You are the creative director for "${account.name}", an AI fashion photoshoot app. We produce Instagram posters with a FIXED, proven design system. Your ONLY job is to fill the variable slots below for a poster showcasing this app feature — you do NOT design the layout, it is locked.

APP FEATURE TO SHOWCASE:
Name: ${feature.name}
What it does: ${feature.description}
Marketing angle: ${feature.angle}
${feature.sideCards ? `Side cards concept: ${feature.sideCards}` : ""}
${feature.mastheadIdeas ? `Masthead suggestions (pick one or invent a better 2-3 word one in the same spirit): ${feature.mastheadIdeas.join(", ")}` : ""}

BRAND: ${account.brand_persona || "Premium AI fashion photoshoot app for e-commerce sellers."}
${buildHistoryBlock(history)}

Vary the product, model and scene — be inventive with garments (chic designer pieces only: tailored suits, satin dresses, linen sets, cashmere coats...), locations and palettes.
${PALETTE_DIVERSITY}

Reply with ONLY a JSON object, no markdown fences, exactly these keys:
{
  "HERO_SCENE": "one rich sentence: an elegant female model wearing [specific chic garment] in [specific striking location/setting] with [specific lighting that is NOT golden hour], describing fabric behaviour and mood",
  "MASTHEAD": "the chosen 2-3 word headline in CAPS, e.g. ANY LOCATION",
  "MASTHEAD_COLOR": "a cream/ivory/white/charcoal tone that contrasts the scene",
  "SIDE_CARDS_BLOCK": "ONE complete sentence starting with 'LEFT SIDE:' or 'RIGHT SIDE:' describing the small rounded cards with thin white borders and soft shadows that visualize the feature variants (same model/garment, different [feature variable]), each with tiny clean caps labels — follow the side cards concept above",
  "FOOTER_LINE": "a punchy 4-7 word feature benefit line ending with a period",
  "PALETTE": "a DISTINCT cohesive palette for THIS post — NOT warm/golden by default (e.g. cool daylight neutrals, high-key white, bold color-pop, moody charcoal, fresh pastel)",
  "caption": "Instagram caption in ${account.language || "en"}: hook first line about this feature, 2-4 short lines, subtle CTA to try the app, then blank line and 8-12 relevant hashtags"
}`;

  const slots = await callGemini(slotPrompt);
  const allSlots = { ...slots, FEATURE_NAME: feature.name.toUpperCase() };
  const finalPrompt = fillSkeleton(SPOTLIGHT_SKELETON, allSlots);
  const storyPrompt = fillSkeleton(SPOTLIGHT_STORY_SKELETON, allSlots);
  console.log(`🎨 [SOCIAL_GEN] Spotlight prompt ready (${feature.key})`);

  // 4:5 post + 9:16 story aynı kurguyla
  const image = await callFal({ prompt: finalPrompt, aspectRatio: "4:5", resolution: "4K" });
  const stored = await persistImage(image.url, account.id);

  let story = null;
  try {
    const storyImage = await callFal({ prompt: storyPrompt, aspectRatio: "9:16", resolution: "4K" });
    story = await persistImage(storyImage.url, account.id);
  } catch (e) {
    console.error("⚠️ [SOCIAL_GEN] Story variant failed (post devam ediyor):", e.message);
  }

  return {
    imagePrompt: finalPrompt,
    caption: slots.caption,
    imageUrl: stored.publicUrl,
    storagePath: stored.storagePath,
    storyImageUrl: story?.publicUrl || null,
    storyStoragePath: story?.storagePath || null,
    meta: {
      template: "feature_spotlight",
      feature_key: feature.key,
      image_model: image.model,
      text_model: "google/gemini-3.1-pro",
      // Çeşitlilik hafızası: sonraki üretimlerde Gemini'ye "tekrarlama" diye verilir
      summary: `${feature.key} — masthead "${slots.MASTHEAD}"; hero: ${String(slots.HERO_SCENE || "").slice(0, 160)}; palette: ${slots.PALETTE}`,
    },
  };
}

// ---------------------------------------------------------------
// Şablon 2: before_after (3 adımlı zincir)
// ---------------------------------------------------------------
async function generateBeforeAfter(account, feature, history = []) {
  const slotPrompt = `You are the creative director for "${account.name}", an AI fashion photoshoot app. We produce a 3-step BEFORE/AFTER Instagram poster with a FIXED, proven design system (amateur photo → editorial photo → poster). Your ONLY job is to fill the variable slots — the layout language is locked.

FEATURE: ${feature.name} — ${feature.description}
ANGLE: ${feature.angle}
BRAND: ${account.brand_persona || "Premium AI fashion photoshoot app for e-commerce sellers."}
${buildHistoryBlock(history)}

Pick a CHIC designer-quality garment (vary it widely: emerald tailored suit, scarlet silk dress, ivory linen set, black evening dress, cobalt knit, blush trench...) and a fitting editorial scene.
${PALETTE_DIVERSITY}

Reply with ONLY a JSON object, no markdown fences, exactly these keys:
{
  "CHIC_PRODUCT": "the garment with rich fabric/color/cut detail, e.g. an ELEGANT scarlet red silk-chiffon midi dress with a soft v-neckline and gathered waist",
  "AMATEUR_SCENE": "where the bad photo is taken, e.g. on a wooden hanger hooked over a plain white wardrobe door in an ordinary apartment",
  "PRODUCT_SHORT": "short product name, e.g. scarlet red silk-chiffon midi dress",
  "POSE_DIRECTIVE": "a specific dynamic editorial pose tailored to THIS garment showing fabric behaviour, e.g. relaxed contrapposto with a gentle shoulder turn and one arm softly raised, fabric fluidly draping along the hip line",
  "EDITORIAL_SETTING": "studio/location + a DISTINCT lighting scenario that is NOT golden hour (vary it: crisp cool daylight, high-key white studio, moody low-key shadow, bright color-pop backdrop...), e.g. a minimalist white seamless studio with clean bright daylight and soft even shadows",
  "MASTHEAD": "2-3 word CAPS headline about the transformation, e.g. AI PHOTOSHOOT",
  "MASTHEAD_COLOR": "a cream/ivory/white/charcoal tone that contrasts the scene",
  "FOOTER_LINE": "short punchy line, e.g. Your product. Studio quality. 30 seconds.",
  "PALETTE": "a DISTINCT cohesive palette for THIS post — NOT warm/golden by default",
  "caption": "Instagram caption in ${account.language || "en"}: hook about the transformation, 2-4 short lines, subtle CTA, blank line, 8-12 hashtags"
}`;

  const slots = await callGemini(slotPrompt);

  // Adım 1: amatör ürün fotoğrafı
  const amateurPrompt = fillSkeleton(BA_STEP1_SKELETON, slots);
  const amateur = await callFal({ prompt: amateurPrompt, aspectRatio: "3:4", resolution: "1K" });
  console.log(`📷 [SOCIAL_GEN] BA step1 done (${feature.key})`);

  // Adım 2: editorial çekim (amatör referansla)
  const editorialPrompt = fillSkeleton(BA_STEP2_SKELETON, slots);
  const editorial = await callFal({
    prompt: editorialPrompt,
    imageUrls: [amateur.url],
    aspectRatio: "4:5",
    resolution: "2K",
  });
  console.log(`📸 [SOCIAL_GEN] BA step2 done`);

  // Adım 3: poster kompozisyonu (iki görselle, 4K)
  const posterPrompt = fillSkeleton(BA_STEP3_SKELETON, slots);
  const poster = await callFal({
    prompt: posterPrompt,
    imageUrls: [amateur.url, editorial.url],
    aspectRatio: "4:5",
    resolution: "4K",
  });
  console.log(`🖼️ [SOCIAL_GEN] BA step3 done`);

  const stored = await persistImage(poster.url, account.id);

  // Story varyantı: aynı iki kaynaktan 9:16 kompozisyon
  let story = null;
  try {
    const storyPrompt = fillSkeleton(BA_STEP3_STORY_SKELETON, slots);
    const storyImage = await callFal({
      prompt: storyPrompt,
      imageUrls: [amateur.url, editorial.url],
      aspectRatio: "9:16",
      resolution: "4K",
    });
    story = await persistImage(storyImage.url, account.id);
  } catch (e) {
    console.error("⚠️ [SOCIAL_GEN] BA story variant failed (post devam ediyor):", e.message);
  }

  return {
    imagePrompt: posterPrompt,
    caption: slots.caption,
    imageUrl: stored.publicUrl,
    storagePath: stored.storagePath,
    storyImageUrl: story?.publicUrl || null,
    storyStoragePath: story?.storagePath || null,
    meta: {
      template: "before_after",
      feature_key: feature.key,
      image_model: poster.model,
      text_model: "google/gemini-3.1-pro",
      intermediate: { amateur: amateur.url, editorial: editorial.url },
      summary: `${feature.key} — masthead "${slots.MASTHEAD}"; product: ${String(slots.PRODUCT_SHORT || "").slice(0, 100)}; setting: ${String(slots.EDITORIAL_SETTING || "").slice(0, 120)}; palette: ${slots.PALETTE}`,
    },
  };
}

// ---------------------------------------------------------------
// Ana giriş: özelliğe göre şablon seç ve üret
// history: son postların meta.summary listesi (anti-tekrar için)
// ---------------------------------------------------------------
async function generatePostContent(account, feature, history = []) {
  const startedAt = Date.now();
  const result =
    feature.template === "before_after"
      ? await generateBeforeAfter(account, feature, history)
      : await generateSpotlight(account, feature, history);
  result.meta.generation_ms = Date.now() - startedAt;
  return result;
}

module.exports = { generatePostContent, persistImage, callFal, callGemini };
