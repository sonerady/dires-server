const resolveImageUrl = (value) =>
  typeof value === "string"
    ? value
    : value?.uri || value?.url || value?.publicUrl || value?.imageUrl;

const imageIdentity = (value) => {
  const rawUrl = resolveImageUrl(value);
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.split(/[?#]/, 1)[0];
  }
};

/**
 * Varyasyon modeline gidecek görselleri sıralı ve tekil toplar.
 * `excludedImages`, client generic reference listesinde aynı URL yeniden gelse
 * bile (signed URL query'si farklı olsa da) konum görselini kesin olarak keser.
 */
function collectInputImages({
  sourceImageUrl,
  referenceImages,
  extraImages,
  excludedImages = [],
}) {
  const seen = new Set();
  const excluded = new Set();
  const images = [];

  const exclude = (value) => {
    if (Array.isArray(value)) {
      value.forEach(exclude);
      return;
    }
    const identity = imageIdentity(value);
    if (identity) excluded.add(identity);
  };
  exclude(excludedImages);

  const push = (value) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const rawUrl = resolveImageUrl(value);
    const identity = imageIdentity(rawUrl);
    if (!identity || excluded.has(identity) || seen.has(identity)) return;
    seen.add(identity);
    images.push(rawUrl.trim());
  };

  // Hero her zaman ilk sırada kimlik/kompozisyon çıpasıdır.
  push(sourceImageUrl);
  push(referenceImages);
  push(extraImages);
  return images;
}

module.exports = { collectInputImages };
