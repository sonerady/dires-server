/**
 * Cloudflare Image Resizing - Merkezi Resim Optimizasyon Utility'si
 *
 * Supabase /render/image/ transform yerine Cloudflare /cdn-cgi/image/ kullanır.
 * Bu sayede Supabase image transform maliyeti sıfırlanır.
 *
 * Cloudflare Image Resizing URL formatı:
 *   https://domain.com/cdn-cgi/image/width=W,height=H,quality=Q,format=webp/ORIGINAL_URL
 */

// Cloudflare Image Resizing aktif mi? (false yapılırsa eski Supabase render kullanılır - rollback için)
const USE_CLOUDFLARE = false;

// Cloudflare proxied domain (cdn-cgi/image/ bu domain üzerinden çalışır)
// api.diress.ai DNS only olduğu için, proxied olan diress.ai kullanılmalı
const CLOUDFLARE_CDN_DOMAIN = "https://diress.ai";

// Supabase direct domain → custom domain dönüşümü
// Cloudflare Image Resizing varsayılan olarak sadece aynı zone'daki URL'leri resize eder.
// egpfenrpripkjpemjxtg.supabase.co harici domain olduğu için çalışmaz,
// api.diress.ai ise diress.ai zone'unda olduğu için çalışır.
const SUPABASE_DIRECT_DOMAIN = "https://egpfenrpripkjpemjxtg.supabase.co";
const SUPABASE_CUSTOM_DOMAIN = "https://api.diress.ai";

/**
 * Supabase storage URL'sinden orijinal (transform'suz) URL'yi çıkarır.
 * Hem /render/image/public/ hem /object/public/ URL'lerini destekler.
 * Cloudflare CDN wrapper'larını da strip eder (double-wrap önlemi).
 */
const getOriginalUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  let url = imageUrl;

  // Cloudflare CDN wrapper'larını strip et (DB'de CDN URL kaydedilmiş olabilir)
  // Format: https://diress.ai/cdn-cgi/image/OPTIONS/ORIGINAL_URL
  while (url.includes("/cdn-cgi/image/")) {
    const match = url.match(/\/cdn-cgi\/image\/[^/]+\/(https?:\/\/.+)/);
    if (match) {
      url = match[1];
    } else {
      break;
    }
  }

  // Supabase direct domain'i custom domain'e çevir (Cloudflare same-zone restriction)
  if (url.includes(SUPABASE_DIRECT_DOMAIN)) {
    url = url.replace(SUPABASE_DIRECT_DOMAIN, SUPABASE_CUSTOM_DOMAIN);
  }

  // render URL'sini object URL'sine çevir
  if (url.includes("/storage/v1/render/image/public/")) {
    url = url.replace(
      "/storage/v1/render/image/public/",
      "/storage/v1/object/public/",
    );
  }

  // Query parametrelerini kaldır
  url = url.split("?")[0];

  return url;
};

/**
 * Supabase storage URL'sinden domain'i çıkarır.
 * Örnek: "https://api.diress.ai/storage/v1/..." → "https://api.diress.ai"
 */
const extractDomain = (imageUrl) => {
  if (!imageUrl) return null;
  try {
    const urlObj = new URL(imageUrl);
    return `${urlObj.protocol}//${urlObj.host}`;
  } catch {
    return null;
  }
};

/**
 * Ana resim optimizasyon fonksiyonu.
 * Supabase render/image yerine Cloudflare Image Resizing URL'si üretir.
 *
 * @param {string} imageUrl - Orijinal veya optimize edilmiş Supabase URL
 * @param {object} options - { width, height, quality, fit }
 * @returns {string} Cloudflare Image Resizing URL'si
 */
const optimizeImageUrl = (
  imageUrl,
  { width = 500, height = 500, quality = 80, fit = "cover" } = {},
) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si değilse dokunma
  if (!imageUrl.includes("/storage/v1/")) return imageUrl;

  if (!USE_CLOUDFLARE) {
    // Fallback: Eski Supabase render yöntemi
    return _supabaseRenderFallback(imageUrl, { width, height, quality });
  }

  // 1. Orijinal URL'yi al (transform parametreleri olmadan)
  const originalUrl = getOriginalUrl(imageUrl);

  // 2. Cloudflare Image Resizing URL'si oluştur
  // api.diress.ai DNS only olduğu için, proxied olan diress.ai üzerinden /cdn-cgi/image/ kullanılır
  // Format: https://diress.ai/cdn-cgi/image/OPTIONS/FULL_ORIGINAL_URL
  return `${CLOUDFLARE_CDN_DOMAIN}/cdn-cgi/image/width=${width},height=${height},quality=${quality},fit=${fit},format=webp/${originalUrl}`;
};

/**
 * Thumbnail optimizasyonu (300x300, quality 70)
 * History routes'ta thumbnail için kullanılır.
 */
const optimizeForThumbnail = (imageUrl) => {
  return optimizeImageUrl(imageUrl, {
    width: 300,
    height: 300,
    quality: 70,
  });
};

/**
 * Orijinal boyutu döndürür (transform yok, sadece clean URL).
 * History modal görüntüleme için kullanılır.
 */
const getOriginalForModal = (imageUrl) => {
  return getOriginalUrl(imageUrl);
};

/**
 * API'lere gönderilecek temiz URL (transform parametreleri olmadan).
 * Fal.ai, Replicate vb. harici servislere URL gönderirken kullanılır.
 */
const cleanImageUrlForApi = (imageUrl) => {
  return getOriginalUrl(imageUrl);
};

/**
 * History objelerinin resim URL'lerini optimize eden fonksiyon.
 * Her image field için hem thumbnail hem original versiyon üretir.
 */
const optimizeHistoryImages = (historyItems) => {
  if (!Array.isArray(historyItems)) return historyItems;

  return historyItems.map((item) => {
    const optimizedItem = { ...item };

    // Result image'ları
    if (optimizedItem.result_image_url) {
      optimizedItem.result_image_url_thumbnail = optimizeForThumbnail(
        optimizedItem.result_image_url,
      );
      optimizedItem.result_image_url_original = getOriginalForModal(
        optimizedItem.result_image_url,
      );
    }

    // Reference images
    if (optimizedItem.reference_images) {
      try {
        let referenceImages = Array.isArray(optimizedItem.reference_images)
          ? optimizedItem.reference_images
          : JSON.parse(optimizedItem.reference_images || "[]");

        optimizedItem.reference_images_thumbnail =
          referenceImages.map(optimizeForThumbnail);
        optimizedItem.reference_images_original =
          referenceImages.map(getOriginalForModal);

        optimizedItem.reference_images = referenceImages;
      } catch (e) {
        console.warn("Reference images parse error:", e);
        optimizedItem.reference_images = [];
        optimizedItem.reference_images_thumbnail = [];
        optimizedItem.reference_images_original = [];
      }
    }

    // Location image
    if (optimizedItem.location_image) {
      optimizedItem.location_image_thumbnail = optimizeForThumbnail(
        optimizedItem.location_image,
      );
      optimizedItem.location_image_original = getOriginalForModal(
        optimizedItem.location_image,
      );
    }

    // Pose image
    if (optimizedItem.pose_image) {
      optimizedItem.pose_image_thumbnail = optimizeForThumbnail(
        optimizedItem.pose_image,
      );
      optimizedItem.pose_image_original = getOriginalForModal(
        optimizedItem.pose_image,
      );
    }

    // Hair style image
    if (optimizedItem.hair_style_image) {
      optimizedItem.hair_style_image_thumbnail = optimizeForThumbnail(
        optimizedItem.hair_style_image,
      );
      optimizedItem.hair_style_image_original = getOriginalForModal(
        optimizedItem.hair_style_image,
      );
    }

    return optimizedItem;
  });
};

/**
 * Kit objelerinin kit_images array'indeki URL'leri optimize eden fonksiyon.
 * Her kit image için thumbnail ve original versiyon üretir.
 */
const optimizeKitImages = (kits) => {
  if (!Array.isArray(kits)) return kits;

  return kits.map((kit) => {
    const optimizedKit = { ...kit };

    if (Array.isArray(optimizedKit.kit_images)) {
      optimizedKit.kit_images = optimizedKit.kit_images.map((img) => {
        if (typeof img === "object" && img !== null && img.url) {
          return {
            ...img,
            thumbnail: optimizeForThumbnail(img.url),
            original: getOriginalForModal(img.url),
          };
        }
        if (typeof img === "string") {
          return {
            url: img,
            thumbnail: optimizeForThumbnail(img),
            original: getOriginalForModal(img),
          };
        }
        return img;
      });
    }

    // original_photos da optimize et
    if (Array.isArray(optimizedKit.original_photos)) {
      optimizedKit.original_photos = optimizedKit.original_photos.map((url) => {
        if (typeof url === "string") {
          return {
            url: url,
            thumbnail: optimizeForThumbnail(url),
            original: getOriginalForModal(url),
          };
        }
        return url;
      });
    }

    return optimizedKit;
  });
};

/**
 * Location objelerinin resim URL'lerini optimize eden fonksiyon.
 */
const optimizeLocationImages = (locations, options = {}) => {
  if (!Array.isArray(locations)) return locations;

  return locations.map((location) => ({
    ...location,
    image_url: optimizeImageUrl(location.image_url, options),
  }));
};

/**
 * Fallback: Eski Supabase render yöntemi (USE_CLOUDFLARE=false durumu için)
 */
const _supabaseRenderFallback = (imageUrl, { width, height, quality }) => {
  if (!imageUrl.includes("/storage/v1/")) return imageUrl;

  if (imageUrl.includes("/storage/v1/render/image/public/")) {
    const baseUrl = imageUrl.split("?")[0];
    return `${baseUrl}?width=${width}&height=${height}&quality=${quality}`;
  }

  if (imageUrl.includes("/storage/v1/object/public/")) {
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/",
      ) + `?width=${width}&height=${height}&quality=${quality}`
    );
  }

  const hasParams = imageUrl.includes("?");
  return `${imageUrl}${hasParams ? "&" : "?"}width=${width}&height=${height}`;
};

module.exports = {
  optimizeImageUrl,
  optimizeForThumbnail,
  getOriginalUrl,
  getOriginalForModal,
  cleanImageUrlForApi,
  optimizeHistoryImages,
  optimizeKitImages,
  optimizeLocationImages,
  USE_CLOUDFLARE,
};
