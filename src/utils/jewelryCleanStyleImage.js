const axios = require("axios");
const { fal } = require("@fal-ai/client");

const JEWELRY_CLEAN_MODEL = "google/nano-banana-lite/edit";
// 💎 Ürün çekimi (çekim tarzı 2) referanslarında takı SİLİNMEZ: o karelerde konu
// ürünün kendisi, takıyı kaldırmak referansı yok eder. Yalnız model üstündeki
// tarzlarda (1 Editoryal, 3 Yakın plan) temizlik yapılır — orada referans modelin
// kendi takısı kullanıcının ürünüyle karışmasın diye kaldırılması gerekiyor.
const PRODUCT_SHOT_STYLE_APPROACH = 2;
// Storage yolunda da kullanılan işlem revizyonu. Pruna ile üretilen bozuk
// sonuçlardan farklı bir obje yolu oluşturur; DB dizisi yeni URL'lerle
// değiştiğinde uzun CDN cache süresi eski görselleri geri getiremez.
const JEWELRY_CLEAN_VARIANT = "fal-nano-banana-lite-v3";
// Nano Banana Lite uzun, negatif madde listelerini bazı fotoğraflarda
// no_media_generated ile reddediyor. Kısa ve pozitif/full-bleed ifade aynı
// düzenlemeyi güvenilir biçimde yaptırıyor; alt beyaz şeridi de isim vermeden
// fotoğrafın doğal kenarlarına kadar devam ettiriyor.
const JEWELRY_CLEAN_PROMPT =
  "Remove all jewelry and accessories from this photo. Keep the same person, clothing, pose, crop, lighting and background unchanged. Make the photograph clean and full-bleed to its original edges without border strips.";
const JEWELRY_CLEAN_FALLBACK_PROMPT =
  "Remove all jewelry from this photo. Keep everything else unchanged.";

function createFalClient() {
  const credentials = process.env.FAL_API_KEY || process.env.FAL_KEY;
  if (!credentials) {
    throw new Error("FAL_API_KEY veya FAL_KEY tanımlı değil");
  }
  fal.config({ credentials });
  return fal;
}

function normalizeOutputUrl(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return normalizeOutputUrl(output[0]);
  if (output && typeof output.url === "function") {
    const value = output.url();
    return typeof value === "string" ? value : String(value);
  }
  if (output?.url) return String(output.url);
  if (output?.output) return normalizeOutputUrl(output.output);
  const rendered = output == null ? "" : String(output);
  return /^https?:\/\//i.test(rendered) ? rendered : null;
}

function extensionForContentType(contentType = "") {
  const type = contentType.toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("avif")) return "avif";
  return "jpg";
}

async function runJewelryCleanEdit(imageUrl, falClient = null) {
  const client = falClient || createFalClient();
  const prompts = [JEWELRY_CLEAN_PROMPT, JEWELRY_CLEAN_FALLBACK_PROMPT];
  let lastError = null;

  for (const prompt of prompts) {
    try {
      const output = await client.subscribe(JEWELRY_CLEAN_MODEL, {
        input: {
          prompt,
          image_urls: [imageUrl],
          aspect_ratio: "auto",
          num_images: 1,
          output_format: "png",
          safety_tolerance: "6",
          limit_generations: true,
        },
        logs: true,
      });
      const outputUrl = normalizeOutputUrl(
        output?.data?.images || output?.images || output?.data || output,
      );
      if (outputUrl) return outputUrl;
      lastError = new Error("fal geçerli bir output URL döndürmedi");
    } catch (error) {
      lastError = error;
    }
  }

  const detail = lastError?.body?.detail?.[0]?.msg;
  throw new Error(detail || lastError?.message || "fal jewelry clean başarısız");
}

async function downloadProviderImage(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 180000,
    maxContentLength: 100 * 1024 * 1024,
    maxBodyLength: 100 * 1024 * 1024,
  });
  const contentType = String(response.headers["content-type"] || "image/jpeg")
    .split(";")[0]
    .trim();
  return { buffer: Buffer.from(response.data), contentType };
}

async function cleanAndPersistJewelryStyleImage({
  imageUrl,
  supabase,
  objectPathWithoutExtension,
  bucket = "reference",
  falClient = null,
}) {
  const providerUrl = await runJewelryCleanEdit(imageUrl, falClient);
  const { buffer, contentType } = await downloadProviderImage(providerUrl);
  const objectPath = `${objectPathWithoutExtension}.${extensionForContentType(contentType)}`;
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
  if (!data?.publicUrl) throw new Error("Supabase public URL üretilemedi");
  return data.publicUrl;
}

module.exports = {
  JEWELRY_CLEAN_MODEL,
  JEWELRY_CLEAN_VARIANT,
  PRODUCT_SHOT_STYLE_APPROACH,
  JEWELRY_CLEAN_PROMPT,
  JEWELRY_CLEAN_FALLBACK_PROMPT,
  createFalClient,
  runJewelryCleanEdit,
  cleanAndPersistJewelryStyleImage,
};
