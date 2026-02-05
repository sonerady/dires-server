const express = require("express");
const { supabase } = require("../supabaseClient");
const router = express.Router();

/**
 * @route GET /api/favorites/:userId
 * @desc Get all favorite locations for a user
 * @access Public (should be authenticated in production)
 */
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, limit = 50, offset = 0 } = req.query;


    // Build query with location details - Manual JOIN using location_id
    const {
      data: favoriteData,
      error: favoriteError,
      count,
    } = await supabase
      .from("user_favorite_locations")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (favoriteError) {
      console.error("❌ Error fetching favorites:", favoriteError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch favorites",
        details: favoriteError.message,
      });
    }

    if (!favoriteData || favoriteData.length === 0) {
      return res.json({
        success: true,
        data: [],
        total: 0,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: false,
        },
      });
    }

    // Filter by location type if specified
    let filteredFavorites = favoriteData;
    if (type && type !== "all") {
      filteredFavorites = favoriteData.filter(
        (fav) => fav.location_type === type
      );
    }

    // Apply pagination
    const startIndex = parseInt(offset);
    const endIndex = startIndex + parseInt(limit);
    const paginatedFavorites = filteredFavorites.slice(startIndex, endIndex);

    // Get location details for each favorite
    const locationIds = paginatedFavorites.map((fav) => fav.location_id);

    const { data: locationData, error: locationError } = await supabase
      .from("custom_locations")
      .select(
        "id, title, generated_title, image_url, location_type, category, favorite_count, created_at"
      )
      .in("id", locationIds);

    if (locationError) {
      console.error("❌ Error fetching location details:", locationError);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch location details",
        details: locationError.message,
      });
    }

    // Merge favorite data with location data
    const data = paginatedFavorites.map((favorite) => {
      const location = locationData.find(
        (loc) =>
          loc.id === favorite.location_id ||
          loc.id.toString() === favorite.location_id.toString()
      );

      return {
        ...favorite,
        location_title:
          location?.title || location?.generated_title || "Unknown Location",
        location_image_url: location?.image_url || "",
        location_category: location?.category || favorite.location_category,
        location_type: location?.location_type || favorite.location_type,
        favorite_count: location?.favorite_count || 0,
      };
    });


    res.json({
      success: true,
      data: data || [],
      total: filteredFavorites.length, // Use filtered count for total
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: endIndex < filteredFavorites.length,
      },
    });
  } catch (error) {
    console.error("❌ Server error in GET favorites:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * @route POST /api/favorites
 * @desc Add a location to user's favorites
 * @access Public (should be authenticated in production)
 */
router.post("/", async (req, res) => {
  try {
    const {
      user_id,
      location_id,
      location_type,
      location_title,
      location_image_url,
      location_category,
    } = req.body;

    // Validation
    if (!user_id || !location_id || !location_type) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: user_id, location_id, location_type",
      });
    }

    console.log(`💖 Adding favorite: ${location_id} for user: ${user_id}`);

    // Insert favorite (will fail if already exists due to unique constraint)
    const { data, error } = await supabase
      .from("user_favorite_locations")
      .insert([
        {
          user_id,
          location_id,
          location_type,
          location_title: location_title || null,
          location_image_url: location_image_url || null,
          location_category: location_category || null,
        },
      ])
      .select()
      .single();

    if (error) {
      // Check if it's a duplicate key error
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          error: "Location already in favorites",
          code: "ALREADY_FAVORITED",
        });
      }

      console.error("❌ Error adding favorite:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to add favorite",
        details: error.message,
      });
    }

    console.log(`✅ Successfully added favorite: ${location_id}`);

    res.status(201).json({
      success: true,
      data: data,
      message: "Location added to favorites",
    });
  } catch (error) {
    console.error("❌ Server error in POST favorites:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * @route DELETE /api/favorites/:userId/:locationId
 * @desc Remove a location from user's favorites
 * @access Public (should be authenticated in production)
 */
router.delete("/:userId/:locationId", async (req, res) => {
  try {
    const { userId, locationId } = req.params;

    console.log(`💔 Removing favorite: ${locationId} for user: ${userId}`);

    const { data, error } = await supabase
      .from("user_favorite_locations")
      .delete()
      .eq("user_id", userId)
      .eq("location_id", locationId)
      .select();

    if (error) {
      console.error("❌ Error removing favorite:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to remove favorite",
        details: error.message,
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Favorite not found",
        code: "NOT_FOUND",
      });
    }

    console.log(`✅ Successfully removed favorite: ${locationId}`);

    res.json({
      success: true,
      data: data[0],
      message: "Location removed from favorites",
    });
  } catch (error) {
    console.error("❌ Server error in DELETE favorites:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * @route POST /api/favorites/toggle
 * @desc Toggle favorite status (add if not exists, remove if exists)
 * @access Public (should be authenticated in production)
 */
router.post("/toggle", async (req, res) => {
  try {
    const {
      user_id,
      location_id,
      location_type,
      location_title,
      location_image_url,
      location_category,
    } = req.body;

    // Validation
    if (!user_id || !location_id) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: user_id, location_id",
      });
    }

    console.log(`🔄 Toggling favorite: ${location_id} for user: ${user_id}`);

    // Check if favorite already exists
    const { data: existing, error: checkError } = await supabase
      .from("user_favorite_locations")
      .select("id")
      .eq("user_id", user_id)
      .eq("location_id", location_id)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("❌ Error checking favorite existence:", checkError);
      return res.status(500).json({
        success: false,
        error: "Failed to check favorite status",
        details: checkError.message,
      });
    }

    if (existing) {
      // Remove favorite
      const { data, error } = await supabase
        .from("user_favorite_locations")
        .delete()
        .eq("user_id", user_id)
        .eq("location_id", location_id)
        .select()
        .single();

      if (error) {
        console.error("❌ Error removing favorite:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to remove favorite",
          details: error.message,
        });
      }

      console.log(`💔 Removed favorite: ${location_id}`);

      res.json({
        success: true,
        action: "removed",
        data: data,
        message: "Location removed from favorites",
      });
    } else {
      // Add favorite
      if (!location_type) {
        return res.status(400).json({
          success: false,
          error: "location_type is required when adding to favorites",
        });
      }

      const { data, error } = await supabase
        .from("user_favorite_locations")
        .insert([
          {
            user_id,
            location_id,
            location_type,
            location_title: location_title || null,
            location_image_url: location_image_url || null,
            location_category: location_category || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("❌ Error adding favorite:", error);
        return res.status(500).json({
          success: false,
          error: "Failed to add favorite",
          details: error.message,
        });
      }

      console.log(`💖 Added favorite: ${location_id}`);

      res.status(201).json({
        success: true,
        action: "added",
        data: data,
        message: "Location added to favorites",
      });
    }
  } catch (error) {
    console.error("❌ Server error in POST favorites/toggle:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * @route GET /api/favorites/:userId/check/:locationId
 * @desc Check if a location is in user's favorites
 * @access Public (should be authenticated in production)
 */
router.get("/:userId/check/:locationId", async (req, res) => {
  try {
    const { userId, locationId } = req.params;

    const { data, error } = await supabase
      .from("user_favorite_locations")
      .select("id, created_at")
      .eq("user_id", userId)
      .eq("location_id", locationId)
      .single();

    if (error && error.code !== "PGRST116") {
      console.error("❌ Error checking favorite:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to check favorite status",
        details: error.message,
      });
    }

    res.json({
      success: true,
      is_favorite: !!data,
      data: data || null,
    });
  } catch (error) {
    console.error("❌ Server error in GET favorites check:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

/**
 * @route GET /api/favorites/:userId/stats
 * @desc Get user's favorites statistics
 * @access Public (should be authenticated in production)
 */
router.get("/:userId/stats", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(`📊 Fetching favorites stats for user: ${userId}`);

    // Get count by location type
    const { data, error } = await supabase
      .from("user_favorite_locations")
      .select("location_type")
      .eq("user_id", userId);

    if (error) {
      console.error("❌ Error fetching favorites stats:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch favorites stats",
        details: error.message,
      });
    }

    // Count by type
    const stats = {
      total: data.length,
      by_type: {},
    };

    data.forEach((item) => {
      const type = item.location_type || "unknown";
      stats.by_type[type] = (stats.by_type[type] || 0) + 1;
    });

    console.log(`✅ Favorites stats for user ${userId}:`, stats);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("❌ Server error in GET favorites stats:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
});

module.exports = router;
