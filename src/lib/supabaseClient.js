require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Supabase URL veya Anon Key bulunamadı. Lütfen .env dosyasını kontrol edin."
  );
  // Uygulamanın çökmesini sağlayabilir veya varsayılan bir davranış belirleyebilirsiniz.
  // process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;
