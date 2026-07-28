// 🖼️ reference_results.result_thumb_url geriye dönük doldurma
//
// Neden: netleştirilmiş sonuçlar 30 MB'ı aşabiliyor; Cloudflare Image Resizing
// bu boyuttaki kaynağı reddediyor (403), böylece Results ızgarasındaki önizleme
// hiç yüklenmiyor (görsel modalda açılınca sorunsuz geliyordu). Yeni üretimlerde
// önizlemeyi sunucu üretiyor; bu betik ESKİ kayıtlar için aynısını yapar.
//
// Kullanım:
//   node server/scripts/backfill-reference-thumbs.js              # tüm netleştirilmiş kayıtlar
//   node server/scripts/backfill-reference-thumbs.js --limit=20
//   node server/scripts/backfill-reference-thumbs.js --dry        # yazmadan dene
//
// Önce `reference_results_thumb_migration.sql` çalıştırılmış olmalı.
// Güvenli: yalnızca result_thumb_url IS NULL satırlara dokunur, tekrarlanabilir.
require("dotenv").config({ path: `${__dirname}/../.env` });
const axios = require("axios");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BUCKET = "user_image_results";
const THUMB_MAX = 900;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

async function download(url) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 180000,
    maxContentLength: 250 * 1024 * 1024,
    maxBodyLength: 250 * 1024 * 1024,
  });
  return Buffer.from(resp.data);
}

async function processRow(row) {
  // Küçük olan "öncesi" karesi varsa onu indirmek çok daha hızlı; içerik aynı.
  const sources = [row.pre_upscale_image_url, row.result_image_url].filter(
    Boolean,
  );
  let buffer = null;
  let usedSource = null;
  for (const src of sources) {
    try {
      buffer = await download(src);
      usedSource = src;
      break;
    } catch (err) {
      console.warn(`   ↳ kaynak alınamadı (${err.message}): ${src.slice(0, 70)}`);
    }
  }
  if (!buffer) throw new Error("hiçbir kaynak indirilemedi");

  const thumb = await sharp(buffer)
    .rotate()
    .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  const thumbPath = `${row.user_id}/backfill_thumb_${row.generation_id}.jpg`;
  if (DRY) return { dry: thumbPath, bytes: thumb.length, usedSource };

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(thumbPath, thumb, {
      contentType: "image/jpeg",
      cacheControl: "3600",
      upsert: true,
    });
  if (upErr) throw new Error(`upload: ${upErr.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(thumbPath);
  const { error: dbErr } = await supabase
    .from("reference_results")
    .update({ result_thumb_url: urlData?.publicUrl || null })
    .eq("generation_id", row.generation_id)
    .eq("user_id", row.user_id);
  if (dbErr) throw new Error(`db: ${dbErr.message}`);

  return { url: urlData?.publicUrl, bytes: thumb.length, usedSource };
}

(async () => {
  let query = supabase
    .from("reference_results")
    .select(
      "generation_id, user_id, upscaled_mp, result_image_url, pre_upscale_image_url, created_at",
    )
    .not("upscaled_mp", "is", null)
    .is("result_thumb_url", null)
    .not("result_image_url", "is", null)
    .order("created_at", { ascending: false });
  if (LIMIT) query = query.limit(LIMIT);

  const { data: rows, error } = await query;
  if (error) {
    console.error("❌ Sorgu hatası:", error.message);
    process.exit(1);
  }

  console.log(
    `🖼️ ${rows.length} netleştirilmiş kayıt işlenecek${DRY ? " (DRY RUN — yazma yok)" : ""}`,
  );

  let ok = 0;
  let failed = 0;

  for (const [i, row] of rows.entries()) {
    const label = `${i + 1}/${rows.length} ${row.generation_id.slice(0, 8)} (${row.upscaled_mp} MP)`;
    try {
      const res = await processRow(row);
      ok++;
      console.log(`✅ ${label} → ${Math.round(res.bytes / 1024)} KB önizleme`);
    } catch (err) {
      failed++;
      console.warn(`⚠️  ${label} başarısız — ${err.message}`);
    }
  }

  console.log(`\nBitti: ${ok} üretildi · ${failed} hata`);
  process.exit(failed && !ok ? 1 : 0);
})();
