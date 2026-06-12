// Social Studio — Diress özellik kataloğu + rotasyon
// Kaynak: client/screens taraması (CreatePhotoshootScreen, ChangeModelPose,
// ChangeProductColor, ClosetBackSide, VideoUpload, Refiner, Jewelry, BodyShape,
// hair style/color modülleri) + paywall/onboarding feature metinleri.
//
// Her özellik, Gemini'nin DOLDURACAĞI değişken slotları tarif eder; tasarım
// dilinin kendisi contentGenerator'daki kilitli şablondadır ve değişmez.

const FEATURES = [
  {
    key: "on_model",
    name: "See Product on Model",
    template: "before_after",
    description:
      "Core feature: user uploads a plain amateur product photo (garment on a hanger / flat-lay) and Diress dresses it on a photorealistic AI model in a professional photoshoot, preserving the garment exactly.",
    angle:
      "The magic transformation moment — from a bad phone photo to a campaign-ready editorial shot of the SAME garment.",
  },
  {
    key: "locations",
    name: "Location Selection (100+ AI Backgrounds)",
    template: "feature_spotlight",
    description:
      "User picks the photoshoot location/background from 100+ options: studio, city streets (Paris, NYC), beach, Mediterranean terrace, luxury interior, nature... The same outfit can be shot anywhere in the world.",
    angle:
      "One product photo, every destination — show the SAME outfit/model in multiple iconic locations via side cards.",
    sideCards:
      "three small location cards showing the SAME model in the SAME outfit in different scenes (e.g. STUDIO, PARIS, BEACH), each with a tiny clean caps label",
    mastheadIdeas: ["ANY LOCATION", "SHOT ANYWHERE", "EVERY CITY"],
  },
  {
    key: "product_color",
    name: "Product Color Change",
    template: "feature_spotlight",
    description:
      "User recolors the product in one tap — generate the same garment in any colorway without re-shooting. Great for stores selling multiple color variants.",
    angle:
      "Same garment, full color range — hero in one bold colorway, side strip showing the EXACT same garment in 3-4 other colorways plus round color-picker swatch dots with one marked selected.",
    sideCards:
      "a vertical strip of small cards showing the EXACT SAME garment on a hanger in different colorways, beside a neat vertical row of small round color swatch dots with one marked selected by a subtle ring",
    mastheadIdeas: ["EVERY COLOR", "ANY SHADE", "FULL PALETTE"],
  },
  {
    key: "hair",
    name: "Hair Style & Hair Color",
    template: "feature_spotlight",
    description:
      "User changes the AI model's hair style (bob, sleek straight, curly updo, waves...) and hair color (platinum, copper, black, honey...) to match the brand's audience.",
    angle:
      "Beauty-editorial portrait energy — hero with striking hair, side cards showing the SAME model with different hairstyles, small hair-color swatch dots.",
    sideCards:
      "three small portrait cards showing the SAME model in the SAME top with different hairstyles (each with a tiny caps label like BOB, SLEEK, CURLY) and below them a small row of round hair-color swatch dots",
    mastheadIdeas: ["ANY HAIR", "EVERY STYLE", "HAIR YOUR WAY"],
  },
  {
    key: "pose",
    name: "Pose & Angle Control",
    template: "feature_spotlight",
    description:
      "User changes the model's pose and camera angle — or describes a fully custom pose in words and the AI visualizes it. Walking, seated, three-quarter turn, close-up...",
    angle:
      "Direct your model like a photographer — dynamic mid-motion hero pose, side cards showing the SAME model & outfit in different poses (WALK, SIT, TURN).",
    sideCards:
      "three small cards showing the SAME model in the SAME outfit in different poses (tiny caps labels like WALK, SEATED, PROFILE)",
    mastheadIdeas: ["STRIKE A POSE", "ANY ANGLE", "YOU DIRECT"],
  },
  {
    key: "body_shape",
    name: "Body Shape & Measurements",
    template: "feature_spotlight",
    description:
      "User selects the model's body shape, proportions and measurements — show garments on realistic, diverse bodies your actual customers have, not just one sample size.",
    angle:
      "Inclusive, real-body fashion — confident hero, side cards showing the SAME garment fitting beautifully on models of different body shapes.",
    sideCards:
      "three small cards showing the SAME garment styled on models with visibly different body shapes, all looking equally elegant (tiny caps labels like PETITE, CURVY, TALL)",
    mastheadIdeas: ["EVERY BODY", "TRUE FIT", "MADE FOR ALL"],
  },
  {
    key: "weather",
    name: "Weather & Atmosphere",
    template: "feature_spotlight",
    description:
      "User sets the weather/atmosphere of the shoot: golden sun, soft rain, snow, overcast, dusk — the same outfit photographed in completely different moods.",
    angle:
      "Same outfit, four seasons — hero in one dramatic weather mood, side cards with the SAME outfit under sun / rain / snow.",
    sideCards:
      "three small cards showing the SAME model and outfit under different weather (tiny caps labels SUN, RAIN, SNOW)",
    mastheadIdeas: ["ANY WEATHER", "ALL SEASONS", "RAIN OR SHINE"],
  },
  {
    key: "back_side",
    name: "Outfit Back View",
    template: "feature_spotlight",
    description:
      "Diress generates the back view of the garment on the model — customers see how the outfit looks from behind without a second photoshoot.",
    angle:
      "The view your customers always ask for — elegant hero shot of the model from the back (garment back details visible), a small front-view card as reference.",
    sideCards:
      "two small cards: the garment's front view on the model and the amateur source photo, each with tiny caps labels FRONT and YOUR PHOTO",
    mastheadIdeas: ["FRONT & BACK", "EVERY ANGLE", "THE BACK VIEW"],
  },
  {
    key: "jewelry",
    name: "Jewelry on Model",
    template: "feature_spotlight",
    description:
      "Jewelry sellers put necklaces, earrings, rings on photorealistic AI models — intimate beauty close-ups that make small products feel luxurious.",
    angle:
      "Luxury jewelry campaign — tight editorial close-up portrait (neckline/face) with the jewelry catching light, small card showing the amateur product-only photo.",
    sideCards:
      "one small tilted instant-photo card showing the same jewelry piece as a plain amateur product photo, labeled YOUR PHOTO in tiny caps",
    mastheadIdeas: ["PURE SHINE", "JEWEL STORY", "WEAR THE LIGHT"],
  },
  {
    key: "video",
    name: "Image to Video",
    template: "feature_spotlight",
    description:
      "Diress turns a single product photo into a dynamic AI fashion video (6-scene storyboard) — moving model, flowing fabric, cinematic camera moves.",
    angle:
      "Photo becomes film — cinematic hero frame with motion energy (flowing fabric, slight motion blur), a horizontal filmstrip of 3 small sequential frames of the same scene, a subtle play-button icon.",
    sideCards:
      "a horizontal filmstrip strip of three small sequential frames of the SAME scene (model mid-motion) with a subtle elegant play-button icon overlay on the middle frame",
    mastheadIdeas: ["NOW IN MOTION", "PRESS PLAY", "PHOTO TO FILM"],
  },
  {
    key: "enhance",
    name: "Photo Enhancer (Amateur to Professional)",
    template: "before_after",
    description:
      "Refiner/Enhance: fixes lighting, sharpness and quality of an existing product photo — from dim amateur snapshot to studio-grade image.",
    angle:
      "From amateur to professional — the same photo rescued: dull noisy phone shot vs crisp studio-quality result.",
  },
  {
    key: "hijab",
    name: "Hijab / Modest Mode",
    template: "feature_spotlight",
    description:
      "One-tap modest mode: the AI model wears an elegant, modern hijab that harmonizes with the outfit — hair, ears and neck covered naturally with soft realistic fabric. The outfit itself stays exactly the same. Essential for modest fashion brands and sellers in TR/MENA markets.",
    angle:
      "Elegant modest fashion campaign — hero shot of a serene, confident model in a beautifully styled modest outfit with a modern chic hijab, luxurious and dignified editorial mood (think high-end modest fashion magazines). Side cards show the SAME outfit with different hijab colors/draping styles.",
    sideCards:
      "three small cards showing the SAME model and SAME outfit with different elegant hijab colorways and draping styles (tiny caps labels like SAND, ROSE, NOIR)",
    mastheadIdeas: ["MODEST GRACE", "THE MODEST EDIT", "COVERED & CHIC"],
  },
  {
    key: "age_groups",
    name: "Model Age Selection (Newborn to Adult)",
    template: "feature_spotlight",
    description:
      "User selects the model's age group: newborn, baby, child, young, adult. Baby & kidswear sellers show their products on adorable realistic child models without organizing a children's photoshoot.",
    angle:
      "Kidswear/family-brand energy — warm, joyful hero shot of a cute child model in stylish kidswear (bright, playful but still editorial), side cards showing the SAME outfit concept across age groups.",
    sideCards:
      "three small cards showing models of different age groups in the same brand's outfit style (tiny caps labels like BABY, CHILD, ADULT)",
    mastheadIdeas: ["EVERY AGE", "LITTLE MODELS", "GROWS WITH YOU"],
  },
  {
    key: "men",
    name: "Male Models (Menswear)",
    template: "feature_spotlight",
    description:
      "Full menswear support: the user picks a male AI model — tailoring, streetwear, casual — and shows men's products on a professional male model.",
    angle:
      "Sharp menswear editorial — confident male model in impeccably tailored or elevated-casual menswear, strong masculine editorial lighting (think GQ cover), side cards showing the SAME garment styled in different ways or on different male model types.",
    sideCards:
      "three small cards showing the SAME menswear garment on male models with different styling vibes (tiny caps labels like TAILORED, STREET, CASUAL)",
    mastheadIdeas: ["FOR HIM", "THE MEN'S EDIT", "SHARP & MODERN"],
  },
  {
    key: "diversity",
    name: "Skin Tone & Ethnicity Selection",
    template: "feature_spotlight",
    description:
      "User selects the model's skin tone and ethnicity so the model matches the brand's real audience — sell globally with models your customers recognize themselves in.",
    angle:
      "Global, inclusive campaign — striking hero shot of a model with rich, beautifully lit skin tone in an elegant outfit, side cards showing the SAME outfit on models of clearly different skin tones and ethnic backgrounds, all equally glamorous.",
    sideCards:
      "three small cards showing the SAME outfit on models with visibly different skin tones and ethnic backgrounds, all equally elegant (tiny caps labels like GLOBAL, RADIANT, EVERY SHADE — or simple numbered look labels)",
    mastheadIdeas: ["EVERY SHADE", "ALL OF US", "YOUR AUDIENCE"],
  },
  {
    key: "brand_face",
    name: "Consistent Brand Face",
    template: "feature_spotlight",
    description:
      "Create your brand's own AI model face once and reuse the SAME model across every photoshoot — every product, every season. Customers see one familiar face, like a real brand ambassador on contract.",
    angle:
      "Brand ambassador energy — hero portrait of one distinctive, memorable model; side cards showing the SAME woman (identical face) in completely different shoots: different outfit, different location, different season — proving face consistency.",
    sideCards:
      "three small cards showing the SAME model with the IDENTICAL face in three completely different photoshoots — different outfits, locations and seasons (tiny caps labels like SUMMER, CITY, STUDIO)",
    mastheadIdeas: ["ONE FACE", "YOUR AMBASSADOR", "ALWAYS HER"],
  },
  {
    key: "background_remove",
    name: "Background Removal & Clean Studio",
    template: "feature_spotlight",
    description:
      "One-tap background removal: messy room disappears, product gets a clean studio or pure white marketplace-ready background — required format for Amazon, Etsy, Trendyol listings.",
    angle:
      "Clean-cut transformation — hero shot of a garment/product floating on a flawless pure-white or soft studio background with perfect soft shadow; one small inset card showing the same product photographed in a cluttered messy room (the before).",
    sideCards:
      "one small tilted instant-photo card in the upper area showing the SAME product in a cluttered amateur setting, labeled BEFORE in tiny caps — contrasting with the immaculate clean hero",
    mastheadIdeas: ["CLEAN CUT", "PURE WHITE", "NO BACKGROUND"],
  },
  {
    key: "chat_edit",
    name: "Edit by Chat (AI Editing Room)",
    template: "feature_spotlight",
    description:
      "Conversational editing: type what you want changed — 'make the background warmer', 'remove the wrinkles', 'add golden hour light' — and the AI applies it. No Photoshop skills needed.",
    angle:
      "Magic-by-words — elegant hero editorial shot with two or three minimal chat bubbles floating beside the model showing short edit commands (e.g. 'warmer light ☀️', 'remove wrinkles') and the photo visibly reflecting them; modern, playful but premium.",
    sideCards:
      "two or three small minimal iMessage-style chat bubble graphics placed along one side, each containing a very short edit command in clean type (e.g. WARMER LIGHT, SMOOTH FABRIC, GOLDEN HOUR), visually connected to the hero photo",
    mastheadIdeas: ["JUST ASK", "TYPE & DONE", "SAY THE WORD"],
  },
  {
    key: "listing_kit",
    name: "E-commerce Listing Kit",
    template: "feature_spotlight",
    description:
      "One product photo becomes a COMPLETE marketplace listing set: lifestyle scene, detail close-up, size & dimension chart, infographic, comparison and problem/solution visuals — everything an Amazon/Etsy/Trendyol listing needs, generated in minutes.",
    angle:
      "The full package — hero lifestyle shot of the product in a beautiful real-life scene; side cards showing the OTHER listing assets generated from the same photo: detail close-up, size chart visual, infographic card.",
    sideCards:
      "a vertical strip of three small cards showing different listing assets of the SAME product: macro detail close-up, clean size & dimension chart visual, minimal infographic card (tiny caps labels CLOSE-UP, SIZE GUIDE, INFOGRAPHIC)",
    mastheadIdeas: ["FULL LISTING", "THE WHOLE SET", "LIST IT ALL"],
  },
  {
    key: "marketing_banner",
    name: "AI Marketing Banners & Campaign Kit",
    template: "feature_spotlight",
    description:
      "Generate ready-to-run marketing creatives from product photos: campaign banners, sale announcements, seasonal ad visuals — designed layouts with headline space, sized for social and ads.",
    angle:
      "Campaign launch energy — hero shot styled like a premium seasonal sale campaign visual (editorial product/model shot with bold integrated typography mock space); side cards showing the SAME campaign adapted to different banner formats.",
    sideCards:
      "three small cards showing the SAME campaign visual adapted into different ad formats: square feed ad, wide web banner, vertical story ad (tiny caps labels FEED, BANNER, STORY)",
    mastheadIdeas: ["AD READY", "CAMPAIGN ON", "LAUNCH DAY"],
  },
  {
    key: "street_icon_kit",
    name: "Street Icon Kit (UGC-Style Shots)",
    template: "feature_spotlight",
    description:
      "Generates a set of candid, smartphone-style street photos of the same garment — 'shot on iPhone' aesthetic: leaning on a graffiti wall, mid-stride on cobblestones, golden hour against a sun-bleached shop front. Authentic UGC-feel content that performs on social, not polished studio shots.",
    angle:
      "Effortlessly-cool UGC vibe — hero shot that looks like a perfect candid iPhone photo (slight grain, handheld feel, natural light, lived-in street setting, model glancing off-camera); side cards showing the SAME garment in other candid street scenes from the kit.",
    sideCards:
      "three small cards showing the SAME garment in different candid smartphone-style street scenes — graffiti wall, cobblestone alley, shop front (tiny caps labels SCENE 1, SCENE 2, SCENE 3)",
    mastheadIdeas: ["STREET ICON", "SHOT CANDID", "OFF DUTY"],
  },
  {
    key: "fashion_kit",
    name: "Fashion Kit (Editorial Campaign Worlds)",
    template: "feature_spotlight",
    description:
      "Generates a set of bold, story-driven high-fashion editorial scenes around the same garment — cinematic campaign worlds like Vogue Italia: velvet-and-baroque luxury interiors, misty desert with horses, village courtyards with traditional rugs, open highways. One product, five dramatic campaign universes.",
    angle:
      "High-drama campaign storytelling — hero shot in one breathtaking cinematic editorial world (rich set design, dramatic directional light, film-like color grading); side cards showing the SAME garment in other wildly different campaign worlds from the kit.",
    sideCards:
      "three small cards showing the SAME garment in completely different cinematic editorial worlds — e.g. baroque velvet interior, misty desert, mountain highway (tiny caps labels WORLD 1, WORLD 2, WORLD 3)",
    mastheadIdeas: ["FIVE WORLDS", "THE CAMPAIGN", "EDITORIAL ERA"],
  },
  {
    key: "campaign_kit",
    name: "Campaign Kit (Designed Sale Visuals)",
    template: "feature_spotlight",
    description:
      "Turns a product photo into ready-designed campaign visuals: the AI studies the photo's empty spaces and intelligently places headline, subtitle, discount badge and CTA button with clean aligned typography — launch a sale campaign without a designer.",
    angle:
      "Sale-day designer energy — hero shot styled like a finished premium campaign visual: editorial product photo with elegantly placed headline, small discount badge and CTA chip already composed into the empty space; side cards showing the SAME photo turned into different campaign moods (sale, new season, last chance).",
    sideCards:
      "three small cards showing the SAME product photo composed into different designed campaign variants — different headline/badge placements and moods (tiny caps labels SALE, NEW IN, LAST CALL)",
    mastheadIdeas: ["INSTANT CAMPAIGN", "NO DESIGNER", "SALE READY"],
  },
  {
    key: "product_stories",
    name: "Product Stories & Unboxing",
    template: "feature_spotlight",
    description:
      "Auto-generated vertical story sets for products: unboxing-style reveals and product story sequences ready to post to Instagram stories — scroll-stopping vertical content from a single photo.",
    angle:
      "Story-native showcase — hero shot framed like a premium unboxing moment (elegant hands opening branded tissue-paper packaging revealing the garment, warm intimate light); side cards showing sequential story frames of the reveal.",
    sideCards:
      "a horizontal filmstrip of three small sequential vertical frames showing the unboxing/story progression of the SAME product (tiny caps labels 1, 2, 3)",
    mastheadIdeas: ["UNBOXED", "STORY TIME", "THE REVEAL"],
  },
];

/**
 * Rotasyon: en yakın zamanda kullanılan özellikler hariç tutulur.
 * recentKeys (en yeniden eskiye) içinde OLMAYAN özelliklerden rastgele seçer;
 * hepsi kullanıldıysa en uzun süredir kullanılmayanı döner.
 */
function pickNextFeature(recentKeys = []) {
  const unused = FEATURES.filter((f) => !recentKeys.includes(f.key));
  if (unused.length > 0) {
    return unused[Math.floor(Math.random() * unused.length)];
  }
  // Hepsi yakın geçmişte kullanılmış → en eski kullanılanı seç
  for (let i = recentKeys.length - 1; i >= 0; i--) {
    const feature = FEATURES.find((f) => f.key === recentKeys[i]);
    if (feature) return feature;
  }
  return FEATURES[0];
}

function getFeature(key) {
  return FEATURES.find((f) => f.key === key) || null;
}

module.exports = { FEATURES, pickNextFeature, getFeature };
