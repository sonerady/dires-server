// Casting defaults apply only when creating a new identity from text.
function textModelCastingDirection(age) {
  const numericAge = Number(age);
  const adult = ['young', 'middle', 'adult', 'senior', 'old', 'elderly'].includes(age)
    || (Number.isFinite(numericAge) && numericAge >= 18);
  if (!adult) return `Keep facial proportions, styling and appearance natural and appropriate to the requested age.`;
  return `Premium editorial fashion casting quality, Vogue-style model presence within a plain passport-photo composition. For unspecified facial features, favor distinctive defined bone structure, sculptural cheekbones and a refined jawline, with natural proportions and subtle asymmetry. Preserve the requested age, gender and any explicit appearance details from the user; these defaults must not override them. Realistic pores and fine skin texture, minimal natural grooming, no plastic skin or beauty-filter smoothing. Plain white T-shirt, white studio background, frontal head-and-shoulders framing, neutral expression, soft even lighting. No editorial wardrobe, pose, typography, logos, magazine covers or watermarks.`;
}

const REFERENCE_ID_PHOTO_PROMPT = `Convert the supplied reference photo into a professional passport/ID-style portrait of the SAME person. Use the reference image as the sole source of their identity and appearance. Preserve their recognizable face, facial proportions, bone structure, eyes, nose, lips, skin tone, apparent age, hairline, hairstyle and distinctive features. Do not invent a different person, reshape the face, change facial structure or impose a new model appearance. Retain realistic skin texture without beauty-filter smoothing.
Change only the framing, background, lighting and clothing needed for the ID photo: frontal head-and-shoulders composition, entire head visible with comfortable headroom, clean white T-shirt, pure white background, neutral expression and soft even studio illumination. Keep existing head coverings unless explicitly instructed otherwise. Sharp natural photographic detail, no blur, borders, frames, text, graphics, logos or watermarks.`;

// 🧑‍🤝‍🧑 Model havuzu (10 Eyl 2026, güçlendirildi 11 Eyl): Pinterest'ten kırpılan kişinin
// kopyası değil, ondan esinlenen YENİ bir kurgusal model. Yüz hatlarının TAMAMI (yüz şekli,
// göz, kaş, burun, dudak, çene, elmacık) + saç + ayırt edici işaretler değişir; yalnız
// cinsiyet, yaş aralığı, ten, saç rengi, vücut tipi ve hava korunur. Sonuç yüz tanımada
// eşleşmemeli ama doğal, abartısız kalmalı.
const POOL_PORTRAIT_PROMPT = `Create a NEW fictional fashion model who is unmistakably a DIFFERENT PERSON from the one in the reference photo. The reference is only loose casting inspiration — never a likeness, not a relative, not a look-alike. Keep ONLY these from the reference: gender, apparent age range, skin tone, general hair color, body type and the professional vibe.
Change the identity decisively (all of the following, not just one): a different overall face shape and proportions (e.g. rounder vs. angular, wider vs. narrower), different eye shape, spacing and color where plausible, different eyebrow shape and thickness, a different nose (bridge, width, tip), different lip shape and fullness, different chin and jawline, different cheekbones, plus a different hairstyle (length, parting, texture, volume) and, if present, different facial hair. Remove any distinctive marks (moles, scars, freckle patterns, tattoos, piercings) so nothing identifies the original person. A face-recognition system must NOT match the result to the reference. Stay natural and attractive, coherent with the kept age/skin tone — a believable real person, not an exaggerated caricature. Realistic natural skin texture without beauty-filter smoothing.
Framing and styling of a professional passport/ID-style portrait: frontal head-and-shoulders composition, entire head visible with comfortable headroom, clean white T-shirt, pure white background, neutral expression, soft even studio illumination. Keep any existing head covering. Sharp natural photographic detail, no blur, borders, frames, text, graphics, logos or watermarks.`;

module.exports = { textModelCastingDirection, REFERENCE_ID_PHOTO_PROMPT, POOL_PORTRAIT_PROMPT };
