const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabaseClient');
const { v4: uuidv4 } = require("uuid");
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);
const {
    getVerificationEmailTemplate,
    getWelcomeEmailTemplate,
    getPasswordResetTemplate
} = require('../lib/emailTemplates');

// Rate limiting için basit in-memory store
const rateLimitStore = new Map();

/**
 * Helper: Supabase Auth kullanıcısını users tablosuna senkronize et
 * Web login/signup sonrası çağrılır
 */
async function syncUserToUsersTable(supabaseUserId, email, fullName = null, provider = 'email') {
    try {
        console.log(`🔄 [WEB AUTH] Syncing user to users table: ${email}`);

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

        // 3. Yeni kullanıcı oluştur
        console.log(`🆕 [WEB AUTH] Creating new user for: ${email}`);

        const newUserId = uuidv4();
        const { data: newUser, error: insertError } = await supabase
            .from("users")
            .insert([{
                id: newUserId,
                supabase_user_id: supabaseUserId,
                email: email,
                full_name: fullName,
                auth_provider: provider,
                credit_balance: 40, // Yeni kullanıcıya 40 kredi hediye
                received_initial_credit: true,
                initial_credit_date: new Date().toISOString(),
                created_at: new Date().toISOString(),
                owner: false,
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
            'email'
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
    let { email, password, options } = req.body;
    console.log(`[Signup] Request received for email: ${email}`);

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
            if (msg.includes("registered") || msg.includes("invalid") || createError.status === 422 || createError.status === 400) {
                return res.status(400).json({ success: false, error: "This email is already registered. Please sign in instead." });
            }
            throw createError;
        }

        console.log(`[Signup] User created and auto-confirmed. ID: ${createdUser.user.id}`);

        // 2. Users tablosuna kayıt oluştur
        const { user: dbUser, isNew } = await syncUserToUsersTable(
            createdUser.user.id,
            email,
            options?.data?.company_name || options?.data?.full_name,
            'email'
        );

        console.log(`[Signup] Users table sync: ${isNew ? 'created' : 'linked'}, ID: ${dbUser?.id}`);

        // 3. Generate verification code (6 digits)
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

        // 4. Send Verification Email via Resend
        const verificationUrl = `https://app.diress.ai/verify?token=${verificationToken}&userId=${createdUser.user.id}`;
        const userName = options?.data?.company_name || options?.data?.full_name || email.split('@')[0];

        try {
            await resend.emails.send({
                from: 'Diress <noreply@diress.ai>',
                to: [email],
                subject: 'Confirm your account - Diress',
                html: getVerificationEmailTemplate(verificationCode, verificationUrl, userName)
            });
            console.log(`[Signup] Verification email sent via Resend to: ${email}`);
        } catch (sendErr) {
            console.error("[Signup] Resend error:", sendErr);
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

module.exports = router;
