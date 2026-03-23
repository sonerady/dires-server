// Required modules
const express = require("express");
const { supabase } = require("../supabaseClient");
const { getEffectiveCredits } = require("../services/teamService");
const { v4: uuidv4 } = require("uuid");
const axios = require("axios");
const sharp = require("sharp");

const router = express.Router();

const CREDIT_COST = 5;
const FAL_ENDPOINT = "https://fal.run/pixelcut/background-removal";

// Transparent pikselleri trim eden yardımcı fonksiyon
async function trimTransparentPixels(imageBuffer) {
  try {
    const image = sharp(imageBuffer);
    const { width, height, channels } = await image.metadata();

    // Eğer alpha kanalı yoksa, direkt buffer'ı döndür
    if (channels < 4) {
      return imageBuffer;
    }

    // Resmi raw data olarak al
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });

    // Transparent olmayan piksellerin sınırlarını bul
    let minX = width,
      maxX = -1;
    let minY = height,
      maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * channels;
        const alpha = data[pixelIndex + 3]; // Alpha kanalı

        // Eğer piksel transparent değilse (alpha > 0)
        if (alpha > 0) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Eğer hiç opaque piksel bulunamadıysa, orijinal resmi döndür
    if (maxX === -1 || maxY === -1) {
      return imageBuffer;
    }

    // Küçük bir padding ekle (opsiyonel)
    const padding = 2;
    const cropLeft = Math.max(0, minX - padding);
    const cropTop = Math.max(0, minY - padding);
    const cropWidth = Math.min(width - cropLeft, maxX - minX + 1 + padding * 2);
    const cropHeight = Math.min(
      height - cropTop,
      maxY - minY + 1 + padding * 2
    );

    // Trim edilmiş resmi oluştur
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
      `🎯 Trim işlemi: ${width}x${height} → ${cropWidth}x${cropHeight}`
    );

    return trimmedBuffer;
  } catch (error) {
    console.warn(
      "⚠️ Trim işlemi başarısız, orijinal resim kullanılıyor:",
      error.message
    );
    return imageBuffer;
  }
}

// URL'den arkaplan kaldırma endpoint'i (fal.ai pixelcut + 5 kredi)
router.post("/remove-background", async (req, res) => {
  const { imageUrl, userId } = req.body || {};
  let creditDeducted = false;
  let creditOwnerId;
  let creditBalanceBefore = null;

  if (!imageUrl) {
    return res
      .status(400)
      .json({ success: false, message: "Image URL is required" });
  }

  try {
    console.log("🖼️ Arkaplan kaldırma başlatılıyor:", imageUrl);

    // ── Kredi kontrolü ve düşme ──
    creditOwnerId = userId;

    if (userId && userId !== "anonymous_user") {
      try {
        console.log("💰 [BG-REMOVE] Team-aware kredi kontrolü, userId:", userId);

        const effectiveCredits = await getEffectiveCredits(userId);
        const currentCredit = effectiveCredits.creditBalance || 0;
        creditOwnerId = effectiveCredits.creditOwnerId;
        creditBalanceBefore = currentCredit;

        console.log(
          `💳 [BG-REMOVE] Kredi: ${currentCredit}, gerekli: ${CREDIT_COST}`,
          effectiveCredits.isTeamCredit ? `(team owner: ${creditOwnerId})` : "(kendi kredisi)"
        );

        if (currentCredit < CREDIT_COST) {
          console.log(`❌ [BG-REMOVE] Kredi yetersiz! ${currentCredit} < ${CREDIT_COST}`);
          return res.status(402).json({
            success: false,
            error: "Yetersiz kredi",
            requiredCredit: CREDIT_COST,
            currentCredit: currentCredit,
          });
        }

        // Krediyi düş
        const { error: updateError } = await supabase
          .from("users")
          .update({ credit_balance: currentCredit - CREDIT_COST })
          .eq("id", creditOwnerId);

        if (updateError) {
          console.error("❌ Kredi düşme hatası:", updateError);
          return res.status(500).json({
            success: false,
            error: "Kredi düşülemedi",
          });
        }

        creditDeducted = true;
        console.log(
          `✅ ${CREDIT_COST} kredi düşüldü. Kalan: ${currentCredit - CREDIT_COST}`
        );
      } catch (creditErr) {
        console.error("❌ Kredi yönetimi hatası:", creditErr);
        return res.status(500).json({
          success: false,
          error: "Kredi yönetimi sırasında hata oluştu",
        });
      }
    }

    // ── fal.ai pixelcut/background-removal API çağrısı ──
    console.log("🧠 fal.ai pixelcut background removal başlatılıyor...");

    const falResponse = await axios.post(
      FAL_ENDPOINT,
      { image_url: imageUrl },
      {
        headers: {
          Authorization: `Key ${process.env.FAL_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      }
    );

    const output = falResponse.data;
    console.log("✅ fal.ai response alındı");

    // fal.ai çıktısını parse et
    let resultImageUrl = null;
    if (output.image && output.image.url) {
      resultImageUrl = output.image.url;
    } else if (output.images && Array.isArray(output.images) && output.images.length > 0) {
      resultImageUrl = output.images[0].url;
    } else if (typeof output === "string" && output.startsWith("http")) {
      resultImageUrl = output;
    } else {
      resultImageUrl = output.url || null;
    }

    if (!resultImageUrl) {
      throw new Error("fal.ai response did not contain a valid image URL");
    }

    console.log("✅ fal.ai çıktı URL:", resultImageUrl);

    // ── Çıktıyı indir, trim uygula ve Supabase'e yükle ──
    let processedBuffer;
    let trimmedMetadata = null;
    try {
      const processedResp = await axios.get(resultImageUrl, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      let tmpBuffer = Buffer.from(processedResp.data);

      // PNG'ye çevir
      let pngBuffer = await sharp(tmpBuffer).png().toBuffer();

      // Transparent pikselleri trim et
      console.log("🎯 Transparent trimming işlemi başlatılıyor...");
      processedBuffer = await trimTransparentPixels(pngBuffer);

      // Trim sonrası yeni boyutları al
      trimmedMetadata = await sharp(processedBuffer).metadata();
    } catch (procErr) {
      console.warn("⚠️ İşlenen resmi indirirken/işlerken hata:", procErr);
      // Fallback: fal.ai URL'ini direkt döndürelim
      return res.status(200).json({
        success: true,
        removedBgUrl: resultImageUrl,
        originalUrl: imageUrl,
        result: { removed_bg_url: resultImageUrl },
      });
    }

    // Supabase'e yükle ve public URL al
    const fileName = `${uuidv4()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, processedBuffer, {
        contentType: "image/png",
      });
    if (uploadError) throw uploadError;

    const { data: publicUrlData, error: publicUrlError } =
      await supabase.storage.from("images").getPublicUrl(fileName);
    if (publicUrlError) throw publicUrlError;

    const publicUrl = publicUrlData.publicUrl;

    return res.status(200).json({
      success: true,
      removedBgUrl: publicUrl,
      originalUrl: imageUrl,
      result: {
        removed_bg_url: publicUrl,
        trimmed_width: trimmedMetadata?.width,
        trimmed_height: trimmedMetadata?.height,
      },
    });
  } catch (error) {
    console.error("❌ Arkaplan kaldırma hatası:", error);

    // Hata durumunda kredi iadesi
    if (creditDeducted && creditOwnerId && creditBalanceBefore !== null) {
      try {
        console.log(`🔄 Kredi iade ediliyor: ${CREDIT_COST} → ${creditOwnerId}`);
        await supabase
          .from("users")
          .update({ credit_balance: creditBalanceBefore })
          .eq("id", creditOwnerId);
        console.log("✅ Kredi iade edildi");
      } catch (refundErr) {
        console.error("❌ Kredi iade hatası:", refundErr);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Arkaplan kaldırma işlemi sırasında bir hata oluştu",
      error: error.message || "Unknown error",
    });
  }
});

module.exports = router;
