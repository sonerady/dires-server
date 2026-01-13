// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { supabase, supabaseAdmin } = require("../supabaseClient");
const { v4: uuidv4 } = require("uuid");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

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
 * Supabase Auth ile giriş yapan kullanıcıyı backend users tablosuna senkronize et
 * Account Linking: Mevcut anonim hesabı Supabase Auth hesabına bağlar
 *
 * Akış:
 * 1. supabase_user_id ile mevcut kullanıcı var mı kontrol et
 * 2. Varsa → o kullanıcıyı döndür (zaten bağlı)
 * 3. Yoksa ve existingUserId geldiyse → anonim hesabı bağla (LINK)
 * 4. Yoksa ve existingUserId yoksa → yeni kullanıcı oluştur
 */
router.post("/sync-user", async (req, res) => {
  try {
    const { supabaseUserId, email, fullName, avatarUrl, provider, existingUserId } = req.body;

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
      existingUserId: existingUserId || "none",
    });

    // 1. Bu Supabase Auth kullanıcısı zaten var mı kontrol et
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

    // 2. Supabase Auth kullanıcısı zaten varsa → bilgileri güncelle ve döndür
    if (existingAuthUser) {
      console.log("✅ [AUTH] User already linked, updating:", existingAuthUser.id);

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
          avatarUrl: updatedUser.avatar_url,
          isPro: updatedUser.is_pro,
        },
        isNewUser: false,
        isLinked: true,
      });
    }

    // 2.5 EMAIL İLE ACCOUNT LINKING: Aynı email ile farklı provider'dan giriş
    // Örn: Önce email/password ile kayıt, sonra Google ile giriş (aynı email)
    if (email) {
      const { data: existingEmailUser, error: emailFetchError } = await supabase
        .from("users")
        .select("*")
        .eq("email", email)
        .single();

      if (!emailFetchError && existingEmailUser) {
        console.log(`🔗 [AUTH] Found existing user with same email, linking: ${existingEmailUser.id}`);
        console.log(`   Old provider: ${existingEmailUser.auth_provider}, New provider: ${provider}`);
        console.log(`   Old supabase_user_id: ${existingEmailUser.supabase_user_id}, New: ${supabaseUserId}`);

        // 🔀 HESAP BİRLEŞTİRME: Email user VE anonymous user varsa kredileri birleştir
        let mergedCredits = 0;
        let wasMerged = false;

        if (existingUserId && existingUserId !== existingEmailUser.id) {
          // Anonymous user'ı kontrol et
          const { data: anonymousUser, error: anonError } = await supabase
            .from("users")
            .select("*")
            .eq("id", existingUserId)
            .single();

          if (!anonError && anonymousUser && !anonymousUser.merged_into_user_id) {
            console.log(`🔀 [AUTH] MERGING accounts: anonymous=${existingUserId} → email=${existingEmailUser.id}`);
            console.log(`   Anonymous credits: ${anonymousUser.credit_balance}`);
            console.log(`   Email user credits: ${existingEmailUser.credit_balance}`);

            mergedCredits = anonymousUser.credit_balance || 0;
            wasMerged = true;

            // Anonymous user'ı merged olarak işaretle
            await supabase
              .from("users")
              .update({
                merged_into_user_id: existingEmailUser.id,
                merged_at: new Date().toISOString(),
              })
              .eq("id", existingUserId);

            console.log(`✅ [AUTH] Anonymous user marked as merged`);
          }
        }

        // Mevcut kullanıcıyı yeni Supabase Auth ID'sine bağla
        const updateData = {
          supabase_user_id: supabaseUserId,
        };
        if (fullName) updateData.full_name = fullName;
        if (avatarUrl) updateData.avatar_url = avatarUrl;
        // Provider'ı güncelle (artık multi-provider olabilir)
        if (provider) updateData.auth_provider = provider;

        // Kredileri birleştir
        if (wasMerged && mergedCredits > 0) {
          updateData.credit_balance = (existingEmailUser.credit_balance || 0) + mergedCredits;
          console.log(`💰 [AUTH] Merged credits: ${existingEmailUser.credit_balance} + ${mergedCredits} = ${updateData.credit_balance}`);
        }

        const { data: linkedUser, error: linkError } = await supabase
          .from("users")
          .update(updateData)
          .eq("id", existingEmailUser.id)
          .select()
          .single();

        if (linkError) {
          console.error("❌ [AUTH] Error linking user by email:", linkError);
          return res.status(500).json({
            success: false,
            message: "Error linking user by email",
            error: linkError.message,
          });
        }

        console.log("✅ [AUTH] Account linked by email successfully:", linkedUser.id);

        return res.status(200).json({
          success: true,
          message: wasMerged ? "Accounts merged successfully" : "Account linked by email successfully",
          user: {
            id: linkedUser.id,
            supabaseUserId: linkedUser.supabase_user_id,
            email: linkedUser.email,
            fullName: linkedUser.full_name,
            creditBalance: linkedUser.credit_balance,
            avatarUrl: linkedUser.avatar_url,
            isPro: linkedUser.is_pro,
          },
          isNewUser: false,
          isLinked: true,
          wasEmailLinked: true,
          wasMerged,
          mergedCredits: wasMerged ? mergedCredits : 0,
        });
      }
    }

    // 3. Supabase Auth kullanıcısı yok ve email ile de bulunamadı - Account Linking dene
    if (existingUserId) {
      // Mevcut anonim kullanıcıyı bul
      const { data: anonymousUser, error: anonError } = await supabase
        .from("users")
        .select("*")
        .eq("id", existingUserId)
        .single();

      if (!anonError && anonymousUser) {
        // Anonim hesabın zaten başka bir Supabase hesabına bağlı olup olmadığını kontrol et
        if (anonymousUser.supabase_user_id && anonymousUser.supabase_user_id !== supabaseUserId) {
          console.log("⚠️ [AUTH] Anonymous user already linked to different Supabase account");
          // Bu durumda yeni kullanıcı oluştur (aşağıda devam edecek)
        } else {
          // 🔗 ACCOUNT LINKING: Anonim hesabı Supabase Auth'a bağla
          console.log(`🔗 [AUTH] Linking anonymous user ${existingUserId} to Supabase Auth ${supabaseUserId}`);

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
            console.error("❌ [AUTH] Error linking user:", linkError);
            return res.status(500).json({
              success: false,
              message: "Error linking user",
              error: linkError.message,
            });
          }

          console.log("✅ [AUTH] Account linked successfully:", linkedUser.id);

          return res.status(200).json({
            success: true,
            message: "Account linked successfully",
            user: {
              id: linkedUser.id,
              supabaseUserId: linkedUser.supabase_user_id,
              email: linkedUser.email,
              fullName: linkedUser.full_name,
              creditBalance: linkedUser.credit_balance,
              avatarUrl: linkedUser.avatar_url,
              isPro: linkedUser.is_pro,
            },
            isNewUser: false,
            isLinked: true,
            wasAnonymous: true,
          });
        }
      }
    }

    // 4. Yeni kullanıcı oluştur (linking yapılamadıysa veya existingUserId yoksa)
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
        avatarUrl: newUser.avatar_url,
        isPro: newUser.is_pro,
      },
      isNewUser: true,
      isLinked: true,
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
        isPro: user.is_pro,
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
    const { email, password, existingUserId } = req.body;

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
    const { email, password, companyName, existingUserId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    console.log("🔐 [AUTH] Email signup attempt:", email);

    // Supabase Auth ile kayıt ol
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Email doğrulamasını atla (mobil için)
      user_metadata: {
        company_name: companyName || null,
      },
    });

    if (error) {
      console.error("❌ [AUTH] Email signup failed:", error.message);
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

    // Backend users tablosuna sync et
    const syncResult = await syncUserToBackend({
      supabaseUserId: data.user.id,
      email: data.user.email,
      fullName: companyName || data.user.email?.split("@")[0],
      avatarUrl: null,
      provider: "email",
      existingUserId,
    });

    return res.status(200).json({
      success: true,
      message: "Signup successful",
      user: syncResult.user,
      isNewUser: syncResult.isNewUser,
      isLinked: syncResult.isLinked,
      wasAnonymous: syncResult.wasAnonymous,
      requiresEmailVerification: false,
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
    const { idToken, accessToken, existingUserId } = req.body;

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
    const { identityToken, fullName, existingUserId } = req.body;

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
async function syncUserToBackend({ supabaseUserId, email, fullName, avatarUrl, provider, existingUserId }) {
  // 1. Bu Supabase Auth kullanıcısı zaten var mı kontrol et
  const { data: existingAuthUser, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("supabase_user_id", supabaseUserId)
    .single();

  if (fetchError && fetchError.code !== "PGRST116") {
    throw new Error("Error checking user existence");
  }

  // 2. Supabase Auth kullanıcısı zaten varsa → bilgileri güncelle ve döndür
  if (existingAuthUser) {
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
      throw new Error("Error updating user");
    }

    return {
      user: {
        id: updatedUser.id,
        supabaseUserId: updatedUser.supabase_user_id,
        email: updatedUser.email,
        fullName: updatedUser.full_name,
        creditBalance: updatedUser.credit_balance,
        avatarUrl: updatedUser.avatar_url,
        isPro: updatedUser.is_pro,
      },
      isNewUser: false,
      isLinked: true,
      wasAnonymous: false,
    };
  }

  // 3. Email ile mevcut kullanıcı var mı kontrol et (farklı provider ile kayıtlı olabilir)
  if (email) {
    const { data: existingEmailUser, error: emailError } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!emailError && existingEmailUser) {
      console.log(`🔗 [HELPER] User found by email: ${email}, updating supabase_user_id`);

      // 🔀 HESAP BİRLEŞTİRME: Email user VE anonymous user varsa kredileri birleştir
      let mergedCredits = 0;
      let wasMerged = false;

      if (existingUserId && existingUserId !== existingEmailUser.id) {
        // Anonymous user'ı kontrol et
        const { data: anonymousUser, error: anonError } = await supabase
          .from("users")
          .select("*")
          .eq("id", existingUserId)
          .single();

        if (!anonError && anonymousUser && !anonymousUser.merged_into_user_id) {
          console.log(`🔀 [HELPER] MERGING accounts: anonymous=${existingUserId} → email=${existingEmailUser.id}`);
          console.log(`   Anonymous credits: ${anonymousUser.credit_balance}`);
          console.log(`   Email user credits: ${existingEmailUser.credit_balance}`);

          mergedCredits = anonymousUser.credit_balance || 0;
          wasMerged = true;

          // Anonymous user'ı merged olarak işaretle
          await supabase
            .from("users")
            .update({
              merged_into_user_id: existingEmailUser.id,
              merged_at: new Date().toISOString(),
            })
            .eq("id", existingUserId);

          console.log(`✅ [HELPER] Anonymous user marked as merged`);
        }
      }

      // Email user'ı güncelle
      const updateData = { supabase_user_id: supabaseUserId };
      if (fullName) updateData.full_name = fullName;
      if (avatarUrl) updateData.avatar_url = avatarUrl;
      if (provider) updateData.auth_provider = provider;

      // Kredileri birleştir
      if (wasMerged && mergedCredits > 0) {
        updateData.credit_balance = (existingEmailUser.credit_balance || 0) + mergedCredits;
        console.log(`💰 [HELPER] Merged credits: ${existingEmailUser.credit_balance} + ${mergedCredits} = ${updateData.credit_balance}`);
      }

      const { data: linkedUser, error: updateError } = await supabase
        .from("users")
        .update(updateData)
        .eq("id", existingEmailUser.id)
        .select()
        .single();

      if (updateError) {
        throw new Error("Error linking user by email");
      }

      return {
        user: {
          id: linkedUser.id,
          supabaseUserId: linkedUser.supabase_user_id,
          email: linkedUser.email,
          fullName: linkedUser.full_name,
          creditBalance: linkedUser.credit_balance,
          avatarUrl: linkedUser.avatar_url,
          isPro: linkedUser.is_pro,
        },
        isNewUser: false,
        isLinked: true,
        wasAnonymous: false,
        wasEmailLinked: true,
        wasMerged: wasMerged,
        mergedCredits: mergedCredits,
      };
    }
  }

  // 4. Anonymous user ile Account Linking dene (email yoksa veya email match olmadıysa)
  if (existingUserId) {
    const { data: anonymousUser, error: anonError } = await supabase
      .from("users")
      .select("*")
      .eq("id", existingUserId)
      .single();

    if (!anonError && anonymousUser) {
      if (!anonymousUser.supabase_user_id || anonymousUser.supabase_user_id === supabaseUserId) {
        const updateData = { supabase_user_id: supabaseUserId };
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

        return {
          user: {
            id: linkedUser.id,
            supabaseUserId: linkedUser.supabase_user_id,
            email: linkedUser.email,
            fullName: linkedUser.full_name,
            creditBalance: linkedUser.credit_balance,
            avatarUrl: linkedUser.avatar_url,
            isPro: linkedUser.is_pro,
          },
          isNewUser: false,
          isLinked: true,
          wasAnonymous: true,
        };
      }
    }
  }

  // 5. Yeni kullanıcı oluştur
  const newUserId = uuidv4();
  const insertData = {
    id: newUserId,
    supabase_user_id: supabaseUserId,
    credit_balance: 40,
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
    throw new Error("Error creating user");
  }

  return {
    user: {
      id: newUser.id,
      supabaseUserId: newUser.supabase_user_id,
      email: newUser.email,
      fullName: newUser.full_name,
      creditBalance: newUser.credit_balance,
      avatarUrl: newUser.avatar_url,
      isPro: newUser.is_pro,
    },
    isNewUser: true,
    isLinked: true,
    wasAnonymous: false,
  };
}

module.exports = router;

