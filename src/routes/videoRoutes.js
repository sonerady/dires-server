const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");

// Video türleri
const VIDEO_TYPES = {
  HERO: "hero",
  PAYWALL: "paywall",
  BEFORE_AFTER: "before_after",
};

// Video tipine göre videoları getir
router.get("/videos/:type", async (req, res) => {
  try {
    const { type } = req.params;

    console.log(`📹 Video API: ${type} videoları isteniyor...`);

    // Geçerli video tipini kontrol et
    if (!Object.values(VIDEO_TYPES).includes(type)) {
      return res.status(400).json({
        success: false,
        error:
          "Geçersiz video tipi. Kullanılabilir tipler: hero, paywall, before_after",
      });
    }

    // Supabase'den videoları getir
    const { data: videos, error } = await supabase
      .from("videos")
      .select("*")
      .eq("type", type)
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (error) {
      console.error("❌ Video getirme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Video verileri alınamadı",
      });
    }

    console.log(`✅ ${videos.length} adet ${type} videosu bulundu`);

    res.json({
      success: true,
      data: videos,
      count: videos.length,
    });
  } catch (error) {
    console.error("❌ Video API hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

// Tüm videoları getir
router.get("/videos", async (req, res) => {
  try {
    console.log("📹 Video API: Tüm videolar isteniyor...");

    const { data: videos, error } = await supabase
      .from("videos")
      .select("*")
      .eq("is_active", true)
      .order("type", { ascending: true })
      .order("priority", { ascending: true });

    if (error) {
      console.error("❌ Video getirme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Video verileri alınamadı",
      });
    }

    // Tip bazında grupla
    const groupedVideos = videos.reduce((acc, video) => {
      if (!acc[video.type]) {
        acc[video.type] = [];
      }
      acc[video.type].push(video);
      return acc;
    }, {});

    console.log(`✅ ${videos.length} adet video bulundu`);

    res.json({
      success: true,
      data: groupedVideos,
      count: videos.length,
    });
  } catch (error) {
    console.error("❌ Video API hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

// Video ekle (Admin)
router.post("/videos", async (req, res) => {
  try {
    const { type, title, url, description, priority = 0 } = req.body;

    console.log("📹 Video API: Yeni video ekleniyor...", { type, title, url });

    // Validation
    if (!type || !title || !url) {
      return res.status(400).json({
        success: false,
        error: "type, title ve url alanları zorunludur",
      });
    }

    if (!Object.values(VIDEO_TYPES).includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Geçersiz video tipi",
      });
    }

    // Video ekle
    const { data: video, error } = await supabase
      .from("videos")
      .insert([
        {
          type,
          title,
          url,
          description,
          priority,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ Video ekleme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Video eklenemedi",
      });
    }

    console.log("✅ Video başarıyla eklendi:", video.id);

    res.status(201).json({
      success: true,
      data: video,
      message: "Video başarıyla eklendi",
    });
  } catch (error) {
    console.error("❌ Video ekleme API hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

// Video güncelle (Admin)
router.put("/videos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, url, description, priority, is_active } = req.body;

    console.log(`📹 Video API: Video güncelleniyor... ID: ${id}`);

    // Video güncelle
    const { data: video, error } = await supabase
      .from("videos")
      .update({
        ...(type && { type }),
        ...(title && { title }),
        ...(url && { url }),
        ...(description !== undefined && { description }),
        ...(priority !== undefined && { priority }),
        ...(is_active !== undefined && { is_active }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("❌ Video güncelleme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Video güncellenemedi",
      });
    }

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video bulunamadı",
      });
    }

    console.log("✅ Video başarıyla güncellendi:", video.id);

    res.json({
      success: true,
      data: video,
      message: "Video başarıyla güncellendi",
    });
  } catch (error) {
    console.error("❌ Video güncelleme API hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

// Video sil (Admin)
router.delete("/videos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log(`📹 Video API: Video siliniyor... ID: ${id}`);

    // Video sil (soft delete - is_active = false)
    const { data: video, error } = await supabase
      .from("videos")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("❌ Video silme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Video silinemedi",
      });
    }

    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video bulunamadı",
      });
    }

    console.log("✅ Video başarıyla silindi:", video.id);

    res.json({
      success: true,
      message: "Video başarıyla silindi",
    });
  } catch (error) {
    console.error("❌ Video silme API hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

module.exports = router;
