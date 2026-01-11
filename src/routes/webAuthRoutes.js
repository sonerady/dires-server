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

// Google Login için mobil app callback endpoint
router.get('/google/callback', async (req, res) => {
    const { access_token, refresh_token, error, error_description } = req.query;

    if (error) {
        // Hata varsa mobil app'e redirect et
        return res.redirect(`diress://auth/callback?error=${encodeURIComponent(error_description || error)}`);
    }

    if (access_token) {
        // Başarılı ise token'larla mobil app'e redirect et
        let redirectUrl = `diress://auth/callback#access_token=${access_token}`;
        if (refresh_token) {
            redirectUrl += `&refresh_token=${refresh_token}`;
        }
        return res.redirect(redirectUrl);
    }

    res.status(400).json({ success: false, error: 'No tokens received' });
});

module.exports = router;
