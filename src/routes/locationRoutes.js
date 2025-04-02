const express = require("express");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");

const VALID_LOCATIONS = ["studio_images", "outdoor_images", "indoor_images"];

router.get("/locations/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // Location tipini kontrol et
    if (!VALID_LOCATIONS.includes(type)) {
      return res.status(400).json({
        success: false,
        error:
          "Geçersiz location tipi. Geçerli tipler: " +
          VALID_LOCATIONS.join(", "),
      });
    }

    // JSON dosyasını oku
    const filePath = path.join(__dirname, "..", "lib", `${type}.json`);
    const jsonData = await fs.readFile(filePath, "utf8");
    const images = JSON.parse(jsonData);

    // Pagination hesaplamaları
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);

    const paginatedImages = images.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        images: paginatedImages,
        pagination: {
          total: images.length,
          currentPage: parseInt(page),
          totalPages: Math.ceil(images.length / parseInt(limit)),
          hasMore: endIndex < images.length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching locations:", error);
    res.status(500).json({
      success: false,
      error: "Lokasyon bilgileri yüklenirken bir hata oluştu",
    });
  }
});

// Tüm lokasyonları listele
router.get("/locations", async (req, res) => {
  try {
    const allLocations = {};

    // Her lokasyon tipi için JSON dosyasını oku
    for (const type of VALID_LOCATIONS) {
      const filePath = path.join(__dirname, "..", "lib", `${type}.json`);
      const jsonData = await fs.readFile(filePath, "utf8");
      allLocations[type] = JSON.parse(jsonData);
    }

    res.json({
      success: true,
      data: allLocations,
    });
  } catch (error) {
    console.error("Error fetching all locations:", error);
    res.status(500).json({
      success: false,
      error: "Lokasyon bilgileri yüklenirken bir hata oluştu",
    });
  }
});

module.exports = router;
