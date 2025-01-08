const express = require("express");
const router = express.Router();
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs").promises;
const path = require("path");

// Supabase client oluştur
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Bucket listesi
const VALID_BUCKETS = ["indoor_images", "outdoor_images", "studio_images"];

async function generateJsonForBucket(bucketName) {
  try {
    // Bucket'tan dosyaları listele
    const { data: files, error } = await supabase.storage
      .from(bucketName)
      .list();

    if (error) {
      throw error;
    }

    // Her dosya için obje oluştur
    const images = files.map((file) => ({
      name: file.name,
      image: `${supabaseUrl}/storage/v1/object/public/${bucketName}/${file.name}`,
    }));

    // JSON dosyasını oluştur
    const jsonPath = path.join(__dirname, "..", "lib", `${bucketName}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(images, null, 2));

    return images.length; // Kaç dosya işlendiğini dön
  } catch (error) {
    console.error(`Error processing ${bucketName}:`, error);
    throw error;
  }
}

// Tek bir bucket için JSON oluştur
router.post("/generate-images-json/:bucketName", async (req, res) => {
  try {
    const { bucketName } = req.params;

    // Bucket adını kontrol et
    if (!VALID_BUCKETS.includes(bucketName)) {
      return res.status(400).json({
        success: false,
        error:
          "Geçersiz bucket adı. Geçerli bucket'lar: " +
          VALID_BUCKETS.join(", "),
      });
    }

    const count = await generateJsonForBucket(bucketName);

    res.json({
      success: true,
      message: `JSON file generated successfully for ${bucketName}`,
      result: {
        [bucketName]: `${count} images processed`,
      },
    });
  } catch (error) {
    console.error("Error generating JSON file:", error);
    res.status(500).json({
      success: false,
      error: "JSON dosyası oluşturulurken bir hata oluştu",
    });
  }
});

// Tüm bucket'lar için JSON oluştur
router.post("/generate-all-images-json", async (req, res) => {
  try {
    const results = {};

    for (const bucket of VALID_BUCKETS) {
      const count = await generateJsonForBucket(bucket);
      results[bucket] = `${count} images processed`;
    }

    res.json({
      success: true,
      message: "All JSON files generated successfully",
      results,
    });
  } catch (error) {
    console.error("Error generating JSON files:", error);
    res.status(500).json({
      success: false,
      error: "JSON dosyaları oluşturulurken bir hata oluştu",
    });
  }
});

module.exports = router;
