const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

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
    const { email, password, options } = req.body;

    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options,
        });

        if (error) throw error;

        res.json({ success: true, data });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

// Google Login (Get OAuth URL)
router.post('/google', async (req, res) => {
    const { redirectTo } = req.body;

    try {
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo || undefined,
            },
        });

        if (error) throw error;

        res.json({ success: true, url: data.url });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

module.exports = router;
