const express = require("express");
const supabase = require("../supabaseClient");

const router = express.Router();

// Paket ID'sine göre kredi miktarlarını belirle
const getCreditsForPackage = (productId) => {
  const packageCredits = {
    // Subscription paketleri - Kısa format
    standard_weekly_600: 600,
    standard_monthly_2400: 2400,
    plus_weekly_1200: 1200,
    plus_monthly_4800: 4800,
    premium_weekly_2400: 2400,
    premium_monthly_9600: 9600,

    // Subscription paketleri - RevenueCat gerçek product ID'leri
    "com.diress.standard.weekly.600": 600,
    "com.diress.standard.monthly.2400": 2400,
    "com.diress.plus.weekly.1200": 1200,
    "com.diress.plus.monthly.4800": 4800,
    "com.diress.premium.weekly.2400": 2400,
    "com.diress.premium.monthly.9600": 9600,

    // Legacy subscription paketleri (revenuecatWebhook.js'ten)
    "com.monailisa.pro_weekly600": 600,
    "com.monailisa.pro_monthly2400": 2400,

    // Coin paketleri - Kısa format (one-time purchases)
    micro_1000: 1000,
    small_2500: 2500,
    boost_5000: 5000,
    growth_10000: 10000,
    pro_15000: 15000,
    enterprise_20000: 20000,

    // Coin paketleri - RevenueCat gerçek product ID'leri (yeni format)
    "com.micro.diress": 1000,
    "com.small.diress": 2500,
    "com.boost.diress": 5000,
    "com.growth.diress": 10000,
    "com.pro.diress": 15000,
    "com.enterprise.diress": 20000,

    // Coin paketleri - Eski format (compat)
    "com.diress.micro.1000": 1000,
    "com.diress.small.2500": 2500,
    "com.diress.boost.5000": 5000,
    "com.diress.growth.10000": 10000,
    "com.diress.pro.15000": 15000,
    "com.diress.enterprise.20000": 20000,

    // Legacy coin paketleri (revenuecatWebhook.js'ten)
    "com.monailisa.creditpack5000": 5000,
    "com.monailisa.creditpack1000": 1000,
    "com.monailisa.creditpack300": 300,
    "com.monailisa.100coin": 100,

    // Test paketleri (RevenueCat test webhook'ları için)
    test_product: 1000, // Test için 1000 kredi
  };

  return packageCredits[productId] || 0;
};

// RevenueCat Webhook endpoint v2
router.post("/webhookv2", async (req, res) => {
  try {
    console.log("🔗 RevenueCat Webhook Received!");
    console.log("Headers:", req.headers);

    // Authorization header kontrolü (opsiyonel - RevenueCat dashboard'dan ayarlanabilir)
    const authHeader = req.headers.authorization;
    if (authHeader) {
      console.log("📋 Authorization header:", authHeader);
      // Bu kısmı RevenueCat dashboard'da ayarladığınız authorization header ile karşılaştırabilirsiniz
    }

    // Request body'yi direkt kullan (express.json() middleware'i tarafından parse edilmiş)
    const eventData = req.body;
    if (!eventData) {
      console.error("❌ No event data received");
      return res.status(400).json({ error: "No event data" });
    }

    console.log("📦 Event Data:", JSON.stringify(eventData, null, 2));

    const { api_version, event } = eventData;

    if (!event) {
      console.error("❌ No event data found");
      return res.status(400).json({ error: "No event data" });
    }

    const {
      type,
      app_user_id,
      original_app_user_id,
      product_id,
      transaction_id,
      purchased_at_ms,
      price,
      currency,
      environment,
      store,
    } = event;

    console.log("🎯 Event Details:");
    console.log(`   Type: ${type}`);
    console.log(`   App User ID: ${app_user_id}`);
    console.log(`   Original App User ID: ${original_app_user_id}`);
    console.log(`   Product ID: ${product_id}`);
    console.log(`   Transaction ID: ${transaction_id}`);
    console.log(`   Price: ${price} ${currency}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Store: ${store}`);

    // Sadece başarılı satın alma eventleri için kredi ekle
    const creditEvents = [
      "INITIAL_PURCHASE", // İlk satın alma
      "NON_RENEWING_PURCHASE", // Tek seferlik satın alma
      "RENEWAL", // Yenileme
      "PRODUCT_CHANGE", // Plan değişikliği (aynı kullanıcı ID'si durumunda)
      "TEST", // RevenueCat test webhook'ları
    ];

    // Cancellation ve expiration eventleri için özel işlem
    const cancellationEvents = [
      "CANCELLATION", // İptal
      "EXPIRATION", // Süresi dolmuş
    ];

    // Product change eventi için özel işlem
    if (type === "PRODUCT_CHANGE") {
      console.log(`🔄 Processing PRODUCT_CHANGE event`);

      const oldUserId = original_app_user_id;
      const newUserId = app_user_id;

      if (!oldUserId || !newUserId) {
        console.error("❌ Missing user IDs for product change");
        return res.status(400).json({
          error: "Product change requires both old and new user IDs",
        });
      }

      if (oldUserId === newUserId) {
        console.log("ℹ️ Same user ID - treating as plan upgrade/downgrade");
        // Aynı kullanıcı, farklı plana geçiş - normal kredi ekleme işlemi devam edecek
      } else {
        console.log(`🔄 Transferring data from ${oldUserId} to ${newUserId}`);

        // Eski kullanıcının verilerini al
        const { data: oldUserData, error: oldUserError } = await supabase
          .from("users")
          .select("credit_balance, is_pro, subscription_type")
          .eq("id", oldUserId)
          .single();

        if (oldUserError) {
          console.error("❌ Error fetching old user data:", oldUserError);
          return res
            .status(500)
            .json({ error: "Failed to fetch old user data" });
        }

        // Yeni kullanıcının mevcut verilerini al veya oluştur
        let { data: newUserData, error: newUserError } = await supabase
          .from("users")
          .select("credit_balance")
          .eq("id", newUserId)
          .single();

        // Yeni kullanıcı yoksa oluştur
        if (newUserError && newUserError.code === "PGRST116") {
          console.log(`🆕 Creating new user: ${newUserId}`);

          const { data: createdUser, error: createError } = await supabase
            .from("users")
            .insert({
              id: newUserId,
              credit_balance: 0,
              is_pro: false,
              created_at: new Date().toISOString(),
            })
            .select("credit_balance")
            .single();

          if (createError) {
            console.error("❌ Error creating new user:", createError);
            return res.status(500).json({ error: "Failed to create new user" });
          }

          newUserData = createdUser;
        } else if (newUserError) {
          console.error("❌ Error fetching new user data:", newUserError);
          return res
            .status(500)
            .json({ error: "Failed to fetch new user data" });
        }

        // Product ID'den yeni plan bilgilerini belirle
        const creditsToAdd = getCreditsForPackage(product_id);
        let planType = null;
        let isPro = false;

        // Plan tipini belirle (önceki koddan alınan mantık)
        if (
          product_id.startsWith("standard_") ||
          product_id.includes(".standard.")
        ) {
          planType = "standard";
          isPro = true;
        } else if (
          product_id.startsWith("plus_") ||
          product_id.includes(".plus.")
        ) {
          planType = "plus";
          isPro = true;
        } else if (
          product_id.startsWith("premium_") ||
          product_id.includes(".premium.")
        ) {
          planType = "premium";
          isPro = true;
        }

        // Eski kullanıcının tüm kredi bakiyesini + yeni plan kredilerini yeni kullanıcıya transfer et
        const totalCredits =
          (oldUserData?.credit_balance || 0) +
          (newUserData?.credit_balance || 0) +
          creditsToAdd;

        // Yeni kullanıcıyı güncelle
        const updateFields = {
          credit_balance: totalCredits,
          is_pro: isPro,
        };

        if (planType) {
          updateFields.subscription_type = planType;
        }

        const { data: transferData, error: transferError } = await supabase
          .from("users")
          .update(updateFields)
          .eq("id", newUserId)
          .select();

        if (transferError) {
          console.error("❌ Error transferring data:", transferError);
          return res.status(500).json({ error: "Data transfer failed" });
        }

        // Eski kullanıcıyı deaktive et (kredi bakiyesini sıfırla ve PRO'dan çıkar)
        const { error: deactivateError } = await supabase
          .from("users")
          .update({
            credit_balance: 0,
            is_pro: false,
            subscription_type: null,
          })
          .eq("id", oldUserId);

        if (deactivateError) {
          console.error(
            "⚠️ Warning: Could not deactivate old user:",
            deactivateError
          );
        }

        // Purchase history'ye kaydet
        try {
          await supabase.from("purchase_history").insert({
            user_id: newUserId,
            product_id: product_id || "product_change",
            transaction_id: transaction_id || `transfer_${Date.now()}`,
            credits_added: creditsToAdd,
            price: price || 0,
            currency: currency || "USD",
            store: store || "unknown",
            environment: environment || "unknown",
            event_type: "PRODUCT_CHANGE",
            purchased_at: new Date(purchased_at_ms || Date.now()),
            created_at: new Date().toISOString(),
          });
        } catch (historyError) {
          console.error(
            "⚠️ Warning: Product change history error:",
            historyError
          );
        }

        console.log(`✅ Product change completed successfully!`);
        console.log(`📊 Transfer summary:`);
        console.log(
          `   Old user (${oldUserId}): ${
            oldUserData?.credit_balance || 0
          } credits -> deactivated`
        );
        console.log(
          `   New user (${newUserId}): ${totalCredits} total credits (${creditsToAdd} new + ${
            (oldUserData?.credit_balance || 0) +
            (newUserData?.credit_balance || 0)
          } transferred)`
        );

        return res.status(200).json({
          success: true,
          message:
            "Product change processed - user data transferred successfully",
          old_user_id: oldUserId,
          new_user_id: newUserId,
          credits_transferred:
            (oldUserData?.credit_balance || 0) +
            (newUserData?.credit_balance || 0),
          credits_added: creditsToAdd,
          total_credits: totalCredits,
          subscription_type: planType,
          is_pro: isPro,
          event_type: "PRODUCT_CHANGE",
        });
      }
    }

    // Eğer cancellation/expiration event'i ise kullanıcıyı free yap
    if (cancellationEvents.includes(type)) {
      console.log(`🚫 Processing ${type} event - removing user subscription`);

      const userId = app_user_id || original_app_user_id;
      if (!userId) {
        console.error("❌ No user ID found in cancellation event");
        return res.status(400).json({ error: "No user ID found" });
      }

      // Kullanıcıyı plan olmayan duruma düşür
      const { data: downgradedData, error: downgradeError } = await supabase
        .from("users")
        .update({
          is_pro: false,
          subscription_type: null, // Planını kaldır
        })
        .eq("id", userId)
        .select();

      if (downgradeError) {
        console.error("❌ Error downgrading user:", downgradeError);
        return res.status(500).json({ error: "User downgrade failed" });
      }

      console.log("✅ User subscription cancelled successfully!");

      // Purchase history'ye kaydet
      try {
        await supabase.from("purchase_history").insert({
          user_id: userId,
          product_id: product_id || "unknown",
          transaction_id: transaction_id || "cancellation",
          credits_added: 0,
          price: 0,
          currency: currency || "USD",
          store: store || "unknown",
          environment: environment || "unknown",
          event_type: type,
          purchased_at: new Date(purchased_at_ms || Date.now()),
          created_at: new Date().toISOString(),
        });
      } catch (historyError) {
        console.error("⚠️ Warning: Cancellation history error:", historyError);
      }

      return res.status(200).json({
        success: true,
        message: `User subscription ${type.toLowerCase()} processed`,
        user_id: userId,
        is_pro: false,
        subscription_type: null,
        event_type: type,
      });
    }

    // Kredi ekleme gerektirmeyen diğer eventler
    if (!creditEvents.includes(type)) {
      console.log(`ℹ️ Event type '${type}' does not require credit addition`);
      return res.status(200).json({
        message: "Event received but no action required",
        type: type,
      });
    }

    // Test/Sandbox satın almaları için uyarı
    if (environment === "SANDBOX") {
      console.log("⚠️ SANDBOX purchase detected - processing anyway");
    }

    // Test event'i için özel uyarı
    if (type === "TEST") {
      console.log("🧪 TEST event detected - processing test webhook");
    }

    // Kullanıcı ID'sini belirle (önce app_user_id, sonra original_app_user_id)
    const userId = app_user_id || original_app_user_id;

    if (!userId) {
      console.error("❌ No user ID found in event");
      return res.status(400).json({ error: "No user ID found" });
    }

    // ✅ GÜÇLÜ DUPLICATE KONTROLÜ - MULTIPLE CHECK
    // Aynı transaction_id daha önce işlenmiş mi kontrol et
    if (transaction_id) {
      console.log(`🔍 Checking for duplicate transaction: ${transaction_id}`);

      const { data: existingTransaction, error: duplicateError } =
        await supabase
          .from("purchase_history")
          .select("transaction_id, product_id, event_type, created_at")
          .eq("transaction_id", transaction_id)
          .eq("user_id", userId)
          .limit(1);

      if (duplicateError) {
        console.error(
          "❌ Error checking duplicate transaction:",
          duplicateError
        );
        // Devam et ama log'la
      } else if (existingTransaction && existingTransaction.length > 0) {
        const existing = existingTransaction[0];
        console.log(`🚫 DUPLICATE TRANSACTION DETECTED: ${transaction_id}`);
        console.log("❌ This transaction has already been processed:", {
          existing_transaction_id: existing.transaction_id,
          existing_product_id: existing.product_id,
          existing_event_type: existing.event_type,
          existing_processed_at: existing.created_at,
          current_product_id: product_id,
          current_event_type: type,
          prevention_level: "STRICT_DUPLICATE_PROTECTION",
        });

        return res.status(200).json({
          success: true,
          message: "Transaction already processed - duplicate ignored",
          transaction_id: transaction_id,
          user_id: userId,
          duplicate: true,
          existing_record: existing,
        });
      }

      console.log("✅ Transaction is new - proceeding with processing");
    } else {
      console.log(
        "⚠️ No transaction_id provided - will create unique identifier"
      );

      // Transaction ID yoksa da aynı event'in yakın zamanda işlenip işlenmediğini kontrol et
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentSimilarEvent, error: recentError } = await supabase
        .from("purchase_history")
        .select("*")
        .eq("user_id", userId)
        .eq("product_id", product_id)
        .eq("event_type", type)
        .gte("created_at", fiveMinutesAgo)
        .limit(1);

      if (recentSimilarEvent && recentSimilarEvent.length > 0) {
        console.log(
          `🚫 SIMILAR EVENT RECENTLY PROCESSED: ${type} for ${product_id}`
        );
        console.log(
          "❌ Preventing potential duplicate without transaction_id:",
          {
            recent_event: recentSimilarEvent[0],
            prevention_level: "TIME_BASED_DUPLICATE_PROTECTION",
          }
        );

        return res.status(200).json({
          success: true,
          message:
            "Similar event recently processed - potential duplicate ignored",
          user_id: userId,
          product_id: product_id,
          event_type: type,
          time_based_protection: true,
        });
      }
    }

    // Product ID'den kredi miktarını belirle
    const creditsToAdd = getCreditsForPackage(product_id);

    if (creditsToAdd === 0) {
      console.error(`❌ Unknown product ID: ${product_id}`);
      return res.status(400).json({ error: `Unknown product: ${product_id}` });
    }

    console.log(`💰 Adding ${creditsToAdd} credits to user ${userId}`);

    // Plan tipini belirle
    let planType = null;
    let isPro = false;

    // Standard paketler (hem kısa hem uzun format)
    if (
      product_id.startsWith("standard_") ||
      product_id.includes(".standard.")
    ) {
      planType = "standard";
      isPro = true;
    }
    // Plus paketler (hem kısa hem uzun format)
    else if (product_id.startsWith("plus_") || product_id.includes(".plus.")) {
      planType = "plus";
      isPro = true;
    }
    // Premium paketler (hem kısa hem uzun format)
    else if (
      product_id.startsWith("premium_") ||
      product_id.includes(".premium.")
    ) {
      planType = "premium";
      isPro = true;
    }
    // Legacy subscription paketleri (revenuecatWebhook.js'ten)
    else if (
      product_id === "com.monailisa.pro_weekly600" ||
      product_id === "com.monailisa.pro_monthly2400"
    ) {
      planType = "standard"; // Legacy paketleri standard olarak kabul et
      isPro = true;
    }
    // Coin paketleri için - sadece PRO yapar ama plan tipi vermez
    else if (
      [
        // Kısa formatlar
        "micro_1000",
        "small_2500",
        "boost_5000",
        "growth_10000",
        "pro_15000",
        "enterprise_20000",
        "test_product", // Test ürünü de PRO yapıyor
        // Yeni formatlar (gerçek product ID'ler)
        "com.micro.diress",
        "com.small.diress",
        "com.boost.diress",
        "com.growth.diress",
        "com.pro.diress",
        "com.enterprise.diress",
        // Legacy coin paketleri (revenuecatWebhook.js'ten)
        "com.monailisa.creditpack5000",
        "com.monailisa.creditpack1000",
        "com.monailisa.creditpack300",
        "com.monailisa.100coin",
      ].includes(product_id) ||
      // Eski uzun formatlar (compat)
      product_id.includes(".micro.") ||
      product_id.includes(".small.") ||
      product_id.includes(".boost.") ||
      product_id.includes(".growth.") ||
      product_id.includes(".pro.") ||
      product_id.includes(".enterprise.")
    ) {
      planType = null; // Coin paketleri plan tipi vermiyor
      isPro = true; // Ama kullanıcıyı PRO yapıyor
    }

    console.log(`🎯 Event type: ${type}`);
    console.log(`📦 Product ID: ${product_id}`);
    console.log(`📦 Plan type: ${planType || "none (coin pack)"}`);
    console.log(`✨ Making user PRO: ${isPro}`);

    // Önce kullanıcının mevcut kredi bakiyesini al
    let { data: userData, error: fetchError } = await supabase
      .from("users")
      .select("credit_balance")
      .eq("id", userId)
      .single();

    // Eğer kullanıcı bulunamazsa (özellikle test webhook'ları için)
    if (fetchError && fetchError.code === "PGRST116") {
      console.log(`🔄 User not found, creating test user: ${userId}`);

      // Test kullanıcısı oluştur
      const { data: newUserData, error: createError } = await supabase
        .from("users")
        .insert({
          id: userId,
          credit_balance: 0,
          is_pro: false,
          created_at: new Date().toISOString(),
        })
        .select("credit_balance")
        .single();

      if (createError) {
        console.error("❌ Error creating test user:", createError);
        return res.status(500).json({ error: "Test user creation failed" });
      }

      userData = newUserData;
      console.log(`✅ Test user created successfully: ${userId}`);
    } else if (fetchError) {
      console.error("❌ Error fetching user:", fetchError);
      return res.status(500).json({ error: "User fetch failed" });
    }

    if (!userData) {
      console.error(`❌ User data not available: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }

    const currentBalance = userData.credit_balance || 0;
    const newBalance = currentBalance + creditsToAdd;

    console.log(`💳 Current balance: ${currentBalance}`);
    console.log(`💳 New balance: ${newBalance}`);

    // Kullanıcının kredi bakiyesini güncelle ve PRO yap
    const updateFields = {
      credit_balance: newBalance,
      is_pro: isPro,
    };

    // Sadece subscription paketleri için plan tipi belirle
    if (planType) {
      updateFields.subscription_type = planType;
    }

    const { data: updateData, error: updateError } = await supabase
      .from("users")
      .update(updateFields)
      .eq("id", userId)
      .select();

    if (updateError) {
      console.error("❌ Error updating credits:", updateError);
      return res.status(500).json({ error: "Credit update failed" });
    }

    console.log("✅ Credits updated successfully!");
    console.log("Updated data:", updateData);

    // Purchase history tablosuna kayıt ekle (opsiyonel)
    try {
      const { data: purchaseData, error: purchaseError } = await supabase
        .from("purchase_history")
        .insert({
          user_id: userId,
          product_id: product_id || "unknown",
          transaction_id: transaction_id || `test_${Date.now()}`,
          credits_added: creditsToAdd,
          price: price || 0,
          currency: currency || "USD",
          store: store || "unknown",
          environment: environment || "unknown",
          event_type: type,
          purchased_at: new Date(purchased_at_ms || Date.now()),
          created_at: new Date().toISOString(),
        });

      if (purchaseError) {
        console.error(
          "⚠️ Warning: Could not save purchase history:",
          purchaseError
        );
        // Bu hata webhook'u başarısız saymamalı
      } else {
        console.log("📋 Purchase history saved");
      }
    } catch (historyError) {
      console.error("⚠️ Warning: Purchase history error:", historyError);
      // Bu hata webhook'u başarısız saymamalı
    }

    // Başarılı response
    const responseMessage =
      type === "TEST"
        ? `TEST webhook processed successfully - ${creditsToAdd} credits added to test user`
        : planType
        ? `Credits added successfully and user upgraded to PRO with ${planType} plan`
        : "Credits added successfully and user upgraded to PRO (coin pack)";

    res.status(200).json({
      success: true,
      message: responseMessage,
      user_id: userId,
      credits_added: creditsToAdd,
      new_balance: newBalance,
      subscription_type: planType,
      is_pro: isPro,
      event_type: type,
      transaction_id: transaction_id || `test_${Date.now()}`,
      product_id: product_id,
      is_test: type === "TEST",
    });
  } catch (error) {
    console.error("💥 Webhook error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

module.exports = router;
