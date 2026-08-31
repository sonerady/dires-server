#!/usr/bin/env node

// Jewelry auto-style referanslarından mevcut takıları kaldırır.
//
// Akış:
//   style_profiles.image_urls
//     → fal google/nano-banana-lite/edit (aspect_ratio=auto)
//     → Supabase reference/jewelry-clean/... bucket yolu
//     → style_profiles.jewelry_clean_image_urls
//
// Kullanım:
//   npm run styles:jewelry-clean -- --check
//   npm run styles:jewelry-clean -- --yes
//   npm run styles:jewelry-clean -- --yes --limit=20 --concurrency=2
//   npm run styles:jewelry-clean -- --yes --force --profile=<uuid>
//
// Güvenlik/tekrar çalıştırma:
// - --check hiçbir API çağrısı ve DB/Storage yazımı yapmaz.
// - Gerçek çalışma ücretli olduğu için --yes zorunludur.
// - Tamamlanmış ve kaynak fingerprint'i değişmemiş kayıtlar atlanır.
// - --force mevcut jewelry_clean_image_urls dizisini yeni sonuçlarla değiştirir.
// - Her başarılı görselden sonra dizi kaydedilir; yarıda kesilirse kaldığı
//   görselden devam eder.

require("dotenv").config({ path: `${__dirname}/../.env` });

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const {
  JEWELRY_CLEAN_MODEL: MODEL,
  JEWELRY_CLEAN_VARIANT,
  createFalClient,
  cleanAndPersistJewelryStyleImage,
} = require("../src/utils/jewelryCleanStyleImage");

const BUCKET = "reference";
// Model token bazlı fiyatlanır; 1K çıktı için yalnızca kaba takip tahminidir.
const ESTIMATED_PRICE_PER_IMAGE_USD = 0.05;
const DEFAULT_CONCURRENCY = 2;

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes("--check") || args.includes("--dry");
const CONFIRMED = args.includes("--yes");
const FORCE = args.includes("--force");

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function readPositiveInt(name, fallback) {
  const parsed = Number.parseInt(readArg(name, ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT = readPositiveInt("limit", null);
const CONCURRENCY = Math.min(readPositiveInt("concurrency", DEFAULT_CONCURRENCY), 32);
const PROFILE_ID = readArg("profile");
const USER_IDS = String(readArg("users", "auto,global"))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
let progressCompleted = 0;
let progressTotal = 0;
let progressStartedAt = 0;

function requireEnv(name, optional = false) {
  const value = process.env[name];
  if (!value && !optional) throw new Error(`${name} tanımlı değil`);
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL");
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  requireEnv("SUPABASE_ANON_KEY");
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const falClient = process.env.FAL_API_KEY || process.env.FAL_KEY
  ? createFalClient()
  : null;

function fingerprint(urls) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(urls))
    .digest("hex");
}

function isCurrentVariantUrl(url) {
  return (
    typeof url === "string" &&
    /^https?:\/\//i.test(url) &&
    url.includes(`-${JEWELRY_CLEAN_VARIANT}-`)
  );
}

function isComplete(row, sourceFingerprint) {
  const sourceCount = Array.isArray(row.image_urls)
    ? row.image_urls.filter(Boolean).length
    : 0;
  return (
    row.jewelry_clean_source_fingerprint === sourceFingerprint &&
    Array.isArray(row.jewelry_clean_image_urls) &&
    row.jewelry_clean_image_urls.length === sourceCount &&
    row.jewelry_clean_image_urls.every(isCurrentVariantUrl)
  );
}

function printProgress() {
  progressCompleted += 1;
  const ratio = progressTotal
    ? Math.min(1, progressCompleted / progressTotal)
    : 1;
  const percent = (ratio * 100).toFixed(1);
  const elapsedSeconds = Math.max(1, (Date.now() - progressStartedAt) / 1000);
  const rate = progressCompleted / elapsedSeconds;
  const remainingSeconds = rate > 0
    ? Math.max(0, Math.round((progressTotal - progressCompleted) / rate))
    : 0;
  console.log(
    `📊 TOPLAM ${progressCompleted}/${progressTotal} (%${percent}) · tahmini kalan ${remainingSeconds}sn`,
  );
}

async function persistProgress(rowId, cleanUrls, sourceFingerprint, patch = {}) {
  const { error } = await supabase
    .from("style_profiles")
    .update({
      jewelry_clean_image_urls: cleanUrls,
      jewelry_clean_source_fingerprint: sourceFingerprint,
      jewelry_clean_stamped_grid_url: null,
      ...patch,
    })
    .eq("id", rowId);
  if (error) throw new Error(`DB update: ${error.message}`);
}

async function processProfile(row, ordinal, total) {
  const sources = Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [];
  const sourceFingerprint = fingerprint(sources);
  const label = `${ordinal}/${total} ${row.product_subtype || "jewelry"}/${row.style_approach || "-"} ${row.id.slice(0, 8)}`;

  if (!FORCE && isComplete(row, sourceFingerprint)) {
    console.log(`⏭️  ${label} zaten hazır`);
    return { skipped: 1, images: 0 };
  }

  const canResume =
    !FORCE &&
    row.jewelry_clean_source_fingerprint === sourceFingerprint &&
    Array.isArray(row.jewelry_clean_image_urls) &&
    row.jewelry_clean_image_urls.length === sources.length;
  const cleanUrls = canResume
    ? [...row.jewelry_clean_image_urls]
    : Array(sources.length).fill(null);

  try {
    let generated = 0;
    for (let index = 0; index < sources.length; index += 1) {
      if (!FORCE && isCurrentVariantUrl(cleanUrls[index])) {
        continue;
      }
      console.log(`⏳ ${label} — görsel ${index + 1}/${sources.length} fal'a gönderiliyor`);
      cleanUrls[index] = await cleanAndPersistJewelryStyleImage({
        imageUrl: sources[index],
        supabase,
        bucket: BUCKET,
        falClient,
        objectPathWithoutExtension: `jewelry-clean/${row.id}/${sourceFingerprint.slice(0, 12)}-${JEWELRY_CLEAN_VARIANT}-${index + 1}`,
      });
      generated += 1;
      await persistProgress(row.id, cleanUrls, sourceFingerprint, {
        jewelry_clean_error: null,
        jewelry_cleaned_at: null,
      });
      console.log(`✅ ${label} — görsel ${index + 1}/${sources.length} kaydedildi`);
      printProgress();
    }

    await persistProgress(row.id, cleanUrls, sourceFingerprint, {
      jewelry_clean_error: null,
      jewelry_cleaned_at: new Date().toISOString(),
    });
    console.log(`🎉 ${label} tamamlandı`);
    return { skipped: 0, images: generated };
  } catch (error) {
    await supabase
      .from("style_profiles")
      .update({ jewelry_clean_error: String(error.message || error).slice(0, 1000) })
      .eq("id", row.id);
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
        console.error(`❌ ${index + 1}/${items.length} başarısız: ${error.message}`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker),
  );
  return results;
}

async function fetchRows() {
  // Supabase projelerinde API satır limiti çoğunlukla 1000'dir. Jewelry havuzu
  // bunun üstünde olduğu için tüm kayıtları deterministik sayfalarla al.
  const PAGE_SIZE = 500;
  const rows = [];
  let offset = 0;
  while (true) {
    const pageSize = PAGE_SIZE;
    let query = supabase
      .from("style_profiles")
      .select(
        "id,user_id,product_category,product_subtype,style_approach,image_urls,jewelry_clean_image_urls,jewelry_clean_source_fingerprint,jewelry_cleaned_at,jewelry_clean_error",
      )
      .eq("product_category", "jewelry")
      .in("user_id", USER_IDS)
      .or("auto_pool.is.null,auto_pool.eq.true")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (PROFILE_ID) query = query.eq("id", PROFILE_ID);
    const { data, error } = await query;
    if (error) {
      if (/jewelry_clean_/i.test(error.message || "")) {
        throw new Error(
          `Jewelry clean kolonları henüz yok. Önce migrations/add_jewelry_clean_style_images.sql dosyasını Supabase'e uygulayın. (${error.message})`,
        );
      }
      throw new Error(error.message);
    }
    rows.push(...(data || []));
    if (!data || data.length < pageSize || PROFILE_ID) break;
    offset += pageSize;
  }
  return rows.filter(
    (row) => Array.isArray(row.image_urls) && row.image_urls.filter(Boolean).length,
  );
}

async function main() {
  const rows = await fetchRows();
  const allPending = rows.filter((row) => {
    const sources = row.image_urls.filter(Boolean);
    return FORCE || !isComplete(row, fingerprint(sources));
  });
  // Limit sorgudan önce değil, tamamlanmış kayıtlar elendikten sonra uygulanır.
  // Böylece `--limit=20` ile tekrarlanan çalışmalar her seferinde sıradaki 20
  // bekleyen profili işler; ilk 20 tamamlandıktan sonra takılı kalmaz.
  const pending = LIMIT ? allPending.slice(0, LIMIT) : allPending;
  const pendingImages = pending.reduce((sum, row) => {
    const sources = row.image_urls.filter(Boolean);
    if (FORCE || row.jewelry_clean_source_fingerprint !== fingerprint(sources)) {
      return sum + sources.length;
    }
    const done = Array.isArray(row.jewelry_clean_image_urls)
      ? row.jewelry_clean_image_urls.filter(isCurrentVariantUrl).length
      : 0;
    return sum + Math.max(0, sources.length - done);
  }, 0);

  console.log("\nJewelry clean auto-style ön kontrolü");
  console.log(`Model: ${MODEL}`);
  console.log(`Talimat: mevcut tüm takıları kaldır, diğer her şeyi koru`);
  console.log(`Aspect ratio: auto | output: png | generation limit: 1`);
  console.log(`Safety tolerance: 6 | işlem sürümü: ${JEWELRY_CLEAN_VARIANT}`);
  console.log(
    `Kayıt: ${rows.length} | Toplam bekleyen profil: ${allPending.length} | Bu çalışma: ${pending.length} profil / ${pendingImages} görsel`,
  );
  console.log(`Yaklaşık fal maliyeti: $${(pendingImages * ESTIMATED_PRICE_PER_IMAGE_USD).toFixed(2)} (token kullanımına göre değişebilir)`);
  console.log(`Paralellik: ${CONCURRENCY} | Kullanıcı havuzu: ${USER_IDS.join(", ")}`);

  if (CHECK_ONLY) {
    console.log("\n--check tamamlandı; API çağrısı ve hiçbir yazma yapılmadı.");
    return;
  }
  if (!CONFIRMED) {
    throw new Error("Ücretli işlemi başlatmak için --yes ekleyin. Önce --check kullanın.");
  }
  if (!falClient) throw new Error("FAL_API_KEY veya FAL_KEY tanımlı değil");
  if (!pending.length) {
    console.log("\n🏁 İşlenecek kayıt yok; tüm jewelry referansları hazır.");
    return;
  }

  const startedAt = Date.now();
  progressCompleted = 0;
  progressTotal = pendingImages;
  progressStartedAt = startedAt;
  const results = await mapWithConcurrency(pending, CONCURRENCY, (row, index) =>
    processProfile(row, index + 1, pending.length),
  );
  const failed = results.filter((result) => result?.error).length;
  const generated = results.reduce((sum, result) => sum + (result?.images || 0), 0);
  const skipped = results.reduce((sum, result) => sum + (result?.skipped || 0), 0);
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n🏁 Bitti: ${generated} görsel üretildi · ${skipped} profil atlandı · ${failed} hata · ${seconds}sn`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 1;
});
