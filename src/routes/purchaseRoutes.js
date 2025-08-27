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
      isOneTimePackage:
        packageType === "one_time" ||
        (productId &&
          (productId.includes("creditpack") || productId.includes("coin"))),
      timestamp: new Date().toISOString(),
    });

    // DOUBLE PURCHASE PREVENTION: Check for rapid duplicate requests
    const requestKey = `${userId}_${productId}_${Date.now()}`;
    const duplicateCheckWindow = 2000; // 2 seconds

    // Store ongoing requests in memory (production'da Redis kullanılabilir)
    if (!global.ongoingPurchaseRequests) {
      global.ongoingPurchaseRequests = new Map();
    }

    // Check for ongoing request for same user+product
    const ongoingKey = `${userId}_${productId}`;
    const ongoingRequest = global.ongoingPurchaseRequests.get(ongoingKey);

    if (
      ongoingRequest &&
      Date.now() - ongoingRequest.timestamp < duplicateCheckWindow
    ) {
      console.warn(`Double purchase prevention triggered for ${ongoingKey}`, {
        currentTime: Date.now(),
        ongoingTimestamp: ongoingRequest.timestamp,
        timeDiff: Date.now() - ongoingRequest.timestamp,
      });

      return res.status(429).json({
        success: false,
        message: "Purchase request already in progress, please wait",
        retryAfter: duplicateCheckWindow,
      });
    }

    // Mark this request as ongoing
    global.ongoingPurchaseRequests.set(ongoingKey, {
      timestamp: Date.now(),
      transactionId,
      productId,
    });

    // Cleanup function to remove ongoing request
    const cleanupOngoingRequest = () => {
      global.ongoingPurchaseRequests.delete(ongoingKey);
    };

    // Set timeout to cleanup after window expires
    setTimeout(cleanupOngoingRequest, duplicateCheckWindow);

    // Input validation
    if (!userId || !productId || !coinsAdded) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // GÜVENLIK: Sadece gerçek demo/fallback transaction'ları engelle
    // RevenueCat gerçek product ID'leri (com.monailisa.*) geçirebilir
    const isRealRevenueCatProduct =
      productId && productId.startsWith("com.monailisa.");
    const isDemoTransaction =
      (transactionId &&
        (transactionId.includes("demo_") ||
          transactionId.includes("fallback_"))) ||
      (productId &&
        (productId.includes("demo_") || productId.includes("fallback_"))) ||
      packageType === "demo_one_time";

    if (isDemoTransaction && !isRealRevenueCatProduct) {
      console.log(
        "Purchase verification BLOCKED - Demo/fallback transaction detected:",
        {
          transactionId,
          productId,
          packageType,
          isRealRevenueCatProduct,
        }
      );
      return res.status(400).json({
        success: false,
        message: "Demo transactions are not allowed",
      });
    }

    // Test modunda transaction ID olmayabilir - gerçek RevenueCat product'ları için izin ver
    if (!transactionId && isRealRevenueCatProduct) {
      console.log(
        "Test mode detected - allowing RevenueCat product without transaction ID:",
        {
          productId,
          userId,
        }
      );
    }

    // Transaction ID oluştur eğer yoksa (test modunda)
    const finalTransactionId =
      transactionId ||
      (isRealRevenueCatProduct
        ? `test_${productId.replace(/\./g, "_")}_${userId}_${Date.now()}`
        : `demo_${userId}_${Date.now()}`);

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
        newBalance: existingPurchase.coins_added
          ? (
              await supabase
                .from("users")
                .select("credit_balance")
                .eq("id", userId)
                .single()
            ).data?.credit_balance || 0
          : null,
      });
    }

    // STRATEGY: One-time purchases are ONLY handled by client verification
    // Webhooks skip NON_RENEWING_PURCHASE events, so no coordination needed
    console.log(
      "✅ ONE-TIME PURCHASE - Processing via client verification only (webhooks skip these):",
      {
        userId,
        productId,
        transactionId: transactionId || "test_mode",
        strategy: "client_verification_only",
      }
    );

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
      package_type:
        packageType === "subscription" ? "subscription" : "one_time",
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

    console.log(
      "✅ CLIENT VERIFICATION - One-time purchase verified successfully:",
      {
        userId,
        transactionId: finalTransactionId,
        newBalance,
        coinsAdded,
        productId,
        packageType: "one_time",
        source: "client_verification",
        timestamp: new Date().toISOString(),
      }
    );

    // Cleanup ongoing request before responding
    if (typeof cleanupOngoingRequest === "function") {
      cleanupOngoingRequest();
    }

    return res.status(200).json({
      success: true,
      message: "Purchase verified successfully",
      newBalance: newBalance,
      coinsAdded: parseInt(coinsAdded),
    });
  } catch (error) {
    console.error("Purchase verification error:", error);

    // Cleanup ongoing request on error
    if (req.body && req.body.userId && req.body.productId) {
      const ongoingKey = `${req.body.userId}_${req.body.productId}`;
      if (global.ongoingPurchaseRequests) {
        global.ongoingPurchaseRequests.delete(ongoingKey);
      }
    }

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

    // DOUBLE CREDIT PREVENTION: Check if webhook already processed this subscription in last 60 seconds
    // This applies to both real transactions and test mode
    const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: recentWebhookPurchase, error: webhookError } = await supabase
      .from("user_purchase")
      .select("*")
      .eq("user_id", userId)
      .eq("product_id", productId)
      .eq("package_type", "subscription")
      .gte("purchase_date", sixtySecondsAgo)
      .order("purchase_date", { ascending: false })
      .limit(1)
      .single();

    // ADDITIONAL CHECK: Look for any recent subscription for this user (different product IDs)
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: anyRecentSubscription, error: anySubError } = await supabase
      .from("user_purchase")
      .select("*")
      .eq("user_id", userId)
      .eq("package_type", "subscription")
      .gte("purchase_date", twoMinutesAgo)
      .order("purchase_date", { ascending: false })
      .limit(1);

    // Check if user just got subscription credits (any subscription type)
    if (anyRecentSubscription && anyRecentSubscription.length > 0) {
      const recentSub = anyRecentSubscription[0];
      const expectedCoins = subscriptionType === "weekly" ? 600 : 2400;

      console.log("🔍 SUBSCRIPTION DOUBLE-CHECK:", {
        userId,
        requestedType: subscriptionType,
        requestedCoins: expectedCoins,
        recentSubscription: {
          product_id: recentSub.product_id,
          coins_added: recentSub.coins_added,
          purchase_date: recentSub.purchase_date,
          transaction_id: recentSub.transaction_id,
        },
        timeDifference:
          Date.now() - new Date(recentSub.purchase_date).getTime(),
      });

      // If same subscription type with same coins was just processed
      if (recentSub.coins_added === expectedCoins) {
        console.log(
          "🚨 SUBSCRIPTION VERIFICATION BLOCKED - Same subscription type already processed recently:",
          {
            recentTransactionId: recentSub.transaction_id,
            recentProductId: recentSub.product_id,
            coinsAlreadyAdded: recentSub.coins_added,
            requestedProductId: productId,
            requestedCoins: expectedCoins,
            preventedDoubleCredit: true,
          }
        );

        // Get current user balance
        const { data: currentUser } = await supabase
          .from("users")
          .select("credit_balance, is_pro")
          .eq("id", userId)
          .single();

        return res.status(200).json({
          success: true,
          message: "Subscription already processed recently",
          alreadyProcessed: true,
          newBalance: currentUser?.credit_balance || 0,
          coinsAdded: recentSub.coins_added || 0,
          subscriptionType: subscriptionType,
          recentlyProcessed: true,
        });
      }
    }

    if (recentWebhookPurchase) {
      console.log(
        "🚨 SUBSCRIPTION VERIFICATION BLOCKED - Webhook already processed within last 60 seconds:",
        {
          webhookTransactionId: recentWebhookPurchase.transaction_id,
          productId,
          userId,
          coinsAdded: recentWebhookPurchase.coins_added,
          webhookProcessedAt: recentWebhookPurchase.purchase_date,
          clientTransactionId: transactionId || "test_mode",
        }
      );

      // Get current user balance
      const { data: currentUser } = await supabase
        .from("users")
        .select("credit_balance, is_pro")
        .eq("id", userId)
        .single();

      return res.status(200).json({
        success: true,
        message: "Subscription already processed by webhook",
        alreadyProcessed: true,
        newBalance: currentUser?.credit_balance || 0,
        coinsAdded: recentWebhookPurchase.coins_added || 0,
        subscriptionType: subscriptionType,
        webhookProcessed: true,
      });
    }

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

    console.log(
      "✅ CLIENT VERIFICATION - Subscription verified successfully:",
      {
        userId,
        transactionId: finalTransactionId,
        newBalance,
        coinsToAdd,
        subscriptionType,
        productId,
        source: "client_verification",
        timestamp: new Date().toISOString(),
      }
    );

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

    // Cache kontrolünü devre dışı bırak
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    // Get user data from database - önce tüm alanlarla dene
    let userData, userError;
    try {
      const result = await supabase
        .from("users")
        .select(
          "credit_balance, is_pro, subscription_type, received_initial_credit"
        )
        .eq("id", userId)
        .single();
      userData = result.data;
      userError = result.error;
    } catch (error) {
      // Bazı columnlar yoksa, sadece temel alanları al
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
      received_initial_credit: userData.received_initial_credit || false,
      timestamp: new Date().toISOString(), // Cache busting için timestamp ekle
    });
  } catch (error) {
    console.error("Get user data error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Mark initial credit as received endpoint
router.post("/mark-initial-credit-received/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    console.log(
      `🎁 [GIFT MODAL] Marking initial credit as received for user: ${userId}`
    );

    // Update user's received_initial_credit to true
    const { error: updateError } = await supabase
      .from("users")
      .update({
        received_initial_credit: true,
        initial_credit_received_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Error updating received_initial_credit:", updateError);
      return res.status(500).json({
        success: false,
        message: "Failed to update user",
      });
    }

    console.log(
      `✅ [GIFT MODAL] User ${userId} marked as received initial credit`
    );

    return res.status(200).json({
      success: true,
      message: "Initial credit marked as received",
    });
  } catch (error) {
    console.error("Mark initial credit error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Get paywall packages endpoint - hızlı fallback paketleri
router.get("/packages", async (req, res) => {
  try {
    // Cache kontrolünü devre dışı bırak
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    // Hızlı fallback paketleri döndür
    const packages = {
      coinPackages: [
        {
          coins: "300",
          identifier: "backend_300_coins",
          price: "$12.99",
          pricePerCoin: "$0.043",
          originalPrice: 12.99,
          bestValue: false,
          description: "300 Credits Pack",
          currencyCode: "USD",
        },
        {
          coins: "1000",
          identifier: "backend_1000_coins",
          price: "$29.99",
          pricePerCoin: "$0.030",
          originalPrice: 29.99,
          bestValue: true,
          description: "1000 Credits Pack - Best Value!",
          currencyCode: "USD",
        },
        {
          coins: "2200",
          identifier: "backend_2200_coins",
          price: "$54.99",
          pricePerCoin: "$0.025",
          originalPrice: 54.99,
          bestValue: false,
          description: "2200 Credits Pack",
          currencyCode: "USD",
        },
        {
          coins: "5000",
          identifier: "backend_5000_coins",
          price: "$99.99",
          pricePerCoin: "$0.020",
          originalPrice: 99.99,
          bestValue: false,
          description: "5000 Credits Pack - Maximum Value!",
          currencyCode: "USD",
        },
      ],
      subscriptionPackages: [
        {
          type: "weekly",
          identifier: "backend_weekly_sub",
          price: "$2.99",
          coins: 600,
          period: "week",
          description: "Weekly Pro 600",
        },
        {
          type: "monthly",
          identifier: "backend_monthly_sub",
          price: "$24.99",
          coins: 2400,
          period: "month",
          description: "Monthly Pro 2400",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      ...packages,
    });
  } catch (error) {
    console.error("Get packages error:", error);
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
