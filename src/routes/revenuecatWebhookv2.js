const express = require("express");
const { supabase } = require("../supabaseClient");
const {
  syncOneSignalTagsFromDb,
} = require("../services/oneSignalTagSync");

const router = express.Router();

// Team paketlerinden üye sayısını belirle
const getTeamMembersForPackage = (productId) => {
  const teamPackages = {
    // iOS Team paketleri
    "com.team1.monthly.diress": 1,
    "com.team2.monthly.diress": 2,
    "com.team3.monthly.diress": 3,
    "com.team4.monthly.diress": 4,
    "com.team5.monthly.diress": 5,
    "com.team6.monthly.diress": 6,
  };
  return teamPackages[productId] || 0;
};

// Team paketi mi kontrol et
const isTeamPackage = (productId) => {
  // com.team1.monthly.diress, com.team2.monthly.diress formatında
  return productId && productId.startsWith('com.team') && productId.includes('.monthly.diress');
};

// Paket ID'sine göre kredi miktarlarını belirle
const KNOWN_PACKAGE_CREDITS = {
    // Subscription paketleri - Kısa format
    standard_weekly_600: 600,
    standard_monthly_2400: 2400,
    standard_weekly_regular: 600,
    standard_monthly_regular: 2400,
    plus_weekly_1200: 1200,
    plus_monthly_4800: 4800,
    plus_weekly_regular: 1200,
    plus_monthly_regular: 4800,
    premium_weekly_2400: 2400,
    premium_monthly_9600: 9600,
    premium_weekly_regular: 2400,
    premium_monthly_regular: 9600,
    pro_weekly_regular: 600,
    pro_monthly_regular: 2400,

    // Subscription paketleri - RevenueCat gerçek product ID'leri
    // (iOS App Store + Google Play için aynı ID'ler kullanılıyor)
    // --- Discounted (indirimli) paketler ---
    "com.diress.standard.weekly.600": 600,
    "com.diress.standard.monthly.2400": 2400,
    "com.diress.plus.weekly.1200": 1200,
    "com.diress.plus.monthly.4800": 4800,
    "com.diress.premium.weekly.2400": 2400,
    "com.diress.premium.monthly.9600": 9600,
    // --- Regular (tam fiyat) paketler — discounted ile aynı kalıp, "regular" segmenti + kredi sonda ---
    "com.diress.standard.weekly.regular.600": 600,
    "com.diress.standard.monthly.regular.2400": 2400,
    "com.diress.plus.weekly.regular.1200": 1200,
    "com.diress.plus.monthly.regular.4800": 4800,
    "com.diress.premium.weekly.regular.2400": 2400,
    "com.diress.premium.monthly.regular.9600": 9600,
    // --- Legacy regular aliases (geriye uyumluluk için) ---
    "com.diress.standard.weekly.regular": 600,
    "com.diress.standard.monthly.regular": 2400,
    "com.diress.plus.weekly.regular": 1200,
    "com.diress.plus.monthly.regular": 4800,
    "com.diress.premium.weekly.regular": 2400,
    "com.diress.premium.monthly.regular": 9600,
    "com.diress.pro.weekly.regular": 600,
    "com.diress.pro.monthly.regular": 2400,

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

const normalizeRevenueCatProductId = (productId) =>
  String(productId || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .split(":")[0]
    .toLowerCase();

const getCreditsForPackage = (productId) => {
  const normalizedProductId = normalizeRevenueCatProductId(productId);
  return KNOWN_PACKAGE_CREDITS[normalizedProductId] || 0;
};

// RevenueCat Webhook endpoint v2
router.post("/webhookv2", async (req, res) => {
  // Server-side OneSignal tag sync — fires once the webhook response is
  // flushed back to RevenueCat. Reads `users.is_pro` / `users.is_in_trial`
  // (now reflecting the changes this handler made) and pushes to OneSignal.
  res.on("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const ev = req.body?.event;
    const uid = ev?.app_user_id || ev?.original_app_user_id;
    if (!uid) return;
    syncOneSignalTagsFromDb(uid).catch((err) =>
      console.warn("[OS-SYNC v2] error:", err?.message || err),
    );
  });

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
      period_type,
      is_trial_conversion,
    } = event;

    // is_trial_conversion: RevenueCat'in resmi field'ı. Sadece trial→paid dönüşüm
    // event'inde (dashboard'da "NEW SUB" görünen olay) true olur. Normal aylık
    // renewal'larda false. Kullanıyoruz çünkü ileride trial conversion'a özel
    // davranış eklemek istersek (ekstra bonus, retention email, vb.) ayırt etmek
    // mümkün olsun. Şu an credit logic değişmiyor — yine full package credits veriliyor.
    const isTrialConversion = is_trial_conversion === true;

    console.log("🎯 Event Details:");
    console.log(`   Type: ${type}`);
    console.log(`   App User ID: ${app_user_id}`);
    console.log(`   Original App User ID: ${original_app_user_id}`);
    console.log(`   Product ID: ${product_id}`);
    console.log(`   Transaction ID: ${transaction_id}`);
    console.log(`   Price: ${price} ${currency}`);
    console.log(`   Environment: ${environment}`);
    console.log(`   Store: ${store}`);
    console.log(`   Period Type: ${period_type}`);
    console.log(`   Is Trial Conversion: ${isTrialConversion}`);

    // Sadece başarılı satın alma eventleri için kredi ekle
    const creditEvents = [
      "INITIAL_PURCHASE", // İlk satın alma
      "NON_RENEWING_PURCHASE", // Tek seferlik satın alma
      "RENEWAL", // Yenileme
      "PRODUCT_CHANGE", // Trial→Paid upgrade veya plan değişikliği (aynı subscription group içinde)
      "TEST", // RevenueCat test webhook'ları
    ];

    // Cancellation ve expiration eventleri için özel işlem
    const cancellationEvents = [
      "CANCELLATION", // İptal
      "EXPIRATION", // Süresi dolmuş
    ];

    // Eğer cancellation/expiration event'i ise kullanıcıyı free yap
    if (cancellationEvents.includes(type)) {
      console.log(`🚫 Processing ${type} event...`);

      // CANCELLATION durumunda, eğer süresi henüz dolmamışsa işlem yapma
      if (type === "CANCELLATION" && eventData.event.expiration_at_ms) {
        const expirationTime = new Date(eventData.event.expiration_at_ms).getTime();
        const currentTime = Date.now();

        if (expirationTime > currentTime) {
          console.log(`ℹ️ Subscription cancelled but still active until ${new Date(expirationTime).toISOString()}`);
          return res.status(200).json({
            success: true,
            message: "User cancelled auto-renewal, but subscription is still active",
            user_id: app_user_id || original_app_user_id,
            expiration_date: new Date(expirationTime).toISOString(),
            is_pro: true // Hala PRO
          });
        }
      }

      console.log(`🚫 Processing ${type} event - removing user subscription`);

      const userId = app_user_id || original_app_user_id;
      if (!userId) {
        console.error("❌ No user ID found in cancellation event");
        return res.status(400).json({ error: "No user ID found" });
      }

      // Team paketi iptal mi kontrol et
      const cancelBaseProductId = normalizeRevenueCatProductId(product_id);

      if (isTeamPackage(cancelBaseProductId)) {
        console.log(`👥 TEAM SUBSCRIPTION CANCELLATION: ${cancelBaseProductId}`);

        // Team subscription'ı deaktive et
        const { data: teamCancelData, error: teamCancelError } = await supabase
          .from("users")
          .update({
            team_max_members: 0,
            team_subscription_active: false,
          })
          .eq("id", userId)
          .select();

        if (teamCancelError) {
          console.error("❌ Error cancelling team subscription:", teamCancelError);
          return res.status(500).json({ error: "Team subscription cancellation failed" });
        }

        // Kullanıcının team'inin max_members'ını sıfırla
        const { data: userTeam } = await supabase
          .from("teams")
          .select("id")
          .eq("owner_id", userId)
          .single();

        if (userTeam) {
          await supabase
            .from("teams")
            .update({ max_members: 0 })
            .eq("id", userTeam.id);
          console.log("✅ Team max_members reset to 0");

          // Owner hariç tüm team üyelerini sil
          const { data: removedMembers, error: removeMembersError } = await supabase
            .from("team_members")
            .delete()
            .eq("team_id", userTeam.id)
            .neq("role", "owner")
            .select();

          if (removeMembersError) {
            console.error("⚠️ Error removing team members:", removeMembersError);
          } else {
            console.log(`✅ Removed ${removedMembers?.length || 0} team members`);
          }

          // Bekleyen davetleri de iptal et
          const { error: cancelInvitesError } = await supabase
            .from("team_invitations")
            .update({ status: "cancelled" })
            .eq("team_id", userTeam.id)
            .eq("status", "pending");

          if (cancelInvitesError) {
            console.error("⚠️ Error cancelling pending invitations:", cancelInvitesError);
          } else {
            console.log("✅ Pending invitations cancelled");
          }
        }

        console.log("✅ Team subscription cancelled successfully!");

        // Purchase history'ye kaydet
        try {
          await supabase.from("purchase_history").insert({
            user_id: userId,
            product_id: product_id,
            transaction_id: transaction_id || "team_cancellation",
            credits_added: 0,
            price: 0,
            currency: currency || "USD",
            store: store || "unknown",
            environment: environment || "unknown",
            event_type: type,
            package_type: "team_subscription",
            purchased_at: new Date(purchased_at_ms || Date.now()),
            created_at: new Date().toISOString(),
          });
        } catch (historyError) {
          console.error("⚠️ Warning: Team cancellation history error:", historyError);
        }

        return res.status(200).json({
          success: true,
          message: `Team subscription ${type.toLowerCase()} processed`,
          user_id: userId,
          team_max_members: 0,
          team_subscription_active: false,
          event_type: type,
        });
      }

      // Normal subscription iptal işlemi
      // Kullanıcıyı plan olmayan duruma düşür ve trial flag'ini sıfırla
      const { data: downgradedData, error: downgradeError } = await supabase
        .from("users")
        .update({
          is_pro: false,
          subscription_type: null, // Planını kaldır
          is_in_trial: false, // Trial bitti / iptal edildi
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
    const purchaserId = app_user_id || original_app_user_id;

    if (!purchaserId) {
      console.error("❌ No user ID found in event");
      return res.status(400).json({ error: "No user ID found" });
    }

    // 🔗 TEAM-AWARE: Eğer satın alan bir team member ise, kredileri owner'a ekle
    // NOT: Eski uygulama versiyonlarında active_team_id olmayabilir - bu durumda normal devam eder
    let userId = purchaserId; // Default: satın alanın kendisi
    let isTeamPurchase = false;
    let teamOwnerId = null;

    try {
      // Satın alan kullanıcının team üyeliğini kontrol et
      const { data: purchaserData, error: purchaserError } = await supabase
        .from("users")
        .select("active_team_id")
        .eq("id", purchaserId)
        .single();

      // active_team_id varsa ve boş değilse team üyeliğini kontrol et
      if (!purchaserError && purchaserData && purchaserData.active_team_id) {
        // Kullanıcı bir team'e üye - team owner'ı bul
        const { data: teamData, error: teamError } = await supabase
          .from("teams")
          .select("owner_id")
          .eq("id", purchaserData.active_team_id)
          .single();

        if (!teamError && teamData && teamData.owner_id) {
          // Team member owner değilse, kredileri owner'a ekle
          if (teamData.owner_id !== purchaserId) {
            userId = teamData.owner_id;
            isTeamPurchase = true;
            teamOwnerId = teamData.owner_id;
            console.log(`👥 TEAM PURCHASE DETECTED!`);
            console.log(`   Purchaser (member): ${purchaserId}`);
            console.log(`   Credits will be added to Owner: ${teamOwnerId}`);
          } else {
            console.log(`👤 Purchaser is the team owner - credits go to self`);
          }
        }
      } else {
        // active_team_id yok veya null - eski kullanıcı veya team'e üye değil
        console.log(`👤 No active team membership - credits go to purchaser: ${purchaserId}`);
      }
    } catch (teamCheckError) {
      console.log(`⚠️ Team check failed (backward compat), using purchaser as target: ${teamCheckError.message}`);
      // Hata durumunda satın alanın kendisine ekle - eski uygulama versiyonları için güvenli
    }

    console.log(`🎯 Final credit target: ${userId} (isTeamPurchase: ${isTeamPurchase})`);

    // ✅ EVENT-TYPE-AWARE DUPLICATE KONTROLÜ
    // Aynı transaction_id farklı event_type'larla gelebilir — özellikle Apple
    // PRODUCT_CHANGE (upgrade) event'i INITIAL_PURCHASE ile AYNI transaction_id
    // taşıyor (subscription group içinde original_transaction_id sabit kalıyor).
    // Bu yüzden duplicate guard sadece (transaction_id, event_type) kombinasyonu
    // aynıysa blokluyor; farklı event_type ise yeni bir lifecycle aşaması olarak işliyor.
    if (transaction_id) {
      console.log(`🔍 Checking for duplicate transaction: ${transaction_id} (type=${type})`);

      const { data: existingTransaction, error: duplicateError } =
        await supabase
          .from("purchase_history")
          .select("transaction_id, product_id, event_type, created_at")
          .eq("transaction_id", transaction_id)
          .eq("user_id", userId)
          .eq("event_type", type) // ← AYNI event_type tekrarı duplicate sayılır
          .limit(1);

      if (duplicateError) {
        console.error(
          "❌ Error checking duplicate transaction:",
          duplicateError
        );
        // Devam et ama log'la
      } else if (existingTransaction && existingTransaction.length > 0) {
        const existing = existingTransaction[0];
        console.log(`🚫 DUPLICATE TRANSACTION DETECTED (same type): ${transaction_id} / ${type}`);
        console.log("❌ This transaction+type combo has already been processed:", {
          existing_transaction_id: existing.transaction_id,
          existing_product_id: existing.product_id,
          existing_event_type: existing.event_type,
          existing_processed_at: existing.created_at,
          current_product_id: product_id,
          current_event_type: type,
          prevention_level: "EVENT_TYPE_AWARE_DUPLICATE_PROTECTION",
        });

        return res.status(200).json({
          success: true,
          message: "Transaction+type combo already processed - duplicate ignored",
          transaction_id: transaction_id,
          user_id: userId,
          duplicate: true,
          existing_record: existing,
        });
      }

      console.log(`✅ Transaction+type combo is new (${type}) - proceeding with processing`);
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

    // ===== TEAM PAKETİ KONTROLÜ =====
    const baseProductId = normalizeRevenueCatProductId(product_id);
    console.log(`🔧 Normalized Product ID: ${baseProductId} (Original: ${product_id})`);

    if (isTeamPackage(baseProductId)) {
      const teamMembers = getTeamMembersForPackage(baseProductId);
      console.log(`👥 TEAM PACKAGE DETECTED: ${baseProductId} - ${teamMembers} members`);

      if (teamMembers === 0) {
        console.error(`❌ Unknown team package: ${baseProductId}`);
        return res.status(400).json({ error: `Unknown team package: ${baseProductId}` });
      }

      // Kullanıcının team_max_members alanını güncelle
      const { data: teamUpdateData, error: teamUpdateError } = await supabase
        .from("users")
        .update({
          team_max_members: teamMembers,
          team_subscription_active: true,
        })
        .eq("id", userId)
        .select();

      if (teamUpdateError) {
        console.error("❌ Error updating team subscription:", teamUpdateError);
        return res.status(500).json({ error: "Team subscription update failed" });
      }

      console.log("✅ Team subscription updated successfully!");
      console.log("Updated data:", teamUpdateData);

      // Eğer kullanıcının team'i varsa, max_members'ı güncelle
      const { data: userTeam, error: teamFetchError } = await supabase
        .from("teams")
        .select("id")
        .eq("owner_id", userId)
        .single();

      if (userTeam && !teamFetchError) {
        await supabase
          .from("teams")
          .update({ max_members: teamMembers })
          .eq("id", userTeam.id);
        console.log(`✅ Team max_members updated to ${teamMembers}`);
      }

      // Purchase history'ye kaydet
      try {
        await supabase.from("purchase_history").insert({
          user_id: userId,
          product_id: product_id,
          transaction_id: transaction_id || `team_${Date.now()}`,
          credits_added: 0,
          price: price || 0,
          currency: currency || "USD",
          store: store || "unknown",
          environment: environment || "unknown",
          event_type: type,
          package_type: "team_subscription",
          purchased_at: new Date(purchased_at_ms || Date.now()),
          created_at: new Date().toISOString(),
        });
        console.log("📋 Team purchase history saved");
      } catch (historyError) {
        console.error("⚠️ Warning: Team purchase history error:", historyError);
      }

      return res.status(200).json({
        success: true,
        message: `Team subscription activated - ${teamMembers} team members allowed`,
        user_id: userId,
        team_max_members: teamMembers,
        product_id: product_id,
        event_type: type,
        transaction_id: transaction_id,
      });
    }

    // ===== NORMAL KREDİ PAKETİ İŞLEMİ =====
    // Product ID'den kredi miktarını belirle
    const packageCredits = getCreditsForPackage(baseProductId);
    const packageMapHit = Object.prototype.hasOwnProperty.call(
      KNOWN_PACKAGE_CREDITS,
      baseProductId,
    );

    // Trial-aware grant: when period_type === 'TRIAL' AND app_config.trial_enabled is true,
    // grant trial_credits (default 2000) instead of the full package credits.
    // RENEWAL events (period_type === 'NORMAL', including trial→paid conversion) fall through
    // to the package-credits path below, so users top up to the full amount once charged.
    // If trial_enabled is false (kill-switch), the webhook acts as before regardless of period_type.
    let creditsToAdd = packageCredits;
    let isTrialGrant = false;
    if (period_type === "TRIAL" && type === "INITIAL_PURCHASE") {
      const configPlatform =
        store === "PLAY_STORE" || store === "GOOGLE" ? "android" : "ios";
      try {
        const { data: trialCfg } = await supabase
          .from("app_config")
          .select("trial_enabled, trial_credits")
          .eq("platform", configPlatform)
          .order("updated_at", { ascending: false, nullsLast: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (trialCfg?.trial_enabled === true) {
          const trialCredits = Number.isFinite(trialCfg.trial_credits)
            ? trialCfg.trial_credits
            : 2000;
          creditsToAdd = trialCredits;
          isTrialGrant = true;
          console.log(
            `🎁 [RC_WEBHOOK_V2] TRIAL grant: ${trialCredits} credits (platform=${configPlatform}, full_package=${packageCredits})`,
          );
        } else {
          console.log(
            `⚠️ [RC_WEBHOOK_V2] period_type=TRIAL but trial_enabled=false on ${configPlatform} → granting full package credits (${packageCredits})`,
          );
        }
      } catch (cfgErr) {
        console.warn(
          "⚠️ [RC_WEBHOOK_V2] app_config read for trial failed, falling back to full credits:",
          cfgErr?.message || cfgErr,
        );
      }
    } else if (isTrialConversion) {
      // Trial→Paid dönüşüm event'i (dashboard'da "NEW SUB" görünen olay).
      // creditsToAdd zaten packageCredits olarak set edildi — full paket kredisini
      // veriyoruz. Trial başlangıcında verilen ~2000 trial bonusunu DÜŞMÜYORUZ,
      // bonus olarak kalsın (trial'ı tamamlayan kullanıcıya teşekkür jesti).
      console.log(
        `🎉 [RC_WEBHOOK_V2] Trial-to-Paid CONVERSION detected (is_trial_conversion=true) → granting full ${packageCredits} credits (trial 2000 bonus preserved on top)`,
      );
    } else if (type === "PRODUCT_CHANGE") {
      // Trial içindeyken "Tam Sürüme Geç" → farklı bir paket satın alma veya
      // mevcut planı upgrade etme (monthly → yearly vs.) durumunda RevenueCat
      // PRODUCT_CHANGE fırlatır. Kullanıcı artık tam ücret ödüyor, dolayısıyla:
      //   - Full package credits eklenir (creditsToAdd zaten packageCredits)
      //   - is_pro = true olur (isTrialGrant = false olduğu için aşağıda set edilir)
      //   - Trial bonus (varsa) zaten bakiyede, additive olarak kalır
      console.log(
        `🔄 [RC_WEBHOOK_V2] PRODUCT_CHANGE detected → upgrade flow, granting full ${packageCredits} credits + is_pro=true`,
      );
    }

    console.log("🧪 [RC_WEBHOOK_V2] Product mapping debug:", {
      originalProductId: product_id,
      normalizedProductId: baseProductId,
      packageMapHit,
      packageCredits,
      creditsToAdd,
      isTrialGrant,
      isTrialConversion,
      periodType: period_type,
      knownKeyCount: Object.keys(KNOWN_PACKAGE_CREDITS).length,
    });

    if (creditsToAdd === 0) {
      console.error(`❌ Unknown product ID: ${baseProductId}`);
      return res.status(400).json({ error: `Unknown product: ${baseProductId}` });
    }

    console.log(`💰 Adding ${creditsToAdd} credits to user ${userId}`);

    // Plan tipini belirle
    let planType = null;
    let isPro = false;

    // Standard paketler (hem kısa hem uzun format)
    if (
      baseProductId.startsWith("standard_") ||
      baseProductId.includes(".standard.") ||
      baseProductId.includes(".pro.")
    ) {
      planType = "standard";
      isPro = true;
    }
    // Plus paketler (hem kısa hem uzun format)
    else if (baseProductId.startsWith("plus_") || baseProductId.includes(".plus.")) {
      planType = "plus";
      isPro = true;
    }
    // Premium paketler (hem kısa hem uzun format)
    else if (
      baseProductId.startsWith("premium_") ||
      baseProductId.includes(".premium.")
    ) {
      planType = "premium";
      isPro = true;
    }
    // Legacy subscription paketleri (revenuecatWebhook.js'ten)
    else if (
      baseProductId === "com.monailisa.pro_weekly600" ||
      baseProductId === "com.monailisa.pro_monthly2400"
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
      ].includes(baseProductId) ||
      // Eski uzun formatlar (compat)
      baseProductId.includes(".micro.") ||
      baseProductId.includes(".small.") ||
      baseProductId.includes(".boost.") ||
      baseProductId.includes(".growth.") ||
      baseProductId.includes(".pro.") ||
      baseProductId.includes(".enterprise.")
    ) {
      planType = null; // Coin paketleri plan tipi vermiyor
      isPro = true; // Ama kullanıcıyı PRO yapıyor
    }

    // NOT: Trial kullanıcıları da is_pro=true olarak işaretlenir (watermark KAPALI).
    // Eski mantıkta trial sırasında watermark açık tutuluyordu, ama UX kararı değişti:
    // trial kullanıcısı satın alma yapmış sayılır (Apple charge'layacak), PRO erişim verilir.
    // is_pro değeri product pattern match'ten geliyor (yukarıda set edilmişti).
    // Trial grant block'u sadece kredi miktarını kontrol eder (trial_credits vs full).

    console.log(`🎯 Event type: ${type}`);
    console.log(`📦 Product ID: ${product_id}`);
    console.log(`📦 Plan type: ${planType || "none (coin pack)"}`);
    console.log(`✨ Making user PRO: ${isPro}`);

    // Önce kullanıcının mevcut kredi bakiyesini ve trial flag'ini al
    let { data: userData, error: fetchError } = await supabase
      .from("users")
      .select("credit_balance, is_in_trial")
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
          is_in_trial: false,
          created_at: new Date().toISOString(),
        })
        .select("credit_balance, is_in_trial")
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
    const wasInTrial = userData.is_in_trial === true;

    // Trial continuation: kullanıcı trial'dayken PRODUCT_CHANGE event'i geldi VE
    // period_type hâlâ TRIAL → sadece product değişti, trial devam ediyor (ödeme yok).
    // Sandbox'ta subscription group içinde upgrade'de Apple bunu fırlatabiliyor.
    // Bu durumda: credit ekleme, zero-out yapma, sadece event'i kaydet.
    const isTrialContinuation =
      type === "PRODUCT_CHANGE" && period_type === "TRIAL" && wasInTrial;

    // Trial→Paid conversion: kullanıcı trial'dan ücretli pakete geçti.
    // Two paths:
    //   (a) RENEWAL + is_trial_conversion=true (NEW SUB) — trial doğal bitti, paid başladı
    //   (b) PRODUCT_CHANGE + period_type !== TRIAL — kullanıcı trial'dayken "Tam Sürüme Geç"
    //       bastı, yeni ürün artık paid (period_type=NORMAL)
    // Bu durumda mevcut bakiyeyi SIFIRLA + yeni paket kredisi yaz.
    const isConvertingFromTrial =
      isTrialConversion === true ||
      (type === "PRODUCT_CHANGE" && wasInTrial && period_type !== "TRIAL");

    // Credit calculation
    let newBalance;
    if (isTrialContinuation) {
      // Trial içinde product değişimi: bakiye dokunulmaz
      newBalance = currentBalance;
      creditsToAdd = 0; // purchase_history'ye 0 olarak kaydedilsin
    } else if (isConvertingFromTrial) {
      newBalance = creditsToAdd; // zero-out + paket
    } else {
      newBalance = currentBalance + creditsToAdd; // additive
    }

    console.log(`💳 Current balance: ${currentBalance}`);
    console.log(`💳 Was in trial: ${wasInTrial}`);
    console.log(`💳 Trial continuation: ${isTrialContinuation}`);
    console.log(`💳 Converting from trial: ${isConvertingFromTrial}`);
    console.log(
      `💳 New balance: ${newBalance}${
        isTrialContinuation
          ? " (trial continuation, no change)"
          : isConvertingFromTrial
            ? " (zeroed-out then added package)"
            : " (additive)"
      }`,
    );

    // is_in_trial lifecycle — Apple'ın GERÇEĞİNE göre track edilir, bizim kill-switch'imize değil.
    //  - Trial başlangıç (INITIAL_PURCHASE+TRIAL) → true
    //  - Trial continuation (PRODUCT_CHANGE+TRIAL) → true (devam)
    //  - Conversion (RENEWAL+is_trial_conversion VEYA PRODUCT_CHANGE+NORMAL-from-trial) → false
    //  - Diğer her şey için mevcut değeri koru (defansif).
    const isTrialStartEvent =
      period_type === "TRIAL" && type === "INITIAL_PURCHASE";
    let isInTrialNext = wasInTrial;
    if (isTrialStartEvent || isTrialContinuation) {
      isInTrialNext = true;
    } else if (isConvertingFromTrial) {
      isInTrialNext = false;
    }

    // NOT: Trial continuation'da artık is_pro override etmiyoruz.
    // Trial kullanıcıları is_pro=true olarak işaretleniyor (watermark kapalı, PRO erişim).
    // Sadece team özellikleri trial sırasında kapalı kalsın (isTrialGrant=true ile team block).
    if (isTrialContinuation) {
      isTrialGrant = true; // team override block'u fire etsin (team_max_members=0)
    }

    // Kullanıcının kredi bakiyesini güncelle ve PRO yap
    const updateFields = {
      credit_balance: newBalance,
      is_pro: isPro,
      is_in_trial: isInTrialNext,
    };

    // has_used_trial: bir kez true olunca asla false'a dönmez (audit flag).
    // Apple trial başlatmışsa set ederiz — kill-switch'ten bağımsız.
    // trial_started_at: client'ın geri sayım göstermesi için trial başlangıç zamanını yaz.
    if (isTrialStartEvent) {
      updateFields.has_used_trial = true;
      // Event'in purchased_at_ms'ini kullan — webhook gecikirse bile doğru tarih
      updateFields.trial_started_at = new Date(purchased_at_ms || Date.now()).toISOString();
    }

    // Sadece subscription paketleri için plan tipi belirle
    if (planType) {
      updateFields.subscription_type = planType;

      // Subscription tipine göre team member hakkı belirle
      // Standard: 0, Plus: 1, Premium: 2
      const teamMembersForPlan = {
        standard: 0,
        plus: 1,
        premium: 2,
      };
      const teamMembers = teamMembersForPlan[planType] ?? 0;
      updateFields.team_max_members = teamMembers;
      // Team özelliği aktif mi? (Tüm abonelik tipleri için true - Standard dahil)
      updateFields.team_subscription_active = true;
      console.log(`👥 Setting team_max_members to ${teamMembers}, team_subscription_active to true for ${planType} plan`);

      // Trial override: kullanıcı trial'dayken team özellikleri kapalı.
      // 1 trial = 1 team member = 2 kullanıcı 2000 krediyi paylaşır → suistimal riski.
      // Trial→paid dönüşümünde (RENEWAL/NORMAL) yukarıdaki blok tekrar çalışıp doğru
      // team_max_members'ı set edecek.
      if (isTrialGrant) {
        updateFields.team_max_members = 0;
        updateFields.team_subscription_active = false;
        console.log(`🚫 [RC_WEBHOOK_V2] Trial → team features disabled (will activate on paid conversion)`);
      }
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
      const purchaseRecord = {
        user_id: userId, // Kredilerin eklendiği kullanıcı (owner veya purchaser)
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
      };

      // Team purchase ise satın alan kişiyi de kaydet (metadata olarak)
      if (isTeamPurchase) {
        purchaseRecord.metadata = JSON.stringify({
          purchaser_id: purchaserId,
          is_team_purchase: true,
          team_owner_id: teamOwnerId
        });
      }

      const { data: purchaseData, error: purchaseError } = await supabase
        .from("purchase_history")
        .insert(purchaseRecord);

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

    const responseData = {
      success: true,
      message: responseMessage,
      user_id: userId, // Kredilerin eklendiği kullanıcı
      credits_added: creditsToAdd,
      new_balance: newBalance,
      subscription_type: planType,
      is_pro: isPro,
      event_type: type,
      transaction_id: transaction_id || `test_${Date.now()}`,
      product_id: product_id,
      is_test: type === "TEST",
    };

    // Team purchase bilgilerini ekle
    if (isTeamPurchase) {
      responseData.is_team_purchase = true;
      responseData.purchaser_id = purchaserId;
      responseData.team_owner_id = teamOwnerId;
      responseData.message = `${responseMessage} (Team purchase: credits added to team owner)`;
      console.log(`✅ TEAM PURCHASE COMPLETED:`);
      console.log(`   Purchaser (member): ${purchaserId}`);
      console.log(`   Credits added to Owner: ${teamOwnerId}`);
      console.log(`   Credits: ${creditsToAdd}`);
      console.log(`   New Owner Balance: ${newBalance}`);
    }

    res.status(200).json(responseData);
  } catch (error) {
    console.error("💥 Webhook error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
});

module.exports = router;
