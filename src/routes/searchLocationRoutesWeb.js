const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { optimizeImageUrl, optimizeLocationImages } = require("../utils/imageOptimizer");

// SEARCH LOCATIONS BY TAGS, TITLE, OR GENERATED_TITLE
router.get("/search-locations", async (req, res) => {
  try {
    const {
      q = "", // Search query
      category = "custom",
      limit = 50,
      offset = 0,
      includeStudio = "false",
      locationType = null, // Optional: filter by location type
    } = req.query;

    console.log("🔍 Search locations - query:", q);
    console.log("📝 Category:", category);
    console.log("📝 Limit:", limit, "Offset:", offset);
    console.log("🎬 Include Studio:", includeStudio);

    // Search query boşsa hata döndür
    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    const searchTerm = q.trim().toLowerCase();

    // Location type filtresi
    const allowedLocationTypes =
      includeStudio === "true"
        ? ["outdoor", "indoor", "studio"]
        : ["outdoor", "indoor"];

    // Tüm public location'ları batch'ler halinde çek (Supabase limit'i 1000)
    const allData = [];
    const batchSize = 1000;
    let currentOffset = 0;
    let hasMore = true;

    console.log("📊 Fetching all locations in batches...");

    while (hasMore) {
      let query = supabase
        .from("custom_locations")
        .select("*, favorite_count")
        .eq("category", category)
        .eq("is_public", true)
        .eq("status", "completed")
        .range(currentOffset, currentOffset + batchSize - 1);

      // Location type filtresi varsa uygula, yoksa tüm tipleri dahil et
      if (locationType && ["outdoor", "indoor", "studio"].includes(locationType)) {
        query = query.eq("location_type", locationType);
      } else {
        query = query.in("location_type", allowedLocationTypes);
      }

      const { data: batchData, error } = await query;

      if (error) {
        throw error;
      }

      if (batchData && batchData.length > 0) {
        allData.push(...batchData);
        console.log(
          `📦 Fetched batch: ${batchData.length} locations (total so far: ${allData.length})`
        );
        currentOffset += batchSize;
        hasMore = batchData.length === batchSize; // Eğer batch tam doluysa, daha fazla var demektir
      } else {
        hasMore = false;
      }
    }

    console.log(`📊 Found ${allData.length} total locations before filtering`);
    console.log(`🔍 Searching for: "${searchTerm}"`);

    // Tag'larda, title'da ve generated_title'da arama yap
    const filteredData = (allData || []).filter((location) => {
      // Title'da arama
      const titleMatch =
        (location.title?.toLowerCase().includes(searchTerm) ||
          location.generated_title?.toLowerCase().includes(searchTerm)) ??
        false;

      // Tag'larda arama - tüm dillerdeki tag'leri kontrol et
      let tagMatch = false;
      let matchedTags = [];

      if (location.tags) {
        try {
          // Tags JSONB olabilir, string ise parse et
          let tagsObj = location.tags;
          if (typeof location.tags === "string") {
            try {
              tagsObj = JSON.parse(location.tags);
            } catch (parseError) {
              console.error(
                `❌ JSON parse error for location ${location.id}:`,
                parseError
              );
              tagsObj = null;
            }
          }

          if (tagsObj && typeof tagsObj === "object" && !Array.isArray(tagsObj)) {
            // Tags bir JSONB object, her dil için array içeriyor
            // Format: { "tr": ["Plaj", ...], "en": ["Beach", ...], ... }
            const allTags = [];
            for (const lang in tagsObj) {
              if (tagsObj.hasOwnProperty(lang) && Array.isArray(tagsObj[lang])) {
                // Her tag'i ekle
                tagsObj[lang].forEach((tag) => {
                  if (tag && typeof tag === "string") {
                    allTags.push(tag);
                  }
                });
              }
            }

            // Debug: İlk birkaç location için tag'leri logla
            if (allTags.length > 0 && Math.random() < 0.1) {
              console.log(
                `🔍 Location ${location.id} (${location.generated_title || location.title}) tags:`,
                allTags.slice(0, 10)
              );
              // Türkçe tag'leri özellikle göster
              if (tagsObj.tr && Array.isArray(tagsObj.tr)) {
                console.log(`   🇹🇷 TR tags:`, tagsObj.tr);
              }
            }

            // Tüm tag'leri lowercase'e çevirip arama yap
            // Hem tam eşleşme hem de içerme kontrolü yap
            matchedTags = allTags.filter((tag) => {
              if (!tag || typeof tag !== "string") return false;
              const tagLower = tag.toLowerCase().trim();
              const searchLower = searchTerm.toLowerCase().trim();
              return tagLower === searchLower || tagLower.includes(searchLower);
            });

            tagMatch = matchedTags.length > 0;

            // Debug: Eşleşme bulunduysa logla
            if (tagMatch) {
              console.log(
                `✅ Tag match found for location ${location.id} (${location.generated_title || location.title}):`,
                matchedTags
              );
            }
          } else if (tagsObj && Array.isArray(tagsObj)) {
            // Eğer tags direkt array ise (eski format)
            matchedTags = tagsObj.filter((tag) => {
              if (!tag || typeof tag !== "string") return false;
              const tagLower = tag.toLowerCase().trim();
              return tagLower === searchTerm || tagLower.includes(searchTerm);
            });
            tagMatch = matchedTags.length > 0;
          } else {
            console.log(
              `⚠️ Location ${location.id} has tags but format is unexpected:`,
              typeof tagsObj,
              Array.isArray(tagsObj)
            );
          }
        } catch (error) {
          console.error(
            `❌ Error processing tags for location ${location.id}:`,
            error.message
          );
        }
      } else {
        // Tags yok veya null - ilk birkaçını logla
        if (allData.indexOf(location) < 5) {
          console.log(
            `⚠️ Location ${location.id} (${location.generated_title || location.title}) has no tags field or it's null/undefined`
          );
          console.log(`   Tags value:`, location.tags);
        }
      }

      return titleMatch || tagMatch;
    });

    console.log(`✅ Found ${filteredData.length} locations matching search`);
    console.log(
      `🔍 Search term: "${searchTerm}" | Total locations checked: ${allData?.length || 0}`
    );

    // Pagination uygula
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedData = filteredData.slice(startIndex, endIndex);

    console.log(
      `📄 Returning ${paginatedData.length} items (${startIndex}-${endIndex})`
    );

    res.json({
      success: true,
      data: optimizeLocationImages(paginatedData),
      count: paginatedData.length,
      total: filteredData.length,
      hasMore: endIndex < filteredData.length,
    });
  } catch (error) {
    console.error("Search locations hatası:", error);
    res.status(500).json({
      success: false,
      error: "Location araması yapılamadı",
      details: error.message,
    });
  }
});

module.exports = router;

