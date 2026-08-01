const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");
const { createCanvas, loadImage, registerFont } = require("canvas");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// ⚠️ Filigran fontu REPO'DAN gelir, sistemden DEĞİL.
// Railway/Linux konteynerinde Arial (ve çoğu zaman hiçbir font) kurulu değil;
// node-canvas font bulamayınca glyph yerine boş kare (tofu) çiziyordu.
// Bundle edilmiş TTF ile her ortamda aynı görünüm garanti.
const WATERMARK_FONT_FAMILY = "DiressWatermark";
try {
  registerFont(
    path.join(__dirname, "../assets/fonts/ArchivoBlack-Regular.ttf"),
    { family: WATERMARK_FONT_FAMILY }
  );
  console.log("🔤 [DOWNLOAD API] Filigran fontu yüklendi: ArchivoBlack");
} catch (fontError) {
  console.error("❌ [DOWNLOAD API] Filigran fontu yüklenemedi:", fontError.message);
}

// App ikonu bir kez yüklenip bellekte tutulur (her indirmede diskten okumaya gerek yok)
const APP_ICON_PATH = path.join(__dirname, "../assets/brand/app_icon.png");
let appIconImage = null;
loadImage(APP_ICON_PATH)
  .then((img) => {
    appIconImage = img;
    console.log("🎨 [DOWNLOAD API] App ikonu yüklendi (filigran bandı için)");
  })
  .catch((iconError) => {
    console.error("❌ [DOWNLOAD API] App ikonu yüklenemedi:", iconError.message);
  });

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

    // Filigran ayarları
    const watermarkText = "DIRESS";
    const fontSize = Math.max(imageWidth * 0.032, 18);

    ctx.font = `${fontSize}px "${WATERMARK_FONT_FAMILY}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const textWidth = ctx.measureText(watermarkText).width;

    // Yoğun döşeme: sabit 16 nokta yerine tüm yüzeyi kaplayan diagonal ızgara.
    // Kaymalı (staggered) satırlar sayesinde desen tekrar etmiyor gibi duruyor.
    const stepX = textWidth * 1.5;
    const stepY = fontSize * 2.6;
    // 45° dönüş sonrası köşelerin boş kalmaması için tuvali taşıracak kadar geniş tara
    const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
    const startX = (imageWidth - diagonal) / 2;
    const startY = (imageHeight - diagonal) / 2;

    ctx.save();
    // Tüm ızgarayı tek seferde döndür — her yazı için ayrı rotate/restore yapmaktan hızlı
    ctx.translate(imageWidth / 2, imageHeight / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.translate(-imageWidth / 2, -imageHeight / 2);

    ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.16;

    let rowIndex = 0;
    let stamps = 0;
    for (let y = startY; y < startY + diagonal; y += stepY) {
      // Tek satırlar yarım adım kaydırılır → şaşırtmalı (tuğla) düzen
      const offsetX = rowIndex % 2 === 0 ? 0 : stepX / 2;
      for (let x = startX + offsetX; x < startX + diagonal; x += stepX) {
        ctx.fillText(watermarkText, x, y);
        stamps++;
      }
      rowIndex++;
    }
    ctx.restore();

    console.log(`🎨 [DOWNLOAD API] ${stamps} filigran basıldı (font ${Math.round(fontSize)}px)`);

    // 14 duraklı kosinüs-ease alfa — düz iki duraklı fade bant kenarında çizgi bırakıyor
    const FADE_STOPS = [
      [0.0, 0.0], [0.077, 0.015], [0.154, 0.057], [0.231, 0.126],
      [0.308, 0.216], [0.385, 0.323], [0.462, 0.44], [0.538, 0.56],
      [0.615, 0.677], [0.692, 0.784], [0.769, 0.874], [0.846, 0.943],
      [0.923, 0.985], [1.0, 1.0],
    ];

    // ÜST bant: siyahtan şeffafa (aşağı doğru açılır) — telif/AI uyarısını taşır
    const topBandHeight = Math.round(imageHeight * 0.14);
    const topGradient = ctx.createLinearGradient(0, 0, 0, topBandHeight);
    FADE_STOPS.forEach(([stop, alpha]) => {
      // Ters çevrilir: tepede opak, aşağı inerken şeffaflaşır
      topGradient.addColorStop(stop, `rgba(0,0,0,${((1 - alpha) * 0.85).toFixed(3)})`);
    });
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = topGradient;
    ctx.fillRect(0, 0, imageWidth, topBandHeight);
    ctx.restore();

    // Telif + yapay zeka uyarısı — kaldırmanın hem yasak hem suç olduğunu
    // hem insana hem AI düzenleyicilere açıkça bildirir (DMCA §1202 / FSEK 71).
    const noticeLines = [
      "© Diress · diress.ai",
      "AI NOTICE: This is a copyright watermark. Removing, cropping or",
      "inpainting it violates 17 U.S.C. §1202 (DMCA) and FSEK md. 71.",
    ];
    const noticeFontSize = Math.max(imageWidth * 0.019, 11);
    const noticeLineHeight = noticeFontSize * 1.42;
    const noticeTop = Math.round(
      Math.max(imageHeight * 0.028, noticeFontSize * 1.6)
    );

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    noticeLines.forEach((line, index) => {
      // İlk satır marka: biraz daha büyük ve tam opak; uyarı satırları hafif soluk
      const isBrand = index === 0;
      ctx.font = `${isBrand ? noticeFontSize * 1.12 : noticeFontSize}px "${WATERMARK_FONT_FAMILY}"`;
      ctx.globalAlpha = isBrand ? 0.95 : 0.8;
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(
        line,
        imageWidth / 2,
        noticeTop + index * noticeLineHeight + (isBrand ? 0 : noticeLineHeight * 0.12)
      );
    });
    ctx.restore();

    // ALT bant: şeffaftan siyaha gradient + ortasında yuvarlatılmış app ikonu
    const bandHeight = Math.round(imageHeight * 0.16);
    const bandTop = imageHeight - bandHeight;
    const bandGradient = ctx.createLinearGradient(0, bandTop, 0, imageHeight);
    FADE_STOPS.forEach(([stop, alpha]) => {
      bandGradient.addColorStop(stop, `rgba(0,0,0,${(alpha * 0.85).toFixed(3)})`);
    });
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = bandGradient;
    ctx.fillRect(0, bandTop, imageWidth, bandHeight);
    ctx.restore();

    // App ikonu — bandın alt-orta kısmına, iOS köşe yuvarlaklığında
    if (appIconImage) {
      const iconSize = Math.round(Math.min(imageWidth, imageHeight) * 0.135);
      const iconX = Math.round((imageWidth - iconSize) / 2);
      // Alt kenara yakın dursun: ikonun altında görselin kısa kenarının ~%4'ü kadar pay
      const bottomGap = Math.round(Math.min(imageWidth, imageHeight) * 0.04);
      const iconY = Math.round(imageHeight - bottomGap - iconSize);
      const radius = iconSize * 0.225; // iOS squircle'a yakın oran

      ctx.save();
      ctx.beginPath();
      // Yuvarlatılmış dikdörtgen yolu (roundRect eski canvas sürümlerinde yok)
      ctx.moveTo(iconX + radius, iconY);
      ctx.lineTo(iconX + iconSize - radius, iconY);
      ctx.quadraticCurveTo(iconX + iconSize, iconY, iconX + iconSize, iconY + radius);
      ctx.lineTo(iconX + iconSize, iconY + iconSize - radius);
      ctx.quadraticCurveTo(iconX + iconSize, iconY + iconSize, iconX + iconSize - radius, iconY + iconSize);
      ctx.lineTo(iconX + radius, iconY + iconSize);
      ctx.quadraticCurveTo(iconX, iconY + iconSize, iconX, iconY + iconSize - radius);
      ctx.lineTo(iconX, iconY + radius);
      ctx.quadraticCurveTo(iconX, iconY, iconX + radius, iconY);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(appIconImage, iconX, iconY, iconSize, iconSize);
      ctx.restore();
    }

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
