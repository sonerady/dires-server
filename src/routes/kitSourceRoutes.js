// 🧰 Kit kaynağı (22 Eyl 2026) — client KitsScreen
//
// Kit üretimleri (e-ticaret / gerçek yaşam / kutu açılışı) sonuçlarını
// reference_results.generation_id satırına yazar. KitsScreen'de kullanıcı
// kaynağı ya GEÇMİŞTEN seçer (satır zaten var, URL'den çözülür) ya da galeriden
// YENİ bir fotoğraf yükler (satır yok). Bu uç her iki durumda da kit'in
// yazılacağı generation_id'yi döndürür; yüklenen fotoğraf için gizli
// (visibility=false) bir kaynak satırı açar — böylece geçmiş sekmelerinde
// sahte bir "üretim" görünmez, kit'ler yine product_kits / kit geçmişinden listelenir.
const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const { supabase } = require("../supabaseClient");
const { resolveCanonicalGenerationId, UUID_REGEX } = require("../utils/canonicalGenerationId");

router.post("/kit-source", async (req, res) => {
  try {
    const { userId, imageUrl } = req.body || {};
    if (!userId || !UUID_REGEX.test(String(userId))) {
      return res.status(400).json({ success: false, message: "Valid userId required" });
    }
    if (typeof imageUrl !== "string" || !/^https?:\/\//i.test(imageUrl)) {
      return res.status(400).json({ success: false, message: "imageUrl required" });
    }

    // 1) Geçmişten seçilen görsel → mevcut satır (URL eq / normalize / storage tail)
    const resolved = await resolveCanonicalGenerationId(null, imageUrl);
    if (resolved) {
      const { data: row } = await supabase
        .from("reference_results")
        .select("settings")
        .eq("generation_id", resolved)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      let settings = row?.settings;
      if (typeof settings === "string") {
        try { settings = JSON.parse(settings); } catch (_) { settings = null; }
      }
      return res.json({
        success: true,
        generationId: resolved,
        productCategory: settings?.productCategory || null,
        created: false,
      });
    }

    // 2) Yeni yüklenen görsel → gizli kaynak satırı
    const generationId = uuidv4();
    const { error } = await supabase.from("reference_results").insert([
      {
        user_id: userId,
        generation_id: generationId,
        status: "completed",
        result_image_url: imageUrl,
        reference_images: [imageUrl],
        settings: { source: "kits_upload" },
        visibility: false,
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) {
      console.error("❌ [KIT_SOURCE] insert error:", error.message);
      return res.status(500).json({ success: false, message: "Failed to register kit source" });
    }
    console.log(`✅ [KIT_SOURCE] Registered upload source ${generationId} for ${userId}`);
    return res.json({ success: true, generationId, productCategory: null, created: true });
  } catch (error) {
    console.error("❌ [KIT_SOURCE] error:", error.message);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

module.exports = router;
