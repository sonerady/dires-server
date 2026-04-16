const express = require("express");
const router = express.Router();
const axios = require("axios");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");

const PIXELCUT_FAL_URL = "https://fal.run/pixelcut/background-removal";

/**
 * PNG'nin transparent kenar boşluklarını kırpar.
 * removeBg.js'teki trimTransparentPixels ile aynı mantık.
 */
async function trimTransparentPixels(imageBuffer) {
  try {
    const image = sharp(imageBuffer);
    const { width, height, channels } = await image.metadata();

    if (!width || !height || channels < 4) {
      return { buffer: imageBuffer, width, height };
    }

    const { data } = await image.raw().toBuffer({ resolveWithObject: true });

    let minX = width,
      maxX = -1;
    let minY = height,
      maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * channels;
        const alpha = data[idx + 3];
        if (alpha > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX === -1 || maxY === -1) {
      return { buffer: imageBuffer, width, height };
    }

    const padding = 2;
    const cropLeft = Math.max(0, minX - padding);
    const cropTop = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - cropLeft, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(
      height - cropTop,
      maxY - minY + 1 + padding * 2
    );

    const trimmedBuffer = await image
      .extract({
        left: cropLeft,
        top: cropTop,
        width: cropWidth,
        height: cropHeight,
      })
      .png()
      .toBuffer();

    console.log(
      `🎯 [PIXELCUT_BG] Trim: ${width}x${height} → ${cropWidth}x${cropHeight}`
    );

    return { buffer: trimmedBuffer, width: cropWidth, height: cropHeight };
  } catch (e) {
    console.warn("⚠️ [PIXELCUT_BG] Trim başarısız, orijinal kullanılıyor:", e.message);
    return { buffer: imageBuffer, width: null, height: null };
  }
}

/**
 * POST /api/remove-background-pixelcut
 *
 * fal.ai üzerindeki Pixelcut background removal modelini çağırır.
 * SizeEditor (Boyutu Ayarla) akışına özel — mevcut Replicate-based
 * /api/remove-background route'u ile karışmaz.
 *
 * Body:    { imageUrl: string, userId?: string }
 * Returns: {
 *   success: true,
 *   removedBgUrl: string,
 *   originalUrl: string,
 *   result: { removed_bg_url, width?, height? }
 * }
 */
router.post("/remove-background-pixelcut", async (req, res) => {
  const { imageUrl } = req.body || {};

  if (!imageUrl || typeof imageUrl !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "imageUrl is required" });
  }

  if (!process.env.FAL_API_KEY) {
    console.error("❌ [PIXELCUT_BG] FAL_API_KEY missing from environment");
    return res
      .status(500)
      .json({ success: false, message: "Server config error: FAL_API_KEY" });
  }

  console.log("🎨 [PIXELCUT_BG] Background removal başlatılıyor:", imageUrl);

  try {
    const response = await axios.post(
      PIXELCUT_FAL_URL,
      { image_url: imageUrl },
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    const data = response.data || {};

    // fal.ai pixelcut response shape varyasyonları:
    //   { image: { url, width, height }, request_id }
    //   { images: [{ url, width, height }], request_id }
    let removedBgUrl = null;
    let width = null;
    let height = null;

    if (data.image && typeof data.image === "object" && data.image.url) {
      removedBgUrl = data.image.url;
      width = data.image.width || null;
      height = data.image.height || null;
    } else if (
      Array.isArray(data.images) &&
      data.images.length > 0 &&
      data.images[0]?.url
    ) {
      removedBgUrl = data.images[0].url;
      width = data.images[0].width || null;
      height = data.images[0].height || null;
    } else if (typeof data.image_url === "string") {
      removedBgUrl = data.image_url;
    }

    if (Array.isArray(removedBgUrl)) removedBgUrl = removedBgUrl[0];

    if (!removedBgUrl) {
      console.error(
        "❌ [PIXELCUT_BG] Beklenmeyen response shape:",
        JSON.stringify(data).slice(0, 500)
      );
      return res.status(502).json({
        success: false,
        message: "Pixelcut response did not contain an image URL",
      });
    }

    console.log("✅ [PIXELCUT_BG] fal.ai URL alındı:", removedBgUrl);

    // PNG'yi indir → transparent kenarları kırp → Supabase'e yükle
    let finalUrl = removedBgUrl;
    let finalWidth = width;
    let finalHeight = height;

    try {
      const dl = await axios.get(removedBgUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });
      const rawBuffer = Buffer.from(dl.data);

      const { buffer: trimmedBuffer, width: tw, height: th } =
        await trimTransparentPixels(rawBuffer);

      const fileName = `pixelcut_${uuidv4()}.png`;
      const { error: uploadError } = await supabase.storage
        .from("images")
        .upload(fileName, trimmedBuffer, {
          contentType: "image/png",
        });
      if (uploadError) throw uploadError;

      const { data: publicUrlData, error: publicUrlError } = await supabase.storage
        .from("images")
        .getPublicUrl(fileName);
      if (publicUrlError) throw publicUrlError;

      finalUrl = publicUrlData.publicUrl;
      finalWidth = tw || finalWidth;
      finalHeight = th || finalHeight;

      console.log("✅ [PIXELCUT_BG] Trim + upload tamam:", finalUrl);
    } catch (postProcessErr) {
      console.warn(
        "⚠️ [PIXELCUT_BG] Trim/upload başarısız, fal URL'si döndürülüyor:",
        postProcessErr.message
      );
      // Fallback: orijinal fal URL'yi döndür
    }

    return res.status(200).json({
      success: true,
      removedBgUrl: finalUrl,
      originalUrl: imageUrl,
      result: {
        removed_bg_url: finalUrl,
        width: finalWidth,
        height: finalHeight,
      },
    });
  } catch (error) {
    const status = error.response?.status;
    const respData = error.response?.data;
    console.error(
      "❌ [PIXELCUT_BG] Hata:",
      status,
      error.message,
      respData ? JSON.stringify(respData).slice(0, 300) : ""
    );
    return res.status(500).json({
      success: false,
      message: "Pixelcut background removal failed",
      error: error.message || "Unknown error",
    });
  }
});

module.exports = router;
