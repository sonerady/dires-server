// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

// Supabase URL ve Key bilgilerini ekleyin
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Supabase client oluştur
const supabase = createClient(supabaseUrl, supabaseKey);

// Admin client (Service Role Key varsa)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let supabaseAdmin = null;

if (supabaseServiceKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

module.exports = { supabase, supabaseAdmin };
