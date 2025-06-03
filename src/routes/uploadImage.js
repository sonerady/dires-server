const express = require("express");
const supabase = require("../supabaseClient"); // Supabase client'ı
const router = express.Router();
const multer = require("multer"); // Dosya yüklemek için kullanılıyor
const upload = multer(); // Geçici olarak bellekte tutmak için

router.post("/upload", upload.array("files", 10), async (req, res) => {
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ message: "Dosya gerekli." });
  }

  try {
    const publicUrls = [];

    for (const file of files) {
      // Dosya ismi oluşturma
      const fileName = `${Date.now()}_${file.originalname}`;

      // Dosyayı Supabase bucket'ına yüklüyoruz
      const { data, error } = await supabase.storage
        .from("images") // Bucket adınız
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
        });

      if (error) {
        throw error;
      }

      // Dosyanın herkese açık URL'sini alıyoruz
      const { data: publicUrlData, error: urlError } = await supabase.storage
        .from("images")
        .getPublicUrl(fileName);

      if (urlError) {
        throw urlError;
      }

      publicUrls.push(publicUrlData.publicUrl);
    }

    // Yüklenen URL'leri console'a yazdır
    console.log("Uploaded URLs:", publicUrls);

    // URL'leri JSON formatında döndür
    res.status(200).json(publicUrls);
  } catch (error) {
    console.error("Dosya yükleme hatası:", error);
    res
      .status(500)
      .json({ message: "Dosya yüklenemedi.", error: error.message });
  }
});

// Yeni upload endpoint - FaceSwap ve Upscale için
router.post("/upload-to-storage", async (req, res) => {
  try {
    const { base64Image, folder = "uploads", filename } = req.body;

    if (!base64Image) {
      return res.status(400).json({
        success: false,
        message: "Base64 image data is required",
      });
    }

    // Base64'ten binary data'ya çevir
    let base64Data = base64Image;
    if (base64Image.includes(",")) {
      base64Data = base64Image.split(",")[1];
    }

    const binaryString = Buffer.from(base64Data, "base64").toString("binary");
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Dosya adı oluştur
    const uniqueFilename =
      filename ||
      `${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;
    const filePath = `${folder}/${uniqueFilename}`;

    console.log("Uploading to Supabase storage:", {
      path: filePath,
      size: bytes.length,
    });

    // Supabase'e yükle
    const { data, error } = await supabase.storage
      .from("images")
      .upload(filePath, bytes.buffer, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: false,
      });

    if (error) {
      console.error("Supabase upload error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to upload to storage",
        error: error.message,
      });
    }

    // Public URL al
    const { data: urlData } = supabase.storage
      .from("images")
      .getPublicUrl(data.path);

    console.log("Upload successful:", urlData.publicUrl);

    res.status(200).json({
      success: true,
      publicUrl: urlData.publicUrl,
      path: data.path,
    });
  } catch (error) {
    console.error("Upload API error:", error);
    res.status(500).json({
      success: false,
      message: "Server error during upload",
      error: error.message,
    });
  }
});

// Test endpoint
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Upload API is working!",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
