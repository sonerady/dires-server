const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

// Supabase resim URL'lerini optimize eden yardımcı fonksiyon (düşük boyut için)
const optimizeImageUrl = (imageUrl) => {
  if (!imageUrl) return imageUrl;

  // Supabase storage URL'si ise optimize et - dikey kartlar için yüksek boyut (custom domain desteği ile)
  if (imageUrl.includes("/storage/v1/")) {
    // Eğer zaten render URL'i ise, query parametrelerini güncelle
    if (imageUrl.includes("/storage/v1/render/image/public/")) {
      // Mevcut query parametrelerini kaldır ve yeni ekle
      const baseUrl = imageUrl.split("?")[0];
      return baseUrl + "?width=600&height=1200&quality=80";
    }
    // Normal object URL'i ise render URL'ine çevir
    return (
      imageUrl.replace(
        "/storage/v1/object/public/",
        "/storage/v1/render/image/public/"
      ) + "?width=600&height=1200&quality=80"
    );
  }

  return imageUrl;
};

// Hair styles JSON dosyalarının yolları
const WOMAN_HAIR_STYLES_FILE = path.join(
  __dirname,
  "../../lib/woman_hair_style_new.json"
);
const MAN_HAIR_STYLES_FILE = path.join(
  __dirname,
  "../../lib/man_hair_style_new.json"
);

// Deterministik ID oluşturma fonksiyonu
const generateHairStyleId = (style, categoryKey, gender) => {
  // key, category ve gender'dan deterministik ID oluştur
  const uniqueString = `${gender}-${categoryKey}-${
    style.key || style.prompt?.substring(0, 50)
  }`;
  return crypto.createHash("md5").update(uniqueString).digest("hex");
};

// GET HAIR STYLES BY GENDER
router.get("/styles/:gender", async (req, res) => {
  try {
    const { gender } = req.params;
    const { category = null, limit = 50, offset = 0 } = req.query;

    console.log(`📱 Hair styles fetch - gender: ${gender}`);
    console.log(`📝 Category filter: ${category}`);
    console.log(`📄 Pagination: limit=${limit}, offset=${offset}`);

    // Gender validation
    if (!["woman", "man"].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid gender. Use 'woman' or 'man'",
      });
    }

    // JSON dosyasını seç
    const jsonFile =
      gender.toLowerCase() === "woman"
        ? WOMAN_HAIR_STYLES_FILE
        : MAN_HAIR_STYLES_FILE;

    // Dosya varlığını kontrol et
    if (!fs.existsSync(jsonFile)) {
      console.error(`❌ Hair styles file not found: ${jsonFile}`);
      return res.status(404).json({
        success: false,
        error: `Hair styles data not found for ${gender}`,
      });
    }

    // JSON dosyasını oku
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    let allStyles = [];
    let filteredCategories = hairData.categories;

    // Kategori filtresi varsa uygula
    if (category) {
      filteredCategories = hairData.categories.filter(
        (cat) => cat.category_key.toLowerCase() === category.toLowerCase()
      );
      console.log(
        `🔍 Filtered to category: ${category}, found ${filteredCategories.length} categories`
      );
    }

    // Tüm style'ları topla (sadece image_url olanlar)
    for (const cat of filteredCategories) {
      for (const style of cat.styles) {
        // image_url yoksa skip et
        if (!style.image_url || style.image_url.trim() === "") {
          continue;
        }

        allStyles.push({
          ...style,
          // Image URL'yi optimize et
          image_url: optimizeImageUrl(style.image_url),
          // Deterministik ID oluştur
          id:
            style.id ||
            generateHairStyleId(style, cat.category_key, gender.toLowerCase()),
          category_key: cat.category_key,
          category_title: cat.title,
          gender: gender.toLowerCase(),
        });
      }
    }

    // Hair styles'ları karıştır (shuffle) - Her API çağrısında farklı sıralama için
    for (let i = allStyles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allStyles[i], allStyles[j]] = [allStyles[j], allStyles[i]];
    }

    console.log(`📊 Total styles found: ${allStyles.length} (shuffled)`);

    // Pagination uygula
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedStyles = allStyles.slice(startIndex, endIndex);

    console.log(
      `📄 Returning ${paginatedStyles.length} styles (${startIndex}-${endIndex})`
    );

    res.json({
      success: true,
      data: paginatedStyles,
      count: paginatedStyles.length,
      total: allStyles.length,
      hasMore: endIndex < allStyles.length,
      gender: gender.toLowerCase(),
      categories: filteredCategories.map((cat) => ({
        key: cat.category_key,
        title: cat.title,
        count: cat.styles.length,
      })),
    });
  } catch (error) {
    console.error("❌ Hair styles fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Hair styles could not be fetched",
      details: error.message,
    });
  }
});

// GET HAIR STYLE CATEGORIES BY GENDER
router.get("/categories/:gender", async (req, res) => {
  try {
    const { gender } = req.params;

    console.log(`📂 Hair style categories fetch - gender: ${gender}`);

    // Gender validation
    if (!["woman", "man"].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid gender. Use 'woman' or 'man'",
      });
    }

    // JSON dosyasını seç
    const jsonFile =
      gender.toLowerCase() === "woman"
        ? WOMAN_HAIR_STYLES_FILE
        : MAN_HAIR_STYLES_FILE;

    // Dosya varlığını kontrol et
    if (!fs.existsSync(jsonFile)) {
      console.error(`❌ Hair styles file not found: ${jsonFile}`);
      return res.status(404).json({
        success: false,
        error: `Hair styles data not found for ${gender}`,
      });
    }

    // JSON dosyasını oku
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    // Kategori bilgilerini hazırla
    const categories = hairData.categories.map((cat) => ({
      key: cat.category_key,
      title: cat.title,
      count: cat.styles.length,
      gender: gender.toLowerCase(),
      // İlk birkaç style'ın preview'ını ekle
      preview: cat.styles.slice(0, 3).map((style) => ({
        key: style.key,
        image_url: style.image_url,
      })),
    }));

    console.log(`📂 Found ${categories.length} categories`);

    res.json({
      success: true,
      data: categories,
      count: categories.length,
      gender: gender.toLowerCase(),
    });
  } catch (error) {
    console.error("❌ Hair style categories fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Hair style categories could not be fetched",
      details: error.message,
    });
  }
});

// GET SPECIFIC HAIR STYLE BY KEY
router.get("/style/:gender/:styleKey", async (req, res) => {
  try {
    const { gender, styleKey } = req.params;

    console.log(
      `🔍 Specific hair style fetch - gender: ${gender}, key: ${styleKey}`
    );

    // Gender validation
    if (!["woman", "man"].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid gender. Use 'woman' or 'man'",
      });
    }

    // JSON dosyasını seç
    const jsonFile =
      gender.toLowerCase() === "woman"
        ? WOMAN_HAIR_STYLES_FILE
        : MAN_HAIR_STYLES_FILE;

    // Dosya varlığını kontrol et
    if (!fs.existsSync(jsonFile)) {
      console.error(`❌ Hair styles file not found: ${jsonFile}`);
      return res.status(404).json({
        success: false,
        error: `Hair styles data not found for ${gender}`,
      });
    }

    // JSON dosyasını oku
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    // Style'ı bul
    let foundStyle = null;
    let foundCategory = null;

    for (const category of hairData.categories) {
      const style = category.styles.find((s) => s.key === styleKey);
      if (style) {
        foundStyle = {
          ...style,
          // Image URL'yi optimize et
          image_url: optimizeImageUrl(style.image_url),
          // Deterministik ID oluştur
          id:
            style.id ||
            generateHairStyleId(
              style,
              category.category_key,
              gender.toLowerCase()
            ),
          category_key: category.category_key,
          category_title: category.title,
          gender: gender.toLowerCase(),
        };
        foundCategory = {
          key: category.category_key,
          title: category.title,
        };
        break;
      }
    }

    if (!foundStyle) {
      return res.status(404).json({
        success: false,
        error: `Hair style not found: ${styleKey}`,
      });
    }

    console.log(`✅ Found hair style: ${foundStyle.key}`);

    res.json({
      success: true,
      data: foundStyle,
      category: foundCategory,
      gender: gender.toLowerCase(),
    });
  } catch (error) {
    console.error("❌ Specific hair style fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Hair style could not be fetched",
      details: error.message,
    });
  }
});

// SEARCH HAIR STYLES
router.get("/search/:gender", async (req, res) => {
  try {
    const { gender } = req.params;
    const { q = "", category = null, limit = 20 } = req.query;

    console.log(`🔍 Hair styles search - gender: ${gender}, query: "${q}"`);

    // Gender validation
    if (!["woman", "man"].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid gender. Use 'woman' or 'man'",
      });
    }

    if (!q.trim()) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    // JSON dosyasını seç
    const jsonFile =
      gender.toLowerCase() === "woman"
        ? WOMAN_HAIR_STYLES_FILE
        : MAN_HAIR_STYLES_FILE;

    // Dosya varlığını kontrol et
    if (!fs.existsSync(jsonFile)) {
      console.error(`❌ Hair styles file not found: ${jsonFile}`);
      return res.status(404).json({
        success: false,
        error: `Hair styles data not found for ${gender}`,
      });
    }

    // JSON dosyasını oku
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    let searchResults = [];
    const searchTerm = q.toLowerCase().trim();

    // Tüm style'larda ara
    for (const cat of hairData.categories) {
      // Kategori filtresi varsa uygula
      if (
        category &&
        cat.category_key.toLowerCase() !== category.toLowerCase()
      ) {
        continue;
      }

      for (const style of cat.styles) {
        // image_url yoksa skip et
        if (!style.image_url || style.image_url.trim() === "") {
          continue;
        }

        // Key, prompt içinde ara
        const matchesKey = style.key.toLowerCase().includes(searchTerm);
        const matchesPrompt = style.prompt.toLowerCase().includes(searchTerm);
        const matchesCategoryTitle = cat.title
          .toLowerCase()
          .includes(searchTerm);

        if (matchesKey || matchesPrompt || matchesCategoryTitle) {
          searchResults.push({
            ...style,
            // Image URL'yi optimize et
            image_url: optimizeImageUrl(style.image_url),
            // ID yoksa UUID ata, varsa mevcut ID'yi kullan
            id: style.id || uuidv4(),
            category_key: cat.category_key,
            category_title: cat.title,
            gender: gender.toLowerCase(),
            // Match score (basit scoring)
            score: matchesKey ? 3 : matchesPrompt ? 2 : 1,
          });
        }
      }
    }

    // Score'a göre sırala (yüksek score önce)
    searchResults.sort((a, b) => b.score - a.score);

    // Limit uygula
    const limitedResults = searchResults.slice(0, parseInt(limit));

    console.log(
      `🎯 Found ${searchResults.length} results, returning ${limitedResults.length}`
    );

    res.json({
      success: true,
      data: limitedResults,
      count: limitedResults.length,
      total: searchResults.length,
      query: q,
      gender: gender.toLowerCase(),
    });
  } catch (error) {
    console.error("❌ Hair styles search error:", error);
    res.status(500).json({
      success: false,
      error: "Hair styles search failed",
      details: error.message,
    });
  }
});

// GET RANDOM HAIR STYLES
router.get("/random/:gender", async (req, res) => {
  try {
    const { gender } = req.params;
    const { count = 10, category = null } = req.query;

    console.log(
      `🎲 Random hair styles fetch - gender: ${gender}, count: ${count}`
    );

    // Gender validation
    if (!["woman", "man"].includes(gender.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: "Invalid gender. Use 'woman' or 'man'",
      });
    }

    // JSON dosyasını seç
    const jsonFile =
      gender.toLowerCase() === "woman"
        ? WOMAN_HAIR_STYLES_FILE
        : MAN_HAIR_STYLES_FILE;

    // Dosya varlığını kontrol et
    if (!fs.existsSync(jsonFile)) {
      console.error(`❌ Hair styles file not found: ${jsonFile}`);
      return res.status(404).json({
        success: false,
        error: `Hair styles data not found for ${gender}`,
      });
    }

    // JSON dosyasını oku
    const hairData = JSON.parse(fs.readFileSync(jsonFile, "utf8"));

    let allStyles = [];

    // Tüm style'ları topla
    for (const cat of hairData.categories) {
      // Kategori filtresi varsa uygula
      if (
        category &&
        cat.category_key.toLowerCase() !== category.toLowerCase()
      ) {
        continue;
      }

      for (const style of cat.styles) {
        // image_url yoksa skip et
        if (!style.image_url || style.image_url.trim() === "") {
          continue;
        }

        allStyles.push({
          ...style,
          // Image URL'yi optimize et
          image_url: optimizeImageUrl(style.image_url),
          // Deterministik ID oluştur
          id:
            style.id ||
            generateHairStyleId(style, cat.category_key, gender.toLowerCase()),
          category_key: cat.category_key,
          category_title: cat.title,
          gender: gender.toLowerCase(),
        });
      }
    }

    // Rastgele seç
    const shuffled = allStyles.sort(() => 0.5 - Math.random());
    const randomStyles = shuffled.slice(0, parseInt(count));

    console.log(
      `🎲 Selected ${randomStyles.length} random styles from ${allStyles.length} total`
    );

    res.json({
      success: true,
      data: randomStyles,
      count: randomStyles.length,
      total: allStyles.length,
      gender: gender.toLowerCase(),
    });
  } catch (error) {
    console.error("❌ Random hair styles fetch error:", error);
    res.status(500).json({
      success: false,
      error: "Random hair styles could not be fetched",
      details: error.message,
    });
  }
});

module.exports = router;
