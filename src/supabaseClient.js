// supabaseClient.js
require('dotenv').config();
const { createClient } = require("@supabase/supabase-js");

// Supabase URL ve Key bilgilerini ekleyin
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log('🌐 [Supabase] Initializing clients...');
console.log('   URL:', supabaseUrl ? 'Set' : 'MISSING');
console.log('   Anon Key:', supabaseKey ? 'Set' : 'MISSING');

// Supabase anon client (RLS policy'leri ile çalışır)
const supabase = createClient(supabaseUrl, supabaseKey);

// Admin client (Service Role Key varsa - sadece auth admin işlemleri için)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('   Service Role Key:', supabaseServiceKey ? 'Set' : 'MISSING');

let supabaseAdmin = null;

if (supabaseServiceKey) {
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
    console.log('✅ [Supabase] Admin client ready (for auth admin ops)');
}

console.log('✅ [Supabase] Anon client ready (RLS policies manage access)');

module.exports = { supabase, supabaseAdmin };
