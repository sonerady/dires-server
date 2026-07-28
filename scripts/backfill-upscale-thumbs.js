// 🖼️ upscale_generations.result_thumb_url geriye dönük doldurma
//
// Neden: netleştirilmiş çıktılar 30 MB'ı aşabiliyor. Hem Cloudflare Image
// Resizing (403) hem Supabase render endpoint'i ("source image file is too
// large") bu boyutta önizleme üretemiyor, geçmiş ızgarasındaki kart boş kalıyor.
// Yeni üretimler kaydedilirken thumbnail'ı biz üretiyoruz; bu betik ESKİ
// kayıtlar için aynısını yapar.
//
// Kullanım:
//   node server/scripts/backfill-upscale-thumbs.js            # tümü
//   node server/scripts/backfill-upscale-thumbs.js --limit=50 # ilk 50 kayıt
//   node server/scripts/backfill-upscale-thumbs.js --dry      # yazmadan dene
//
// Güvenli: yalnızca result_thumb_url IS NULL satırlara dokunur, tekrar tekrar
// çalıştırılabilir. Var olan dosyalar upsert ile güncellenir.
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
const THUMB_MAX = 600;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : null;

// Public URL → bucket içi yol (".../object/public/user_image_results/<yol>")
function storagePathFromUrl(url) {
  if (typeof url !== "string") return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

async function processRow(row) {
  const path = storagePathFromUrl(row.result_image_url);
  if (!path) return { skipped: "bucket dışı URL" };

  const resp = await axios.get(row.result_image_url, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
    maxBodyLength: 200 * 1024 * 1024,
  });

  const thumb = await sharp(Buffer.from(resp.data))
    .rotate()
    .resize(THUMB_MAX, THUMB_MAX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const thumbPath = path.replace(/\.(jpe?g|png|webp)$/i, "_thumb.jpg");
  if (DRY) return { dry: thumbPath, bytes: thumb.length };

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
    .from("upscale_generations")
    .update({ result_thumb_url: urlData?.publicUrl || null })
    .eq("id", row.id);
  if (dbErr) throw new Error(`db: ${dbErr.message}`);

  return { url: urlData?.publicUrl, bytes: thumb.length };
}

(async () => {
  let query = supabase
    .from("upscale_generations")
    .select("id, result_image_url, result_size_bytes, created_at")
    .is("result_thumb_url", null)
    .eq("status", "completed")
    .not("result_image_url", "is", null)
    .order("created_at", { ascending: false });
  if (LIMIT) query = query.limit(LIMIT);

  const { data: rows, error } = await query;
  if (error) {
    console.error("❌ Sorgu hatası:", error.message);
    process.exit(1);
  }

  console.log(
    `🖼️ ${rows.length} kayıt işlenecek${DRY ? " (DRY RUN — yazma yok)" : ""}`,
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const [i, row] of rows.entries()) {
    const label = `${i + 1}/${rows.length} ${row.id.slice(0, 8)}`;
    try {
      const res = await processRow(row);
      if (res.skipped) {
        skipped++;
        console.log(`⏭️  ${label} atlandı — ${res.skipped}`);
      } else {
        ok++;
        console.log(
          `✅ ${label} → ${Math.round(res.bytes / 1024)} KB önizleme`,
        );
      }
    } catch (err) {
      failed++;
      console.warn(`⚠️  ${label} başarısız — ${err.message}`);
    }
  }

  console.log(`\nBitti: ${ok} üretildi · ${skipped} atlandı · ${failed} hata`);
  process.exit(failed && !ok ? 1 : 0);
})();
