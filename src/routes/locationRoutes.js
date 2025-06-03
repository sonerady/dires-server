const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

// JSON dosyalarının yolları - src/lib dizinine işaret edecek şekilde güncellendi
const indoorImagesPath = path.join(__dirname, "../lib/indoor_images.json");
const studioImagesPath = path.join(__dirname, "../lib/studio_images.json");
const outdoorImagesPath = path.join(__dirname, "../lib/outdoor_images.json");

// Dosya yollarını konsola yazdırarak kontrol et
console.log("Indoor images path:", indoorImagesPath);
console.log("Studio images path:", studioImagesPath);
console.log("Outdoor images path:", outdoorImagesPath);

// Resim URL'lerine boyut parametresi ekleyen yardımcı fonksiyon
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;
  // Sadece supabase URL'lerini işle
  if (imageUrl.includes("supabase.co/storage")) {
    const hasParams = imageUrl.includes("?");
    return `${imageUrl}${hasParams ? "&" : "?"}width=512&height=512`;
  }
  return imageUrl;
};

// Dosya adından başlık oluşturan yardımcı fonksiyon - KÜÇÜK HARFLERLE
const formatTitle = (filename) => {
  if (!filename) return "location";
  return (
    filename
      .replace(/\.png|\.jpg|\.jpeg/gi, "") // Uzantıları kaldır
      // Baş harfleri büyütme kısmını kaldırdık
      .toLowerCase()
  ); // Tüm metni küçük harfe çevir
};

// Diziyi karıştıran yardımcı fonksiyon - HER SORGUDA FARKLI SIRALAMA İÇİN
const shuffleArray = (array) => {
  // Dizinin bir kopyasını oluştur
  const shuffled = [...array];
  // Fisher-Yates (Knuth) Shuffle algoritması
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; // Elemanları değiştir
  }
  return shuffled;
};

// JSON dosyalarını oku ve işle
const loadAndProcessLocations = (filePath, category) => {
  try {
    const fileData = fs.readFileSync(filePath, "utf8");
    let items = JSON.parse(fileData);
    items = items.map((item, index) => ({
      id: `${category}-${item.name || index}`, // Benzersiz ID oluştur (dosya adı + kategori)
      title: formatTitle(item.name),
      image: optimizeImageUrl(item.image),
      category: category,
    }));
    console.log(`${items.length} ${category} lokasyonu yüklendi.`);
    return items;
  } catch (error) {
    console.error(`${category} lokasyonları yüklenirken hata:`, error);
    return [];
  }
};

const indoorLocations = loadAndProcessLocations(indoorImagesPath, "indoor");
const studioLocations = loadAndProcessLocations(studioImagesPath, "studio");
const outdoorLocations = loadAndProcessLocations(outdoorImagesPath, "outdoor");

// Test endpointi
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Lokasyon API çalışıyor",
    indoorCount: indoorLocations.length,
    studioCount: studioLocations.length,
    outdoorCount: outdoorLocations.length,
    totalLocations:
      indoorLocations.length + studioLocations.length + outdoorLocations.length,
  });
});

const paginateData = (data, page, limit) => {
  // Veriyi önce karıştır
  const shuffledData = shuffleArray(data);
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedItems = shuffledData.slice(startIndex, endIndex);
  return {
    paginatedItems,
    hasMore: endIndex < data.length,
    total: data.length,
  };
};

// Indoor lokasyonlarını getir
router.get("/indoor", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { paginatedItems, hasMore, total } = paginateData(
      indoorLocations,
      page,
      limit
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      hasMore,
      data: paginatedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Indoor lokasyonları yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Studio lokasyonlarını getir
router.get("/studio", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { paginatedItems, hasMore, total } = paginateData(
      studioLocations,
      page,
      limit
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      hasMore,
      data: paginatedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Studio lokasyonları yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Outdoor lokasyonlarını getir
router.get("/outdoor", (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const { paginatedItems, hasMore, total } = paginateData(
      outdoorLocations,
      page,
      limit
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      hasMore,
      data: paginatedItems,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Outdoor lokasyonları yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
