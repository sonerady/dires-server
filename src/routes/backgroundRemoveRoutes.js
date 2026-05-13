const express = require("express");
const axios = require("axios");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");

const router = express.Router();
const PIXELCUT_FAL_URL = "https://fal.run/pixelcut/background-removal";
const MAX_BULK_ITEMS = 20;

// In-memory tracking for async/polling pattern (30dk TTL, 5dk'da bir GC)
const BG_REMOVE_BATCH_TTL_MS = 30 * 60 * 1000;
const bgRemoveBatches = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [batchId, batch] of bgRemoveBatches) {
    if (now - batch.createdAt > BG_REMOVE_BATCH_TTL_MS) {
      bgRemoveBatches.delete(batchId);
    }
  }
}, 5 * 60 * 1000);

async function ensureProUser(userId) {
  if (!userId || userId === "anonymous_user") return false;
  const effective = await getEffectiveCredits(userId);
  return effective?.isPro === true;
}

async function trimTransparentPixels(imageBuffer) {
  try {
    const image = sharp(imageBuffer);
    const { width, height, channels } = await image.metadata();

    if (!width || !height || channels < 4) {
      return { buffer: imageBuffer, width, height };
    }

    const { data } = await image.raw().toBuffer({ resolveWithObject: true });
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const alpha = data[(y * width + x) * channels + 3];
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
    const left = Math.max(0, minX - padding);
    const top = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - left, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(height - top, maxY - minY + 1 + padding * 2);
    const buffer = await image
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .png()
      .toBuffer();

    return { buffer, width: cropWidth, height: cropHeight };
  } catch (error) {
    console.warn("[BG_REMOVE] Trim failed, using original:", error.message);
    return { buffer: imageBuffer, width: null, height: null };
  }
}

async function uploadPngToStorage(buffer) {
  const fileName = `background_remove_${uuidv4()}.png`;
  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(fileName, buffer, { contentType: "image/png" });

  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("images").getPublicUrl(fileName);
  return data.publicUrl;
}

async function removeBackgroundWithPixelcut(imageUrl) {
  if (!process.env.FAL_API_KEY) {
    throw new Error("FAL_API_KEY is not configured");
  }

  const falResponse = await axios.post(
    PIXELCUT_FAL_URL,
    {
      image_url: imageUrl,
      output_format: "rgba",
      sync_mode: false,
    },
    {
      headers: {
        Authorization: `Key ${process.env.FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 120000,
    }
  );

  const data = falResponse.data || {};
  const falUrl =
    data?.image?.url ||
    data?.images?.[0]?.url ||
    data?.image_url ||
    data?.url ||
    null;

  if (!falUrl) {
    throw new Error("Pixelcut response did not contain an image URL");
  }

  let finalUrl = falUrl;
  let width = data?.image?.width || data?.images?.[0]?.width || null;
  let height = data?.image?.height || data?.images?.[0]?.height || null;

  try {
    const imageResponse = await axios.get(falUrl, {
      responseType: "arraybuffer",
      timeout: 60000,
    });
    const { buffer, width: trimmedWidth, height: trimmedHeight } =
      await trimTransparentPixels(Buffer.from(imageResponse.data));
    finalUrl = await uploadPngToStorage(buffer);
    width = trimmedWidth || width;
    height = trimmedHeight || height;
  } catch (postProcessError) {
    console.warn(
      "[BG_REMOVE] Post-process failed, returning fal URL:",
      postProcessError.message
    );
  }

  return {
    imageUrl: finalUrl,
    originalUrl: imageUrl,
    width,
    height,
    rawOutput: data,
  };
}

router.post("/generate", async (req, res) => {
  try {
    const { imageUrl, userId } = req.body || {};
    if (!imageUrl || typeof imageUrl !== "string") {
      return res.status(400).json({ success: false, error: "imageUrl is required" });
    }

    const isPro = await ensureProUser(userId);
    if (!isPro) {
      return res.status(403).json({
        success: false,
        error: "PRO_REQUIRED",
        message: "Background removal is available for Pro users only.",
      });
    }

    const result = await removeBackgroundWithPixelcut(imageUrl);
    return res.json({ success: true, result });
  } catch (error) {
    console.error("[BG_REMOVE] generate error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: "BACKGROUND_REMOVE_FAILED",
      message: error.message || "Background removal failed",
    });
  }
});

router.post("/generate-bulk", async (req, res) => {
  try {
    const { items, userId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items is required" });
    }
    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json({
        success: false,
        error: "TOO_MANY_ITEMS",
        maxItems: MAX_BULK_ITEMS,
      });
    }

    const isPro = await ensureProUser(userId);
    if (!isPro) {
      return res.status(403).json({
        success: false,
        error: "PRO_REQUIRED",
        message: "Background removal is available for Pro users only.",
      });
    }

    const results = await Promise.all(
      items.map(async (item, index) => {
        try {
          if (!item?.imageUrl) throw new Error("imageUrl is required");
          const result = await removeBackgroundWithPixelcut(item.imageUrl);
          return {
            index,
            status: "succeeded",
            imageUrl: result.imageUrl,
            width: result.width,
            height: result.height,
          };
        } catch (error) {
          return {
            index,
            status: "failed",
            error: error.message || "Background removal failed",
          };
        }
      })
    );

    return res.json({ success: true, results, creditsCharged: 0 });
  } catch (error) {
    console.error("[BG_REMOVE] bulk error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: "BACKGROUND_REMOVE_BULK_FAILED",
      message: error.message || "Bulk background removal failed",
    });
  }
});

// ============================================================================
// ASYNC BULK BACKGROUND REMOVE — Polling pattern
// ----------------------------------------------------------------------------
// POST /generate-bulk-async  → hemen batchId döner, item'lar background'da işlenir
// GET  /generate-bulk-status/:batchId → güncel item state'leri
// ============================================================================
router.post("/generate-bulk-async", async (req, res) => {
  try {
    const { items, userId, sessionId: rawSessionId } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "items is required" });
    }
    if (items.length > MAX_BULK_ITEMS) {
      return res.status(400).json({
        success: false,
        error: "TOO_MANY_ITEMS",
        maxItems: MAX_BULK_ITEMS,
      });
    }

    const isPro = await ensureProUser(userId);
    if (!isPro) {
      return res.status(403).json({
        success: false,
        error: "PRO_REQUIRED",
        message: "Background removal is available for Pro users only.",
      });
    }

    const sessionId = rawSessionId || uuidv4();

    bgRemoveBatches.set(sessionId, {
      userId,
      items: items.map((it, i) => ({
        index: i,
        status: "processing",
        imageUrl: null,
        originalImageUrl: it?.imageUrl || null,
      })),
      completed: false,
      createdAt: Date.now(),
    });

    console.log(
      `🚀 [BG_REMOVE_ASYNC] ${items.length} item background'da işlenmeye başladı (batchId=${sessionId})`
    );

    res.status(200).json({
      success: true,
      batchSessionId: sessionId,
      items: items.map((_, i) => ({ index: i, status: "processing" })),
    });

    // Background: paralel processing, item bittikçe Map'e yaz
    Promise.allSettled(
      items.map(async (item, i) => {
        try {
          if (!item?.imageUrl) throw new Error("imageUrl is required");
          const result = await removeBackgroundWithPixelcut(item.imageUrl);
          const batch = bgRemoveBatches.get(sessionId);
          if (batch) {
            batch.items[i] = {
              index: i,
              status: "succeeded",
              imageUrl: result.imageUrl,
              width: result.width,
              height: result.height,
              originalImageUrl: item.imageUrl,
            };
          }
        } catch (err) {
          const batch = bgRemoveBatches.get(sessionId);
          if (batch) {
            batch.items[i] = {
              index: i,
              status: "failed",
              error: err?.message || "Background removal failed",
              originalImageUrl: item?.imageUrl || null,
            };
          }
        }
      })
    ).then(() => {
      const batch = bgRemoveBatches.get(sessionId);
      if (batch) {
        batch.completed = true;
        console.log(
          `🏁 [BG_REMOVE_ASYNC] Batch ${sessionId} tüm itemları tamamlandı`
        );
      }
    });
  } catch (error) {
    console.error("[BG_REMOVE_ASYNC] start error:", error?.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: "BACKGROUND_REMOVE_BULK_FAILED",
        message: error.message || "Bulk background removal failed",
      });
    }
  }
});

router.get("/generate-bulk-status/:batchId", (req, res) => {
  const { batchId } = req.params;
  const batch = bgRemoveBatches.get(batchId);
  if (!batch) {
    return res.status(404).json({
      success: false,
      error: "Batch bulunamadı veya süresi dolmuş",
    });
  }
  return res.json({
    success: true,
    batchSessionId: batchId,
    items: batch.items,
    completed: batch.completed,
  });
});

module.exports = router;
