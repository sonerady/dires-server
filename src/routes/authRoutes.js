// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");

/**
 * Supabase Auth ile giriş yapan kullanıcıyı backend users tablosuna senkronize et
 */
router.post("/sync-user", async (req, res) => {
  try {
    const { supabaseUserId, email, fullName, avatarUrl, provider } = req.body;

    if (!supabaseUserId) {
      return res.status(400).json({
        success: false,
        message: "supabaseUserId is required",
      });
    }

    console.log("🔄 [AUTH] Syncing user to backend:", {
      supabaseUserId,
      email,
      provider,
    });

    // Kullanıcı zaten var mı kontrol et (supabase_user_id ile)
    const { data: existingUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      // PGRST116 = no rows returned (normal durum)
      console.error("❌ [AUTH] Error fetching user:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Error checking user existence",
        error: fetchError.message,
      });
    }

    if (existingUser) {
      // Kullanıcı zaten var - bilgileri güncelle
      console.log("✅ [AUTH] User exists, updating:", existingUser.id);

      const updateData = {};
      if (email) updateData.email = email;
      if (fullName) updateData.full_name = fullName;
      if (avatarUrl) updateData.avatar_url = avatarUrl;
      if (provider) updateData.auth_provider = provider;

      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("supabase_user_id", supabaseUserId)
        .select()
        .single();

      if (updateError) {
        console.error("❌ [AUTH] Error updating user:", updateError);
        return res.status(500).json({
          success: false,
          message: "Error updating user",
          error: updateError.message,
        });
      }

      return res.status(200).json({
        success: true,
        message: "User updated successfully",
        user: {
          id: updatedUser.id,
          supabaseUserId: updatedUser.supabase_user_id,
          email: updatedUser.email,
          fullName: updatedUser.full_name,
          creditBalance: updatedUser.credit_balance,
        },
        isNewUser: false,
      });
    } else {
      // Yeni kullanıcı oluştur
      console.log("🆕 [AUTH] Creating new user");

      const newUserId = uuidv4();
      const insertData = {
        id: newUserId,
        supabase_user_id: supabaseUserId,
        credit_balance: 40, // Yeni kullanıcıya 40 kredi hediye
        received_initial_credit: true,
        initial_credit_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        owner: false,
      };

      if (email) insertData.email = email;
      if (fullName) insertData.full_name = fullName;
      if (avatarUrl) insertData.avatar_url = avatarUrl;
      if (provider) insertData.auth_provider = provider;

      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([insertData])
        .select()
        .single();

      if (insertError) {
        console.error("❌ [AUTH] Error creating user:", insertError);
        return res.status(500).json({
          success: false,
          message: "Error creating user",
          error: insertError.message,
        });
      }

      console.log("✅ [AUTH] New user created:", newUser.id);

      return res.status(200).json({
        success: true,
        message: "User created successfully",
        user: {
          id: newUser.id,
          supabaseUserId: newUser.supabase_user_id,
          email: newUser.email,
          fullName: newUser.full_name,
          creditBalance: newUser.credit_balance,
        },
        isNewUser: true,
      });
    }
  } catch (error) {
    console.error("❌ [AUTH] Unexpected error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Supabase user ID ile kullanıcı bilgilerini al
 */
router.get("/user/:supabaseUserId", async (req, res) => {
  try {
    const { supabaseUserId } = req.params;

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      return res.status(500).json({
        success: false,
        message: "Error fetching user",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        supabaseUserId: user.supabase_user_id,
        email: user.email,
        fullName: user.full_name,
        creditBalance: user.credit_balance,
        avatarUrl: user.avatar_url,
        authProvider: user.auth_provider,
      },
    });
  } catch (error) {
    console.error("❌ [AUTH] Get user error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;

