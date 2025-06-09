#!/usr/bin/env node

/**
 * Bu script, Supabase'de reference_explores tablosunu oluşturur.
 *
 * Kullanım:
 * node scripts/create-reference-explores-table.js
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const supabaseUrl =
  process.env.SUPABASE_URL || "https://halurilrsdzgnieeajxm.supabase.co";
const supabaseKey =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.error(
    "Error: SUPABASE_SERVICE_KEY veya SUPABASE_ANON_KEY çevre değişkenleri tanımlanmamış"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createReferenceExploresTable() {
  try {
    console.log("Supabase bağlantısı kuruluyor...");

    // SQL dosyasını oku
    const sqlFilePath = path.join(
      __dirname,
      "../supabase/migrations/20240520_create_reference_explores_table.sql"
    );
    const sqlQuery = fs.readFileSync(sqlFilePath, "utf8");

    console.log("SQL sorgusu çalıştırılıyor...");

    // SQL sorgusunu çalıştır
    const { error } = await supabase.rpc("pg_query", { query: sqlQuery });

    if (error) {
      console.error("SQL sorgusu çalıştırılırken hata oluştu:", error);
      return;
    }

    // Doğrulama: Tablo var mı kontrol et
    const { data, error: checkError } = await supabase
      .from("reference_explores")
      .select("id")
      .limit(1);

    if (checkError) {
      console.error("Tablo kontrol edilirken hata oluştu:", checkError);
      return;
    }

    console.log("reference_explores tablosu başarıyla oluşturuldu!");
    console.log("Tablo yapısı:");
    console.log("- id (UUID): Benzersiz kayıt ID");
    console.log("- user_id (TEXT): Kullanıcı ID");
    console.log("- image_url (TEXT): Oluşturulan görsel URL");
    console.log("- prompt (TEXT): Orijinal prompt");
    console.log("- enhanced_prompt (TEXT): Geliştirilmiş prompt");
    console.log("- reference_images (TEXT[]): Referans görsel URL listesi");
    console.log("- created_at (TIMESTAMPTZ): Oluşturulma zamanı");
    console.log("- updated_at (TIMESTAMPTZ): Güncellenme zamanı");
  } catch (err) {
    console.error("Hata:", err);
  }
}

createReferenceExploresTable().catch(console.error);
