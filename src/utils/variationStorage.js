const axios = require("axios");

const DEFAULT_VARIATION_BUCKET = "images";

function safePathSegment(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function buildVariationStoragePath({ userId, sourceGenerationId, generationId }) {
  return [
    "variations",
    safePathSegment(userId, "unknown-user"),
    safePathSegment(sourceGenerationId, "unknown-source"),
    `${safePathSegment(generationId, "variation")}.jpg`,
  ].join("/");
}

async function persistVariationImage({
  supabase,
  sourceUrl,
  userId,
  sourceGenerationId,
  generationId,
  bucket = process.env.VARIATION_STORAGE_BUCKET || DEFAULT_VARIATION_BUCKET,
  httpClient = axios,
}) {
  if (!sourceUrl || !supabase) {
    throw new Error("Variation persistence requires sourceUrl and supabase");
  }

  const response = await httpClient.get(sourceUrl, {
    responseType: "arraybuffer",
    timeout: 60000,
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length === 0) throw new Error("Downloaded variation image is empty");

  const storagePath = buildVariationStoragePath({
    userId,
    sourceGenerationId,
    generationId,
  });
  const storage = supabase.storage.from(bucket);
  const { error } = await storage.upload(storagePath, buffer, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw new Error(`Variation bucket upload failed: ${error.message}`);

  const { data } = storage.getPublicUrl(storagePath);
  if (!data?.publicUrl) {
    throw new Error("Variation bucket did not return a public URL");
  }

  return {
    publicUrl: data.publicUrl,
    bucket,
    storagePath,
  };
}

module.exports = {
  DEFAULT_VARIATION_BUCKET,
  buildVariationStoragePath,
  persistVariationImage,
};
