const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { createCanvas, loadImage } = require("canvas");
const { v4: uuidv4 } = require("uuid");

// Supabase istemci oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Kullanıcının pro olup olmadığını kontrol etme fonksiyonu
async function checkUserProStatus(userId) {
  try {
    if (!userId || userId === "anonymous_user") {
      return false;
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("is_pro")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("❌ User pro status kontrol hatası:", error);
      return false;
    }

    const isPro = user?.is_pro === true;
    console.log(`👤 User ${userId.slice(0, 8)} pro status: ${isPro}`);
    
    return isPro;
  } catch (error) {
    console.error("❌ Pro status kontrol hatası:", error);
    return false;
  }
}

// Resme watermark ekleme fonksiyonu - Canvas ile
async function addWatermarkToImage(imageUrl) {
  try {
    console.log("🎨 [DOWNLOAD API] Watermark ekleniyor:", imageUrl);

    // Resmi indir
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const imageBuffer = Buffer.from(imageResponse.data);

    // Canvas ile resmi yükle
    const originalImage = await loadImage(imageBuffer);
    const imageWidth = originalImage.width;
    const imageHeight = originalImage.height;

    console.log(`🖼️ [DOWNLOAD API] Resim boyutu: ${imageWidth}x${imageHeight}`);

    // Canvas oluştur
    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext("2d");

    // Anti-aliasing ayarları
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // Orijinal resmi canvas'e çiz
    ctx.drawImage(originalImage, 0, 0, imageWidth, imageHeight);

    // Watermark ayarları - client-side ile aynı stil
    const watermarkText = "DIRESS";
    const fontSize = Math.max(imageWidth * 0.04, 20);
    
    // Font ayarları
    ctx.font = `900 ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Watermark pozisyonları - client-side ile aynı
    const positions = [
      { x: imageWidth * 0.15, y: imageHeight * 0.15 },
      { x: imageWidth * 0.5, y: imageHeight * 0.1 },
      { x: imageWidth * 0.85, y: imageHeight * 0.15 },
      { x: imageWidth * 0.1, y: imageHeight * 0.35 },
      { x: imageWidth * 0.4, y: imageHeight * 0.3 },
      { x: imageWidth * 0.7, y: imageHeight * 0.35 },
      { x: imageWidth * 0.9, y: imageHeight * 0.3 },
      { x: imageWidth * 0.15, y: imageHeight * 0.55 },
      { x: imageWidth * 0.5, y: imageHeight * 0.5 },
      { x: imageWidth * 0.85, y: imageHeight * 0.55 },
      { x: imageWidth * 0.1, y: imageHeight * 0.75 },
      { x: imageWidth * 0.4, y: imageHeight * 0.7 },
      { x: imageWidth * 0.7, y: imageHeight * 0.75 },
      { x: imageWidth * 0.9, y: imageHeight * 0.7 },
      { x: imageWidth * 0.25, y: imageHeight * 0.9 },
      { x: imageWidth * 0.75, y: imageHeight * 0.9 },
    ];

    // Her pozisyona watermark ekle
    positions.forEach((pos) => {
      ctx.save();
      
      // Pozisyona git
      ctx.translate(pos.x, pos.y);
      
      // 45 derece döndür (diagonal)
      ctx.rotate(-Math.PI / 4);

      // Gölge efekti
      ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 1;
      ctx.shadowOffsetY = 1;

      // Ana text (beyaz, şeffaf)
      ctx.globalAlpha = 0.18; // Client-side ile aynı opacity
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(watermarkText, 0, 0);

      ctx.restore();
    });

    // Canvas'ı buffer'a çevir
    const watermarkedBuffer = canvas.toBuffer("image/png");
    console.log("✅ [DOWNLOAD API] Watermark eklendi, buffer boyutu:", watermarkedBuffer.length);

    return watermarkedBuffer;

  } catch (error) {
    console.error("❌ [DOWNLOAD API] Watermark ekleme hatası:", error);
    throw error;
  }
}

// Download endpoint - Pro kontrolü ile
router.get("/image", async (req, res) => {
  try {
    const { imageUrl, userId } = req.query;

    if (!imageUrl) {
      return res.status(400).json({
        success: false,
        message: "Image URL gereklidir",
      });
    }

    console.log("📥 [DOWNLOAD API] İndirme isteği:", {
      imageUrl: imageUrl.substring(0, 50) + "...",
      userId: userId?.slice(0, 8) || "anonymous",
    });

    // Pro status kontrolü
    const isUserPro = await checkUserProStatus(userId);
    console.log(`👤 [DOWNLOAD API] User pro status: ${isUserPro}`);

    if (isUserPro) {
      // Pro kullanıcı - orijinal resmi redirect et
      console.log("💎 [DOWNLOAD API] Pro kullanıcı - orijinal resim redirect");
      return res.redirect(imageUrl);
    } else {
      // Pro olmayan kullanıcı - watermark ekle
      console.log("🎨 [DOWNLOAD API] Pro olmayan kullanıcı - watermark ekleniyor...");
      
      const watermarkedBuffer = await addWatermarkToImage(imageUrl);
      
      // Watermarked resmi response olarak gönder
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", "attachment; filename=diress_image_watermarked.png");
      res.setHeader("Cache-Control", "no-cache");
      
      console.log("✅ [DOWNLOAD API] Watermarked resim gönderiliyor");
      return res.send(watermarkedBuffer);
    }

  } catch (error) {
    console.error("❌ [DOWNLOAD API] Download hatası:", error);
    return res.status(500).json({
      success: false,
      message: "Download işlemi sırasında hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
