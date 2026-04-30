/**
 * Canonical generation_id resolver.
 *
 * Album item'ları gibi non-UUID generation_id durumlarında client URL'den türetilmiş
 * v5 UUID gönderiyor olabilir. Bu helper 4 adımda gerçek generation_id'yi çözer:
 *   1) recordId ile direkt match
 *   2) imageUrl ile direkt eq
 *   3) getOriginalUrl ile normalize edilmiş URL ile eq (CDN-wrapped → original)
 *   4) Storage path tail ile ILIKE (en güçlü fallback — domain/CDN/query farklarını eler)
 */

const { supabase } = require("../supabaseClient");
const { getOriginalUrl } = require("./imageOptimizer");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Supabase storage URL'sinden unique path tail çıkarır.
// Örn: "https://api.diress.ai/storage/v1/object/public/user_image_results/xx/yy.jpg"
//   → "user_image_results/xx/yy.jpg"
// Bu tail CDN-wrapped, render-vs-object, domain swap, query-string farklarına karşı stabil.
function extractStoragePathTail(url) {
  if (!url) return null;
  const original = getOriginalUrl(url);
  if (!original) return null;
  const m = original.match(/\/storage\/v1\/(?:object|render\/image)\/public\/([^?#]+)$/);
  return m ? m[1] : null;
}

async function resolveCanonicalGenerationId(recordId, imageUrl) {
  // Step 1: id/generation_id direct match
  if (recordId) {
    const isUuid = UUID_REGEX.test(String(recordId));
    const orFilter = isUuid
      ? `generation_id.eq.${recordId},id.eq.${recordId}`
      : `generation_id.eq.${recordId}`;
    const { data: directMatch } = await supabase
      .from("reference_results")
      .select("generation_id, id")
      .or(orFilter)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (directMatch) {
      return directMatch.generation_id || directMatch.id;
    }
  }

  if (!imageUrl) return recordId;

  // Step 2: raw imageUrl ile direkt eq
  const { data: directUrl } = await supabase
    .from("reference_results")
    .select("generation_id, id")
    .eq("result_image_url", imageUrl)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (directUrl) {
    const resolved = directUrl.generation_id || directUrl.id;
    console.log(
      `🔄 [CANONICAL_ID] Resolved via url-eq: ${recordId} → ${resolved}`,
    );
    return resolved;
  }

  // Step 3: getOriginalUrl ile normalize edilmiş URL ile eq
  const originalUrl = getOriginalUrl(imageUrl);
  if (originalUrl && originalUrl !== imageUrl) {
    const { data: normalizedMatch } = await supabase
      .from("reference_results")
      .select("generation_id, id")
      .eq("result_image_url", originalUrl)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (normalizedMatch) {
      const resolved = normalizedMatch.generation_id || normalizedMatch.id;
      console.log(
        `🔄 [CANONICAL_ID] Resolved via url-original-eq: ${recordId} → ${resolved}`,
      );
      return resolved;
    }
  }

  // Step 4: storage path tail ile ILIKE (en güçlü fallback)
  const tail = extractStoragePathTail(imageUrl);
  if (tail && tail.length > 20) {
    const { data: tailMatch } = await supabase
      .from("reference_results")
      .select("generation_id, id")
      .ilike("result_image_url", `%${tail}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (tailMatch) {
      const resolved = tailMatch.generation_id || tailMatch.id;
      console.log(
        `🔄 [CANONICAL_ID] Resolved via url-tail-ilike (${tail}): ${recordId} → ${resolved}`,
      );
      return resolved;
    }
  }

  return recordId;
}

module.exports = { resolveCanonicalGenerationId, UUID_REGEX, extractStoragePathTail };
