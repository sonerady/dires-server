const express = require('express');
require('dotenv').config();
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabaseClient');
const { v4: uuidv4 } = require("uuid");
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const {
    getVerificationEmailTemplate,
    getMobileVerificationEmailTemplate,
    getWelcomeEmailTemplate,
    getPasswordResetTemplate
} = require('../lib/emailTemplates');

// Rate limiting için basit in-memory store
const rateLimitStore = new Map();

/**
 * Check for registration abuse based on device fingerprint and IP
 * Returns { isAbuse: boolean, reasons: string[], score: number }
 */
async function checkRegistrationAbuse(ip, deviceFingerprint, email) {
    const abuseResult = {
        isAbuse: false,
        reasons: [],
        score: 0
    };

    try {
        // 1. Check device fingerprint (most reliable)
        if (deviceFingerprint) {
            const { data: deviceMatches } = await supabaseAdmin
                .from('registration_tracking')
                .select('id, created_at')
                .eq('device_fingerprint', deviceFingerprint);

            if (deviceMatches && deviceMatches.length > 0) {
                abuseResult.score += 60;
                abuseResult.reasons.push('same_device');
                console.log(`🚨 [ABUSE] Same device fingerprint found: ${deviceFingerprint.substring(0, 8)}...`);
            }
        }

        // 2. Check IP address (last 30 days)
        if (ip) {
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
            const { data: ipMatches } = await supabaseAdmin
                .from('registration_tracking')
                .select('id, created_at')
                .eq('ip_address', ip)
                .gte('created_at', thirtyDaysAgo);

            if (ipMatches && ipMatches.length >= 2) {
                abuseResult.score += 30;
                abuseResult.reasons.push('multiple_ip_registrations');
                console.log(`🚨 [ABUSE] Multiple registrations from IP: ${ip} (${ipMatches.length} found)`);
            }
        }

        // 3. Check for disposable email domains
        const emailDomain = email.split('@')[1]?.toLowerCase();
        const disposableDomains = [
            'tempmail.com', 'guerrillamail.com', '10minutemail.com', 'throwaway.email',
            'mailinator.com', 'temp-mail.org', 'fakeinbox.com', 'tempinbox.com',
            'getnada.com', 'yopmail.com', 'trashmail.com', 'maildrop.cc'
        ];

        if (disposableDomains.includes(emailDomain)) {
            abuseResult.score += 40;
            abuseResult.reasons.push('disposable_email');
            console.log(`🚨 [ABUSE] Disposable email domain detected: ${emailDomain}`);
        }

        // Determine if this is abuse (score >= 50)
        abuseResult.isAbuse = abuseResult.score >= 50;

        console.log(`📊 [ABUSE CHECK] Score: ${abuseResult.score}, IsAbuse: ${abuseResult.isAbuse}, Reasons: ${abuseResult.reasons.join(', ') || 'none'}`);

    } catch (error) {
        console.error('❌ [ABUSE CHECK] Error:', error);
        // On error, don't block registration but log it
    }

    return abuseResult;
}

/**
 * Record registration in tracking table
 */
async function trackRegistration(userId, ip, deviceFingerprint, email, abuseResult, creditsGranted) {
    try {
        // Use supabaseAdmin to bypass RLS
        const { data, error } = await supabaseAdmin.from('registration_tracking').insert({
            user_id: userId,
            ip_address: ip,
            device_fingerprint: deviceFingerprint,
            email_domain: email.split('@')[1]?.toLowerCase(),
            suspicion_score: abuseResult.score,
            abuse_reasons: abuseResult.reasons,
            credits_granted: creditsGranted
        });

        if (error) {
            console.error('❌ [TRACKING] Supabase insert error:', error.message, error.details);
        } else {
            console.log(`📝 [TRACKING] Registration recorded for user: ${userId}`);
        }
    } catch (error) {
        console.error('❌ [TRACKING] Error recording registration:', error);
    }
}

/**
 * Helper: Supabase Auth kullanıcısını users tablosuna senkronize et
 * Web login/signup sonrası çağrılır
 * @param creditsToGrant - Yeni kullanıcıya verilecek kredi miktarı (default 40)
 * @param existingUserId - Mobil'den gelen anonim user ID (account linking için)
 */
async function syncUserToUsersTable(supabaseUserId, email, fullName = null, provider = 'email', companyName = null, creditsToGrant = 40, deviceId = null, existingUserId = null) {
    try {
        console.log(`🔄 [WEB AUTH] Syncing user to users table: ${email}, companyName: ${companyName}, existingUserId: ${existingUserId || '(yok)'}`);

        // 1. Bu Supabase user ID ile kayıt var mı?
        const { data: existingAuthUser, error: authError } = await supabase
            .from("users")
            .select("*")
            .eq("supabase_user_id", supabaseUserId)
            .single();

        if (!authError && existingAuthUser) {
            console.log(`✅ [WEB AUTH] User already exists in users table: ${existingAuthUser.id}`);
            return { user: existingAuthUser, isNew: false };
        }

        // 2. Bu email ile kayıt var mı?
        const { data: existingEmailUser, error: emailError } = await supabase
            .from("users")
            .select("*")
            .eq("email", email)
            .single();

        if (!emailError && existingEmailUser) {
            // Email ile kayıt var, supabase_user_id güncelle
            console.log(`🔗 [WEB AUTH] Linking existing email user: ${existingEmailUser.id}`);

            const { data: linkedUser, error: linkError } = await supabase
                .from("users")
                .update({
                    supabase_user_id: supabaseUserId,
                    auth_provider: provider,
                })
                .eq("id", existingEmailUser.id)
                .select()
                .single();

            if (linkError) {
                console.error(`❌ [WEB AUTH] Error linking user:`, linkError);
                return { user: existingEmailUser, isNew: false };
            }

            return { user: linkedUser, isNew: false };
        }

        // 3. 🔗 existingUserId (anonim hesap) var mı? → Email bağla (sadece email yoksa veya aynıysa!)
        if (existingUserId) {
            const { data: anonymousUser, error: anonError } = await supabase
                .from("users")
                .select("*")
                .eq("id", existingUserId)
                .single();

            if (!anonError && anonymousUser) {
                // ⚠️ Anonim hesapta zaten FARKLI email varsa, üzerine yazma!
                if (anonymousUser.email && email &&
                    anonymousUser.email.toLowerCase() !== email.toLowerCase()) {
                    console.log(`⚠️ [WEB AUTH] Anonim hesap ${existingUserId} zaten farklı email'e bağlı: ${anonymousUser.email}`);
                    console.log(`   İstenen email: ${email}`);
                    console.log(`   Yeni hesap oluşturulacak (Step 4'e düşüyor)...`);
                    // return yapma - Step 4'e düşsün
                } else {
                    // Güvenli: email yok veya aynı email → bağla
                    console.log(`🔗 [WEB AUTH] Linking anonymous user ${existingUserId} with email ${email}`);
                    console.log(`   📊 Anonymous user credits: ${anonymousUser.credit_balance}`);

                    const { data: linkedUser, error: linkError } = await supabase
                        .from("users")
                        .update({
                            supabase_user_id: supabaseUserId,
                            email: email,
                            full_name: fullName || anonymousUser.full_name,
                            company_name: companyName || anonymousUser.company_name,
                            auth_provider: provider,
                            // credit_balance KORUNUYOR! (eski krediler kaybolmuyor)
                        })
                        .eq("id", existingUserId)
                        .select()
                        .single();

                    if (linkError) {
                        console.error(`❌ [WEB AUTH] Error linking anonymous user:`, linkError);
                        // Hata olsa bile anonim kullanıcıyı dön
                        return { user: anonymousUser, isNew: false };
                    }

                    console.log(`✅ [WEB AUTH] Anonymous user linked successfully! User ID: ${linkedUser.id}, Credits preserved: ${linkedUser.credit_balance}`);
                    return { user: linkedUser, isNew: false };
                }
            }
        }

        // 4. Yeni kullanıcı oluştur (sadece hiçbir hesap bulunamazsa)
        console.log(`🆕 [WEB AUTH] Creating new user for: ${email}`);

        const newUserId = uuidv4();
        const shouldReceiveCredit = creditsToGrant > 0;
        const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert([{
                id: newUserId,
                supabase_user_id: supabaseUserId,
                email: email,
                full_name: fullName,
                company_name: companyName,
                auth_provider: provider,
                credit_balance: creditsToGrant, // Yeni kullanıcıya kredi hediye (abuse/device check ise 0)
                received_initial_credit: shouldReceiveCredit,
                initial_credit_date: shouldReceiveCredit ? new Date().toISOString() : null,
                created_at: new Date().toISOString(),
                owner: false,
                device_id: deviceId, // 🛡️ Mobil cihaz ID'si
            }])
            .select()
            .single();

        if (insertError) {
            console.error(`❌ [WEB AUTH] Error creating user:`, insertError);
            return { user: null, isNew: false, error: insertError };
        }

        console.log(`✅ [WEB AUTH] New user created: ${newUser.id}`);
        return { user: newUser, isNew: true };

    } catch (error) {
        console.error(`❌ [WEB AUTH] Sync error:`, error);
        return { user: null, isNew: false, error };
    }
}

// Email/Password Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;

        // Users tablosuna senkronize et
        const { user: dbUser } = await syncUserToUsersTable(
            data.user.id,
            data.user.email,
            data.user.user_metadata?.full_name,
            'email',
            data.user.user_metadata?.company_name
        );

        res.json({
            success: true,
            data,
            dbUser: dbUser ? {
                id: dbUser.id,
                creditBalance: dbUser.credit_balance,
                isPro: dbUser.is_pro,
            } : null
        });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Email/Password Sign Up (WITH EMAIL VERIFICATION)
router.post('/signup', async (req, res) => {
    let { email, password, options, platform, deviceFingerprint, deviceId, existingUserId } = req.body;
    console.log(`[Signup] Request received for email: ${email} (platform: ${platform || 'web'}) deviceId: ${deviceId || 'none'} existingUserId: ${existingUserId || 'none'}`);

    // Get IP address for abuse tracking
    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress;

    email = email ? email.trim() : '';

    // Basic Validation
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: "Please enter a valid email address." });
    }
    if (!password || password.length < 6) {
        return res.status(400).json({ success: false, error: "Password must be at least 6 characters long." });
    }

    try {
        console.log(`[Signup] Supabase Admin available: ${!!supabaseAdmin}`);

        if (!supabaseAdmin) {
            return res.status(500).json({ success: false, error: "Server configuration error: Admin client missing." });
        }

        // 1. Create User via Admin (Email verification REQUIRED)
        const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: false, // EMAIL VERIFICATION REQUIRED
            user_metadata: options ? options.data : {}
        });

        if (createError) {
            console.log(`[Signup] Create user error: "${createError.message}" Code: ${createError.status}`);
            const msg = createError.message.toLowerCase();

            // EMAIL ALREADY REGISTERED? Check confirmation status
            if (msg.includes("registered") || msg.includes("invalid") || createError.status === 422 || createError.status === 400) {
                try {
                    // Find user in our database first to get Supabase ID
                    const { data: dbUserCheck } = await supabase
                        .from('users')
                        .select('supabase_user_id')
                        .eq('email', email)
                        .single();

                    if (dbUserCheck?.supabase_user_id) {
                        const { data: { user: existingAuthUser } } = await supabaseAdmin.auth.admin.getUserById(dbUserCheck.supabase_user_id);

                        // IF NOT CONFIRMED -> RESEND MAIL
                        if (existingAuthUser && !existingAuthUser.email_confirmed_at) {
                            console.log(`[Signup] Resilience: Found unconfirmed user ${existingAuthUser.id}. Resending verification...`);

                            // Re-use logic for sending email
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

                            const verificationUrl = `https://app.diress.ai/verify?token=${verificationToken}&userId=${existingAuthUser.id}`;
                            const userName = existingAuthUser.user_metadata?.company_name || existingAuthUser.user_metadata?.full_name || email.split('@')[0];

                            // Choose template based on platform
                            const isMobile = platform === 'mobile';
                            const emailSubject = isMobile ? 'Your verification code - Diress' : 'Confirm your account - Diress';
                            const emailHtml = isMobile
                                ? getMobileVerificationEmailTemplate(verificationCode, userName)
                                : getVerificationEmailTemplate(verificationCode, verificationUrl, userName);

                            const { data: resendData, error: resendError } = await resend.emails.send({
                                from: 'Diress <noreply@diress.ai>',
                                to: [email],
                                subject: emailSubject,
                                html: emailHtml
                            });

                            if (resendError) throw resendError;

                            return res.json({
                                success: true,
                                message: "Verification email resent. Please check your inbox.",
                                requiresEmailVerification: true,
                                email: email,
                                userId: existingAuthUser.id
                            });
                        }
                    }
                } catch (resilienceErr) {
                    console.error("[Signup] Resilience error:", resilienceErr);
                }

                return res.status(400).json({ success: false, error: "This email is already registered. Please sign in instead." });
            }
            throw createError;
        }

        console.log(`[Signup] User created and auto-confirmed. ID: ${createdUser.user.id}`);

        // 2. Check for registration abuse BEFORE granting credits
        const abuseResult = await checkRegistrationAbuse(ip, deviceFingerprint, email);
        let creditsToGrant = abuseResult.isAbuse ? 0 : 40;

        if (abuseResult.isAbuse) {
            console.log(`🚨 [Signup] Abuse detected! User ${email} will receive 0 credits. Reasons: ${abuseResult.reasons.join(', ')}`);
        }

        // 🛡️ MOBILE: Device ID bazlı kredi kontrolü (çift kredi engelleme)
        if (platform === 'mobile' && deviceId && creditsToGrant > 0) {
            console.log(`🔍 [Signup] Mobile device credit check for: ${deviceId}`);
            try {
                const { data: creditCheck, error: creditCheckError } = await supabase.rpc(
                    "check_device_credit_eligibility",
                    { device_id_param: deviceId }
                );

                if (!creditCheckError && creditCheck && creditCheck.length > 0) {
                    const { can_receive_credit, existing_user_count, last_credit_date } = creditCheck[0];
                    console.log(`🔍 [Signup] Device credit check result:`, {
                        can_receive_credit,
                        existing_user_count,
                        last_credit_date,
                    });

                    if (!can_receive_credit) {
                        creditsToGrant = 0;
                        console.log(`🛡️ [Signup] ⚠️ DEVICE DAHA ÖNCE KREDİ ALDI - YENİ KULLANICI 0 KREDİ ALACAK`);
                    }
                }
            } catch (deviceCheckError) {
                console.error(`❌ [Signup] Device credit check error:`, deviceCheckError);
            }
        }

        if (creditsToGrant > 0) {
            console.log(`✅ [Signup] No abuse detected. User ${email} will receive ${creditsToGrant} credits.`);
        }

        // 3. Users tablosuna kayıt oluştur (with adjusted credits + account linking)
        const { user: dbUser, isNew } = await syncUserToUsersTable(
            createdUser.user.id,
            email,
            options?.data?.full_name || null,
            'email',
            options?.data?.company_name || null,
            creditsToGrant,
            deviceId, // 🛡️ Mobil cihaz ID'si
            existingUserId // 🔗 Account linking için anonim user ID
        );

        console.log(`[Signup] Users table sync: ${isNew ? 'created' : 'linked'}, ID: ${dbUser?.id}`);

        // 4. Track this registration for future abuse detection
        // Use Supabase Auth user ID (createdUser.user.id) because FK references auth.users
        await trackRegistration(createdUser.user.id, ip, deviceFingerprint, email, abuseResult, creditsToGrant);

        // 5. Generate verification code (6 digits)
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationToken = uuidv4();

        // Store verification data in user metadata temporarily
        await supabaseAdmin.auth.admin.updateUserById(createdUser.user.id, {
            user_metadata: {
                ...createdUser.user.user_metadata,
                verification_code: verificationCode,
                verification_token: verificationToken,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
            }
        });

        // 6. Send Verification Email via Resend
        const verificationUrl = `https://app.diress.ai/verify?token=${verificationToken}&userId=${createdUser.user.id}`;
        const userName = options?.data?.company_name || options?.data?.full_name || email.split('@')[0];

        try {
            console.log(`📧 [Signup] Sending verification email to: ${email}...`);
            // Choose template based on platform
            const isMobile = platform === 'mobile';
            const emailSubject = isMobile ? 'Your verification code - Diress' : 'Confirm your account - Diress';
            const emailHtml = isMobile
                ? getMobileVerificationEmailTemplate(verificationCode, userName)
                : getVerificationEmailTemplate(verificationCode, verificationUrl, userName);

            const { data: resendData, error: resendError } = await resend.emails.send({
                from: 'Diress <noreply@diress.ai>',
                to: [email],
                subject: emailSubject,
                html: emailHtml
            });

            if (resendError) {
                console.error("❌ [Signup] Resend API Error:", resendError);
                throw resendError;
            }

            console.log(`✅ [Signup] Verification email sent! Resend ID: ${resendData?.id}`);
        } catch (sendErr) {
            console.error("❌ [Signup] Resend Exception:", sendErr);
            // Kullanıcıyı sil çünkü email gönderilemedi
            await supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
            return res.status(500).json({
                success: false,
                error: "Failed to send verification email. Please try again."
            });
        }

        res.json({
            success: true,
            message: "Verification email sent. Please check your inbox.",
            requiresEmailVerification: true,
            email: email,
            userId: createdUser.user.id,
            dbUser: dbUser ? {
                id: dbUser.id,
                creditBalance: dbUser.credit_balance,
                isPro: dbUser.is_pro,
            } : null
        });

    } catch (error) {
        console.error("[Signup] Unexpected error:", error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Google Login (Get OAuth URL)
router.post('/google', async (req, res) => {
    const { redirectTo } = req.body;

    try {
        // Mobile app deep link için redirect URL
        const finalRedirectTo = redirectTo || 'https://egpfenrpripkjpemjxtg.supabase.co/auth/v1/callback';

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: finalRedirectTo,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent',
                },
            },
        });

        if (error) throw error;

        console.log('[Auth] Google OAuth URL generated, redirectTo:', finalRedirectTo);
        res.json({ success: true, url: data.url });
    } catch (error) {
        console.error('[Auth] Google OAuth error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Apple Login (Get OAuth URL)
router.post('/apple', async (req, res) => {
    const { redirectTo } = req.body;

    try {
        const finalRedirectTo = redirectTo || 'https://egpfenrpripkjpemjxtg.supabase.co/auth/v1/callback';

        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'apple',
            options: {
                redirectTo: finalRedirectTo,
            },
        });

        if (error) throw error;

        console.log('[Auth] Apple OAuth URL generated, redirectTo:', finalRedirectTo);
        res.json({ success: true, url: data.url });
    } catch (error) {
        console.error('[Auth] Apple OAuth error:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// Mobile app callback - Supabase'den gelen token'ları app'e yönlendir
router.get('/callback', async (req, res) => {
    // URL hash fragment'ı server'a gelmez, o yüzden HTML ile client-side redirect yapalım
    // Supabase bazen token'ları query param, bazen hash fragment olarak gönderir
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirecting...</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                    background: #f5f5f5;
                }
                .container { text-align: center; padding: 20px; }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid #e5e5e5;
                    border-top: 3px solid #333;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
                .manual-link {
                    display: none;
                    margin-top: 20px;
                    padding: 15px 30px;
                    background: #007AFF;
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    font-size: 16px;
                }
                .manual-link:hover { background: #0056b3; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="spinner"></div>
                <p id="status">Uygulamaya yönlendiriliyorsunuz...</p>
                <a id="manualLink" class="manual-link" href="#">Uygulamayı Aç</a>
            </div>
            <script>
                console.log('Callback page loaded');
                console.log('Full URL:', window.location.href);
                console.log('Hash:', window.location.hash);
                console.log('Search:', window.location.search);

                // Hash fragment'tan token al
                const hash = window.location.hash.substring(1);
                const hashParams = new URLSearchParams(hash);

                // Query params'tan token al
                const queryParams = new URLSearchParams(window.location.search);

                // Her iki kaynaktan da token'ları kontrol et
                let accessToken = hashParams.get('access_token') || queryParams.get('access_token');
                let refreshToken = hashParams.get('refresh_token') || queryParams.get('refresh_token');
                const error = hashParams.get('error') || queryParams.get('error');
                const errorDescription = hashParams.get('error_description') || queryParams.get('error_description');

                console.log('Access Token found:', !!accessToken);
                console.log('Refresh Token found:', !!refreshToken);
                console.log('Error:', error);

                let redirectUrl = null;

                if (error) {
                    redirectUrl = 'diress://auth/callback?error=' + encodeURIComponent(errorDescription || error);
                    document.getElementById('status').textContent = 'Hata: ' + (errorDescription || error);
                } else if (accessToken) {
                    // Token'ları query param olarak gönder (hash yerine, daha güvenilir)
                    redirectUrl = 'diress://auth/callback?access_token=' + encodeURIComponent(accessToken);
                    if (refreshToken) {
                        redirectUrl += '&refresh_token=' + encodeURIComponent(refreshToken);
                    }
                } else {
                    document.getElementById('status').textContent = 'Token bulunamadı. Lütfen tekrar deneyin.';
                    console.log('No tokens found in URL');
                }

                if (redirectUrl) {
                    console.log('Redirecting to:', redirectUrl);

                    // Önce otomatik yönlendirme dene
                    window.location.href = redirectUrl;

                    // 2 saniye sonra manuel link göster
                    setTimeout(function() {
                        document.getElementById('status').textContent = 'Otomatik yönlendirme çalışmadıysa butona tıklayın';
                        var link = document.getElementById('manualLink');
                        link.href = redirectUrl;
                        link.style.display = 'inline-block';
                    }, 2000);
                }
            </script>
        </body>
        </html>
    `);
});

// Email Verification Endpoint
router.post('/verify-email', async (req, res) => {
    const { token, code, userId } = req.body;

    try {
        if (!userId) {
            return res.status(400).json({ success: false, error: "User ID is required" });
        }

        // Get user from Supabase Auth
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (userError || !userData.user) {
            return res.status(404).json({ success: false, error: "User not found" });
        }

        const user = userData.user;
        const metadata = user.user_metadata || {};

        // Check if already verified
        if (user.email_confirmed_at) {
            return res.status(400).json({
                success: false,
                error: "Email already verified",
                alreadyVerified: true
            });
        }

        // Check expiration
        const expiresAt = new Date(metadata.verification_expires);
        if (expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                error: "Verification code expired. Please request a new one.",
                expired: true
            });
        }

        // Verify token OR code
        let isValid = false;
        if (token && metadata.verification_token === token) {
            isValid = true;
        } else if (code && metadata.verification_code === code) {
            isValid = true;
        }

        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: "Invalid verification code"
            });
        }

        // Mark user as verified
        await supabaseAdmin.auth.admin.updateUserById(userId, {
            email_confirm: true,
            user_metadata: {
                ...metadata,
                verification_code: null,
                verification_token: null,
                verification_expires: null,
            }
        });

        console.log(`✅ [Verify] Email verified for user: ${user.email}`);

        // Send welcome email
        try {
            const userName = metadata.company_name || metadata.full_name || user.email.split('@')[0];
            await resend.emails.send({
                from: 'Diress <noreply@diress.ai>',
                to: [user.email],
                subject: 'Welcome to Diress',
                html: getWelcomeEmailTemplate(userName, 40)
            });
            console.log(`[Verify] Welcome email sent to: ${user.email}`);
        } catch (welcomeErr) {
            console.error("[Verify] Welcome email error (ignored):", welcomeErr);
        }

        res.json({
            success: true,
            message: "Email verified successfully",
            email: user.email
        });

    } catch (error) {
        console.error("[Verify] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Resend Verification Email
router.post('/resend-verification', async (req, res) => {
    const { userId, email } = req.body;

    try {
        if (!userId && !email) {
            return res.status(400).json({ success: false, error: "User ID or email is required" });
        }

        // Rate limiting check (1 minute cooldown)
        const rateLimitKey = userId || email;
        const lastSent = rateLimitStore.get(rateLimitKey);
        const now = Date.now();
        const cooldownMs = 60 * 1000; // 60 seconds

        if (lastSent && (now - lastSent) < cooldownMs) {
            const waitSeconds = Math.ceil((cooldownMs - (now - lastSent)) / 1000);
            return res.status(429).json({
                success: false,
                error: `Please wait ${waitSeconds} seconds before requesting another code`,
                waitSeconds
            });
        }

        // Get user
        let user;
        if (userId) {
            const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
            if (userError || !userData.user) {
                return res.status(404).json({ success: false, error: "User not found" });
            }
            user = userData.user;
        } else {
            // Find by email
            const { data: users } = await supabaseAdmin.auth.admin.listUsers();
            user = users?.users?.find(u => u.email === email);
            if (!user) {
                return res.status(404).json({ success: false, error: "User not found" });
            }
        }

        // Check if already verified
        if (user.email_confirmed_at) {
            return res.status(400).json({
                success: false,
                error: "Email already verified",
                alreadyVerified: true
            });
        }

        // Generate new verification code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationToken = uuidv4();
        const metadata = user.user_metadata || {};

        await supabaseAdmin.auth.admin.updateUserById(user.id, {
            user_metadata: {
                ...metadata,
                verification_code: verificationCode,
                verification_token: verificationToken,
                verification_expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            }
        });

        // Send email
        const verificationUrl = `https://app.diress.ai/verify?token=${verificationToken}&userId=${user.id}`;
        const userName = metadata.company_name || metadata.full_name || user.email.split('@')[0];

        await resend.emails.send({
            from: 'Diress <noreply@diress.ai>',
            to: [user.email],
            subject: '🔐 Email Doğrulama - Diress',
            html: getVerificationEmailTemplate(verificationCode, verificationUrl, userName)
        });

        // Update rate limit
        rateLimitStore.set(rateLimitKey, now);

        console.log(`[Resend] Verification email resent to: ${user.email}`);

        res.json({
            success: true,
            message: "Verification email sent",
            email: user.email
        });

    } catch (error) {
        console.error("[Resend] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Forgot Password - Send Reset Email
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    try {
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: "Please enter a valid email address." });
        }

        const trimmedEmail = email.trim();

        // Rate limiting check (1 minute cooldown)
        const rateLimitKey = `reset_${trimmedEmail}`;
        const lastSent = rateLimitStore.get(rateLimitKey);
        const now = Date.now();
        const cooldownMs = 60 * 1000; // 60 seconds

        if (lastSent && (now - lastSent) < cooldownMs) {
            const waitSeconds = Math.ceil((cooldownMs - (now - lastSent)) / 1000);
            return res.status(429).json({
                success: false,
                error: `Please wait ${waitSeconds} seconds before requesting another reset email`,
                waitSeconds
            });
        }

        console.log(`🔐 [Forgot Password] Request for: ${trimmedEmail}`);

        // Find user by email
        const { data: users } = await supabaseAdmin.auth.admin.listUsers();
        const user = users?.users?.find(u => u.email === trimmedEmail);

        if (!user) {
            // Don't reveal if email exists or not for security
            console.log(`[Forgot Password] User not found: ${trimmedEmail}`);
            return res.json({
                success: true,
                message: "If an account exists with this email, you will receive a password reset link."
            });
        }

        // Generate reset token
        const resetToken = uuidv4();
        const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

        // Store reset token in user metadata
        await supabaseAdmin.auth.admin.updateUserById(user.id, {
            user_metadata: {
                ...user.user_metadata,
                reset_token: resetToken,
                reset_expires: resetExpires,
            }
        });

        // Send reset email
        const resetUrl = `https://app.diress.ai/reset-password?token=${resetToken}&userId=${user.id}`;
        const userName = user.user_metadata?.company_name || user.user_metadata?.full_name || trimmedEmail.split('@')[0];

        await resend.emails.send({
            from: 'Diress <noreply@diress.ai>',
            to: [trimmedEmail],
            subject: 'Reset your password - Diress',
            html: getPasswordResetTemplate(resetUrl, userName)
        });

        // Update rate limit
        rateLimitStore.set(rateLimitKey, now);

        console.log(`✅ [Forgot Password] Reset email sent to: ${trimmedEmail}`);

        res.json({
            success: true,
            message: "If an account exists with this email, you will receive a password reset link."
        });

    } catch (error) {
        console.error("[Forgot Password] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reset Password - Verify token and set new password
router.post('/reset-password', async (req, res) => {
    const { token, userId, newPassword } = req.body;

    try {
        if (!token || !userId) {
            return res.status(400).json({ success: false, error: "Invalid reset link." });
        }

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, error: "Password must be at least 6 characters long." });
        }

        console.log(`🔐 [Reset Password] Attempt for user: ${userId}`);

        // Get user
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (userError || !userData.user) {
            return res.status(404).json({ success: false, error: "Invalid reset link." });
        }

        const user = userData.user;
        const metadata = user.user_metadata || {};

        // Verify token
        if (metadata.reset_token !== token) {
            return res.status(400).json({ success: false, error: "Invalid or expired reset link." });
        }

        // Check expiration
        const expiresAt = new Date(metadata.reset_expires);
        if (expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                error: "Reset link has expired. Please request a new one.",
                expired: true
            });
        }

        // Update password
        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            password: newPassword,
            user_metadata: {
                ...metadata,
                reset_token: null,
                reset_expires: null,
            }
        });

        if (updateError) {
            console.error("[Reset Password] Update error:", updateError);
            return res.status(500).json({ success: false, error: "Failed to update password." });
        }

        console.log(`✅ [Reset Password] Password updated for: ${user.email}`);

        res.json({
            success: true,
            message: "Password updated successfully. You can now sign in with your new password."
        });

    } catch (error) {
        console.error("[Reset Password] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verify Reset Token (for checking if link is valid before showing form)
router.post('/verify-reset-token', async (req, res) => {
    const { token, userId } = req.body;

    try {
        if (!token || !userId) {
            return res.status(400).json({ success: false, error: "Invalid reset link." });
        }

        // Get user
        const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (userError || !userData.user) {
            return res.status(404).json({ success: false, error: "Invalid reset link." });
        }

        const user = userData.user;
        const metadata = user.user_metadata || {};

        // Verify token
        if (metadata.reset_token !== token) {
            return res.status(400).json({ success: false, error: "Invalid or expired reset link." });
        }

        // Check expiration
        const expiresAt = new Date(metadata.reset_expires);
        if (expiresAt < new Date()) {
            return res.status(400).json({
                success: false,
                error: "Reset link has expired. Please request a new one.",
                expired: true
            });
        }

        res.json({
            success: true,
            email: user.email
        });

    } catch (error) {
        console.error("[Verify Reset Token] Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update User Profile (Company Name, etc.)
router.post('/update-profile', async (req, res) => {
    const { userId, companyName, fullName } = req.body;

    try {
        if (!userId) {
            return res.status(400).json({ success: false, error: "User ID is required" });
        }

        console.log(`🔄 [Profile Update] Request for user: ${userId}, companyName: ${companyName}`);

        // 1. Update Supabase Auth user_metadata
        const updateData = {};
        if (companyName !== undefined) updateData.company_name = companyName;
        if (fullName !== undefined) updateData.full_name = fullName;

        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
            user_metadata: updateData
        });

        if (authError) {
            console.error("❌ [Profile Update] Supabase Auth update error:", authError);
            throw authError;
        }

        // 2. Update users table in database
        const dbUpdateData = {};
        if (companyName !== undefined) dbUpdateData.company_name = companyName;
        if (fullName !== undefined) dbUpdateData.full_name = fullName;

        // Find DB user by supabase_user_id
        const { data: dbUser, error: dbError } = await supabase
            .from('users')
            .update(dbUpdateData)
            .eq('supabase_user_id', userId)
            .select()
            .single();

        if (dbError) {
            console.error("❌ [Profile Update] Database update error:", dbError);
            throw dbError;
        }

        console.log(`✅ [Profile Update] Profile updated for: ${userId}`);

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: dbUser
        });

    } catch (error) {
        console.error("[Profile Update] Unexpected error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
