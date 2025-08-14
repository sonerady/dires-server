const express = require("express");
const sharp = require("sharp");
const router = express.Router();

/**
 * Canvas ve Background Removed resimleri yan yana birleştirme endpoint'i
 * POST /api/canvas/combine-images
 */
router.post("/combine-images", async (req, res) => {
  try {
    const {
      canvasBase64,
      backgroundRemovedBase64,
      combineType = "side-by-side",
    } = req.body;

    // Parametreleri kontrol et
    if (!canvasBase64 || !backgroundRemovedBase64) {
      return res.status(400).json({
        success: false,
        message: "Canvas ve background removed base64 resimleri gerekli",
      });
    }

    console.log("🔄 Canvas resim birleştirme başlatılıyor...");
    console.log("📊 Canvas base64 boyutu:", canvasBase64.length);
    console.log(
      "📊 Background removed base64 boyutu:",
      backgroundRemovedBase64.length
    );

    // Base64'leri buffer'a çevir
    const canvasBuffer = Buffer.from(canvasBase64, "base64");
    const backgroundRemovedBuffer = Buffer.from(
      backgroundRemovedBase64,
      "base64"
    );

    // Resim meta bilgilerini al
    const canvasMetadata = await sharp(canvasBuffer).metadata();
    const bgRemovedMetadata = await sharp(backgroundRemovedBuffer).metadata();

    console.log(
      "📐 Canvas boyutları:",
      canvasMetadata.width,
      "x",
      canvasMetadata.height
    );
    console.log(
      "📐 Background removed boyutları:",
      bgRemovedMetadata.width,
      "x",
      bgRemovedMetadata.height
    );

    let combinedBuffer;
    let combinedWidth, combinedHeight;

    if (combineType === "side-by-side") {
      // Yan yana birleştirme - Her iki resmi de 2048x2048 yap
      const targetSize = 2048;
      combinedWidth = targetSize * 2; // 4096
      combinedHeight = targetSize; // 2048

      console.log("🎯 Hedef boyutlar: Her resim 2048x2048, toplam: 4096x2048");

      // Canvas resmini 2048x2048 yap
      const resizedCanvasBuffer = await sharp(canvasBuffer)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toBuffer();

      // Background removed resmini de 2048x2048 yap
      const resizedBgRemovedBuffer = await sharp(backgroundRemovedBuffer)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toBuffer();

      console.log("✅ Her iki resim de 2048x2048 boyutuna getirildi");

      // İki resmi yan yana birleştir
      combinedBuffer = await sharp({
        create: {
          width: combinedWidth,
          height: combinedHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite([
          {
            input: resizedCanvasBuffer,
            top: 0,
            left: 0,
          },
          {
            input: resizedBgRemovedBuffer,
            top: 0,
            left: targetSize, // 2048 pixel sağa
          },
        ])
        .png()
        .toBuffer();
    } else if (combineType === "top-bottom") {
      // Üst-alt birleştirme - Her iki resmi de 2048x2048 yap
      const targetSize = 2048;
      combinedWidth = targetSize; // 2048
      combinedHeight = targetSize * 2; // 4096

      console.log("🎯 Hedef boyutlar: Her resim 2048x2048, toplam: 2048x4096");

      // Canvas resmini 2048x2048 yap
      const resizedCanvasBuffer = await sharp(canvasBuffer)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toBuffer();

      // Background removed resmini de 2048x2048 yap
      const resizedBgRemovedBuffer = await sharp(backgroundRemovedBuffer)
        .resize(targetSize, targetSize, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toBuffer();

      console.log("✅ Her iki resim de 2048x2048 boyutuna getirildi");

      // İki resmi üst-alt birleştir
      combinedBuffer = await sharp({
        create: {
          width: combinedWidth,
          height: combinedHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      })
        .composite([
          {
            input: resizedCanvasBuffer,
            top: 0,
            left: 0,
          },
          {
            input: resizedBgRemovedBuffer,
            top: targetSize, // 2048 pixel aşağı
            left: 0,
          },
        ])
        .png()
        .toBuffer();
    } else {
      return res.status(400).json({
        success: false,
        message:
          'Geçersiz birleştirme tipi. "side-by-side" veya "top-bottom" kullanın.',
      });
    }

    // Birleştirilmiş resmi base64'e çevir
    const combinedBase64 = combinedBuffer.toString("base64");

    console.log("✅ Canvas resimler başarıyla birleştirildi!");
    console.log(
      "📊 Birleştirilmiş resim boyutu:",
      combinedWidth,
      "x",
      combinedHeight
    );
    console.log("📊 Birleştirilmiş base64 boyutu:", combinedBase64.length);

    res.json({
      success: true,
      message: "Canvas resimleri başarıyla birleştirildi",
      combinedBase64: combinedBase64,
      metadata: {
        originalCanvas: {
          width: canvasMetadata.width,
          height: canvasMetadata.height,
        },
        originalBackgroundRemoved: {
          width: bgRemovedMetadata.width,
          height: bgRemovedMetadata.height,
        },
        combined: {
          width: combinedWidth,
          height: combinedHeight,
          combineType: combineType,
        },
      },
    });
  } catch (error) {
    console.error("❌ Canvas resim birleştirme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Canvas resim birleştirme sırasında hata oluştu",
      error: error.message,
    });
  }
});

/**
 * Canvas resim boyutlarını optimize etme endpoint'i (opsiyonel)
 * POST /api/canvas/optimize-for-flux
 */
router.post("/optimize-for-flux", async (req, res) => {
  try {
    const { base64Image, targetWidth = 1024, targetHeight = 1024 } = req.body;

    if (!base64Image) {
      return res.status(400).json({
        success: false,
        message: "Base64 resim gerekli",
      });
    }

    console.log("🔄 Canvas resmi Flux için optimize ediliyor...");

    const imageBuffer = Buffer.from(base64Image, "base64");

    // Resmi hedef boyutlara göre optimize et (Flux Max için ideal boyutlar)
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 }, // Beyaz arkaplan
      })
      .jpeg({ quality: 95 }) // Yüksek kalite JPEG
      .toBuffer();

    const optimizedBase64 = optimizedBuffer.toString("base64");

    console.log("✅ Canvas resmi Flux için optimize edildi!");
    console.log("📊 Optimize edilmiş boyut:", targetWidth, "x", targetHeight);

    res.json({
      success: true,
      message: "Canvas resmi Flux için optimize edildi",
      optimizedBase64: optimizedBase64,
      metadata: {
        targetWidth,
        targetHeight,
        format: "jpeg",
        quality: 95,
      },
    });
  } catch (error) {
    console.error("❌ Canvas resim optimizasyon hatası:", error);
    res.status(500).json({
      success: false,
      message: "Canvas resim optimizasyon sırasında hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
