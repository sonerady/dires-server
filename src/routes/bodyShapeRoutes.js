const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

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

// Diziyi karıştıran yardımcı fonksiyon
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

// Dosya adından başlık oluşturan yardımcı fonksiyon
const formatTitle = (filename) => {
  if (!filename) return "shape";
  return filename
    .replace(/\.png|\.jpg|\.jpeg/gi, "") // Uzantıları kaldır
    .replace(/[-_]/g, " ") // Tire ve alt çizgiyi boşlukla değiştir
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1)) // İlk harfleri büyüt
    .join(" ");
};

// Supabase bucket'tan resimleri getiren fonksiyon
const getImagesFromBucket = async (bucketName, category) => {
  try {
    console.log(`Fetching images from bucket: ${bucketName}`);

    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list("", {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      console.error(`Error fetching from ${bucketName}:`, error);
      return [];
    }

    if (!files || files.length === 0) {
      console.log(`No files found in bucket: ${bucketName}`);
      return [];
    }

    // Sadece resim dosyalarını filtrele
    const imageFiles = files.filter((file) =>
      file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)
    );

    console.log(`Found ${imageFiles.length} image files in ${bucketName}`);

    // Her dosya için public URL oluştur
    const bodyShapes = imageFiles.map((file, index) => {
      const { data } = supabase.storage
        .from(bucketName)
        .getPublicUrl(file.name);

      return {
        id: `${category}-${file.name.replace(/\.[^/.]+$/, "")}-${index}`,
        title: formatTitle(file.name),
        image: optimizeImageUrl(data.publicUrl),
        category: category,
        fileName: file.name,
      };
    });

    console.log(`Processed ${bodyShapes.length} ${category} body shapes`);
    return bodyShapes;
  } catch (error) {
    console.error(`Error processing ${bucketName}:`, error);
    return [];
  }
};

// Verileri sayfalama fonksiyonu
const paginateData = (data, page, limit) => {
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

// Test endpointi
router.get("/test", async (req, res) => {
  try {
    const manShapes = await getImagesFromBucket("man-body-shapes", "man");
    const womanShapes = await getImagesFromBucket("woman-body-shapes", "woman");

    res.json({
      success: true,
      message: "Body Shape API çalışıyor",
      manCount: manShapes.length,
      womanCount: womanShapes.length,
      totalBodyShapes: manShapes.length + womanShapes.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Test endpoint hatası",
      error: error.message,
    });
  }
});

// Man body shapes endpoint
router.get("/man", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const manShapes = await getImagesFromBucket("man-body-shapes", "man");
    const { paginatedItems, hasMore, total } = paginateData(
      manShapes,
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
      message: "Man body shapes yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

// Woman body shapes endpoint
router.get("/woman", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const womanShapes = await getImagesFromBucket("woman-body-shapes", "woman");
    const { paginatedItems, hasMore, total } = paginateData(
      womanShapes,
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
      message: "Woman body shapes yüklenirken hata oluştu",
      error: error.message,
    });
  }
});

module.exports = router;
 