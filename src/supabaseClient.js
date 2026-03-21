// supabaseClient.js
require('dotenv').config();
const { createClient } = require("@supabase/supabase-js");

// Supabase URL ve Key bilgilerini ekleyin
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

console.log('🌐 [Supabase] Initializing clients...');
console.log('   URL:', supabaseUrl ? 'Set' : 'MISSING');
console.log('   Anon Key:', supabaseKey ? 'Set' : 'MISSING');

// Supabase client oluştur
const supabase = createClient(supabaseUrl, supabaseKey);

// Admin client (Service Role Key varsa)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log('   Service Role Key:', supabaseServiceKey ? 'Set' : 'MISSING');

let supabaseAdmin = null;

if (supabaseServiceKey) {
    console.log('🚀 [Supabase] Creating Admin client...');
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });
}

// Service Role Key varsa tüm işlemlerde admin client kullan (RLS bypass)
// Böylece tüm route'lar otomatik olarak admin client ile çalışır
const effectiveClient = supabaseAdmin || supabase;

if (supabaseAdmin) {
    console.log('✅ [Supabase] All routes will use Admin client (RLS bypassed)');
} else {
    console.log('⚠️ [Supabase] No Service Role Key - using Anon client (RLS active)');
}

module.exports = { supabase: effectiveClient, supabaseAdmin };
