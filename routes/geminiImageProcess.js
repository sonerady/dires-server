const express = require("express");
const router = express.Router();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// Gemini API yapılandırması
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Sonuçlar için klasör yolu
const resultsDir = path.join(__dirname, "../results");

// Klasör yoksa oluştur
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

router.post("/", async (req, res) => {
  try {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "Görsel verisi bulunamadı" });
    }

    // Base64'ten buffer'a çevir
    const imageData = Buffer.from(image.split(",")[1], "base64");

    // Benzersiz dosya adı oluştur
    const fileName = `${uuidv4()}.jpg`;
    const filePath = path.join(resultsDir, fileName);

    // Görseli kaydet
    fs.writeFileSync(filePath, imageData);

    // Gemini modelini başlat
    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    // Görseli işle
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageData.toString("base64"),
        },
      },
      "Bu görseli profesyonel bir ürün fotoğrafına dönüştür. Parlaklık, kontrast ve renk dengesini optimize et.",
    ]);

    const response = await result.response;
    const text = response.text();

    // İşlenmiş görselin URL'sini döndür
    res.json({
      imageUrl: `/results/${fileName}`,
      description: text,
    });
  } catch (error) {
    console.error("Görsel işleme hatası:", error);
    res.status(500).json({ error: "Görsel işlenirken bir hata oluştu" });
  }
});

module.exports = router;
