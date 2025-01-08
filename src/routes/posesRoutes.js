const express = require("express");
const router = express.Router();
const fs = require("fs").promises;
const path = require("path");

router.get("/poses", async (req, res) => {
  try {
    const { gender = "female", page = 1, limit = 20 } = req.query;

    // Dosya yolunu belirle
    const filePath = path.join(
      __dirname,
      "..",
      "lib",
      `${gender.toLowerCase()}_poses.json`
    );

    // JSON dosyasını oku
    const jsonData = await fs.readFile(filePath, "utf8");
    const poses = JSON.parse(jsonData); // Direkt array olarak geliyor

    // Pagination hesaplamaları
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);

    const paginatedPoses = poses.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        poses: paginatedPoses,
        pagination: {
          total: poses.length,
          currentPage: parseInt(page),
          totalPages: Math.ceil(poses.length / parseInt(limit)),
          hasMore: endIndex < poses.length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching poses:", error);
    res.status(500).json({
      success: false,
      error: "Pozlar yüklenirken bir hata oluştu",
    });
  }
});

module.exports = router;
