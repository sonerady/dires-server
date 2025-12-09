const express = require("express");
const { supabase } = require("../supabaseClient");
const router = express.Router();

/**
 * Test endpoint - Supabase bağlantısını test et
 * GET /api/modal-contents/test
 */
router.get("/api/modal-contents/test", async (req, res) => {
  try {
    console.log("🧪 [MODAL-TEST] Supabase bağlantısı test ediliyor...");

    // Tablo varlığını kontrol et
    const { data, error } = await supabase
      .from("modal_contents")
      .select("count", { count: "exact" });

    if (error) {
      console.error("❌ [MODAL-TEST] Supabase hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Supabase connection failed",
        error: error.message,
      });
    }

    console.log("✅ [MODAL-TEST] Supabase bağlantısı başarılı");
    res.json({
      success: true,
      message: "Supabase connection successful",
      tableExists: true,
      recordCount: data?.length || 0,
    });
  } catch (error) {
    console.error("❌ [MODAL-TEST] Test hatası:", error);
    res.status(500).json({
      success: false,
      message: "Test failed",
      error: error.message,
    });
  }
});

/**
 * Modal içeriği getir
 * GET /api/modal-contents/:modalKey
 * Query: ?lang=tr (default: en)
 */
router.get("/api/modal-contents/:modalKey", async (req, res) => {
  try {
    const { modalKey } = req.params;
    const { lang = "en" } = req.query;

    console.log(`📖 [MODAL-CONTENT] İstek: ${modalKey} (lang: ${lang})`);

    // Supabase'den modal içeriğini getir
    const { data, error } = await supabase
      .from("modal_contents")
      .select("content, is_active")
      .eq("modal_key", modalKey)
      .eq("is_active", true)
      .single();

    if (error) {
      console.error(`❌ [MODAL-CONTENT] Supabase hatası:`, error);
      return res.status(404).json({
        success: false,
        message: "Modal content not found",
        error: error.message,
      });
    }

    if (!data) {
      console.log(`⚠️ [MODAL-CONTENT] Modal bulunamadı: ${modalKey}`);
      return res.status(404).json({
        success: false,
        message: "Modal content not found",
      });
    }

    // İstenen dil varsa o dili döndür, yoksa en döndür
    const content = data.content;
    const modalContent = content[lang] || content["en"];

    if (!modalContent) {
      console.log(`⚠️ [MODAL-CONTENT] Dil bulunamadı: ${lang} for ${modalKey}`);
      return res.status(404).json({
        success: false,
        message: `Language '${lang}' not found for modal '${modalKey}'`,
      });
    }

    console.log(
      `✅ [MODAL-CONTENT] Modal başarıyla getirildi: ${modalKey} (${lang})`
    );

    res.json({
      success: true,
      data: {
        modalKey,
        lang,
        title: modalContent.title,
        html: modalContent.html,
      },
    });
  } catch (error) {
    console.error(`❌ [MODAL-CONTENT] Server hatası:`, error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * Tüm aktif modal listesi getir
 * GET /api/modal-contents
 * Query: ?lang=tr (default: en)
 */
router.get("/api/modal-contents", async (req, res) => {
  try {
    const { lang = "en" } = req.query;

    console.log(`📖 [MODAL-LIST] Tüm modaller isteniyor (lang: ${lang})`);

    // Supabase'den tüm aktif modalleri getir
    const { data, error } = await supabase
      .from("modal_contents")
      .select("modal_key, content")
      .eq("is_active", true)
      .order("modal_key");

    if (error) {
      console.error(`❌ [MODAL-LIST] Supabase hatası:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch modals",
        error: error.message,
      });
    }

    // Her modal için sadece istenen dili döndür
    const modals = data.map((modal) => {
      const content = modal.content;
      const modalContent = content[lang] || content["en"];

      return {
        modalKey: modal.modal_key,
        title: modalContent?.title || "Untitled",
        lang,
      };
    });

    console.log(
      `✅ [MODAL-LIST] ${modals.length} modal başarıyla getirildi (${lang})`
    );

    res.json({
      success: true,
      data: {
        lang,
        modals,
      },
    });
  } catch (error) {
    console.error(`❌ [MODAL-LIST] Server hatası:`, error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * Modal içeriği güncelle (Admin)
 * PUT /api/modal-contents/:modalKey
 */
router.put("/api/modal-contents/:modalKey", async (req, res) => {
  try {
    const { modalKey } = req.params;
    const { content, is_active = true } = req.body;

    console.log(`📝 [MODAL-UPDATE] Modal güncelleniyor: ${modalKey}`);

    // İçerik validasyonu
    if (!content || typeof content !== "object") {
      return res.status(400).json({
        success: false,
        message: "Content must be a valid object with language keys",
      });
    }

    // Supabase'de güncelle
    const { data, error } = await supabase
      .from("modal_contents")
      .update({
        content,
        is_active,
      })
      .eq("modal_key", modalKey)
      .select();

    if (error) {
      console.error(`❌ [MODAL-UPDATE] Supabase hatası:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to update modal",
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      console.log(`⚠️ [MODAL-UPDATE] Modal bulunamadı: ${modalKey}`);
      return res.status(404).json({
        success: false,
        message: "Modal not found",
      });
    }

    console.log(`✅ [MODAL-UPDATE] Modal başarıyla güncellendi: ${modalKey}`);

    res.json({
      success: true,
      message: "Modal updated successfully",
      data: data[0],
    });
  } catch (error) {
    console.error(`❌ [MODAL-UPDATE] Server hatası:`, error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * Yeni modal oluştur (Admin)
 * POST /api/modal-contents
 */
router.post("/api/modal-contents", async (req, res) => {
  try {
    const { modal_key, content, is_active = true } = req.body;

    console.log(`📝 [MODAL-CREATE] Yeni modal oluşturuluyor: ${modal_key}`);

    // Validasyon
    if (!modal_key || !content) {
      return res.status(400).json({
        success: false,
        message: "modal_key and content are required",
      });
    }

    if (typeof content !== "object") {
      return res.status(400).json({
        success: false,
        message: "Content must be a valid object with language keys",
      });
    }

    // Supabase'e ekle
    const { data, error } = await supabase
      .from("modal_contents")
      .insert({
        modal_key,
        content,
        is_active,
      })
      .select();

    if (error) {
      console.error(`❌ [MODAL-CREATE] Supabase hatası:`, error);

      if (error.code === "23505") {
        // Unique constraint violation
        return res.status(409).json({
          success: false,
          message: "Modal with this key already exists",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to create modal",
        error: error.message,
      });
    }

    console.log(`✅ [MODAL-CREATE] Modal başarıyla oluşturuldu: ${modal_key}`);

    res.status(201).json({
      success: true,
      message: "Modal created successfully",
      data: data[0],
    });
  } catch (error) {
    console.error(`❌ [MODAL-CREATE] Server hatası:`, error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

/**
 * Modal sil (Admin)
 * DELETE /api/modal-contents/:modalKey
 */
router.delete("/api/modal-contents/:modalKey", async (req, res) => {
  try {
    const { modalKey } = req.params;

    console.log(`🗑️ [MODAL-DELETE] Modal siliniyor: ${modalKey}`);

    // Supabase'den sil
    const { data, error } = await supabase
      .from("modal_contents")
      .delete()
      .eq("modal_key", modalKey)
      .select();

    if (error) {
      console.error(`❌ [MODAL-DELETE] Supabase hatası:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete modal",
        error: error.message,
      });
    }

    if (!data || data.length === 0) {
      console.log(`⚠️ [MODAL-DELETE] Modal bulunamadı: ${modalKey}`);
      return res.status(404).json({
        success: false,
        message: "Modal not found",
      });
    }

    console.log(`✅ [MODAL-DELETE] Modal başarıyla silindi: ${modalKey}`);

    res.json({
      success: true,
      message: "Modal deleted successfully",
    });
  } catch (error) {
    console.error(`❌ [MODAL-DELETE] Server hatası:`, error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = router;
