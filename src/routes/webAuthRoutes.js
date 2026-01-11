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

module.exports = router;
