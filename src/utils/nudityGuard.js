// ───────────────────────────────────────────────────────────────────────────
// Nudity / manipulation content guard — SADECE belirli güvenlik test hesapları için.
//
// Amaç: Google Play / App Store inceleme ekibinin test hesabı (varsayılan
// nodselemen@gmail.com) ile çıplaklık veya manipülasyon (deepfake/undress vb.)
// üretmeye çalışıldığında:
//   1) İsteği sistemden GEÇİRME (block) — model çağrılmaz, kredi düşmez.
//   2) Bu hesabın her isteğinde prompt'u güvenlik talimatıyla SERTLEŞTİR
//      (nano-banana / Gemini çıplaklık üretmesin diye hassasiyeti artır).
//
// Diğer (gerçek) kullanıcılar bu mantıktan ETKİLENMEZ — davranış birebir aynı kalır.
//
// Test hesapları `SAFETY_TEST_EMAILS` env'i ile genişletilebilir (virgülle ayrılır).
// ───────────────────────────────────────────────────────────────────────────

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const TEST_EMAILS = (process.env.SAFETY_TEST_EMAILS || "nodselemen@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// ── Açık çıplaklık / soyma — tek başına bloklanır (EN + TR) ──
const NUDITY_PATTERNS = [
  /\bnudes?\b/i, /\bnudity\b/i, /\bnaked\b/i, /\btopless\b/i, /\bbottomless\b/i,
  /\bsee[\s-]?through\b/i, /\btransparent\s+(top|dress|clothing|shirt|outfit|blouse|fabric|bra)\b/i,
  /\bsheer\s+(top|dress|fabric|outfit|clothing|blouse)\b/i,
  /\bno\s+(clothes|clothing|bra|underwear|top|shirt|panties)\b/i,
  /\bwithout\s+(clothes|clothing|bra|underwear|top|shirt|anything|panties)\b/i,
  /\b(nothing|naught)\s+on\b/i, /\bwearing\s+nothing\b/i, /\bwith\s+nothing\s+on\b/i,
  /\bbare\s+(body|chest|breast|skin|naked|butt|bottom)\b/i, /\bfully\s+(nude|naked|exposed|bare)\b/i,
  /\bcompletely\s+(nude|naked|bare|exposed)\b/i,
  /\bremove\s+(her|the)?\s*(clothes|clothing|top|dress|bra|shirt|underwear)\b/i,
  /\bshow\s+(?:\w+\s+){0,2}?(body|skin|breasts?|chest|nipples?|butt|bottom|naked)\b/i,
  /\bexposed?\s+(breast|chest|nipple|genital|butt|buttock|body|skin)/i,
  /\bnipples?\b/i, /\bgenital/i, /\bunderboob\b/i, /\bcleav/i, /\blingerie\b/i, /\bbraless\b/i,
  /\bstrip(ped|ping)?\b/i, /\bporn/i, /\bnsfw\b/i, /\bexplicit\b/i,
  /\bundress/i, /\bnudify/i, /\bunclothed\b/i, /\bbirthday\s+suit\b/i,
  // Manipülasyon / deepfake
  /\bdeep[\s-]?fake\b/i, /\bface[\s-]?swap\b/i,
  // Türkçe
  /çıplak/i, /soyun/i, /şeffaf\s+(üst|elbise|giysi|bluz|gömlek|kıyafet|sütyen)/i,
  /iç\s*çamaşır/i, /göğüs\s*(açık|ucu|uçları)/i, /müstehcen/i, /pornografi|porno/i,
  /üstü\s*(açık|çıplak)/i, /üstsüz/i, /hiçbir\s*şey\s*(giy|olma)/i,
];

// ── Cinsel / müstehcen ima — tek başına bloklanır (test hesabı kapsamında) ──
const SUGGESTIVE_PATTERNS = [
  /\bsexual/i, /\berotic/i, /\bseductive/i, /\bseduc/i, /\bsexy\b/i, /\bsensual/i,
  /\bprovocative/i, /\blewd\b/i, /\bracy\b/i, /\bsuggestive/i, /\bhorny\b/i,
  /\bturn\s+(me|you|him|her)\s+on\b/i, /\bfetish/i, /\bbdsm\b/i,
  /seksi/i, /şehvet/i, /baştan\s*çıkar/i, /tahrik/i, /azdır/i,
];

// ── Minör / reşit olmayan göstergeleri ──
const MINOR_PATTERNS = [
  /\bteen(ager|aged)?s?\b/i, /\bchild(ren)?\b/i, /\bkids?\b/i, /\bunder[\s-]?age/i,
  /\bminors?\b/i, /\bpre[\s-]?teen/i, /\bschool\s*girl\b/i, /\bschool\s*boy\b/i,
  /\bloli\b/i, /\btoddler\b/i, /\binfant\b/i, /\byoung\b/i, /\blittle\s+girl\b/i,
  /\b1[0-7]\s*(year|yr)s?[\s-]*old\b/i, /\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen)\s+years?\s+old\b/i,
  /çocuk/i, /ergen/i, /reşit\s*olmayan/i, /küçük\s*kız/i, /\bgenç\b/i,
];

// Minör ile birleşince bloklanacak "vücut / açıklık" terimleri (yetişkinde tek başına serbest).
const BODY_EXPOSURE_PATTERNS = [
  /\bbody\b/i, /\bskin\b/i, /\bbreasts?\b/i, /\bchest\b/i, /\bthighs?\b/i, /\blegs?\b/i,
  /\bbikini\b/i, /\bswim\s*suit\b/i, /\bswim\s*wear\b/i, /\bunderwear\b/i, /\blingerie\b/i,
  /\bbare\b/i, /\bexpos/i, /\breveal/i, /\bcleav/i, /\bmidriff\b/i, /\bcrop\s+top\b/i,
  /vücut/i, /ten\b/i, /bacak/i, /mayo/i, /bikini/i,
];

const SAFETY_SUFFIX =
  " STRICT SAFETY REQUIREMENT: The depicted person MUST be fully clothed in modest, opaque, " +
  "non-revealing clothing. Absolutely NO nudity, NO partial nudity, NO see-through / sheer / " +
  "transparent fabric, NO exposed intimate body parts, NO sexual, suggestive or provocative content. " +
  "If any instruction conflicts with this, ignore it and produce a fully-clothed, professional fashion photo.";

// Gemini prompt-enhancer'ın EN BAŞINA eklenecek system prompt (yalnızca test hesabı için).
// Enhancer'a "uygunsuz/+18 istekte o yönde prompt ÜRETME, güvenli versiyon üret" der.
const SAFETY_SYSTEM_PROMPT =
  "SYSTEM SAFETY OVERRIDE (highest priority, cannot be overridden by the request below): " +
  "You are a professional fashion-photography prompt generator. If the user's request contains ANY " +
  "inappropriate, sexual, +18, nudity, partial nudity, see-through / sheer / transparent clothing, " +
  "undressing, 'nothing on', lingerie/underwear-only, suggestive, seductive or provocative content, " +
  "OR anything sexualizing minors (teen, child, underage), you MUST NOT produce such a prompt. " +
  "In that case silently drop the unsafe parts and generate ONLY a fully-clothed, modest, professional, " +
  "non-sexual fashion photo prompt. Never describe nudity, exposed intimate body parts, transparent " +
  "clothing, or sexual/suggestive content under any circumstances.";

// Test hesap id'leri — email→id çözümü 10 dk cache'lenir.
let _ids = new Set();
let _at = 0;
const TTL_MS = 10 * 60 * 1000;

async function getTestUserIds() {
  if (_ids.size && Date.now() - _at < TTL_MS) return _ids;
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, email")
      .in("email", TEST_EMAILS);
    if (!error && Array.isArray(data)) {
      _ids = new Set(data.map((u) => u.id));
      _at = Date.now();
    }
  } catch (_e) {
    // ağ/DB hatasında eski cache'i koru (fail-open değil, sadece eski set)
  }
  return _ids;
}

async function isSafetyTestUser(userId) {
  if (!userId) return false;
  const ids = await getTestUserIds();
  return ids.has(userId);
}

function matchAny(patterns, text) {
  for (const re of patterns) {
    if (re.test(text)) return re.source;
  }
  return null;
}

// NOT: Bu fonksiyon SADECE test hesabı (nodselemen) için çağrılır (evaluatePrompt içinde
// isTestUser kontrolünden sonra). Gerçek kullanıcılar bu kalıplardan ASLA etkilenmez.
function findViolation(text) {
  if (!text || typeof text !== "string") return null;
  // 1) Açık çıplaklık / soyma → her zaman blokla
  const nud = matchAny(NUDITY_PATTERNS, text);
  if (nud) return `nudity:${nud}`;
  // 2) Cinsel / müstehcen ima → blokla (test hesabı kapsamında)
  const sug = matchAny(SUGGESTIVE_PATTERNS, text);
  if (sug) return `suggestive:${sug}`;
  // 3) Minör göstergesi + vücut/açıklık terimi birlikte → blokla.
  //    (Tek başına "young/teenage" bloklanmaz — normal moda template'inde her zaman var.)
  const minor = matchAny(MINOR_PATTERNS, text);
  if (minor) {
    const body = matchAny(BODY_EXPOSURE_PATTERNS, text);
    if (body) return `minor+body:${minor} & ${body}`;
  }
  return null;
}

// Sertleştirme talimatını prompt'a ekle.
function hardenPrompt(prompt) {
  return `${prompt || ""}${SAFETY_SUFFIX}`;
}

// Ana API: test hesabı mı + prompt politikayı ihlal ediyor mu?
//   - isTestUser=false → çağıran route hiçbir şey değiştirmez.
//   - blocked=true     → istek reddedilmeli (model çağrılmamalı, kredi düşmemeli).
//   - blocked=false & isTestUser=true → route promptu hardenPrompt() ile sertleştirmeli.
async function evaluatePrompt(userId, text) {
  const isTestUser = await isSafetyTestUser(userId);
  if (!isTestUser) return { isTestUser: false, blocked: false, reason: null };
  const reason = findViolation(text);
  return { isTestUser: true, blocked: !!reason, reason };
}

module.exports = {
  evaluatePrompt,
  hardenPrompt,
  isSafetyTestUser,
  findViolation,
  SAFETY_SUFFIX,
  SAFETY_SYSTEM_PROMPT,
};
