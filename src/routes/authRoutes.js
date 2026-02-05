// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { supabase, supabaseAdmin } = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const teamService = require("../services/teamService");

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Apple JWKS client for token verification
const appleJwksClient = jwksClient({
  jwksUri: "https://appleid.apple.com/auth/keys",
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600000, // 10 minutes
});

/**
 * Helper: Get effective user data considering team membership
 * If user is a team member, returns owner's credits and Pro status
 */
async function getEffectiveUserData(user, platform = null) {
  const effectiveStatus = await teamService.getEffectiveUserStatus(user.id);

  const userData = {
    id: user.id,
    supabaseUserId: user.supabase_user_id,
    email: user.email,
    fullName: user.full_name,
    companyName: user.company_name,
    // Use owner's credits and Pro status if team member
    creditBalance: effectiveStatus.creditBalance,
    isPro: effectiveStatus.isPro,
    avatarUrl: user.avatar_url,
    // Team info for frontend
    isTeamMember: effectiveStatus.isTeamMember,
    ownerInfo: effectiveStatus.ownerInfo || null,
    subscriptionType: effectiveStatus.subscriptionType,
  };

  // Include session version based on platform
  if (platform === 'web') {
    userData.webSessionVersion = user.web_session_version || 1;
  } else if (platform === 'mobile') {
    userData.mobileSessionVersion = user.mobile_session_version || 1;
  }

  return userData;
}

/**
 * Helper: Increment session version for a platform and return updated user
 * This invalidates all previous sessions on that platform
 */
async function incrementSessionVersion(userId, platform) {
  const columnName = platform === 'web' ? 'web_session_version' : 'mobile_session_version';
  const loginColumn = platform === 'web' ? 'last_web_login' : 'last_mobile_login';

  // Get current version
  const { data: user } = await supabase
    .from('users')
    .select(`id, ${columnName}`)
    .eq('id', userId)
    .single();

  const currentVersion = user?.[columnName] || 1;
  const newVersion = currentVersion + 1;

  // Update version and login timestamp
  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({
      [columnName]: newVersion,
      [loginColumn]: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.error(`❌ [AUTH] Error incrementing ${platform} session version:`, error);
    return { success: false, error };
  }

  console.log(`🔐 [AUTH] ${platform} session version incremented: ${currentVersion} → ${newVersion} for user ${userId}`);
  return { success: true, user: updatedUser, newVersion };
}

/**
 * Supabase Auth ile giriş yapan kullanıcıyı backend users tablosuna senkronize et
 *
 * YENİ BASİTLEŞTİRİLMİŞ MANTIK (MERGE YOK):
 *
 * 1. Email ile users tablosunda kayıt var mı?
 *    ├── VAR → O hesabı döndür (web'de veya başka cihazda oluşturulmuş)
 *    └── YOK → Anonim hesaba email bağla (ilk kez kayıt)
 *
 * 2. Mobil'de logout yapılınca eski anonim hesaba geri dönülür (client tarafında)
 *
 * AVANTAJLAR:
 * - Merge karmaşıklığı yok
 * - Her hesap bağımsız kalır
 * - RevenueCat ID'leri sabit kalır
 * - Veri kaybı riski yok
 */
router.post("/sync-user", async (req, res) => {
  try {
    const { supabaseUserId, email, fullName, avatarUrl, provider, existingUserId, platform, deviceId } = req.body;

    if (!supabaseUserId) {
      return res.status(400).json({
        success: false,
        message: "supabaseUserId is required",
      });
    }

    // Platform: 'web' or 'mobile' - used for single session enforcement
    const loginPlatform = platform || null;

    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("🔄 [AUTH] SYNC-USER ENDPOINT ÇAĞRILDI");
    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("📧 Email:", email || "(yok)");
    console.log("🔑 Supabase User ID:", supabaseUserId);
    console.log("👤 Provider:", provider || "(yok)");
    console.log("📱 Platform:", loginPlatform || "(yok)");
    console.log("🆔 Existing User ID:", existingUserId || "(yok)");
    console.log("📲 Device ID:", deviceId || "(yok)");
    console.log("═══════════════════════════════════════════════════════════════════");

    // 1. Bu Supabase Auth kullanıcısı zaten bağlı mı kontrol et
    const { data: existingAuthUser, error: fetchError } = await supabase
      .from("users")
      .select("*")
      .eq("supabase_user_id", supabaseUserId)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      console.error("❌ [AUTH] Error fetching user:", fetchError);
      return res.status(500).json({
        success: false,
        message: "Error checking user existence",
        error: fetchError.message,
      });
    }

    // Supabase Auth kullanıcısı zaten varsa → bilgileri güncelle ve döndür
    if (existingAuthUser) {
      console.log("───────────────────────────────────────────────────────────────────");
      console.log("✅ [AUTH] MEVCUT SUPABASE AUTH KULLANICISI BULUNDU");
      console.log("───────────────────────────────────────────────────────────────────");
      console.log("🆔 User ID:", existingAuthUser.id);
      console.log("📧 Email:", existingAuthUser.email || "(yok)");
      console.log("💰 Credit Balance:", existingAuthUser.credit_balance);
      console.log("───────────────────────────────────────────────────────────────────");

      // Email farklıysa bu hesabı güncelleme - Adım 2/3/4'e devam et
      // Bu durum, persistSession nedeniyle eski supabase_user_id'nin yeni email ile gelmesi halinde oluşur
      if (email && existingAuthUser.email &&
          existingAuthUser.email.toLowerCase() !== email.toLowerCase()) {
        console.log("───────────────────────────────────────────────────────────────────");
        console.log("⚠️ [AUTH] supabase_user_id eslesti ama email FARKLI - Adim 2'ye geciliyor");
        console.log("   Hesaptaki email:", existingAuthUser.email);
        console.log("   Gelen email:", email);
        console.log("───────────────────────────────────────────────────────────────────");
        // return yapmadan devam et - Adım 2 (email ile arama) çalışacak
      } else {
        // Aynı email veya email yok - normal güncelleme akışı
        const updateData = {};
        if (email) updateData.email = email;
        if (fullName) updateData.full_name = fullName;
        if (avatarUrl) updateData.avatar_url = avatarUrl;
        if (provider) updateData.auth_provider = provider;

        // Increment session version for single-session enforcement
        let finalUser = existingAuthUser;
        if (loginPlatform) {
          const sessionResult = await incrementSessionVersion(existingAuthUser.id, loginPlatform);
          if (sessionResult.success) {
            finalUser = sessionResult.user;
          }
        }

        if (Object.keys(updateData).length > 0) {
          const { data: updatedUser, error: updateError } = await supabase
            .from("users")
            .update(updateData)
            .eq("supabase_user_id", supabaseUserId)
            .select()
            .single();

          if (updateError) {
            console.error("❌ [AUTH] Error updating user:", updateError);
          } else {
            finalUser = updatedUser;
            // Get effective user data (team credits/Pro if applicable)
            const effectiveUserData = await getEffectiveUserData(finalUser, loginPlatform);
            return res.status(200).json({
              success: true,
              message: "User updated successfully",
              user: effectiveUserData,
              isNewUser: false,
              isLinked: true,
              accountType: "existing_auth",
            });
          }
        }

        // Get effective user data (team credits/Pro if applicable)
        const effectiveUserData = await getEffectiveUserData(finalUser, loginPlatform);
        return res.status(200).json({
          success: true,
          message: "User found",
          user: effectiveUserData,
          isNewUser: false,
          isLinked: true,
          accountType: "existing_auth",
        });
      }
    }

    // 2. EMAIL İLE HESAP KONTROLÜ
    // Bu email ile daha önce kayıt yapılmış mı? (web'de veya başka cihazda)
    if (email) {
      const { data: existingEmailUser, error: emailFetchError } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .single();

      if (!emailFetchError && existingEmailUser) {
        // ✅ Bu email ile hesap VAR → O hesabı aç (MERGE YOK)
        console.log("───────────────────────────────────────────────────────────────────");
        console.log("🔗 [AUTH] MEVCUT EMAIL HESABI BULUNDU - YENİ KULLANICI OLUŞTURULMAYACAK");
        console.log("───────────────────────────────────────────────────────────────────");
        console.log("🆔 Account ID:", existingEmailUser.id);
        console.log("📧 Email:", email);
        console.log("💰 Credits:", existingEmailUser.credit_balance);
        console.log("───────────────────────────────────────────────────────────────────");

        // Supabase user ID'yi güncelle (farklı provider'dan giriş olabilir)
        const updateData = {
          supabase_user_id: supabaseUserId,
        };
        if (fullName && !existingEmailUser.full_name) updateData.full_name = fullName;
        if (avatarUrl && !existingEmailUser.avatar_url) updateData.avatar_url = avatarUrl;
        if (provider) updateData.auth_provider = provider;

        const { data: linkedUser, error: linkError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", existingEmailUser.id)
          .select()
          .single();

        if (linkError) {
          console.error("❌ [AUTH] Error linking user:", linkError);
          return res.status(500).json({
            success: false,
            message: "Error linking user",
            error: linkError.message,
          });
        }

        console.log("✅ [AUTH] Existing email account opened:", linkedUser.id);

        // Increment session version for single-session enforcement
        let finalUser = linkedUser;
        if (loginPlatform) {
          const sessionResult = await incrementSessionVersion(linkedUser.id, loginPlatform);
          if (sessionResult.success) {
            finalUser = sessionResult.user;
          }
        }

        // Get effective user data (team credits/Pro if applicable)
        const effectiveUserData = await getEffectiveUserData(finalUser, loginPlatform);
        return res.status(200).json({
          success: true,
          message: "Existing account opened successfully",
          user: effectiveUserData,
          isNewUser: false,
          isLinked: true,
          accountType: "existing_email",
          // Mobil client'a anonim hesabı saklamasını söyle
          preserveAnonymousAccount: existingUserId && existingUserId !== linkedUser.id,
        });
      }
    }

    // 3. Email ile hesap bulunamadı → Anonim hesaba email bağla (ilk kayıt)
    if (existingUserId) {
      console.log(`🔍 [AUTH] Checking anonymous account: ${existingUserId}`);

      const { data: anonymousUser, error: anonError } = await supabase
        .from("users")
        .select("*")
        .eq("id", existingUserId)
        .single();

      if (anonError) {
        console.log(`⚠️ [AUTH] Anonymous user not found: ${existingUserId}`, anonError.message);
      }

      if (!anonError && anonymousUser) {
        console.log("───────────────────────────────────────────────────────────────────");
        console.log("✅ [AUTH] ANONİM HESAP BULUNDU");
        console.log("───────────────────────────────────────────────────────────────────");
        console.log("🆔 ID:", anonymousUser.id);
        console.log("📧 Mevcut Email:", anonymousUser.email || "(yok)");
        console.log("💰 Credits:", anonymousUser.credit_balance);
        console.log("🔑 Supabase User ID:", anonymousUser.supabase_user_id || "(yok)");
        console.log("📲 Device ID:", anonymousUser.device_id || "(yok)");
        console.log("───────────────────────────────────────────────────────────────────");

        // Anonim hesapta zaten EMAIL varsa (farklı bir email'e bağlı) → yeni hesap oluştur
        // EMAIL yoksa → bu hesaba yeni email'i bağla
        if (anonymousUser.email && email && anonymousUser.email.toLowerCase() !== email.toLowerCase()) {
          console.log("⚠️ [AUTH] Anonymous user already linked to different email:", anonymousUser.email);
          console.log("   Requested email:", email);
          console.log("   Creating new account...");
          // Aşağıda yeni hesap oluşturulacak
        } else {
          // EK GÜVENLİK: else bloğuna girmiş olsa bile, mevcut email farklıysa güncelleme yapma
          if (anonymousUser.email && email &&
              anonymousUser.email.toLowerCase() !== email.toLowerCase()) {
            console.log("───────────────────────────────────────────────────────────────────");
            console.log("🛡️ [AUTH] GUARD: else blogunda farkli email tespit edildi - Adim 4'e geciliyor");
            console.log("   Mevcut email:", anonymousUser.email);
            console.log("   Gelen email:", email);
            console.log("───────────────────────────────────────────────────────────────────");
            // Bu bloğu atla, Adım 4'e düşsün (return yapma)
          } else {
            // ✅ Anonim hesaba email bağla (İLK KAYIT veya aynı email ile tekrar giriş)
            console.log(`🔗 [AUTH] Linking email to anonymous account: ${existingUserId}`);
            console.log(`   Current email: ${anonymousUser.email || '(none)'}`);
            console.log(`   New email: ${email}`);

            const updateData = {
              supabase_user_id: supabaseUserId,
            };
            if (email) updateData.email = email;
            if (fullName) updateData.full_name = fullName;
            if (avatarUrl) updateData.avatar_url = avatarUrl;
            if (provider) updateData.auth_provider = provider;

            const { data: linkedUser, error: linkError } = await supabase
              .from("users")
              .update(updateData)
              .eq("id", existingUserId)
              .select()
              .single();

            if (linkError) {
              console.error("❌ [AUTH] Error linking anonymous user:", linkError);
              return res.status(500).json({
                success: false,
                message: "Error linking user",
                error: linkError.message,
              });
            }

            console.log("✅ [AUTH] Email linked to anonymous account:", linkedUser.id);

            // Increment session version for single-session enforcement
            let finalUser = linkedUser;
            if (loginPlatform) {
              const sessionResult = await incrementSessionVersion(linkedUser.id, loginPlatform);
              if (sessionResult.success) {
                finalUser = sessionResult.user;
              }
            }

            // Get effective user data (team credits/Pro if applicable)
            const effectiveUserData = await getEffectiveUserData(finalUser, loginPlatform);
            return res.status(200).json({
              success: true,
              message: "Email linked to your account successfully",
              user: effectiveUserData,
              isNewUser: false,
              isLinked: true,
              accountType: "anonymous_linked",
              // Anonim hesap artık email'e bağlı, saklamaya gerek yok
              preserveAnonymousAccount: false,
            });
          }
        }
      }
    }

    // 4. Yeni kullanıcı oluştur (web'den ilk kayıt veya anonim hesap bulunamadı)
    console.log("───────────────────────────────────────────────────────────────────");
    console.log("🆕 [AUTH] YENİ KULLANICI OLUŞTURULUYOR");
    console.log("───────────────────────────────────────────────────────────────────");

    // 🛡️ GÜVENLIK: Device ID bazlı kredi kontrolü (mobil çift kredi engelleme)
    let shouldReceiveCredit = true;

    if (deviceId) {
      console.log(`🔍 [AUTH] Device ID mevcut: ${deviceId}`);
      console.log(`🔍 [AUTH] Device kredi uygunluğu kontrol ediliyor...`);

      const { data: creditCheck, error: creditCheckError } = await supabase.rpc(
        "check_device_credit_eligibility",
        { device_id_param: deviceId }
      );

      if (creditCheckError) {
        console.log(`❌ [AUTH] Device kredi kontrolü HATASI:`, creditCheckError.message);
      } else if (!creditCheck || creditCheck.length === 0) {
        console.log(`⚠️ [AUTH] Device kredi kontrolü sonuç döndürmedi`);
      } else {
        const { can_receive_credit, existing_user_count, last_credit_date } = creditCheck[0];

        console.log(`🔍 [AUTH] Device kredi kontrolü SONUCU:`);
        console.log(`   - Can Receive Credit: ${can_receive_credit}`);
        console.log(`   - Existing User Count: ${existing_user_count}`);
        console.log(`   - Last Credit Date: ${last_credit_date || "(yok)"}`);

        if (!can_receive_credit) {
          shouldReceiveCredit = false;
          console.log(`🛡️ [AUTH] ⚠️ DEVICE DAHA ÖNCE KREDİ ALDI - YENİ KULLANICI 0 KREDİ ALACAK`);
        } else {
          console.log(`✅ [AUTH] Device kredi alabilir - yeni kullanıcı 40 kredi alacak`);
        }
      }
    } else {
      console.log(`⚠️ [AUTH] Device ID GÖNDERİLMEDİ - kredi kontrolü atlanıyor`);
    }

    const newUserId = uuidv4();
    const insertData = {
      id: newUserId,
      supabase_user_id: supabaseUserId,
      credit_balance: shouldReceiveCredit ? 40 : 0, // Cihaz daha önce kredi aldıysa 0, almadıysa 40
      received_initial_credit: shouldReceiveCredit,
      initial_credit_date: shouldReceiveCredit ? new Date().toISOString() : null,
      created_at: new Date().toISOString(),
      owner: false,
      device_id: deviceId || null, // Device ID'yi kaydet
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

    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("✅ [AUTH] YENİ KULLANICI BAŞARIYLA OLUŞTURULDU");
    console.log("═══════════════════════════════════════════════════════════════════");
    console.log("🆔 User ID:", newUser.id);
    console.log("📧 Email:", newUser.email || "(yok)");
    console.log("💰 Credit Balance:", newUser.credit_balance);
    console.log("🎁 Received Initial Credit:", newUser.received_initial_credit);
    console.log("📲 Device ID:", newUser.device_id || "(yok)");
    console.log("═══════════════════════════════════════════════════════════════════");

    // Increment session version for single-session enforcement
    let finalUser = newUser;
    if (loginPlatform) {
      const sessionResult = await incrementSessionVersion(newUser.id, loginPlatform);
      if (sessionResult.success) {
        finalUser = sessionResult.user;
      }
    }

    // New users won't have team membership, but use helper for consistency
    const effectiveUserData = await getEffectiveUserData(finalUser, loginPlatform);
    return res.status(200).json({
      success: true,
      message: "User created successfully",
      user: effectiveUserData,
      isNewUser: true,
      isLinked: true,
      accountType: "new",
      preserveAnonymousAccount: false,
    });
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
 * Pro status transfer et (hesap değişikliğinde)
 *
 * Kullanıcı anonim hesaptan email hesabına geçtiğinde,
 * eski hesaptaki Pro status yeni hesaba transfer edilir.
 * RevenueCat restorePurchases() ile birlikte çalışır.
 */
router.post("/transfer-pro", async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;

    if (!fromUserId || !toUserId) {
      return res.status(400).json({
        success: false,
        message: "fromUserId and toUserId are required",
      });
    }

    console.log(`🔄 [AUTH] Transferring Pro status: ${fromUserId} → ${toUserId}`);

    // 1. Eski hesabın Pro durumunu kontrol et
    const { data: fromUser, error: fromError } = await supabase
      .from("users")
      .select("id, is_pro, email")
      .eq("id", fromUserId)
      .single();

    if (fromError || !fromUser) {
      console.warn("⚠️ [AUTH] Source user not found:", fromUserId);
      return res.status(404).json({
        success: false,
        message: "Source user not found",
      });
    }

    // 2. Eski hesap Pro değilse transfer gerekmiyor
    if (!fromUser.is_pro) {
      console.log("ℹ️ [AUTH] Source user is not Pro, no transfer needed");
      return res.status(200).json({
        success: true,
        message: "No Pro status to transfer",
        transferred: false,
      });
    }

    // 3. Eski hesabı Pro'dan çıkar
    const { error: updateFromError } = await supabase
      .from("users")
      .update({ is_pro: false })
      .eq("id", fromUserId);

    if (updateFromError) {
      console.error("❌ [AUTH] Error updating source user:", updateFromError);
      return res.status(500).json({
        success: false,
        message: "Error updating source user",
        error: updateFromError.message,
      });
    }

    // 4. Yeni hesabı Pro yap
    const { error: updateToError } = await supabase
      .from("users")
      .update({ is_pro: true })
      .eq("id", toUserId);

    if (updateToError) {
      console.error("❌ [AUTH] Error updating target user:", updateToError);
      // Rollback: eski hesabı tekrar Pro yap
      await supabase
        .from("users")
        .update({ is_pro: true })
        .eq("id", fromUserId);

      return res.status(500).json({
        success: false,
        message: "Error updating target user",
        error: updateToError.message,
      });
    }

    console.log(`✅ [AUTH] Pro status transferred: ${fromUserId} (false) → ${toUserId} (true)`);

    return res.status(200).json({
      success: true,
      message: "Pro status transferred successfully",
      transferred: true,
      fromUserId,
      toUserId,
    });
  } catch (error) {
    console.error("❌ [AUTH] Transfer Pro error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Entitlement adından plan tipini çıkar (webhook ile uyumlu)
 * @param {string[]} entitlements - RevenueCat entitlement adları
 * @returns {string|null} - "standard", "plus", "premium" veya null
 */
const getPlanTypeFromEntitlements = (entitlements) => {
  if (!entitlements || entitlements.length === 0) return null;

  // Tüm entitlement'ları kontrol et
  for (const entitlement of entitlements) {
    const ent = entitlement.toLowerCase();

    // Standard paketler
    if (ent.includes("standard")) {
      return "standard";
    }
    // Plus paketler
    if (ent.includes("plus")) {
      return "plus";
    }
    // Premium paketler
    if (ent.includes("premium")) {
      return "premium";
    }
    // Legacy paketler (pro_weekly, pro_monthly vb.) → standard olarak kabul et
    if (ent.includes("pro_weekly") || ent.includes("pro_monthly") || ent === "pro") {
      return "standard";
    }
    // Weekly/Monthly içeriyorsa ama plan tipi belirtilmemişse → standard
    if (ent.includes("weekly") || ent.includes("monthly")) {
      return "standard";
    }
  }

  // Coin pack veya tanımlanamayan entitlement → null (plan tipi yok ama PRO olabilir)
  return null;
};

/**
 * RevenueCat'ten Pro durumunu senkronize et
 * Login sırasında client RevenueCat'ten aktif abonelik kontrolü yapar
 * ve bu endpoint ile backend'deki is_pro'yu günceller
 */
router.post("/sync-pro-status", async (req, res) => {
  try {
    const { userId, isPro, entitlements } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    // Entitlement'lardan plan tipini çıkar (webhook mantığıyla uyumlu)
    const planType = getPlanTypeFromEntitlements(entitlements);

    console.log(`🔄 [AUTH] Syncing Pro status for user ${userId}:`, {
      isPro,
      entitlements,
      derivedPlanType: planType,
    });

    // Users tablosunu güncelle
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        is_pro: isPro,
        // Plan tipini webhook ile uyumlu şekilde kaydet
        subscription_type: isPro ? planType : null,
      })
      .eq("id", userId)
      .select("id, is_pro, subscription_type")
      .single();

    if (updateError) {
      console.error("❌ [AUTH] Error syncing Pro status:", updateError);
      return res.status(500).json({
        success: false,
        message: "Error syncing Pro status",
        error: updateError.message,
      });
    }

    console.log(`✅ [AUTH] Pro status synced: ${userId} → is_pro: ${isPro}, subscription_type: ${planType}`);

    return res.status(200).json({
      success: true,
      message: "Pro status synced successfully",
      user: {
        id: updatedUser.id,
        isPro: updatedUser.is_pro,
        subscriptionType: updatedUser.subscription_type,
      },
    });
  } catch (error) {
    console.error("❌ [AUTH] Sync Pro status error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Supabase user ID ile kullanıcı bilgilerini al
 * Team member ise owner'ın kredi ve Pro durumunu döndürür
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

    // Get effective user data (team credits/Pro if applicable)
    const effectiveUserData = await getEffectiveUserData(user);

    return res.status(200).json({
      success: true,
      user: {
        ...effectiveUserData,
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

/**
 * Email ile giriş yap
 */
router.post("/email/login", async (req, res) => {
  try {
    const { email, password, existingUserId, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("🔐 [AUTH] Email login attempt:", email);

    // Supabase Auth ile giriş yap
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error("❌ [AUTH] Email login failed:", error.message);
      return res.status(401).json({
        success: false,
        message: error.message,
      });
    }

    if (!data.user) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    console.log("✅ [AUTH] Email login successful:", data.user.email);

    // Backend users tablosuna sync et
    const syncResult = await syncUserToBackend({
      supabaseUserId: data.user.id,
      email: data.user.email,
      fullName: data.user.user_metadata?.full_name,
      avatarUrl: data.user.user_metadata?.avatar_url,
      provider: "email",
      existingUserId,
      deviceId, // 🛡️ Çift kredi engelleme için
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: syncResult.user,
      isNewUser: syncResult.isNewUser,
      isLinked: syncResult.isLinked,
      wasAnonymous: syncResult.wasAnonymous,
    });
  } catch (error) {
    console.error("❌ [AUTH] Email login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Email ile kayıt ol
 */
router.post("/email/signup", async (req, res) => {
  try {
    const { email, password, companyName, existingUserId, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("🔐 [AUTH] Email signup attempt:", email);

    // Supabase Auth ile kayıt ol
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: false, // REQUIRED FOR VERIFICATION FLOW
      user_metadata: {
        company_name: companyName || null,
      },
    });

    if (error) {
      console.log(`🔐 [AUTH] Signup error: "${error.message}" Code: ${error.status}`);
      const msg = error.message.toLowerCase();

      // EMAIL ALREADY REGISTERED? Check confirmation status
      if (msg.includes("registered") || msg.includes("invalid") || error.status === 422 || error.status === 400) {
        try {
          // Find user in our database first to get Supabase ID
          const { data: dbUserCheck } = await supabase
            .from('users')
            .select('supabase_user_id')
            .eq('email', email.trim())
            .single();

          if (dbUserCheck?.supabase_user_id) {
            const { data: { user: existingAuthUser } } = await supabaseAdmin.auth.admin.getUserById(dbUserCheck.supabase_user_id);

            // IF NOT CONFIRMED -> RESEND MAIL
            if (existingAuthUser && !existingAuthUser.email_confirmed_at) {
              console.log(`🔐 [AUTH] Resilience: Found unconfirmed user ${existingAuthUser.id}. Resending mail...`);

              const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
              const verificationToken = uuidv4();

              await supabaseAdmin.auth.admin.updateUserById(existingAuthUser.id, {
                user_metadata: {
                  ...existingAuthUser.user_metadata,
                  verification_code: verificationCode,
                  verification_token: verificationToken,
                  verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                }
              });

              const { Resend } = require('resend');
              const resend = new Resend(process.env.RESEND_API_KEY);
              const { getMobileVerificationEmailTemplate } = require('../lib/emailTemplates');

              const userName = existingAuthUser.user_metadata?.company_name || existingAuthUser.user_metadata?.full_name || email.split('@')[0];

              await resend.emails.send({
                from: 'Diress <noreply@diress.ai>',
                to: [email.trim()],
                subject: 'Your verification code - Diress',
                html: getMobileVerificationEmailTemplate(verificationCode, userName)
              });

              return res.status(200).json({
                success: true,
                message: "Verification email resent. Please check your inbox.",
                requiresEmailVerification: true,
                email: email.trim(),
                userId: existingAuthUser.id
              });
            }
          }
        } catch (resilienceErr) {
          console.error("❌ [AUTH] Signup resilience error:", resilienceErr);
        }
      }

      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (!data.user) {
      return res.status(400).json({
        success: false,
        message: "Failed to create user",
      });
    }

    console.log("✅ [AUTH] Email signup successful:", data.user.email);

    // Generate verification code for mobile
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationToken = uuidv4();

    // Store verification data in user metadata
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
      user_metadata: {
        ...data.user.user_metadata,
        verification_code: verificationCode,
        verification_token: verificationToken,
        verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
    });

    // Send verification email with CODE (for mobile)
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { getMobileVerificationEmailTemplate } = require('../lib/emailTemplates');

    const userName = companyName || data.user.email?.split("@")[0];

    try {
      await resend.emails.send({
        from: 'Diress <noreply@diress.ai>',
        to: [email.trim()],
        subject: 'Your verification code - Diress',
        html: getMobileVerificationEmailTemplate(verificationCode, userName)
      });
      console.log(`📧 [AUTH] Mobile verification email sent to: ${email.trim()}`);
    } catch (emailErr) {
      console.error("❌ [AUTH] Email sending failed:", emailErr);
    }

    // Backend users tablosuna sync et
    const syncResult = await syncUserToBackend({
      supabaseUserId: data.user.id,
      email: data.user.email,
      fullName: companyName || data.user.email?.split("@")[0],
      avatarUrl: null,
      provider: "email",
      existingUserId,
      deviceId, // 🛡️ Çift kredi engelleme için
    });

    return res.status(200).json({
      success: true,
      message: "Verification email sent. Please check your inbox.",
      user: syncResult.user,
      isNewUser: syncResult.isNewUser,
      isLinked: syncResult.isLinked,
      wasAnonymous: syncResult.wasAnonymous,
      requiresEmailVerification: true,
      email: email.trim(),
      userId: data.user.id,
    });
  } catch (error) {
    console.error("❌ [AUTH] Email signup error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Şifre sıfırlama emaili gönder
 */
router.post("/email/reset-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    console.log("🔐 [AUTH] Password reset request:", email);

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email);

    if (error) {
      console.error("❌ [AUTH] Password reset failed:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password reset email sent",
    });
  } catch (error) {
    console.error("❌ [AUTH] Password reset error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Google ID Token veya Access Token ile giriş yap
 * Mobile client Google Sign-In'den aldığı token'ı buraya gönderir
 * Backend token'ı doğrular, Supabase'de kullanıcı oluşturur/günceller
 */
router.post("/google", async (req, res) => {
  try {
    const { idToken, accessToken, existingUserId, deviceId } = req.body;

    if (!idToken && !accessToken) {
      return res.status(400).json({
        success: false,
        message: "idToken or accessToken is required",
      });
    }

    console.log("🔐 [AUTH] Verifying Google token...");

    let googleUserId, email, name, picture;

    // ID Token varsa önce onu dene
    if (idToken) {
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        googleUserId = payload.sub;
        email = payload.email;
        name = payload.name;
        picture = payload.picture;
        console.log("✅ [AUTH] Google ID token verified:", { email, name });
      } catch (verifyError) {
        console.warn("⚠️ [AUTH] Google ID token verification failed, trying access token...");
      }
    }

    // ID Token başarısız olduysa veya yoksa, access token ile kullanıcı bilgilerini al
    if (!email && accessToken) {
      try {
        const fetch = require("node-fetch");
        const userInfoResponse = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${accessToken}`
        );
        const userInfo = await userInfoResponse.json();

        if (userInfo.error) {
          throw new Error(userInfo.error.message || "Invalid access token");
        }

        googleUserId = userInfo.sub;
        email = userInfo.email;
        name = userInfo.name;
        picture = userInfo.picture;
        console.log("✅ [AUTH] Google access token verified:", { email, name });
      } catch (accessError) {
        console.error("❌ [AUTH] Google access token verification failed:", accessError.message);
        return res.status(401).json({
          success: false,
          message: "Invalid Google token",
          error: accessError.message,
        });
      }
    }

    if (!email) {
      return res.status(401).json({
        success: false,
        message: "Could not verify Google token",
      });
    }
    console.log("✅ [AUTH] Google token verified:", { email, name });

    // Supabase Admin API ile kullanıcı oluştur veya getir
    let supabaseUser;
    try {
      // Önce mevcut kullanıcıyı email ile ara
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
      supabaseUser = existingUsers?.users?.find(u => u.email === email);

      if (!supabaseUser) {
        // Yeni kullanıcı oluştur
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            full_name: name,
            avatar_url: picture,
            provider: "google",
            google_id: googleUserId,
          },
        });

        if (createError) {
          throw createError;
        }
        supabaseUser = newUser.user;
        console.log("🆕 [AUTH] Created new Supabase user:", supabaseUser.id);
      } else {
        // Mevcut kullanıcının metadata'sını güncelle
        const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          supabaseUser.id,
          {
            user_metadata: {
              full_name: name,
              avatar_url: picture,
              provider: "google",
              google_id: googleUserId,
            },
          }
        );
        if (!updateError) {
          supabaseUser = updatedUser.user;
        }
        console.log("✅ [AUTH] Updated existing Supabase user:", supabaseUser.id);
      }
    } catch (supabaseError) {
      console.error("❌ [AUTH] Supabase user creation/update failed:", supabaseError);
      return res.status(500).json({
        success: false,
        message: "Failed to create/update Supabase user",
        error: supabaseError.message,
      });
    }

    // Backend users tablosuna sync et (mevcut sync-user mantığı)
    const syncResult = await syncUserToBackend({
      supabaseUserId: supabaseUser.id,
      email,
      fullName: name,
      avatarUrl: picture,
      provider: "google",
      existingUserId,
      deviceId, // 🛡️ Çift kredi engelleme için
    });

    return res.status(200).json({
      success: true,
      message: "Google login successful",
      user: syncResult.user,
      supabaseUserId: supabaseUser.id,
      isNewUser: syncResult.isNewUser,
      isLinked: syncResult.isLinked,
      wasAnonymous: syncResult.wasAnonymous,
    });
  } catch (error) {
    console.error("❌ [AUTH] Google login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Apple ID Token ile giriş yap
 * Mobile client Apple Sign-In'den aldığı identityToken'ı buraya gönderir
 */
router.post("/apple", async (req, res) => {
  try {
    const { identityToken, fullName, existingUserId, deviceId } = req.body;

    if (!identityToken) {
      return res.status(400).json({
        success: false,
        message: "identityToken is required",
      });
    }

    console.log("🔐 [AUTH] Verifying Apple identity token...");

    // Apple token'ı decode et ve doğrula
    let decodedToken;
    try {
      // Token header'ını al
      const tokenHeader = jwt.decode(identityToken, { complete: true });
      if (!tokenHeader) {
        throw new Error("Invalid token format");
      }

      // Apple'ın public key'ini al
      const key = await appleJwksClient.getSigningKey(tokenHeader.header.kid);
      const publicKey = key.getPublicKey();

      // Token'ı doğrula
      decodedToken = jwt.verify(identityToken, publicKey, {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
      });
    } catch (verifyError) {
      console.error("❌ [AUTH] Apple token verification failed:", verifyError.message);
      return res.status(401).json({
        success: false,
        message: "Invalid Apple token",
        error: verifyError.message,
      });
    }

    const { sub: appleUserId, email } = decodedToken;
    const name = fullName?.givenName && fullName?.familyName
      ? `${fullName.givenName} ${fullName.familyName}`
      : fullName?.givenName || email?.split("@")[0] || "Apple User";

    console.log("✅ [AUTH] Apple token verified:", { email, name });

    // Supabase Admin API ile kullanıcı oluştur veya getir
    let supabaseUser;
    try {
      const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();

      // Apple kullanıcısını email veya apple_id ile ara
      supabaseUser = existingUsers?.users?.find(u =>
        u.email === email || u.user_metadata?.apple_id === appleUserId
      );

      if (!supabaseUser) {
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: email || `${appleUserId}@privaterelay.appleid.com`,
          email_confirm: true,
          user_metadata: {
            full_name: name,
            provider: "apple",
            apple_id: appleUserId,
          },
        });

        if (createError) {
          throw createError;
        }
        supabaseUser = newUser.user;
        console.log("🆕 [AUTH] Created new Supabase user for Apple:", supabaseUser.id);
      } else {
        const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          supabaseUser.id,
          {
            user_metadata: {
              full_name: name,
              provider: "apple",
              apple_id: appleUserId,
            },
          }
        );
        if (!updateError) {
          supabaseUser = updatedUser.user;
        }
        console.log("✅ [AUTH] Updated existing Supabase user for Apple:", supabaseUser.id);
      }
    } catch (supabaseError) {
      console.error("❌ [AUTH] Supabase user creation/update failed:", supabaseError);
      return res.status(500).json({
        success: false,
        message: "Failed to create/update Supabase user",
        error: supabaseError.message,
      });
    }

    // Backend users tablosuna sync et
    const syncResult = await syncUserToBackend({
      supabaseUserId: supabaseUser.id,
      email: email || `${appleUserId}@privaterelay.appleid.com`,
      fullName: name,
      avatarUrl: null,
      provider: "apple",
      existingUserId,
      deviceId, // 🛡️ Çift kredi engelleme için
    });

    return res.status(200).json({
      success: true,
      message: "Apple login successful",
      user: syncResult.user,
      supabaseUserId: supabaseUser.id,
      isNewUser: syncResult.isNewUser,
      isLinked: syncResult.isLinked,
      wasAnonymous: syncResult.wasAnonymous,
    });
  } catch (error) {
    console.error("❌ [AUTH] Apple login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Kullanıcı session kontrolü
 * Backend user ID ile kullanıcının login durumunu kontrol et
 */
router.get("/session/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        isLoggedIn: false,
        message: "User not found",
      });
    }

    // Kullanıcı Supabase Auth'a bağlı mı?
    const isLoggedIn = !!user.supabase_user_id;

    return res.status(200).json({
      success: true,
      isLoggedIn,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        companyName: user.company_name,
        creditBalance: user.credit_balance,
        avatarUrl: user.avatar_url,
        authProvider: user.auth_provider,
        isPro: user.is_pro,
      },
    });
  } catch (error) {
    console.error("❌ [AUTH] Session check error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Kullanıcı profil bilgilerini güncelle
 * Company name, full name gibi alanları günceller
 */
router.post("/update-profile", async (req, res) => {
  try {
    const { userId, companyName, fullName } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    console.log("🔄 [AUTH] Updating user profile:", userId);

    // Güncellenecek alanları belirle
    const updateData = {};
    if (companyName !== undefined) updateData.company_name = companyName;
    if (fullName !== undefined) updateData.full_name = fullName;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    // Users tablosunu güncelle
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("❌ [AUTH] Error updating user profile:", updateError);
      return res.status(500).json({
        success: false,
        message: "Error updating user profile",
        error: updateError.message,
      });
    }

    console.log("✅ [AUTH] User profile updated:", updatedUser.id);

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        fullName: updatedUser.full_name,
        companyName: updatedUser.company_name,
        creditBalance: updatedUser.credit_balance,
        isPro: updatedUser.is_pro,
      },
    });
  } catch (error) {
    console.error("❌ [AUTH] Update profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Kullanıcı çıkış yap
 * Supabase Auth bağlantısını kaldırır ama kullanıcı kaydını silmez
 */
router.post("/logout", async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "userId is required",
      });
    }

    console.log("🚪 [AUTH] Logging out user:", userId);

    // Kullanıcının supabase_user_id'sini temizle (opsiyonel - sadece bağlantıyı kopar)
    // Not: Bunu yapmamayı tercih edebilirsiniz, böylece tekrar giriş yaptığında aynı hesaba bağlanır
    // Şimdilik sadece başarılı response dönüyoruz

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("❌ [AUTH] Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

/**
 * Helper function: Kullanıcıyı backend users tablosuna senkronize et
 */
/**
 * Helper function: Kullanıcıyı backend'e senkronize et
 *
 * YENİ BASİTLEŞTİRİLMİŞ MANTIK (MERGE YOK):
 *
 * 1. Supabase Auth kullanıcısı zaten bağlı mı? → Güncelle ve döndür
 * 2. Email ile users tablosunda kayıt var mı?
 *    ├── VAR → O hesabı aç (MERGE YOK, anonim hesabı sakla)
 *    └── YOK → Anonim hesaba email bağla (ilk kez kayıt)
 * 3. Yeni kullanıcı oluştur (eğer hiçbir eşleşme yoksa)
 */
async function syncUserToBackend({ supabaseUserId, email, fullName, avatarUrl, provider, existingUserId, deviceId }) {
  // 1. Bu Supabase Auth kullanıcısı zaten var mı kontrol et
  const { data: existingAuthUser, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("supabase_user_id", supabaseUserId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error("Error checking user existence");
  }

  // Supabase Auth kullanıcısı zaten varsa → bilgileri güncelle ve döndür
  if (existingAuthUser) {
    console.log("✅ [HELPER] User already linked, returning:", existingAuthUser.id);

    const updateData = {};
    if (email) updateData.email = email;
    if (fullName) updateData.full_name = fullName;
    if (avatarUrl) updateData.avatar_url = avatarUrl;
    if (provider) updateData.auth_provider = provider;

    if (Object.keys(updateData).length > 0) {
      const { data: updatedUser, error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("supabase_user_id", supabaseUserId)
        .select()
        .single();

      if (updateError) {
        throw new Error("Error updating user");
      }

      // Get effective user data (team credits/Pro if applicable)
      const effectiveUserData = await getEffectiveUserData(updatedUser);
      return {
        user: effectiveUserData,
        isNewUser: false,
        isLinked: true,
        wasAnonymous: false,
        accountType: "existing_auth",
      };
    }

    // Get effective user data (team credits/Pro if applicable)
    const effectiveUserData = await getEffectiveUserData(existingAuthUser);
    return {
      user: effectiveUserData,
      isNewUser: false,
      isLinked: true,
      wasAnonymous: false,
      accountType: "existing_auth",
    };
  }

  // 2. EMAIL İLE HESAP KONTROLÜ (NO MERGE - sadece o hesabı aç)
  if (email) {
    const { data: existingEmailUser, error: emailError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!emailError && existingEmailUser) {
      // ✅ Bu email ile hesap VAR → O hesabı aç (MERGE YOK)
      console.log(`🔗 [HELPER] Found existing account with email: ${email}`);
      console.log(`   Account ID: ${existingEmailUser.id}`);
      console.log(`   Credits: ${existingEmailUser.credit_balance}`);

      // Supabase user ID'yi güncelle
      const updateData = {
        supabase_user_id: supabaseUserId,
      };
      if (fullName && !existingEmailUser.full_name) updateData.full_name = fullName;
      if (avatarUrl && !existingEmailUser.avatar_url) updateData.avatar_url = avatarUrl;
      if (provider) updateData.auth_provider = provider;

      const { data: linkedUser, error: linkError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", existingEmailUser.id)
        .select()
        .single();

      if (linkError) {
        throw new Error("Error linking user");
      }

      console.log("✅ [HELPER] Existing email account opened:", linkedUser.id);

      // Get effective user data (team credits/Pro if applicable)
      const effectiveUserData = await getEffectiveUserData(linkedUser);
      return {
        user: effectiveUserData,
        isNewUser: false,
        isLinked: true,
        wasAnonymous: false,
        accountType: "existing_email",
        // Mobil client'a anonim hesabı saklamasını söyle (logout'ta geri dönmek için)
        preserveAnonymousAccount: existingUserId && existingUserId !== linkedUser.id,
      };
    }
  }

  // 3. Email ile hesap bulunamadı → Anonim hesaba email bağla (ilk kayıt)
  if (existingUserId) {
    const { data: anonymousUser, error: anonError } = await supabase
      .from("users")
      .select("*")
      .eq("id", existingUserId)
      .single();

    if (!anonError && anonymousUser) {
      // Anonim hesap zaten başka bir Supabase Auth'a bağlıysa yeni hesap oluştur
      if (anonymousUser.supabase_user_id && anonymousUser.supabase_user_id !== supabaseUserId) {
        console.log("⚠️ [HELPER] Anonymous user already linked to different account, creating new");
        // Aşağıda yeni hesap oluşturulacak
      } else {
        // ✅ Anonim hesaba email bağla (İLK KAYIT)
        console.log(`🔗 [HELPER] Linking email to anonymous account: ${existingUserId}`);

        const updateData = {
          supabase_user_id: supabaseUserId,
        };
        if (email) updateData.email = email;
        if (fullName) updateData.full_name = fullName;
        if (avatarUrl) updateData.avatar_url = avatarUrl;
        if (provider) updateData.auth_provider = provider;

        const { data: linkedUser, error: linkError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", existingUserId)
          .select()
          .single();

        if (linkError) {
          throw new Error("Error linking user");
        }

        console.log("✅ [HELPER] Email linked to anonymous account:", linkedUser.id);

        // Get effective user data (team credits/Pro if applicable)
        const effectiveUserData = await getEffectiveUserData(linkedUser);
        return {
          user: effectiveUserData,
          isNewUser: false,
          isLinked: true,
          wasAnonymous: true,
          accountType: "anonymous_linked",
          // Anonim hesap artık email'e bağlı, saklamaya gerek yok
          preserveAnonymousAccount: false,
        };
      }
    }
  }

  // 4. Yeni kullanıcı oluştur
  console.log("🆕 [HELPER] Creating new user");

  // 🛡️ GÜVENLIK: Device ID bazlı kredi kontrolü (mobil çift kredi engelleme)
  let shouldReceiveCredit = true;

  if (deviceId) {
    console.log(`🔍 [HELPER] Device ID mevcut: ${deviceId}`);
    console.log(`🔍 [HELPER] Device kredi uygunluğu kontrol ediliyor...`);

    const { data: creditCheck, error: creditCheckError } = await supabase.rpc(
      "check_device_credit_eligibility",
      { device_id_param: deviceId }
    );

    if (creditCheckError) {
      console.log(`❌ [HELPER] Device kredi kontrolü HATASI:`, creditCheckError.message);
    } else if (!creditCheck || creditCheck.length === 0) {
      console.log(`⚠️ [HELPER] Device kredi kontrolü sonuç döndürmedi`);
    } else {
      const { can_receive_credit, existing_user_count, last_credit_date } = creditCheck[0];

      console.log(`🔍 [HELPER] Device kredi kontrolü SONUCU:`);
      console.log(`   - Can Receive Credit: ${can_receive_credit}`);
      console.log(`   - Existing User Count: ${existing_user_count}`);
      console.log(`   - Last Credit Date: ${last_credit_date || "(yok)"}`);

      if (!can_receive_credit) {
        shouldReceiveCredit = false;
        console.log(`🛡️ [HELPER] ⚠️ DEVICE DAHA ÖNCE KREDİ ALDI - YENİ KULLANICI 0 KREDİ ALACAK`);
      } else {
        console.log(`✅ [HELPER] Device kredi alabilir - yeni kullanıcı 40 kredi alacak`);
      }
    }
  } else {
    console.log(`⚠️ [HELPER] Device ID GÖNDERİLMEDİ - kredi kontrolü atlanıyor`);
  }

  const newUserId = uuidv4();
  const insertData = {
    id: newUserId,
    supabase_user_id: supabaseUserId,
    credit_balance: shouldReceiveCredit ? 40 : 0,
    received_initial_credit: shouldReceiveCredit,
    initial_credit_date: shouldReceiveCredit ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
    owner: false,
    device_id: deviceId || null,
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
    throw new Error("Error creating user");
  }

  // New users won't have team membership, but use helper for consistency
  const effectiveUserData = await getEffectiveUserData(newUser);
  return {
    user: effectiveUserData,
    isNewUser: true,
    isLinked: true,
    wasAnonymous: false,
  };
}

/**
 * Validate session version
 * Client sends their stored session version, server checks if it matches
 * If mismatch → SESSION_EXPIRED error → client logs out
 */
router.post("/validate-session", async (req, res) => {
  try {
    const { userId, platform, sessionVersion } = req.body;

    if (!userId || !platform || sessionVersion === undefined) {
      return res.status(400).json({
        success: false,
        error: "userId, platform, and sessionVersion are required",
      });
    }

    const columnName = platform === 'web' ? 'web_session_version' : 'mobile_session_version';

    const { data: user, error } = await supabase
      .from('users')
      .select(`id, ${columnName}`)
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const currentVersion = user[columnName] || 1;

    if (sessionVersion < currentVersion) {
      console.log(`🚫 [AUTH] Session expired for user ${userId} on ${platform}. Client: ${sessionVersion}, Server: ${currentVersion}`);
      return res.status(401).json({
        success: false,
        error: "SESSION_EXPIRED",
        message: "Your session has expired. Please log in again.",
        currentVersion,
      });
    }

    return res.status(200).json({
      success: true,
      valid: true,
      currentVersion,
    });
  } catch (error) {
    console.error("❌ [AUTH] Validate session error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;

