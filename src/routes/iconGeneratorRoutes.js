const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// AccessoryLibrary'yi import et
const accessoryLibrary = require("../../temp/accessoryLibrary_relevant.json");

// Supabase client'ı import et
const supabase = require("../supabaseClient");

const GENERATED_ICONS_DIR = path.join(__dirname, "../../generated-icons");

// Icon generation işlemini başlat
router.post("/generate", async (req, res) => {
  const { category = "all" } = req.body;

  try {
    // Script dosyasının yolunu belirle
    const scriptPath = path.join(__dirname, "../../scripts/icon-generator.js");

    // Script'i çalıştır
    let args = [];
    if (category !== "all") {
      args = ["--category", category];
    }

    const childProcess = spawn("node", [scriptPath, ...args], {
      stdio: "pipe",
      cwd: path.dirname(scriptPath),
    });

    let output = "";
    let errorOutput = "";

    // Output'ları log olarak kaydet
    childProcess.stdout.on("data", (data) => {
      console.log(`[Icon Gen] ${data.toString().trim()}`);
    });

    childProcess.stderr.on("data", (data) => {
      console.error(`[Icon Gen Error] ${data.toString().trim()}`);
    });

    // Hemen response dön, process'i background'da çalıştır
    res.json({
      success: true,
      message: "Icon generation arka planda başlatıldı",
      category: category,
      processId: childProcess.pid,
    });

    // Process'i izle ama response'u bloklamadan
    childProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Icon generation tamamlandı (kategori: ${category})`);
      } else {
        console.error(
          `❌ Icon generation hatası (kategori: ${category}, exit code: ${code})`
        );
      }
    });
  } catch (error) {
    console.error("Icon generation error:", error);
    res.status(500).json({
      success: false,
      message: "İç sunucu hatası",
      error: error.message,
    });
  }
});

// Kategorileri listele
router.get("/categories", (req, res) => {
  try {
    const categories = Object.keys(accessoryLibrary).map((category) => ({
      name: category,
      count: accessoryLibrary[category].length,
    }));

    res.json({
      success: true,
      categories: categories,
      total: categories.reduce((sum, cat) => sum + cat.count, 0),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Kategoriler alınamadı",
      error: error.message,
    });
  }
});

// Oluşturulan iconları listele (Supabase + Local)
router.get("/gallery", async (req, res) => {
  try {
    let images = [];

    // Önce Supabase'den iconları çek
    try {
      const { data: supabaseFiles, error: supabaseError } =
        await supabase.storage.from("icons").list("generated-icons", {
          limit: 1000,
          sortBy: { column: "created_at", order: "desc" },
        });

      if (!supabaseError && supabaseFiles) {
        supabaseFiles.forEach((file) => {
          if (
            file.name.endsWith(".jpg") ||
            file.name.endsWith(".png") ||
            file.name.endsWith(".jpeg")
          ) {
            // Dosya adından kategori ve accessory adını çıkar
            const nameParts = file.name
              .replace(/\.(jpg|png|jpeg)$/, "")
              .split("_");
            const category = nameParts[0] || "Unknown";
            const accessoryName =
              nameParts.slice(1).join(" ").replace(/_/g, " ") || "Unknown";

            // Public URL'i al
            const { data: publicData } = supabase.storage
              .from("icons")
              .getPublicUrl(`generated-icons/${file.name}`);

            images.push({
              filename: file.name,
              category: category,
              accessoryName: accessoryName,
              url: publicData.publicUrl,
              createdAt: file.created_at,
              size: file.metadata?.size || 0,
              source: "supabase",
            });
          }
        });
      }
    } catch (supabaseError) {
      console.error("Supabase galeri hatası:", supabaseError);
    }

    // Fallback olarak local dosyaları da kontrol et
    if (fs.existsSync(GENERATED_ICONS_DIR)) {
      const localFiles = fs
        .readdirSync(GENERATED_ICONS_DIR)
        .filter(
          (file) =>
            file.endsWith(".jpg") ||
            file.endsWith(".png") ||
            file.endsWith(".jpeg")
        )
        .map((file) => {
          const filePath = path.join(GENERATED_ICONS_DIR, file);
          const stats = fs.statSync(filePath);

          // Dosya adından kategori ve accessory adını çıkar
          const nameParts = file.replace(/\.(jpg|png|jpeg)$/, "").split("_");
          const category = nameParts[0] || "Unknown";
          const accessoryName =
            nameParts.slice(1).join(" ").replace(/_/g, " ") || "Unknown";

          return {
            filename: file,
            category: category,
            accessoryName: accessoryName,
            url: `/api/icon-generator/image/${file}`,
            createdAt: stats.mtime,
            size: stats.size,
            source: "local",
          };
        });

      // Local dosyaları da ekle (duplicate kontrolü ile)
      localFiles.forEach((localFile) => {
        const exists = images.find(
          (img) => img.filename === localFile.filename
        );
        if (!exists) {
          images.push(localFile);
        }
      });
    }

    // Tarihe göre sırala
    images.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      images: images,
      count: images.length,
      supabaseCount: images.filter((img) => img.source === "supabase").length,
      localCount: images.filter((img) => img.source === "local").length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Galeri yüklenemedi",
      error: error.message,
    });
  }
});

// Tekil resim serve et
router.get("/image/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const imagePath = path.join(GENERATED_ICONS_DIR, filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        success: false,
        message: "Resim bulunamadı",
      });
    }

    // Güvenlik kontrolü - sadece allowed extensions
    const allowedExtensions = [".jpg", ".jpeg", ".png"];
    const ext = path.extname(filename).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: "Geçersiz dosya formatı",
      });
    }

    res.sendFile(imagePath);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Resim servis edilemedi",
      error: error.message,
    });
  }
});

// Generation raporu al
router.get("/report", (req, res) => {
  try {
    const reportPath = path.join(GENERATED_ICONS_DIR, "generation-report.json");

    if (!fs.existsSync(reportPath)) {
      return res.json({
        success: true,
        report: null,
        message: "Henüz rapor oluşturulmadı",
      });
    }

    const reportData = JSON.parse(fs.readFileSync(reportPath, "utf8"));

    res.json({
      success: true,
      report: reportData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Rapor okunamadı",
      error: error.message,
    });
  }
});

// Iconları temizle (Supabase + Local)
router.delete("/clear", async (req, res) => {
  try {
    let totalDeleted = 0;
    let supabaseDeleted = 0;
    let localDeleted = 0;

    // Önce Supabase'den sil
    try {
      const { data: supabaseFiles, error: listError } = await supabase.storage
        .from("icons")
        .list("generated-icons");

      if (!listError && supabaseFiles && supabaseFiles.length > 0) {
        const filesToDelete = supabaseFiles
          .filter(
            (file) => file.name.endsWith(".jpg") || file.name.endsWith(".png")
          )
          .map((file) => `generated-icons/${file.name}`);

        if (filesToDelete.length > 0) {
          const { error: deleteError } = await supabase.storage
            .from("icons")
            .remove(filesToDelete);

          if (!deleteError) {
            supabaseDeleted = filesToDelete.length;
            console.log(`☁️ ${supabaseDeleted} dosya Supabase'den silindi`);
          } else {
            console.error("Supabase silme hatası:", deleteError);
          }
        }
      }
    } catch (supabaseError) {
      console.error("Supabase temizleme hatası:", supabaseError);
    }

    // Local dosyaları sil
    if (fs.existsSync(GENERATED_ICONS_DIR)) {
      const files = fs.readdirSync(GENERATED_ICONS_DIR);

      files.forEach((file) => {
        const filePath = path.join(GENERATED_ICONS_DIR, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          localDeleted++;
        }
      });
    }

    totalDeleted = supabaseDeleted + localDeleted;

    res.json({
      success: true,
      message: `${totalDeleted} dosya silindi`,
      deletedCount: totalDeleted,
      supabaseDeleted: supabaseDeleted,
      localDeleted: localDeleted,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Temizleme hatası",
      error: error.message,
    });
  }
});

// Durum kontrolü (Supabase + Local)
router.get("/status", async (req, res) => {
  try {
    let supabaseIconCount = 0;
    let localIconCount = 0;

    // Supabase icon sayısını al
    try {
      const { data: supabaseFiles, error } = await supabase.storage
        .from("icons")
        .list("generated-icons");

      if (!error && supabaseFiles) {
        supabaseIconCount = supabaseFiles.filter(
          (f) => f.name.endsWith(".jpg") || f.name.endsWith(".png")
        ).length;
      }
    } catch (supabaseError) {
      console.error("Supabase durum hatası:", supabaseError);
    }

    // Local icon sayısını al
    if (fs.existsSync(GENERATED_ICONS_DIR)) {
      localIconCount = fs
        .readdirSync(GENERATED_ICONS_DIR)
        .filter(
          (f) => f.endsWith(".jpg") || f.endsWith(".png") || f.endsWith(".jpeg")
        ).length;
    }

    const reportExists = fs.existsSync(
      path.join(GENERATED_ICONS_DIR, "generation-report.json")
    );

    res.json({
      success: true,
      status: {
        iconCount: Math.max(supabaseIconCount, localIconCount), // En yüksek sayıyı al
        supabaseIconCount: supabaseIconCount,
        localIconCount: localIconCount,
        hasReport: reportExists,
        outputDir: GENERATED_ICONS_DIR,
        categoriesAvailable: Object.keys(accessoryLibrary).length,
        totalAccessories: Object.values(accessoryLibrary).reduce(
          (sum, items) => sum + items.length,
          0
        ),
        supabaseConnected: true,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Durum kontrol edilemedi",
      error: error.message,
    });
  }
});

// Local iconları serve et
router.get("/image/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const imagePath = path.join(GENERATED_ICONS_DIR, filename);

    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({
        success: false,
        message: "Dosya bulunamadı",
      });
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".png" ? "image/png" : "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 yıl cache

    const imageStream = fs.createReadStream(imagePath);
    imageStream.pipe(res);
  } catch (error) {
    console.error("Resim serve hatası:", error);
    res.status(500).json({
      success: false,
      message: "Resim yüklenemedi",
      error: error.message,
    });
  }
});

module.exports = router;
