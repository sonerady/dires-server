// 🎬 Video stüdyosu "skill" kartları (23 Eyl 2026) — Designkit /skills "Video creation"
// setinin e-ticarete uyarlanmış hâli: satış videosu, remix, UGC, yakın plan, 360°,
// reklam. /api/generateImgToVidv2 `skill` + `skillInputs` gelince bu modül Gemini
// yönetmen talimatını kurar; her zaman Seedance reference-to-video (ürün görselleri
// @Image1..N, remix'te referans video @Video1). Ses fal'da ek ücretsiz → sesli
// kartlarda seslendirme SEÇİLEN DİLDE yazdırılır (Seedance dudak senkronlu konuşur).
// Client karşılığı: client/utils/videoSkills.js — id/seçenek eklersen İKİSİNE de.

// 🎯 23 Eyl 2026 kalite yükseltmesi: kart örnekleri (server/scripts/gen-video-skill-cards.cjs)
// el yazımı, NUMARALI çekim listesi + sabit stil bloğu kalıbıyla çok iyi sonuç verdi. Üretim hattı
// artık aynı kalıbı izler: `craft` Gemini'ye yönetmen kuralı, `suffix` Seedance promptunun sonuna
// DEĞİŞMEDEN eklenen kalite kilidi (Gemini ne yazarsa yazsın görünüm tutarlı kalır).
const UGC_REALISM = "Handheld with natural micro-shake and slightly imperfect framing, phone auto-exposure, realistic skin texture with no retouching, ordinary lived-in background, no cinematic color grading, no studio lighting — it must feel like a real TikTok creator clip filmed on a phone, not an ad.";

const SKILLS = {
  sales: {
    maxImages: 9,
    concept: "A short, high-converting PRODUCT SALES VIDEO for social commerce: scroll-stopping hook, clear product proof and benefits, a satisfying hero moment at the end.",
    craft: "Fast rhythmic cuts. Shot 1 is the hook (a satisfying physical action with the product: a drop-in landing, a splash, a snap into frame, a before→after reveal). Middle shots show the product IN USE in a real, bright, aspirational setting and one snap close-up of the key material/detail. The last shot is a clean hero shot of the product on a simple plinth or surface. FASHION RULE (apparel, shoes, bags, jewelry, accessories): shoot it as a LUXURY FASHION-HOUSE CAMPAIGN FILM instead — a striking fictional editorial model WEARS/CARRIES the product in a grand, art-directed location (palazzo hall, marble staircase, sculptural modern architecture, velvet drapes), slow-motion confident walk, fabric moving like liquid, an intimate detail close-up, a held editorial pose to end; bold art direction, rich film color, dramatic window light. NEVER a mannequin, hanger or the garment dropping onto a pedestal.",
    suffix: "Energetic, premium, modern commercial look; crisp natural daylight; beat-synced cuts; the product is sharp and clearly visible in every shot; ends on a clean hero shot.",
  },
  remix: {
    maxImages: 9,
    concept: "A VIDEO REMIX: recreate the reference video @Video1 — its structure, shot order, pacing, camera moves, transitions and energy — but starring the seller's product.",
    craft: "Mirror @Video1 beat-for-beat: same number of shots, same order, same transition types at the same moments, same framing and camera moves. Only swap the product (and use different fictional people/settings).",
    suffix: "Match the reference's timing, transitions and camera language beat-for-beat.",
  },
  ugc: {
    maxImages: 5,
    concept: "An authentic UGC-style product video: a relatable creator films themself on a phone and talks about the product naturally, like a real customer.",
    craft: "One or two continuous selfie takes (front camera) or a mirror selfie, casual and unscripted: the creator holds the product close to the lens, actually uses it (apply, wear, sip, put on), reacts genuinely, then shows it to camera again. Real home/commute/bathroom locations, window daylight. Never polished.",
    suffix: UGC_REALISM,
  },
  closeup: {
    maxImages: 5,
    concept: "PRODUCT CLOSE-UPS: macro shots that showcase details, texture, material and craftsmanship with light gliding across surfaces, shallow depth of field.",
    craft: "3–4 extreme macro shots, each with one slow deliberate camera move (slide, push-in, rack focus), light sweeping across the surface, tiny tactile moments (a fingertip tracing, liquid refracting, droplets, dust in a light beam).",
    suffix: "Extreme macro, shallow depth of field, slow smooth camera slides and rack focus, light gliding across the material; elegant, tactile, high-end.",
  },
  spin360: {
    maxImages: 8,
    concept: "A complete 360° PRODUCT VIEW: the product rotates smoothly a full turn so every side is clearly visible; evenly lit, stable framing, marketplace-ready.",
    craft: "A single continuous shot, no cuts: the product rotates exactly one full turn on an invisible turntable or a simple pedestal, centered, the camera locked off.",
    suffix: "Exactly one smooth full rotation, locked-off centered camera, soft even studio light with a subtle floor shadow, every side clearly visible, no cuts, no people.",
  },
  commercial: {
    maxImages: 9,
    concept: "A polished PRODUCT COMMERCIAL: cinematic brand-quality production, a clear story arc and a strong hero ending.",
    craft: "A mini brand film with a clear arc: an atmospheric establishing moment, a slow-motion signature moment with the product (pour, drop, reveal, unboxing, first use), a human touch (hands, a person using it) and a serene hero shot to close.",
    suffix: "Cinematic brand-film look, soft natural light, slow-motion signature moment, refined color, strong final hero shot of the product.",
  },
};

// Süreye göre çekim sayısı (örneklerde 5 sn ≈ 3–4 çekim en iyi sonucu verdi)
const shotsFor = (skill, duration) => {
  if (skill === "spin360") return "1 continuous shot";
  if (skill === "ugc") return duration >= 10 ? "2–3 casual takes with jump cuts" : "1–2 casual takes";
  if (duration <= 5) return "3–4 shots";
  if (duration <= 10) return "4–5 shots";
  return "5–6 shots";
};

const OPTIONS = {
  tone: {
    performance_ad: "Performance ad: benefit-first, fast and persuasive, built to convert.",
    lifestyle_story: "Lifestyle story: the product naturally woven into an aspirational everyday moment.",
    internet_drama: "Internet drama: a short relatable mini-drama where the product saves the moment.",
    meme_humor: "Meme humor: playful, self-aware internet humor — funny, but the product still shines.",
    plot_twist: "Plot twist: set up an expectation, then reveal the product as the surprising twist.",
  },
  hook: {
    auto: null,
    question: "Open with a direct question the target buyer relates to.",
    problem_solution: "Open on the everyday PROBLEM, then cut to the product solving it.",
    before_after: "Open with a striking before → after contrast.",
    bold_claim: "Open with a bold, confident visual statement of the key benefit (no false claims).",
    surprising_visual: "Open with a surprising, unexpected visual that makes people stop scrolling.",
    social_proof: "Open like a trusted recommendation — someone excitedly showing a product they love.",
  },
  platform: {
    tiktok: "Native TikTok feel: vertical, fast cuts, energetic, creator-like.",
    reels: "Instagram Reels feel: polished but native, aesthetic, rhythmic cuts.",
    shorts: "YouTube Shorts feel: clear, fast, value-packed.",
    amazon: "Marketplace-safe (Amazon): honest, clean, product-focused, no exaggerated claims.",
    trendyol: "Marketplace-safe (Trendyol/Hepsiburada): clear product focus, honest and clean.",
    shopify: "Online-store hero video: premium and brand-like.",
    etsy: "Etsy feel: handmade, warm, crafted, natural light.",
    meta_ads: "Facebook/Instagram ad: hook in the first second, benefit clarity, strong ending.",
  },
  ugcStyle: {
    review: "Honest review: the creator tries the product and shares genuine impressions.",
    unboxing: "Unboxing: the creator opens the package and reacts to the first look.",
    grwm: "Get-ready-with-me: the product is used as part of a daily routine.",
    tutorial: "Quick tutorial: the creator shows how to use the product step by step.",
    testimonial: "Testimonial: the creator explains how the product changed their day.",
  },
  presenterGender: { auto: null, woman: "a woman", man: "a man" },
  presenterAge: { auto: null, young: "in their early twenties", adult: "in their thirties", mature: "in their fifties" },
  focus: {
    texture: "surface texture", material: "material quality", stitching: "stitching and seams",
    shine: "shine, sparkle and reflections", mechanism: "moving parts and mechanisms", packaging: "packaging details",
  },
  background: {
    white: "a pure seamless white backdrop",
    gradient: "a soft studio gradient backdrop in a tone that complements the product",
    styled: "a tasteful styled scene that fits the product",
  },
  spinSpeed: { slow: "a slow, elegant rotation", normal: "a steady, natural rotation speed" },
  adType: {
    brand_tvc: "Brand TVC: cinematic, emotional, premium brand film.",
    unboxing: "Unboxing: hands open clean packaging and reveal the product, then a hero shot.",
    reaction: "Reaction: a person's genuine delighted reaction to trying the product.",
    feature_demo: "Feature demo: clearly demonstrate the key features in action.",
  },
  remixKeep: {
    pacing: "pacing and rhythm", camera: "camera moves and framing", scene: "setting and scene",
    transitions: "transitions and cuts", mood: "mood and color grade",
  },
};

// Seslendirme dilleri = uygulamanın 70 dili (client/constants/languages.js, Ayarlar listesi)
const LANGUAGES = {
  af: "Afrikaans",
  az: "Azerbaijani",
  id: "Indonesian",
  ms: "Malay",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  et: "Estonian",
  en: "English",
  es: "Spanish",
  eu: "Basque",
  fil: "Filipino",
  fr: "French",
  gl: "Galician",
  hr: "Croatian",
  is: "Icelandic",
  it: "Italian",
  zu: "Zulu",
  sw: "Swahili",
  lv: "Latvian",
  lt: "Lithuanian",
  hu: "Hungarian",
  nl: "Dutch",
  no: "Norwegian",
  uz: "Uzbek",
  pl: "Polish",
  pt: "Portuguese",
  ro: "Romanian",
  rm: "Romansh",
  sk: "Slovak",
  sl: "Slovenian",
  fi: "Finnish",
  sv: "Swedish",
  vi: "Vietnamese",
  tr: "Turkish",
  el: "Greek",
  be: "Belarusian",
  bg: "Bulgarian",
  ky: "Kyrgyz",
  mk: "Macedonian",
  mn: "Mongolian",
  ru: "Russian",
  sr: "Serbian",
  uk: "Ukrainian",
  kk: "Kazakh",
  hy: "Armenian",
  he: "Hebrew",
  ar: "Arabic",
  fa: "Persian",
  ur: "Urdu",
  am: "Amharic",
  hi: "Hindi",
  mr: "Marathi",
  ne: "Nepali",
  bn: "Bengali",
  pa: "Punjabi",
  gu: "Gujarati",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  si: "Sinhala",
  th: "Thai",
  lo: "Lao",
  km: "Khmer",
  ka: "Georgian",
  zh: "Mandarin Chinese",
  ja: "Japanese",
  ko: "Korean",
  "pt-BR": "Brazilian Portuguese",
};

const str = (v, max) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const pickOne = (map, v, def = null) => (Object.prototype.hasOwnProperty.call(map, v) ? v : def);
const pickMany = (map, v) => (Array.isArray(v) ? [...new Set(v.filter((x) => Object.prototype.hasOwnProperty.call(map, x)))] : []);

/** İstemciden gelen skill + girdileri beyaz listeyle temizler; bilinmeyen skill → null */
function sanitizeSkill(skill, raw = {}) {
  if (!Object.prototype.hasOwnProperty.call(SKILLS, skill)) return null;
  const i = raw && typeof raw === "object" ? raw : {};
  return {
    skill,
    productName: str(i.productName, 120),
    sellingPoints: str(i.sellingPoints, 300),
    notes: str(i.notes, 500),
    tone: pickOne(OPTIONS.tone, i.tone),
    hook: pickOne(OPTIONS.hook, i.hook, "auto"),
    platform: pickOne(OPTIONS.platform, i.platform),
    ugcStyle: pickOne(OPTIONS.ugcStyle, i.ugcStyle),
    presenterGender: pickOne(OPTIONS.presenterGender, i.presenterGender, "auto"),
    presenterAge: pickOne(OPTIONS.presenterAge, i.presenterAge, "auto"),
    focus: pickMany(OPTIONS.focus, i.focus),
    background: pickOne(OPTIONS.background, i.background),
    spinSpeed: pickOne(OPTIONS.spinSpeed, i.spinSpeed),
    adType: pickOne(OPTIONS.adType, i.adType),
    remixKeep: pickMany(OPTIONS.remixKeep, i.remixKeep),
    voiceLanguage: pickOne(LANGUAGES, i.voiceLanguage, null),
    // Varyasyon sırası (0–2): aynı brief'ten farklı kanca/konsept (A/B testi)
    variantIndex: Math.max(0, Math.min(2, Number.isInteger(i.variantIndex) ? i.variantIndex : 0)),
  };
}

function briefLines(s, { audio, duration, imageCount }) {
  const lines = [SKILLS[s.skill].concept];
  if (s.productName) lines.push(`Product: ${s.productName}.`);
  if (s.sellingPoints) lines.push(`Key selling points to show (never invent others): ${s.sellingPoints}.`);
  if (s.tone) lines.push(OPTIONS.tone[s.tone]);
  if (s.hook && OPTIONS.hook[s.hook]) lines.push(`HOOK (first 1–2 seconds): ${OPTIONS.hook[s.hook]} The first frame must make sense with the sound off.`);
  if (s.platform) lines.push(OPTIONS.platform[s.platform]);
  if (s.ugcStyle) lines.push(OPTIONS.ugcStyle[s.ugcStyle]);
  if (s.skill === "ugc") {
    const who = [OPTIONS.presenterGender[s.presenterGender], OPTIONS.presenterAge[s.presenterAge]].filter(Boolean).join(" ");
    lines.push(`Presenter: ${who || "a relatable creator who fits the product's target buyer"}; a fictional person, filmed selfie-style on a phone, natural home light.`);
  }
  if (s.adType) lines.push(OPTIONS.adType[s.adType]);
  if (s.focus.length) lines.push(`Focus the close-ups on: ${s.focus.map((f) => OPTIONS.focus[f]).join(", ")}.`);
  if (s.background) lines.push(`Background: ${OPTIONS.background[s.background]}.`);
  if (s.spinSpeed) lines.push(`Rotation: ${OPTIONS.spinSpeed[s.spinSpeed]}.`);
  if (s.skill === "spin360" && imageCount > 1) lines.push(`The ${imageCount} reference images are different angles of the SAME product — use them to render every side accurately.`);
  if (s.skill === "remix") {
    lines.push(s.remixKeep.length
      ? `From @Video1 keep especially: ${s.remixKeep.map((k) => OPTIONS.remixKeep[k]).join(", ")}. Never copy its people, logos, text or products.`
      : "Keep the reference's structure and pacing. Never copy its people, logos, text or products.");
  }
  if (s.variantIndex > 0) lines.push(`This is VARIATION ${s.variantIndex + 1} of an A/B test: use a clearly DIFFERENT opening hook, first shot and concept than a standard take — same product and brief.`);
  lines.push(`Total length about ${duration} seconds — pace the beats to fit.`);
  if (audio) {
    const lang = LANGUAGES[s.voiceLanguage] || "English";
    const speaks = ["ugc", "sales", "commercial"].includes(s.skill);
    lines.push(speaks
      ? `SOUND ON: fitting music and sound design, plus 1–3 short natural spoken lines in ${lang} (${s.skill === "ugc" ? "the presenter speaks to camera" : "voiceover or on-camera"}), written in quotes. Benefit-driven, no prices, no discounts, no false claims.`
      : "SOUND ON: fitting music and tactile sound design only — no speech.");
  } else {
    lines.push("Silent visual storytelling — no speech.");
  }
  if (s.notes) lines.push(`Seller notes (any language — keep the intent): ${s.notes}`);
  return lines;
}

function buildSkillGeminiPrompt(s, ctx) {
  return `
You are a senior e-commerce video DIRECTOR writing the prompt for an AI video model (Seedance). READ the product image(s) carefully: what the product is, category, material, color, size and who buys it.

REFERENCES: @Image1${ctx.imageCount > 1 ? `…@Image${ctx.imageCount}` : ""} show the SAME product the seller sells${ctx.imageCount > 1 ? " (different angles/details)" : ""}.${s.skill === "remix" ? " @Video1 is the reference video to remix." : ""} They are often amateur phone photos — build a brand-new professional scene; never reproduce messy original backgrounds.

CREATIVE BRIEF (follow it exactly):
- ${briefLines(s, ctx).join("\n- ")}

DIRECTOR'S CRAFT FOR THIS FORMAT: ${SKILLS[s.skill].craft}

OUTPUT FORMAT (this exact shape works best for the video model):
"<one-line concept for the product>, ${ctx.duration} seconds, <pace>: 1) <shot> 2) <shot> 3) <shot> … <mood words>."
- ${shotsFor(s.skill, ctx.duration)}; each shot = ONE concrete, filmable action + setting + light + camera move, specific to THIS product (material, color, how it is used).
- Choose a real, attractive setting that fits the product and its buyer${s.skill === "spin360" ? " (here: a clean studio backdrop as briefed)" : ""}.${ctx.audio ? "\n- Put the exact spoken lines in quotes in the requested language inside the shots where they are said, plus a short sound-design note." : ""}
- Refer to the product as @Image1${s.skill === "remix" ? " and the reference as @Video1" : ""}.

HARD RULES:
- Output ONLY the prompt text, under 1600 characters.
- Default to bright natural daylight or clean studio light; NO golden-hour, sunset or sunrise glow unless the seller asks for it.
- The product stays identical in every shot: shape, color, material, logo, label, proportions. Never invent features, text, prices or claims.
- No on-screen text, captions, subtitles, watermarks or third-party brand names.
- Any person is fictional. Realistic physics and scale; the product is clearly visible and in focus in the hero moments.
`;
}

function buildSkillFallbackPrompt(s, ctx) {
  return [`Premium e-commerce product video, ${ctx.duration} seconds, ${shotsFor(s.skill, ctx.duration)}.`, ...briefLines(s, ctx), SKILLS[s.skill].craft].join(" ");
}

/** Seedance promptunun sonuna DEĞİŞMEDEN eklenen kalite kilidi (kart örneklerinin stil bloğu) */
const skillStyleSuffix = (s) => SKILLS[s.skill].suffix;

function skillIdentityClause(s, imageCount) {
  return (
    `The product is the exact item shown in @Image1${imageCount > 1 ? `–@Image${imageCount} (same product, different views)` : ""}` +
    " — keep its shape, color, material, logo, label and proportions identical in every shot. Ignore the backgrounds of the reference photos." +
    (s.skill === "remix" ? " Use @Video1 only for structure, pacing, camera and transitions — never its people, products, logos or text." : "") +
    " No on-screen text, no subtitles, no added logos or brand names."
  );
}

module.exports = { SKILLS, sanitizeSkill, buildSkillGeminiPrompt, buildSkillFallbackPrompt, skillIdentityClause, skillStyleSuffix, LANGUAGES };
