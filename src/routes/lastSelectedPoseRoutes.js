const express = require("express");
const supabase = require("../supabaseClient");

const router = express.Router();

// Son seçili pozu kaydet
router.post("/set", async (req, res) => {
  try {
    const { userId, poseId, poseType = "default", poseData } = req.body;

    if (!userId || !poseId) {
      return res.status(400).json({
        success: false,
        error: "userId ve poseId gereklidir",
      });
    }

    console.log("💾 [LAST SELECTED] Kaydetme:", {
      userId,
      poseId,
      poseType,
      poseTitle: poseData?.title,
    });

    // Kullanıcının mevcut kaydını kontrol et
    const { data: existingData, error: selectError } = await supabase
      .from("user_last_selected_pose")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (selectError && selectError.code !== "PGRST116") {
      // PGRST116: No rows found hatası değilse
      console.error("❌ Mevcut kayıt kontrol hatası:", selectError);
      return res.status(500).json({
        success: false,
        error: "Veritabanı hatası",
      });
    }

    const poseRecord = {
      user_id: userId,
      pose_id: poseId.toString(),
      pose_type: poseType,
      pose_title: poseData?.title || poseData?.key || `Pose ${poseId}`,
      pose_image_url: poseData?.image || "",
      pose_key: poseData?.key || poseData?.title || `Pose ${poseId}`,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (existingData) {
      // Güncelle
      const { data, error } = await supabase
        .from("user_last_selected_pose")
        .update(poseRecord)
        .eq("user_id", userId)
        .select()
        .single();

      result = { data, error };
    } else {
      // Yeni kayıt ekle
      const { data, error } = await supabase
        .from("user_last_selected_pose")
        .insert(poseRecord)
        .select()
        .single();

      result = { data, error };
    }

    if (result.error) {
      console.error("❌ Son seçili poz kaydetme hatası:", result.error);
      return res.status(500).json({
        success: false,
        error: "Poz kaydedilemedi",
      });
    }

    console.log("✅ Son seçili poz kaydedildi:", result.data);

    res.json({
      success: true,
      result: {
        lastSelectedPose: result.data,
      },
    });
  } catch (error) {
    console.error("❌ Son seçili poz kaydetme genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

// Son seçili pozu getir
router.get("/get/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "userId gereklidir",
      });
    }

    console.log("📖 [LAST SELECTED] Getirme:", { userId });

    const { data, error } = await supabase
      .from("user_last_selected_pose")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows found - normal durum
        return res.json({
          success: true,
          result: {
            lastSelectedPose: null,
          },
        });
      }

      console.error("❌ Son seçili poz getirme hatası:", error);
      return res.status(500).json({
        success: false,
        error: "Veritabanı hatası",
      });
    }

    console.log("✅ Son seçili poz getirildi:", data);

    // Pose objesini uygun formatta döndür
    const lastSelectedPose = {
      id: data.pose_type === "custom" ? data.pose_id : parseInt(data.pose_id),
      title: data.pose_title,
      key: data.pose_key,
      image: data.pose_image_url,
      isCustom: data.pose_type === "custom",
      customPoseId: data.pose_type === "custom" ? data.pose_id : undefined,
    };

    res.json({
      success: true,
      result: {
        lastSelectedPose,
      },
    });
  } catch (error) {
    console.error("❌ Son seçili poz getirme genel hatası:", error);
    res.status(500).json({
      success: false,
      error: "Sunucu hatası",
    });
  }
});

module.exports = router;
