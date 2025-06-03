// routes/purchaseRoutes.js
const express = require("express");
const router = express.Router();
const supabase = require("../supabaseClient");

// Purchase verification endpoint
router.post("/verify", async (req, res) => {
  try {
    const {
      userId,
      productId,
      transactionId,
      coinsAdded,
      price,
      productTitle,
      packageType,
      receiptData,
    } = req.body;

    console.log("Purchase verification request:", {
      userId,
      productId,
      transactionId,
      coinsAdded,
      price,
      packageType,
    });

    // Input validation
    if (!userId || !productId || !coinsAdded) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Demo transaction ID oluştur eğer yoksa
    const finalTransactionId = transactionId || `demo_${userId}_${Date.now()}`;

    // Check if transaction already processed
    const { data: existingPurchase, error: checkError } = await supabase
      .from("user_purchase")
      .select("*")
      .eq("transaction_id", finalTransactionId)
      .single();

    if (existingPurchase) {
      console.log("Transaction already processed:", finalTransactionId);
      return res.status(200).json({
        success: true,
        message: "Transaction already processed",
        alreadyProcessed: true,
      });
    }

    // Get current user data
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credit_balance, is_pro")
      .eq("id", userId)
      .single();

    if (userError || !userData) {
      console.error("User not found:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentBalance = userData.credit_balance || 0;
    const newBalance = currentBalance + parseInt(coinsAdded);

    // Update user balance and pro status
    const { error: updateError } = await supabase
      .from("users")
      .update({
        credit_balance: newBalance,
        is_pro: true,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating user balance:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update user balance",
        error: updateError.message,
      });
    }

    console.log("User balance updated successfully:", {
      userId,
      newBalance,
      coinsAdded,
    });

    // Verify the update by fetching user data again
    const { data: updatedUserData, error: verifyError } = await supabase
      .from("users")
      .select("credit_balance, is_pro")
      .eq("id", userId)
      .single();

    if (verifyError || !updatedUserData) {
      console.error("Error verifying user update:", verifyError);
    } else {
      console.log("Verified updated user data:", updatedUserData);
    }

    // Record purchase in user_purchase table
    const purchaseRecord = {
      user_id: userId,
      product_id: productId,
      transaction_id: finalTransactionId,
      product_title: productTitle || `${coinsAdded} Credits`,
      purchase_date: new Date().toISOString(),
      package_type: packageType || "one_time",
      price: price || 0,
      coins_added: parseInt(coinsAdded),
      purchase_number: null,
    };

    const { error: insertError } = await supabase
      .from("user_purchase")
      .insert([purchaseRecord]);

    if (insertError) {
      console.error("Error recording purchase:", insertError);
      // Don't return error here, purchase was successful
    }

    console.log("Purchase verified successfully:", {
      userId,
      transactionId: finalTransactionId,
      newBalance,
      coinsAdded,
    });

    return res.status(200).json({
      success: true,
      message: "Purchase verified successfully",
      newBalance: newBalance,
      coinsAdded: parseInt(coinsAdded),
    });
  } catch (error) {
    console.error("Purchase verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Subscription verification endpoint
router.post("/subscription/verify", async (req, res) => {
  try {
    const { userId, productId, transactionId, subscriptionType, receiptData } =
      req.body;

    console.log("Subscription verification request:", {
      userId,
      productId,
      transactionId,
      subscriptionType,
    });

    // Input validation
    if (!userId || !productId || !subscriptionType) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Demo transaction ID oluştur eğer yoksa (test modunda)
    const finalTransactionId =
      transactionId || `demo_sub_${userId}_${Date.now()}`;

    // Check if transaction already processed
    const { data: existingPurchase, error: checkError } = await supabase
      .from("user_purchase")
      .select("*")
      .eq("transaction_id", finalTransactionId)
      .single();

    if (existingPurchase) {
      console.log(
        "Subscription transaction already processed:",
        finalTransactionId
      );
      return res.status(200).json({
        success: true,
        message: "Subscription already processed",
        alreadyProcessed: true,
      });
    }

    // Get current user data
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    if (userError || !userData) {
      console.error("User not found:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log("Current user data:", userData);

    // Determine coins to add based on subscription type and product
    let coinsToAdd = 0;
    let subscriptionTitle = "";

    if (
      subscriptionType === "weekly" ||
      productId.includes("weekly") ||
      productId.includes("600")
    ) {
      coinsToAdd = 600;
      subscriptionTitle = "Weekly Pro 600";
    } else if (
      subscriptionType === "monthly" ||
      productId.includes("monthly") ||
      productId.includes("2400")
    ) {
      coinsToAdd = 2400;
      subscriptionTitle = "Monthly Pro 2400";
    }

    const currentBalance = userData.credit_balance || 0;
    const newBalance = currentBalance + coinsToAdd;

    console.log("Balance calculation:", {
      currentBalance,
      coinsToAdd,
      newBalance,
    });

    // Update user balance, pro status and subscription type
    const { error: updateError } = await supabase
      .from("users")
      .update({
        credit_balance: newBalance,
        is_pro: true,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating user subscription:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update user subscription",
        error: updateError.message,
      });
    }

    console.log("User subscription updated successfully:", {
      userId,
      newBalance,
      coinsToAdd,
    });

    // Verify the update by fetching user data again
    const { data: updatedUserData, error: verifyError } = await supabase
      .from("users")
      .select("credit_balance, is_pro")
      .eq("id", userId)
      .single();

    if (verifyError || !updatedUserData) {
      console.error("Error verifying user update:", verifyError);
    } else {
      console.log("Verified updated user data:", updatedUserData);
    }

    // Record subscription purchase
    const subscriptionRecord = {
      user_id: userId,
      product_id: productId,
      transaction_id: finalTransactionId,
      product_title: subscriptionTitle,
      purchase_date: new Date().toISOString(),
      package_type: "subscription",
      price: 0, // Will be filled from RevenueCat webhook
      coins_added: coinsToAdd,
      purchase_number: null,
    };

    const { error: insertError } = await supabase
      .from("user_purchase")
      .insert([subscriptionRecord]);

    if (insertError) {
      console.error("Error recording subscription:", insertError);
      // Don't return error here, subscription was successful
    }

    console.log("Subscription verified successfully:", {
      userId,
      transactionId: finalTransactionId,
      newBalance,
      coinsToAdd,
      subscriptionType,
    });

    return res.status(200).json({
      success: true,
      message: "Subscription verified successfully",
      newBalance: newBalance,
      coinsAdded: coinsToAdd,
      subscriptionType: subscriptionType,
    });
  } catch (error) {
    console.error("Subscription verification error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get user data endpoint
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get user data from database - önce subscription_type ile dene
    let userData, userError;
    try {
      const result = await supabase
        .from("users")
        .select("credit_balance, is_pro, subscription_type")
        .eq("id", userId)
        .single();
      userData = result.data;
      userError = result.error;
    } catch (error) {
      // subscription_type column yoksa, sadece temel alanları al
      const result = await supabase
        .from("users")
        .select("credit_balance, is_pro")
        .eq("id", userId)
        .single();
      userData = result.data;
      userError = result.error;
    }

    if (userError || !userData) {
      console.error("User not found:", userError);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      credit_balance: userData.credit_balance || 0,
      is_pro: userData.is_pro || false,
      subscription_type: userData.subscription_type || null,
    });
  } catch (error) {
    console.error("Get user data error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Purchase history endpoint
router.get("/user/:userId/purchases", async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get purchase history
    const { data: purchases, error: purchaseError } = await supabase
      .from("user_purchase")
      .select("*")
      .eq("user_id", userId)
      .order("purchase_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (purchaseError) {
      console.error("Error fetching purchase history:", purchaseError);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch purchase history",
      });
    }

    return res.status(200).json({
      success: true,
      purchases: purchases || [],
      count: purchases?.length || 0,
    });
  } catch (error) {
    console.error("Purchase history error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Purchase API is healthy",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
