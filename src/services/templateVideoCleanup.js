// 🧹 Banner şablon videoları 1 gün sonra silinir (29 Eyl 2026, kullanıcı isteği). Galeride "hareketli indir/paylaş"
// ile üretilen MP4'ler `images/bannerStudio/templateVideos/` altında birikiyordu; Supabase deposunun kendi TTL'i yok.
// Saatte bir tarama: son yazılışı (updated_at, yoksa created_at) 24 saatten eski dosyalar toplu silinir.
// Aynı istek tekrar gelirse /template-video dosyayı yeniden üretir (bannerStudioRoutes: tazelik kontrolü).
const BUCKET = "images";
const PREFIX = "bannerStudio/templateVideos";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
const REMOVE_BATCH = 100;

async function cleanupTemplateVideos(db, { now = Date.now(), maxAgeMs = MAX_AGE_MS, logger = console } = {}) {
  const storage = db.storage.from(BUCKET);
  const stale = [];
  for (let offset = 0; ; offset += PAGE) {
    // ⚠️ sortBy verme: dev "images" kovasında tarihe göre sıralı listeleme zaman aşımına düşüyor (544); ad sırası hızlı
    const { data, error } = await storage.list(PREFIX, { limit: PAGE, offset });
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      if (!row?.id || !row.name) continue; // klasör satırı
      const at = Date.parse(row.updated_at || row.created_at || "");
      if (Number.isFinite(at) && now - at >= maxAgeMs) stale.push(`${PREFIX}/${row.name}`);
    }
    if (rows.length < PAGE) break;
  }
  let removed = 0;
  for (let i = 0; i < stale.length; i += REMOVE_BATCH) {
    const batch = stale.slice(i, i + REMOVE_BATCH);
    const { error } = await storage.remove(batch);
    if (error) { logger.error("[template-video-cleanup] remove failed", error.message); continue; }
    removed += batch.length;
  }
  if (removed) logger.log(`🧹 [template-video-cleanup] ${removed} eski şablon videosu silindi`);
  return { stale: stale.length, removed };
}

function startTemplateVideoCleanup(db, { intervalMs = 60 * 60 * 1000, logger = console } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await cleanupTemplateVideos(db, { logger }); }
    catch (error) { logger.error("[template-video-cleanup] sweep failed", error?.message); }
    finally { running = false; }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = { cleanupTemplateVideos, startTemplateVideoCleanup, TEMPLATE_VIDEO_MAX_AGE_MS: MAX_AGE_MS, TEMPLATE_VIDEO_PREFIX: PREFIX };
