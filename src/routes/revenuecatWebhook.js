// routes/revenuecatWebhook.jsMore actions
const express = require("express");
const router = express.Router();
const { supabase } = require("../supabaseClient"); // supabaseClient.js dosyanın yolu

router.post("/webhook", async (req, res) => {
  try {
    const event = req.body;
    console.log("RevenueCat webhook event received:", event);

    const rcEvent = event.event;
    if (!rcEvent) {
      return res.status(400).json({ message: "Invalid event structure" });
    }

    // requestte $RCAnonymousID vs diye birşey yoksa bu kısımları kaldırıyoruz
    const {
      type,
      app_user_id,
      product_id,
      original_transaction_id,
      purchased_at_ms,
    } = rcEvent;

    // purchased_at_ms'den ISO formatında bir tarih oluşturuyoruz
    const purchase_date = purchased_at_ms
      ? new Date(purchased_at_ms).toISOString()
      : new Date().toISOString(); // güvenlik için, eğer yoksa mevcut zaman

    // Subscription expiration handling with protection
    if (type === "EXPIRATION" || type === "CANCELLATION") {
      console.log(`Webhook - Processing ${type} for user:`, app_user_id, {
        product_id,
        original_transaction_id,
        event_timestamp: new Date().toISOString(),
      });

      // PROTECTION: Check if this cancellation is due to recent one-time purchase
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentOneTimePurchases, error: recentError } =
        await supabase
          .from("user_purchase")
          .select("*")
          .eq("user_id", app_user_id)
          .eq("package_type", "one_time")
          .gte("purchase_date", fiveMinutesAgo)
          .order("purchase_date", { ascending: false });

      if (recentOneTimePurchases && recentOneTimePurchases.length > 0) {
        console.warn(
          `WARNING: Ignoring ${type} - Recent one-time purchase detected!`,
          {
            app_user_id,
            recent_purchases: recentOneTimePurchases.map((p) => ({
              product_id: p.product_id,
              coins_added: p.coins_added,
              purchase_date: p.purchase_date,
            })),
          }
        );

        return res.status(200).json({
          message: `${type} ignored due to recent one-time purchase`,
          protection_applied: true,
        });
      }

      // Check if user has any valid subscription products
      const { data: activeSubscriptions, error: subError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("user_id", app_user_id)
        .eq("package_type", "subscription")
        .gte(
          "purchase_date",
          new Date(Date.now() - 32 * 24 * 60 * 60 * 1000).toISOString()
        ) // Last 32 days
        .order("purchase_date", { ascending: false })
        .limit(1);

      if (activeSubscriptions && activeSubscriptions.length > 0) {
        const latestSub = activeSubscriptions[0];
        console.log(`User has recent subscription:`, {
          product_id: latestSub.product_id,
          purchase_date: latestSub.purchase_date,
        });
      }

      const { error: updateError } = await supabase
        .from("users")
        .update({ is_pro: false })
        .eq("id", app_user_id);

      if (updateError) {
        console.error("Error updating user pro status:", updateError);
        return res.status(500).json({ message: "Failed to update pro status" });
      }

      console.log(
        `${type} processed - User pro status updated to false:`,
        app_user_id
      );
      return res.status(200).json({ message: `${type} processed` });
    }

    // Handle purchase events - All RevenueCat purchase event types
    if (
      type === "INITIAL_PURCHASE" ||
      type === "RENEWAL" ||
      type === "NON_RENEWING_PURCHASE"
    ) {
      // STRATEGY: Skip NON_RENEWING_PURCHASE - handled by client verification only
      if (type === "NON_RENEWING_PURCHASE") {
        console.log(
          "⏭️ SKIPPING NON_RENEWING_PURCHASE - One-time purchases handled by client verification only:",
          {
            product_id,
            app_user_id,
            transaction_id: original_transaction_id,
            reason: "one_time_purchases_client_only",
          }
        );

        return res.status(200).json({
          received: true,
          skipped: true,
          reason: "one_time_purchases_handled_by_client_verification",
        });
      }

      console.log(`🎯 WEBHOOK - Processing ${type} event for:`, {
        app_user_id,
        product_id,
        original_transaction_id,
        event_timestamp: new Date().toISOString(),
        event_explanation: {
          INITIAL_PURCHASE: "First time subscription or one-time purchase",
          RENEWAL: "Subscription renewal (should be recurring)",
          NON_RENEWING_PURCHASE: "One-time purchase (not subscription)",
        }[type],
      });

      // DUPLICATE CHECK: Aynı transaction_id ile işlem yapılmış mı kontrol et
      const { data: existingTransaction, error: checkError } = await supabase
        .from("user_purchase")
        .select("*")
        .eq("transaction_id", original_transaction_id)
        .single();

      if (existingTransaction) {
        console.log(
          `Webhook - ${type} transaction already processed:`,
          original_transaction_id
        );
        return res
          .status(200)
          .json({ message: "Transaction already processed" });
      }

      // CLIENT VERIFICATION PRIORITY: Check if client already processed this subscription in last 2 minutes
      if (type === "INITIAL_PURCHASE" || type === "RENEWAL") {
        const twoMinutesAgo = new Date(
          Date.now() - 2 * 60 * 1000
        ).toISOString();
        const { data: recentClientPurchase, error: clientError } =
          await supabase
            .from("user_purchase")
            .select("*")
            .eq("user_id", app_user_id)
            .eq("product_id", product_id)
            .eq("package_type", "subscription")
            .gte("purchase_date", twoMinutesAgo)
            .order("purchase_date", { ascending: false })
            .limit(1);

        if (recentClientPurchase && recentClientPurchase.length > 0) {
          const clientPurchase = recentClientPurchase[0];
          console.log(
            "🚨 WEBHOOK BLOCKED - Client verification already processed this subscription:",
            {
              webhookTransactionId: original_transaction_id,
              clientTransactionId: clientPurchase.transaction_id,
              productId: product_id,
              userId: app_user_id,
              coinsAlreadyAdded: clientPurchase.coins_added,
              clientProcessedAt: clientPurchase.purchase_date,
              preventedDoubleCredit: true,
            }
          );

          return res.status(200).json({
            received: true,
            blocked: true,
            reason: "client_verification_already_processed",
            message: "Subscription already processed by client verification",
          });
        }
      }

      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", app_user_id)
        .single();

      if (userError || !userData) {
        console.error("User not found:", userError);
        return res.status(404).json({ message: "User not found" });
      }

      let addedCoins = 0;
      let packageType = "subscription";
      let mappingMethod = "unknown";

      // Subscription products - Exact match
      if (product_id === "com.monailisa.pro_weekly600") {
        addedCoins = 600;
        packageType = "subscription";
        mappingMethod = "exact_subscription_match";
      } else if (product_id === "com.monailisa.pro_monthly2400") {
        addedCoins = 2400;
        packageType = "subscription";
        mappingMethod = "exact_subscription_match";
      }
      // One-time purchase products - Exact match
      else if (product_id === "com.monailisa.creditpack5000") {
        addedCoins = 5000;
        packageType = "one_time";
        mappingMethod = "exact_oneTime_match";
      } else if (product_id === "com.monailisa.creditpack1000") {
        addedCoins = 1000;
        packageType = "one_time";
        mappingMethod = "exact_oneTime_match";
      } else if (product_id === "com.monailisa.creditpack300") {
        addedCoins = 300;
        packageType = "one_time";
        mappingMethod = "exact_oneTime_match";
      } else if (product_id === "com.monailisa.100coin") {
        addedCoins = 100;
        packageType = "one_time";
        mappingMethod = "exact_oneTime_match";
      }
      // Enhanced Fallback Logic
      else {
        const lowerProductId = product_id.toLowerCase();

        // Fallback 1: Subscription pattern matching
        if (
          lowerProductId.includes("weekly") ||
          lowerProductId.includes("week")
        ) {
          if (lowerProductId.includes("600")) {
            addedCoins = 600;
            packageType = "subscription";
            mappingMethod = "pattern_weekly_subscription";
          }
        } else if (
          lowerProductId.includes("monthly") ||
          lowerProductId.includes("month")
        ) {
          if (lowerProductId.includes("2400")) {
            addedCoins = 2400;
            packageType = "subscription";
            mappingMethod = "pattern_monthly_subscription";
          }
        }
        // Fallback 2: Credit pack pattern matching
        else if (
          lowerProductId.includes("creditpack") ||
          lowerProductId.includes("credit")
        ) {
          const creditMatch = lowerProductId.match(
            /(?:creditpack|credit)(\d+)/
          );
          if (creditMatch) {
            const extractedCoins = parseInt(creditMatch[1]);
            if (extractedCoins >= 50 && extractedCoins <= 10000) {
              addedCoins = extractedCoins;
              packageType = "one_time";
              mappingMethod = "pattern_creditpack";
            }
          }
        }
        // Fallback 3: Generic number extraction for one-time
        else if (
          lowerProductId.includes("coin") ||
          lowerProductId.includes("credit")
        ) {
          const coinMatch = product_id.match(/(\d+)/);
          if (coinMatch) {
            const extractedCoins = parseInt(coinMatch[1]);
            if (extractedCoins >= 50 && extractedCoins <= 10000) {
              addedCoins = extractedCoins;
              packageType = "one_time";
              mappingMethod = "generic_number_extraction";
            }
          }
        }

        // Final fallback: Log unknown product for manual review
        if (mappingMethod === "unknown") {
          console.error("🚨 WEBHOOK - Unknown product ID encountered:", {
            product_id,
            event_type: type,
            app_user_id,
            original_transaction_id,
            requires_manual_review: true,
          });

          // TEMPORARY: Allow unknown products but log for manual review
          // TODO: After frontend update, change this to return error
          console.warn(
            "⚠️ ALLOWING unknown product temporarily for backward compatibility"
          );

          // Set minimal safe defaults
          addedCoins = 0;
          packageType = "unknown";
          mappingMethod = "temporary_allowance";
        }
      }

      console.log(`Webhook - Coin calculation:`, {
        product_id,
        addedCoins,
        packageType,
        mappingMethod,
        event_type: type,
        is_subscription: packageType === "subscription",
        is_one_time: packageType === "one_time",
        is_exact_match: mappingMethod.includes("exact"),
      });

      // Validate that event type matches package type
      if (type === "RENEWAL" && packageType !== "subscription") {
        console.warn(
          `Warning: RENEWAL event for non-subscription product: ${product_id}`
        );
      }
      if (type === "NON_RENEWING_PURCHASE" && packageType !== "one_time") {
        console.warn(
          `Warning: NON_RENEWING_PURCHASE event for subscription product: ${product_id}`
        );
      }
      if (type === "INITIAL_PURCHASE") {
        console.log(
          `INITIAL_PURCHASE can be both subscription or one-time: ${packageType}`
        );
      }

      const currentBalance = userData.credit_balance || 0;
      const newBalance = currentBalance + addedCoins;

      // Bakiyeyi güncelle ve subscription için pro status'unu set et
      const updateData = { credit_balance: newBalance };

      // Subscription ise is_pro'yu true yap
      if (packageType === "subscription") {
        updateData.is_pro = true;
        console.log(
          `Webhook - Setting is_pro = true for subscription: ${product_id}`
        );
      }

      const { error: updateErr } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", app_user_id);

      if (updateErr) {
        console.error("Error updating user balance:", updateErr);
        return res.status(500).json({ message: "Failed to update balance" });
      }

      // user_purchase tablosuna kayıt ekle
      let productTitle = `${addedCoins} Credits`;
      if (packageType === "subscription") {
        productTitle = product_id.includes("monthly2400")
          ? "Monthly Pro 2400"
          : "Weekly Pro 600";
      }

      const purchaseData = {
        user_id: app_user_id,
        product_id: product_id,
        product_title: productTitle,
        purchase_date: purchase_date,
        package_type:
          packageType === "subscription" ? "subscription" : "one_time",
        price: 0,
        coins_added: addedCoins,
        transaction_id: original_transaction_id,
        purchase_number: null,
        // TODO: Add webhook_event_type and webhook_processed after migration
        // webhook_event_type: type,
        // webhook_processed: true,
      };

      const { error: insertError } = await supabase
        .from("user_purchase")
        .insert([purchaseData]);

      if (insertError) {
        console.error("Error inserting renewal data:", insertError);
        return res
          .status(500)
          .json({ message: "Failed to record renewal purchase" });
      }

      console.log(
        `✅ WEBHOOK - ${type} processed successfully for user:`,
        app_user_id,
        {
          addedCoins,
          newBalance,
          packageType,
          product_id,
          original_transaction_id,
          mappingMethod,
          source: "webhook_processing",
          timestamp: new Date().toISOString(),
        }
      );
      return res.status(200).json({ message: `${type} processed` });
    }

    // Log unhandled event types for monitoring
    console.log(`Webhook - Unhandled event type: ${type}`, {
      app_user_id,
      product_id,
      original_transaction_id,
      event_timestamp: new Date().toISOString(),
    });

    return res
      .status(200)
      .json({ message: `Event ${type} acknowledged but not processed` });
  } catch (err) {
    console.error("Error handling webhook:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
