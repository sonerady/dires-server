const express = require("express");
const router = express.Router();
const path = require("path"); // path modülünü import et
const { supabase } = require("../supabaseClient"); // Supabase client'ı import et
const { optimizeImageUrl } = require("../utils/imageOptimizer");
const { catalogRateLimiter, botDetection } = require("../middleware/rateLimiter");

const womanPoses = require(path.join(
  __dirname,
  "../../lib/woman_poses_new.json"
));
const manPoses = require(path.join(__dirname, "../../lib/man_poses_new.json"));

// Pose kartları dikey olduğu için 400x800 boyutunda optimize et
const optimizePoseImageUrl = (imageUrl) => optimizeImageUrl(imageUrl, { width: 400, height: 800, quality: 80 });

router.get("/posesNew", botDetection, catalogRateLimiter, async (req, res) => {
  // /poses yerine doğrudan "/" olarak değiştirildi
  try {
    const {
      gender = "Woman",
      page = 1,
      limit = 20,
      includePublic = "false",
      excludeUserId = null,
    } = req.query;
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);
    const shouldIncludePublic = includePublic === "true";

    console.log(
      `➡️ Poses isteniyor - Cinsiyet: ${gender}, Sayfa: ${page}, Limit: ${limit}, IncludePublic: ${shouldIncludePublic}, ExcludeUserId: ${excludeUserId}`
    );

    let poses = [];
    if (gender.toLowerCase() === "woman") {
      poses = womanPoses;
    } else if (gender.toLowerCase() === "man") {
      poses = manPoses;
    } else {
      console.log(`❌ Geçersiz cinsiyet: ${gender}`);
      return res.status(400).json({ error: "Invalid gender specified." });
    }

    // URL'si olmayan pozları filtrele (client'e gönderilmesin)
    const validPoses = poses.filter((pose) => {
      const hasValidUrl = pose.image_url || pose.image;
      if (!hasValidUrl) {
        console.log(`⚠️ URL'si olmayan poz filtrelendi:`, {
          id: pose.id,
          title: pose.title || pose.prompt,
        });
      }
      return hasValidUrl;
    });

    console.log(
      `📚 Toplam ${gender} pozu: ${poses.length}, Geçerli URL'li poz: ${validPoses.length}`
    );

    // Public custom poses'ları da dahil et (eğer isteniyorsa)
    if (shouldIncludePublic) {
      try {
        console.log("🌍 [INCLUDE_PUBLIC] Public custom poses ekleniyor...");

        const genderForDB =
          gender.toLowerCase() === "woman" ? "female" : "male";

        let query = supabase
          .from("custom_poses")
          .select("*")
          .eq("gender", genderForDB)
          .eq("is_public", true)
          .order("created_at", { ascending: false });

        // Belirli bir kullanıcıyı hariç tut (discover için)
        if (excludeUserId) {
          query = query.neq("user_id", excludeUserId);
        }

        const { data: customPoses, error } = await query.limit(30);

        if (!error && customPoses && customPoses.length > 0) {
          // Custom poses'ları default pose formatına çevir
          const formattedCustomPoses = customPoses.map((pose) => ({
            id: `custom_${pose.id}`,
            title: pose.description,
            key: pose.description,
            image: optimizePoseImageUrl(pose.image_url), // Image URL'ini optimize et
            image_url: optimizePoseImageUrl(pose.image_url), // Image URL'ini optimize et
            isCustom: true,
            isPublic: true,
            userId: pose.user_id,
            customPoseId: pose.id,
          }));

          // Custom poses'ları default poses'lara ekle
          validPoses.push(...formattedCustomPoses);

          console.log(
            `✅ [INCLUDE_PUBLIC] ${formattedCustomPoses.length} public custom pose eklendi`
          );
        } else {
          console.log(
            "⚠️ [INCLUDE_PUBLIC] Public custom pose bulunamadı veya hata:",
            error
          );
        }
      } catch (customPoseError) {
        console.error(
          "❌ [INCLUDE_PUBLIC] Custom poses yükleme hatası:",
          customPoseError
        );
      }
    }

    // Pozları karıştır (shuffle) - Her API çağrısında farklı sıralama için
    for (let i = validPoses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validPoses[i], validPoses[j]] = [validPoses[j], validPoses[i]];
    }

    const startIndex = (parsedPage - 1) * parsedLimit;
    const endIndex = startIndex + parsedLimit;

    const paginatedPoses = validPoses
      .slice(startIndex, endIndex)
      .map((pose) => ({
        ...pose,
        image: optimizePoseImageUrl(pose.image_url || pose.image), // image'ı optimize et
      }));
    const hasMore = endIndex < validPoses.length; // validPoses kullan

    console.log(
      `📦 Sayfa ${parsedPage} için ${paginatedPoses.length} poz gönderiliyor. HasMore: ${hasMore}`
    );

    res.json({
      poses: paginatedPoses,
      hasMore,
      nextPage: hasMore ? parsedPage + 1 : null,
      totalCount: validPoses.length, // validPoses kullan
    });
  } catch (error) {
    console.error("Error fetching poses:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
