const express = require("express");
const crypto = require("crypto");
const { supabase } = require("../supabaseClient");

const router = express.Router();

// =========================================================
// PRODUCT MAPPING: internal product_id -> credits & plan info
// Mirrors revenuecatWebhookv2.js getCreditsForPackage()
// =========================================================
const PRODUCT_MAP = {
  // One-time coin packs (same as RevenueCat - bonus is UI-only)
  micro_1000:       { credits: 1000,  type: "coin_pack" },
  small_2500:       { credits: 2500,  type: "coin_pack" },
  boost_5000:       { credits: 5000,  type: "coin_pack" },
  growth_10000:     { credits: 10000, type: "coin_pack" },
  pro_15000:        { credits: 15000, type: "coin_pack" },
  enterprise_20000: { credits: 20000, type: "coin_pack" },

  // Subscription plans
  standard_weekly_600:   { credits: 600,  type: "subscription", planType: "standard", teamMembers: 0 },
  standard_monthly_2400: { credits: 2400, type: "subscription", planType: "standard", teamMembers: 0 },
  plus_weekly_1200:      { credits: 1200, type: "subscription", planType: "plus",     teamMembers: 1 },
  plus_monthly_4800:     { credits: 4800, type: "subscription", planType: "plus",     teamMembers: 1 },
  premium_weekly_2400:   { credits: 2400, type: "subscription", planType: "premium",  teamMembers: 2 },
  premium_monthly_9600:  { credits: 9600, type: "subscription", planType: "premium",  teamMembers: 2 },
};

// =========================================================
// WEBHOOK SIGNATURE VERIFICATION
// LemonSqueezy signs with HMAC-SHA256 using x-signature header
// req.body is a raw Buffer (express.raw middleware in app.js)
// =========================================================
function verifyWebhookSignature(req, res, next) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("❌ LEMONSQUEEZY_WEBHOOK_SECRET not configured");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }

  const signature = req.headers["x-signature"];
  if (!signature) {
    console.error("❌ No x-signature header found");
    return res.status(401).json({ error: "Missing signature" });
  }

  const hmac = crypto.createHmac("sha256", secret);
  const digest = hmac.update(req.body).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    console.error("❌ Webhook signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  // Parse the raw body to JSON after verification
  try {
    req.parsedBody = JSON.parse(req.body.toString());
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  next();
}

// =========================================================
// TEAM-AWARE CREDIT ROUTING
// Same pattern as revenuecatWebhookv2.js lines 354-391
// =========================================================
async function resolveTargetUser(purchaserId) {
  let userId = purchaserId;
  let isTeamPurchase = false;
  let teamOwnerId = null;

  try {
    const { data: purchaserData, error: purchaserError } = await supabase
      .from("users")
      .select("active_team_id")
      .eq("id", purchaserId)
      .single();

    if (!purchaserError && purchaserData && purchaserData.active_team_id) {
      const { data: teamData, error: teamError } = await supabase
        .from("teams")
        .select("owner_id")
        .eq("id", purchaserData.active_team_id)
        .single();

      if (!teamError && teamData && teamData.owner_id && teamData.owner_id !== purchaserId) {
        userId = teamData.owner_id;
        isTeamPurchase = true;
        teamOwnerId = teamData.owner_id;
        console.log(`👥 TEAM PURCHASE: member ${purchaserId} → credits to owner ${teamOwnerId}`);
      }
    }
  } catch (error) {
    console.log(`⚠️ Team check failed, using purchaser: ${error.message}`);
  }

  return { userId, isTeamPurchase, teamOwnerId, purchaserId };
}

// =========================================================
// DUPLICATE CHECK
// Same pattern as revenuecatWebhookv2.js lines 396-476
// =========================================================
async function isDuplicate(transactionId, userId) {
  if (!transactionId) return false;

  const { data: existing, error } = await supabase
    .from("purchase_history")
    .select("transaction_id")
    .eq("transaction_id", transactionId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    console.error("❌ Duplicate check error:", error);
    return false;
  }

  if (existing && existing.length > 0) {
    console.log(`🚫 DUPLICATE: ${transactionId} already processed for user ${userId}`);
    return true;
  }

  return false;
}

// =========================================================
// ADD CREDITS & UPDATE USER
// Same pattern as revenuecatWebhookv2.js lines 638-720
// =========================================================
async function addCreditsToUser(userId, productInfo, transactionId, eventType, price, currency) {
  // Fetch current balance
  const { data: userData, error: fetchError } = await supabase
    .from("users")
    .select("credit_balance")
    .eq("id", userId)
    .single();

  if (fetchError) {
    console.error("❌ Error fetching user:", fetchError);
    throw new Error("User fetch failed");
  }

  const currentBalance = userData.credit_balance || 0;
  const newBalance = currentBalance + productInfo.credits;

  // Build update fields
  const updateFields = {
    credit_balance: newBalance,
    is_pro: true,
  };

  // Subscription-specific fields
  if (productInfo.type === "subscription" && productInfo.planType) {
    updateFields.subscription_type = productInfo.planType;
    updateFields.team_max_members = productInfo.teamMembers || 0;
    updateFields.team_subscription_active = true;
    console.log(`📦 Subscription: ${productInfo.planType}, team_max_members: ${productInfo.teamMembers}`);
  }

  // Update user
  const { data: updateData, error: updateError } = await supabase
    .from("users")
    .update(updateFields)
    .eq("id", userId)
    .select();

  if (updateError) {
    console.error("❌ Error updating credits:", updateError);
    throw new Error("Credit update failed");
  }

  console.log(`✅ Credits updated: ${currentBalance} → ${newBalance} (+${productInfo.credits})`);

  // Save to purchase_history
  try {
    await supabase.from("purchase_history").insert({
      user_id: userId,
      product_id: productInfo.productId || "unknown",
      transaction_id: transactionId,
      credits_added: productInfo.credits,
      price: price || 0,
      currency: currency || "USD",
      store: "lemonsqueezy",
      environment: "production",
      event_type: eventType,
      purchased_at: new Date(),
      created_at: new Date().toISOString(),
    });
    console.log("📋 Purchase history saved");
  } catch (historyError) {
    console.error("⚠️ Purchase history error:", historyError);
  }

  return { newBalance, creditsAdded: productInfo.credits };
}

// =========================================================
// HANDLE SUBSCRIPTION CANCELLATION/EXPIRATION
// Mirrors revenuecatWebhookv2.js lines 153-318
// =========================================================
async function handleSubscriptionEnded(body, userId, eventName, res) {
  console.log(`🚫 Processing ${eventName} for user ${userId}`);

  const attrs = body.data.attributes;

  // If cancelled but not yet expired, subscription is still active
  if (eventName === "subscription_cancelled" && attrs.ends_at) {
    const endsAt = new Date(attrs.ends_at).getTime();
    if (endsAt > Date.now()) {
      console.log(`ℹ️ Cancelled but still active until ${attrs.ends_at}`);
      return res.status(200).json({
        success: true,
        message: "Subscription cancelled but still active",
        user_id: userId,
        ends_at: attrs.ends_at,
        is_pro: true,
      });
    }
  }

  // Downgrade user
  const { error: downgradeError } = await supabase
    .from("users")
    .update({
      is_pro: false,
      subscription_type: null,
      team_max_members: 0,
      team_subscription_active: false,
    })
    .eq("id", userId);

  if (downgradeError) {
    console.error("❌ Error downgrading user:", downgradeError);
    return res.status(500).json({ error: "User downgrade failed" });
  }

  // Clean up team members if user has a team
  try {
    const { data: userTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("owner_id", userId)
      .single();

    if (userTeam) {
      await supabase.from("teams").update({ max_members: 0 }).eq("id", userTeam.id);

      // Remove non-owner members
      await supabase
        .from("team_members")
        .delete()
        .eq("team_id", userTeam.id)
        .neq("role", "owner");

      // Cancel pending invitations
      await supabase
        .from("team_invitations")
        .update({ status: "cancelled" })
        .eq("team_id", userTeam.id)
        .eq("status", "pending");

      console.log("✅ Team cleaned up");
    }
  } catch (teamError) {
    console.error("⚠️ Team cleanup error:", teamError);
  }

  // Save to purchase history
  try {
    const subscriptionId = body.data.id;
    await supabase.from("purchase_history").insert({
      user_id: userId,
      product_id: "subscription_cancelled",
      transaction_id: `ls_cancel_${subscriptionId}`,
      credits_added: 0,
      price: 0,
      currency: "USD",
      store: "lemonsqueezy",
      environment: "production",
      event_type: eventName.toUpperCase(),
      purchased_at: new Date(),
      created_at: new Date().toISOString(),
    });
  } catch (historyError) {
    console.error("⚠️ Cancellation history error:", historyError);
  }

  console.log("✅ Subscription ended, user downgraded");
  return res.status(200).json({
    success: true,
    message: `Subscription ${eventName} processed`,
    user_id: userId,
    is_pro: false,
  });
}

// =========================================================
// MAIN WEBHOOK ENDPOINT
// =========================================================
router.post("/webhook", verifyWebhookSignature, async (req, res) => {
  try {
    const body = req.parsedBody;
    const eventName = body.meta.event_name;
    const customData = body.meta.custom_data || {};
    const userId = customData.user_id;

    console.log("🍋 ===== LemonSqueezy Webhook Received =====");
    console.log(`   Event: ${eventName}`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Custom Data:`, customData);

    if (!userId) {
      console.error("❌ No user_id in custom_data");
      return res.status(400).json({ error: "Missing user_id in custom data" });
    }

    // ------ ORDER_CREATED: One-time coin pack purchase ------
    if (eventName === "order_created") {
      const attrs = body.data.attributes;
      const orderId = body.data.id;
      const productId = customData.product_id;
      const transactionId = `ls_order_${orderId}`;

      console.log(`🛒 Order: ${orderId}, Product: ${productId}`);

      // Look up product info
      const productInfo = PRODUCT_MAP[productId];
      if (!productInfo) {
        console.error(`❌ Unknown product: ${productId}`);
        return res.status(400).json({ error: `Unknown product: ${productId}` });
      }

      // Resolve target user (team-aware)
      const { userId: targetUserId, isTeamPurchase, teamOwnerId } = await resolveTargetUser(userId);

      // Duplicate check
      if (await isDuplicate(transactionId, targetUserId)) {
        return res.status(200).json({ success: true, message: "Duplicate ignored", duplicate: true });
      }

      // Add credits
      const totalPrice = attrs.total ? attrs.total / 100 : 0; // LemonSqueezy sends cents
      const currency = attrs.currency || "USD";
      const result = await addCreditsToUser(
        targetUserId,
        { ...productInfo, productId },
        transactionId,
        "ORDER_CREATED",
        totalPrice,
        currency
      );

      console.log(`✅ Coin pack purchase complete: +${result.creditsAdded} credits`);
      return res.status(200).json({
        success: true,
        message: "Credits added",
        user_id: targetUserId,
        credits_added: result.creditsAdded,
        new_balance: result.newBalance,
        is_team_purchase: isTeamPurchase,
      });
    }

    // ------ SUBSCRIPTION_CREATED: New subscription ------
    if (eventName === "subscription_created") {
      const attrs = body.data.attributes;
      const subscriptionId = body.data.id;
      const productId = customData.product_id;
      const transactionId = `ls_sub_${subscriptionId}`;

      console.log(`📦 Subscription created: ${subscriptionId}, Product: ${productId}`);

      const productInfo = PRODUCT_MAP[productId];
      if (!productInfo) {
        console.error(`❌ Unknown subscription product: ${productId}`);
        return res.status(400).json({ error: `Unknown product: ${productId}` });
      }

      const { userId: targetUserId, isTeamPurchase } = await resolveTargetUser(userId);

      if (await isDuplicate(transactionId, targetUserId)) {
        return res.status(200).json({ success: true, message: "Duplicate ignored", duplicate: true });
      }

      const totalPrice = attrs.first_subscription_item?.price ? attrs.first_subscription_item.price / 100 : 0;
      const currency = attrs.currency || "USD";
      const result = await addCreditsToUser(
        targetUserId,
        { ...productInfo, productId },
        transactionId,
        "SUBSCRIPTION_CREATED",
        totalPrice,
        currency
      );

      console.log(`✅ Subscription activated: ${productInfo.planType}, +${result.creditsAdded} credits`);
      return res.status(200).json({
        success: true,
        message: "Subscription created",
        user_id: targetUserId,
        credits_added: result.creditsAdded,
        new_balance: result.newBalance,
        subscription_type: productInfo.planType,
        is_team_purchase: isTeamPurchase,
      });
    }

    // ------ SUBSCRIPTION_UPDATED: Renewal or status change ------
    if (eventName === "subscription_updated") {
      const attrs = body.data.attributes;
      const subscriptionId = body.data.id;
      const productId = customData.product_id;
      const status = attrs.status;
      const updatedAt = attrs.updated_at;

      console.log(`🔄 Subscription updated: ${subscriptionId}, status: ${status}`);

      // Only process if active (renewal)
      if (status !== "active") {
        console.log(`ℹ️ Subscription status '${status}' - no credits to add`);
        return res.status(200).json({ success: true, message: "Status noted, no action" });
      }

      const productInfo = PRODUCT_MAP[productId];
      if (!productInfo) {
        console.log(`⚠️ Unknown product in renewal: ${productId}`);
        return res.status(200).json({ success: true, message: "Product not mapped" });
      }

      const { userId: targetUserId } = await resolveTargetUser(userId);

      // Unique transaction ID per renewal using updated_at timestamp
      const transactionId = `ls_renewal_${subscriptionId}_${updatedAt}`;

      if (await isDuplicate(transactionId, targetUserId)) {
        return res.status(200).json({ success: true, message: "Duplicate renewal ignored", duplicate: true });
      }

      const result = await addCreditsToUser(
        targetUserId,
        { ...productInfo, productId },
        transactionId,
        "RENEWAL",
        0,
        attrs.currency || "USD"
      );

      console.log(`✅ Renewal processed: +${result.creditsAdded} credits`);
      return res.status(200).json({
        success: true,
        message: "Renewal processed",
        user_id: targetUserId,
        credits_added: result.creditsAdded,
        new_balance: result.newBalance,
      });
    }

    // ------ SUBSCRIPTION_CANCELLED / SUBSCRIPTION_EXPIRED ------
    if (eventName === "subscription_cancelled" || eventName === "subscription_expired") {
      const { userId: targetUserId } = await resolveTargetUser(userId);
      return await handleSubscriptionEnded(body, targetUserId, eventName, res);
    }

    // ------ UNHANDLED EVENT ------
    console.log(`ℹ️ Unhandled event: ${eventName}`);
    return res.status(200).json({ success: true, message: `Event '${eventName}' received, no action` });

  } catch (error) {
    console.error("💥 LemonSqueezy webhook error:", error);
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
});

module.exports = router;
