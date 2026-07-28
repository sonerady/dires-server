// ───────────────────────────────────────────────────────────────────────────
// 🎬 Style Profiles — kullanıcı tanımlı marka stil presetleri
//
// Kullanıcı, beğendiği marka çekimlerinden (ör. Bershka/Zara) EN AZ 3 fotoğraf
// yükleyip isimli bir stil profili oluşturur. Gemini tüm fotoğraflara bakarak
// ortak estetiği anlatan bir "stil profili promptu" çıkarır. Fotoğraf her
// eklendiğinde/çıkarıldığında prompt TÜM fotoğraflar üzerinden yeniden üretilir.
//
// Üretim tarafında (referenceBrowserRoutesV7 /generate, styleProfileId parametresi)
// profildeki fotoğraflar tek bir grid'e birleştirilir, altına "STYLE REFERENCE ·
// CODE SR-1" kod plakası basılır ve stil referansı olarak nano-banana'ya gider —
// fotoğraflardaki kişilerin yüzleri/kimlikleri asla kopyalanmaz.
// ───────────────────────────────────────────────────────────────────────────

const { createStyleProfileRouter } = require("./styleProfileRouterFactory");

// Model/moda çekimi alanı — CreateModelPhotoScreen akışı.
const STYLE_ANALYSIS_PROMPT = `You are a senior fashion photography art director and director of photography. The attached images are ONLY EXAMPLES of a brand aesthetic the user loves — mood boards, not blueprints. Analyze ALL of them together and write a compact, TECHNICALLY PRECISE STYLE PROFILE that captures the SHARED photographic language, so an AI image model can reproduce this aesthetic in BRAND-NEW photos with DIFFERENT locations and without copying incidental props.

Describe, in confident cinematographer language with concrete estimates:
1. CAMERA & CAPTURE DEVICE — FIRST name the capture device, because it changes everything downstream. Decide from the evidence and say it outright: modern smartphone (and which family it looks like — "iPhone-style computational capture", "Android flagship") / professional mirrorless or DSLR / compact point-and-shoot / analog 35mm film / medium format. Justify it in a few words from what you can actually see: ultra-wide edge stretch, HDR-flattened shadows and over-recovered highlights, phone-style face smoothing, direct on-phone flash falloff, the tiny-sensor look of deep focus, or conversely true optical bokeh, medium-format tonal roll-off, film grain and halation. If it reads as a phone shot — casual street/mirror/selfie energy, wide lens close to the subject — SAY it is a phone shot and name the phone-camera characteristics; do not dress it up as a studio camera. Then give estimated focal length in mm (e.g. "50mm", "85mm compression"), estimated aperture and depth-of-field behavior (e.g. "f/2 with melted background" vs "f/8 everything crisp"), camera height and angle relative to the subject (eye-level / low-angle / high-angle, frontal vs three-quarter), lens character (compression, distortion, close vs distant feel).
2. FRAMING & COMPOSITION — crop habits (full-body / three-quarter / waist-up), headroom and negative space usage, centered vs rule-of-thirds, vertical/horizontal bias.
3. LIGHTING RECIPE — key light direction and quality (hard/soft), fill behavior and shadow density, rim/back light if any, natural vs studio, time-of-day feel, how shadows fall on the background.
4. COLOR GRADE / PRESET RECIPE — if a filter or preset is clearly applied, IDENTIFY IT BY NAME and then give its recipe. Use the real vocabulary of the ecosystem it comes from and pick the closest match rather than staying vague: VSCO (A6, C1, F2, HB1, M5, KP9…), Lightroom/film emulations (Kodak Portra 400, Gold 200, Fuji 400H, Cinestill 800T, Ilford HP5), phone-native looks (iPhone Photographic Styles, "Vivid Warm", Instagram-era filters). Write it as "closest to <name>" — never claim certainty you do not have — and if nothing matches, say "no filter preset, straight capture" and move on. Then ALWAYS give the recipe in adjustable terms so it can be rebuilt without the preset: palette, saturation level, contrast curve (lifted blacks? crushed?), highlight roll-off, shadow tint and highlight tint (e.g. "green-teal shadows, warm cream highlights"), white balance bias in plain words, grain amount and size, and any halation, bloom, vignette or faded-matte treatment.
5. LOCATIONS / SET DESIGN — describe ONLY the FAMILY of environments as a broad category (e.g. "urban street / outdoor city", "indoor loft", "minimal studio"). NEVER name or describe a specific pictured street, building, shopfront, room, or backdrop. Explicitly write that new photographs MUST invent a DIFFERENT location within that same family — matching the vibe/architecture character/surfaces, but never rebuilding any sample set. STUDIO / PLAIN-SET EXCEPTION (apply it generously): if the frames share a plain, featureless backdrop — a seamless studio, a blank white/neutral wall with a plain floor, a bare minimal room with no distinguishing architecture — then that set IS the style: describe it as repeatable AS-IS and state that the same flat, empty backdrop must be reproduced, with no columns, mouldings, windows, doorways, furniture or added room depth.
6. POSING & ATTITUDE — this is what gets lost most often, so be precise, but describe a RANGE, not a single pose. Cover: (a) the ENERGY/ATTITUDE in plain words, this is the most important part (e.g. "cheeky, bratty, playful teen energy", "cool detached stillness", "warm candid laughter"); (b) the body-language rules — how loose the stance and weight shift are, whether hands stay busy/engaged or hang, movement vs stillness, head-tilt and shoulder habits, gaze style; (c) the POSE VOCABULARY this concept allows, phrased as a range of options rather than one instruction (e.g. "hands often engaged — reaching into the hair, tucked in pockets, resting on the hip — never rigid at the sides"). Explicitly separate SIGNATURE from ONE-OFF: only call a gesture a signature if it recurs across most frames; if a striking gesture appears in a single frame, say that it is one example of the allowed range and that new shoots should vary it rather than repeat it. Write it as a directive an image model can copy, not as an observation.
7. OVERALL MOOD — the emotional signature in a few words.

⚠️ THIS IS A REUSABLE TEMPLATE — READ BEFORE WRITING:
The profile you write will be applied to SOMEONE ELSE'S products. The garments, bags, jewellery and accessories visible in the attached frames are NOT part of the style and will NOT be in the final photo. If you describe them, you overwrite the user's own product and the template is ruined. Write ONLY the photographic recipe: camera, framing, light, grade, set family, posing energy. Never name, describe, colour-match or imply any garment, product, accessory or prop.
The same rule covers WHO is in the frame. The style will be reused with people of ANY gender and ANY age — the app lets the user pick both — so the profile must never lock either one in. Write "the subject", "the person", "people" and use they/them. Words like woman, man, female, male, girl, boy, lady, guy, young, teen, mature, 20s, child are FORBIDDEN anywhere in the output, and so is any pronoun that implies one (she/he/her/his). Describe camera height and framing in measurable terms (eye-level, low-angle, waist-up) rather than by who is standing there.

The ONLY wardrobe-related thing you may state is a COVERAGE CONVENTION that is consistent across every frame and defines the concept (for example: modest styling — shoulders, arms and hair fully covered). Write it as a coverage rule to respect, never as a garment description, and only when it clearly holds in all frames.

STRICT RULES:
- The attached images are EXAMPLES ONLY. Locations, backgrounds and props in them are illustrative, not mandatory.
- NEVER mention one-off incidental objects from individual frames (motorcycle, scooter, parked car, bicycle, signage, specific chair, plant, graffiti, storefront details, etc.). Those are coincidences of that shoot, NOT part of the style. Do not list them even as "avoid".
- Do NOT describe or reference any person's face, identity, ethnicity, gender, age or recognizable features. This is a hard rule: a single "young woman" locks the template to one audience and breaks it for everyone else.
- Do NOT describe specific garments, products, accessories, bags, jewellery, eyewear or their colours — only the photographic style. This rule outranks every other instruction above.
- Prefer concrete numeric estimates over vague adjectives whenever the images support them.
- The capture device and the preset name are HIGH-VALUE details — a phone-shot street look rebuilt as a studio camera shot, or a heavily graded frame rebuilt clean, both miss the style completely. Commit to a call in section 1 and section 4; "closest to" is enough, silence is not.
- End section 5 with this exact sentence when the setting is NOT a plain studio/blank backdrop: "New shoots must use a different location from any sample frame, within the same environment family."
- After section 7, output ONE final line, exactly one of these two machine markers (no other text on that line):
  "ENVIRONMENT_LOCK: STUDIO"  → the frames share a plain studio / blank wall / featureless minimal set that must be reproduced as-is;
  "ENVIRONMENT_LOCK: VARY"    → the frames share a real-world environment family whose specific place must be reinvented.
- Output PLAIN TEXT only, 200-340 words, no headings other than the numbered labels above, no markdown.`;

module.exports = createStyleProfileRouter({
  table: "style_profiles",
  storagePrefix: "style_profile_",
  analysisPrompt: STYLE_ANALYSIS_PROMPT,
  subjectLabel: "fashion photoshoot images",
});
