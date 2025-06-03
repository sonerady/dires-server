const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// JSON dosyasının yolu - src/lib dizinine işaret edecek şekilde
const backgroundsPath = path.join(__dirname, "../lib/backgrounds.json");

// Dosya yolunu konsola yazdırarak kontrol et
console.log("Backgrounds path:", backgroundsPath);

// Global değişkenler
let allBackgrounds = [];
let natureBackgrounds = [];
let classicsBackgrounds = [];

// JSON dosyasını oku ve işle
const loadBackgrounds = () => {
  try {
    console.log("🔍 Background JSON dosyası okunuyor:", backgroundsPath);

    // Dosyanın var olup olmadığını kontrol et
    if (!fs.existsSync(backgroundsPath)) {
      console.error("❌ Background JSON dosyası bulunamadı:", backgroundsPath);
      return;
    }

    // JSON dosyasını oku
    const backgroundsData = JSON.parse(
      fs.readFileSync(backgroundsPath, "utf8")
    );
    console.log(
      "✅ JSON dosyası başarıyla okundu, kategori sayısı:",
      backgroundsData.length
    );

    allBackgrounds = [];
    natureBackgrounds = [];
    classicsBackgrounds = [];

    // Her kategorideki background'ları işle
    backgroundsData.forEach((category) => {
      if (category.subCategories && Array.isArray(category.subCategories)) {
        category.subCategories.forEach((background) => {
          const backgroundItem = {
            category: category.category,
            subCategory: background.subCategory,
            prompt: background.prompt,
            image: background.image,
          };

          // Tüm background'lara ekle
          allBackgrounds.push(backgroundItem);

          // Kategoriye göre ayır
          if (category.category === "nature") {
            natureBackgrounds.push(backgroundItem);
          } else if (category.category === "classics") {
            classicsBackgrounds.push(backgroundItem);
          }
        });
      }
    });

    console.log("✅ Background'lar başarıyla yüklendi:");
    console.log(`   - Toplam: ${allBackgrounds.length}`);
    console.log(`   - Nature: ${natureBackgrounds.length}`);
    console.log(`   - Classics: ${classicsBackgrounds.length}`);
  } catch (error) {
    console.error("❌ Background'lar yüklenirken hata:", error.message);
    console.error("🔍 Hata detayı:", error);
  }
};

// Sunucu başladığında background'ları yükle
loadBackgrounds();

// Test endpoint'i - API çalışıyor mu kontrol et
router.get("/test", (req, res) => {
  res.json({
    message: "Background API çalışıyor!",
    timestamp: new Date().toISOString(),
    totalBackgrounds: allBackgrounds.length,
    natureBackgrounds: natureBackgrounds.length,
    classicsBackgrounds: classicsBackgrounds.length,
  });
});

// Tüm background'ları getir
router.get("/all", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const paginatedBackgrounds = allBackgrounds.slice(startIndex, endIndex);

  res.json({
    success: true,
    count: paginatedBackgrounds.length,
    total: allBackgrounds.length,
    page: page,
    totalPages: Math.ceil(allBackgrounds.length / limit),
    hasMore: endIndex < allBackgrounds.length,
    data: paginatedBackgrounds,
  });
});

// Nature kategori background'larını getir
router.get("/nature", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const paginatedBackgrounds = natureBackgrounds.slice(startIndex, endIndex);

  res.json({
    success: true,
    category: "nature",
    count: paginatedBackgrounds.length,
    total: natureBackgrounds.length,
    page: page,
    totalPages: Math.ceil(natureBackgrounds.length / limit),
    hasMore: endIndex < natureBackgrounds.length,
    data: paginatedBackgrounds,
  });
});

// Classics kategori background'larını getir
router.get("/classics", (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  const paginatedBackgrounds = classicsBackgrounds.slice(startIndex, endIndex);

  res.json({
    success: true,
    category: "classics",
    count: paginatedBackgrounds.length,
    total: classicsBackgrounds.length,
    page: page,
    totalPages: Math.ceil(classicsBackgrounds.length / limit),
    hasMore: endIndex < classicsBackgrounds.length,
    data: paginatedBackgrounds,
  });
});

// Dinamik kategori endpoint'i
router.get("/:category", (req, res) => {
  const { category } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Belirtilen kategorideki background'ları filtrele
  const categoryBackgrounds = allBackgrounds.filter(
    (bg) => bg.category.toLowerCase() === category.toLowerCase()
  );

  if (categoryBackgrounds.length === 0) {
    return res.status(404).json({
      success: false,
      message: `'${category}' kategorisinde background bulunamadı`,
      availableCategories: [
        ...new Set(allBackgrounds.map((bg) => bg.category)),
      ],
    });
  }

  const paginatedBackgrounds = categoryBackgrounds.slice(startIndex, endIndex);

  res.json({
    success: true,
    category: category,
    count: paginatedBackgrounds.length,
    total: categoryBackgrounds.length,
    page: page,
    totalPages: Math.ceil(categoryBackgrounds.length / limit),
    hasMore: endIndex < categoryBackgrounds.length,
    data: paginatedBackgrounds,
  });
});

module.exports = router;
