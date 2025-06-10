const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Test endpoint for info modal routes
router.get("/info-modal/test", async (req, res) => {
  console.log("🎯 Info Modal - Test endpoint çağrıldı");
  res.json({
    success: true,
    message: "Info Modal routes çalışıyor!",
    timestamp: new Date().toISOString(),
  });
});

// Kullanıcı için aktif modal kontrolü
router.get("/info-modal/check/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("🔍 Info Modal - Aktif modal kontrol ediliyor:", userId);

    // Aktif modal'ları getir
    const { data: allModals, error: modalsError } = await supabase
      .from("info_modals")
      .select("*")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (modalsError) {
      console.error("❌ Info Modal - Supabase hatası:", modalsError);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: modalsError.message,
      });
    }

    if (!allModals || allModals.length === 0) {
      console.log("✅ Info Modal - Aktif modal bulunamadı");
      return res.json({
        success: true,
        data: null,
        message: "No active modal found",
      });
    }

    // Target audience'a göre filtrele
    const filteredByAudience = allModals.filter((modal) => {
      console.log("🔍 Modal filtreleme:", {
        modalId: modal.id,
        target_audience: modal.target_audience,
        target_user_ids: modal.target_user_ids,
        target_user_ids_type: typeof modal.target_user_ids,
        userId: userId,
      });

      // Eğer specific_users ise, target_user_ids'i kontrol et
      if (modal.target_audience === "specific_users") {
        let targetUserIds = modal.target_user_ids;

        // Eğer string ise JSON parse et
        if (typeof targetUserIds === "string") {
          try {
            targetUserIds = JSON.parse(targetUserIds);
            console.log("📝 JSON parse edildi:", targetUserIds);
          } catch (error) {
            console.error("❌ JSON parse hatası:", error);
            return false;
          }
        }

        console.log("🎯 Target user IDs kontrol:", {
          targetUserIds,
          isArray: Array.isArray(targetUserIds),
          includes: Array.isArray(targetUserIds)
            ? targetUserIds.includes(userId)
            : false,
        });

        if (Array.isArray(targetUserIds)) {
          const result = targetUserIds.includes(userId);
          console.log("✅ Kullanıcı eşleşme sonucu:", result);
          return result;
        }
        return false;
      }

      // Diğer audience türleri için mevcut logic
      if (modal.target_audience === "all") return true;
      if (modal.target_audience === "anonymous" && userId === "anonymous_user")
        return true;
      if (modal.target_audience === "registered" && userId !== "anonymous_user")
        return true;

      return false;
    });

    console.log(
      `🎯 Info Modal - ${allModals.length} modal'dan ${filteredByAudience.length} tanesi kullanıcıya uygun`
    );

    if (filteredByAudience.length === 0) {
      console.log("✅ Info Modal - Kullanıcıya uygun modal bulunamadı");
      return res.json({
        success: true,
        data: null,
        message: "No suitable modal found for user",
      });
    }

    // Bu kullanıcının dismiss ettiği modal'ları getir
    const { data: dismissedInteractions, error: interactionsError } =
      await supabase
        .from("user_modal_interactions")
        .select("modal_id")
        .eq("user_id", userId)
        .eq("interaction_type", "dismissed");

    if (interactionsError) {
      console.error("❌ Info Modal - Interactions hatası:", interactionsError);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: interactionsError.message,
      });
    }

    // Dismiss edilen modal ID'lerini array'e çevir
    const dismissedModalIds = dismissedInteractions
      ? dismissedInteractions.map((i) => i.modal_id)
      : [];

    // Dismiss edilmemiş modal'ları filtrele (artık filteredByAudience kullanıyoruz)
    const availableModals = filteredByAudience.filter(
      (modal) => !dismissedModalIds.includes(modal.id)
    );

    if (availableModals.length > 0) {
      const modal = availableModals[0]; // İlk (en yüksek priority) modal'ı al
      console.log("🎯 Info Modal - Kullanıcı için uygun modal bulundu");

      return res.json({
        success: true,
        data: {
          id: modal.id,
          content: modal.content,
          priority: modal.priority,
        },
      });
    }

    console.log("✅ Info Modal - Aktif modal bulunamadı");
    return res.json({
      success: true,
      data: null,
      message: "No active modal found",
    });
  } catch (error) {
    console.error("❌ Info Modal - Kontrol hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Modal dismiss etme
router.post("/info-modal/dismiss", async (req, res) => {
  try {
    const { userId, modalId } = req.body;

    console.log("💾 Info Modal - Modal dismiss ediliyor:", { userId, modalId });

    if (!userId || !modalId) {
      return res.status(400).json({
        success: false,
        message: "userId and modalId are required",
      });
    }

    // Önce bu kullanıcının bu modal'ı daha önce dismiss edip etmediğini kontrol et
    const { data: existingInteraction, error: checkError } = await supabase
      .from("user_modal_interactions")
      .select("id")
      .eq("user_id", userId)
      .eq("modal_id", modalId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = "The result contains 0 rows" - bu normal, devam ediyoruz
      console.error("❌ Info Modal - Kontrol hatası:", checkError);
      return res.status(500).json({
        success: false,
        message: "Database error during check",
        error: checkError.message,
      });
    }

    // Eğer zaten dismiss edilmişse, başarılı dön (tekrar dismiss etmeye gerek yok)
    if (existingInteraction) {
      console.log("ℹ️ Info Modal - Modal zaten dismiss edilmiş, atlanıyor");
      return res.json({
        success: true,
        message: "Modal already dismissed",
        data: null,
      });
    }

    // Modal'ı dismiss et - yeni kayıt oluştur
    const { data: result, error } = await supabase
      .from("user_modal_interactions")
      .insert([
        {
          user_id: userId,
          modal_id: modalId,
          interaction_type: "dismissed",
        },
      ]);

    if (error) {
      console.error("❌ Info Modal - Dismiss hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    console.log("✅ Info Modal - Modal başarıyla dismiss edildi");
    return res.json({
      success: true,
      message: "Modal dismissed successfully",
      data: result,
    });
  } catch (error) {
    console.error("❌ Info Modal - Dismiss hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Admin: Yeni modal oluşturma
router.post("/info-modal/create", async (req, res) => {
  try {
    const {
      content,
      priority = 1,
      target_audience = "all",
      target_user_ids = null,
      start_date,
      end_date,
    } = req.body;

    console.log("📝 Info Modal - Yeni modal oluşturuluyor");

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "content is required",
      });
    }

    // Content içinde en az bir dilde title olduğunu kontrol et
    const hasTitle = Object.values(content).some(
      (langContent) =>
        langContent && typeof langContent === "object" && langContent.title
    );

    if (!hasTitle) {
      return res.status(400).json({
        success: false,
        message: "content must contain title in at least one language",
      });
    }

    const { data, error } = await supabase
      .from("info_modals")
      .insert([
        {
          content,
          priority,
          target_audience,
          target_user_ids,
          start_date: start_date || new Date().toISOString(),
          end_date: end_date || null,
        },
      ])
      .select();

    if (error) {
      console.error("❌ Info Modal - Oluşturma hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    console.log("✅ Info Modal - Yeni modal başarıyla oluşturuldu");
    return res.json({
      success: true,
      message: "Modal created successfully",
      data: data[0],
    });
  } catch (error) {
    console.error("❌ Info Modal - Oluşturma hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Admin: Tüm modal'ları listeleme
router.get("/info-modal/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("info_modals")
      .select("*")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Info Modal - Listeleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    return res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("❌ Info Modal - Listeleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Admin: Modal durumunu güncelleme (aktif/pasif)
router.put("/info-modal/:modalId/status", async (req, res) => {
  try {
    const { modalId } = req.params;
    const { is_active } = req.body;

    console.log("🔄 Info Modal - Durum güncelleniyor:", { modalId, is_active });

    const { data, error } = await supabase
      .from("info_modals")
      .update({ is_active })
      .eq("id", modalId)
      .select();

    if (error) {
      console.error("❌ Info Modal - Güncelleme hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    if (data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Modal not found",
      });
    }

    console.log("✅ Info Modal - Durum başarıyla güncellendi");
    return res.json({
      success: true,
      message: "Modal status updated successfully",
      data: data[0],
    });
  } catch (error) {
    console.error("❌ Info Modal - Güncelleme hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

// Admin: Modal istatistikleri
router.get("/info-modal/:modalId/stats", async (req, res) => {
  try {
    const { modalId } = req.params;

    const { data, error } = await supabase
      .from("user_modal_interactions")
      .select("interaction_type, interaction_date")
      .eq("modal_id", modalId);

    if (error) {
      console.error("❌ Info Modal - İstatistik hatası:", error);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: error.message,
      });
    }

    const stats = {
      total_interactions: data.length,
      dismissed_count: data.filter((i) => i.interaction_type === "dismissed")
        .length,
      clicked_cta_count: data.filter(
        (i) => i.interaction_type === "clicked_cta"
      ).length,
      interactions_by_date: data.reduce((acc, interaction) => {
        const date = interaction.interaction_date.split("T")[0];
        acc[date] = (acc[date] || 0) + 1;
        return acc;
      }, {}),
    };

    return res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Info Modal - İstatistik hatası:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

module.exports = router;
