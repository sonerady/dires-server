const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin } = require('../supabaseClient');
// const { Resend } = require('resend');
// const resend = new Resend(process.env.RESEND_API_KEY);

// Email/Password Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;

        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Email/Password Sign Up
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

        // 1. Create User via Admin (Auto-Confirm enabled for testing)
        const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true, // AUTO-CONFIRM ENABLED
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

        // 2. Send Welcome Email via Resend (Optional, just for info)
        /*
        try {
            await resend.emails.send({
                from: 'Diress <onboarding@resend.dev>',
                to: [email],
                subject: 'Welcome to Diress!',
                html: `
                    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2>Welcome to Diress!</h2>
                        <p>Your account has been created and automatically verified.</p>
                        <p>You can now sign in to your account.</p>
                    </div>
                `
            });
            console.log(`[Signup] Welcome email sent via Resend.`);
        } catch (sendErr) {
            console.error("[Signup] Resend exception (ignored):", sendErr);
        }
        */

        res.json({ success: true, data: createdUser });

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

// Mobile app callback - Supabase'den gelen token'ları app'e yönlendir
router.get('/callback', async (req, res) => {
    // URL hash fragment'ı server'a gelmez, o yüzden HTML ile client-side redirect yapalım
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Redirecting...</title>
            <meta charset="utf-8">
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
                .container { text-align: center; }
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="spinner"></div>
                <p>Uygulamaya yönlendiriliyorsunuz...</p>
            </div>
            <script>
                // URL'den hash fragment'ı al
                const hash = window.location.hash.substring(1);
                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');

                // Query params'tan da kontrol et
                const queryParams = new URLSearchParams(window.location.search);
                const error = queryParams.get('error') || params.get('error');
                const errorDescription = queryParams.get('error_description') || params.get('error_description');

                if (error) {
                    // Hata varsa app'e yönlendir
                    window.location.href = 'diress://auth/callback?error=' + encodeURIComponent(errorDescription || error);
                } else if (accessToken) {
                    // Başarılı - token'larla app'e yönlendir
                    let redirectUrl = 'diress://auth/callback#access_token=' + accessToken;
                    if (refreshToken) {
                        redirectUrl += '&refresh_token=' + refreshToken;
                    }
                    window.location.href = redirectUrl;
                } else {
                    // Token yok, belki henüz gelmedi
                    document.querySelector('p').textContent = 'Giriş işlemi tamamlanamadı. Lütfen tekrar deneyin.';
                }

                // 5 saniye sonra hala buradaysak mesaj göster
                setTimeout(function() {
                    if (document.body) {
                        document.querySelector('p').innerHTML = 'Uygulama açılmadıysa <a href="diress://">buraya tıklayın</a>';
                    }
                }, 5000);
            </script>
        </body>
        </html>
    `);
});

module.exports = router;
