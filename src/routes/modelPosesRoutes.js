const express = require("express");
const router = express.Router();
const path = require("path"); // path modülünü import et

const womanPoses = require(path.join(
  __dirname,
  "../../lib/woman_poses_new.json"
));
const manPoses = require(path.join(__dirname, "../../lib/man_poses_new.json"));

router.get("/posesNew", async (req, res) => {
  // /poses yerine doğrudan "/" olarak değiştirildi
  try {
    const { gender = "Woman", page = 1, limit = 20 } = req.query;
    const parsedPage = parseInt(page);
    const parsedLimit = parseInt(limit);

    console.log(
      `➡️ Poses isteniyor - Cinsiyet: ${gender}, Sayfa: ${page}, Limit: ${limit}`
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

    // Pozları karıştır (shuffle) - Her API çağrısında farklı sıralama için
    for (let i = poses.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [poses[i], poses[j]] = [poses[j], poses[i]];
    }

    console.log(`📚 Toplam ${gender} pozu: ${poses.length}`);

    const startIndex = (parsedPage - 1) * parsedLimit;
    const endIndex = startIndex + parsedLimit; // endIndex'i düzeltildi

    const paginatedPoses = poses.slice(startIndex, endIndex).map((pose) => ({
      ...pose,
      image: pose.image_url || pose.image, // image_url varsa onu kullan, yoksa image'i kullan
    }));
    const hasMore = endIndex < poses.length;

    console.log(
      `📦 Sayfa ${parsedPage} için ${paginatedPoses.length} poz gönderiliyor. HasMore: ${hasMore}`
    );

    res.json({
      poses: paginatedPoses,
      hasMore,
      nextPage: hasMore ? parsedPage + 1 : null,
      totalCount: poses.length,
    });
  } catch (error) {
    console.error("Error fetching poses:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
