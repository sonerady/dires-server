// Social Studio scheduler
// 1) Günlük planlama (her gece 00:10 TR): autopilot'u açık her hesap için o günün
//    postlarını ÜRETİR ve paylaşım penceresi içinde RASTGELE saatlere zamanlar.
//    - autopilot_mode = "approve": post pending_approval olarak üretilir; sen
//      dashboard'dan onaylayınca scheduled'a geçer ve saati gelince yayınlanır.
//    - autopilot_mode = "auto": post doğrudan scheduled üretilir, onaysız yayınlanır.
// 2) Yayınlama tiki (5 dakikada bir): scheduled_at'i gelmiş postları IG'ye basar.
const cron = require("node-cron");
const { supabaseAdmin } = require("../supabaseClient");
const {
  generatePostContent,
} = require("../utils/socialStudio/contentGenerator");
const { pickNextFeature } = require("../utils/socialStudio/featureCatalog");
const {
  publishImagePost,
  publishStoryImage,
} = require("../utils/socialStudio/igPublisher");

// Son üretimler: rotasyon (8 post) + çeşitlilik hafızası (15 post özeti).
// "Önceki gün saç paylaşıldıysa ertesi gün saç gelmez" → recentKeys;
// "geçen haftaki saç postundaki kadından farklı tarz/tema" → history.
async function getRecentPostContext(accountId, limit = 15) {
  const { data } = await supabaseAdmin
    .from("social_posts")
    .select("meta, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const posts = data || [];
  return {
    recentKeys: posts.slice(0, 8).map((p) => p.meta?.feature_key).filter(Boolean),
    history: posts
      .map((p) => {
        const day = p.created_at ? p.created_at.slice(0, 10) : "";
        return p.meta?.summary ? `[${day}] ${p.meta.summary}` : null;
      })
      .filter(Boolean),
  };
}

const TZ = "Europe/Istanbul";

function randomTimeInWindow(startHour, endHour) {
  // Bugün için pencere içinde rastgele bir zaman (dakika hassasiyetinde)
  const now = new Date();
  const start = new Date(now); start.setHours(startHour, 0, 0, 0);
  const end = new Date(now); end.setHours(endHour, 0, 0, 0);
  // Pencerenin geçmiş kısmına denk gelmesin
  const effectiveStart = Math.max(start.getTime(), now.getTime() + 10 * 60000);
  if (effectiveStart >= end.getTime()) return null; // bugünün penceresi kapandı
  const t = effectiveStart + Math.random() * (end.getTime() - effectiveStart);
  const d = new Date(t);
  d.setSeconds(0, 0);
  return d;
}

async function planDayForAccount(account) {
  // Bugün bu hesap için zaten üretilmiş post sayısı (her statü)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const { data: existing } = await supabaseAdmin
    .from("social_posts")
    .select("id")
    .eq("account_id", account.id)
    .gte("created_at", todayStart.toISOString());

  const remaining = (account.posts_per_day || 1) - (existing?.length || 0);
  if (remaining <= 0) return;

  for (let i = 0; i < remaining; i++) {
    const scheduledAt = randomTimeInWindow(
      account.post_window_start,
      account.post_window_end,
    );
    if (!scheduledAt) {
      console.log(`⏭️ [SOCIAL_CRON] ${account.name}: bugünün penceresi kapandı`);
      return;
    }

    try {
      // Rotasyon: yakın geçmişte paylaşılan özellikler hariç tutulur —
      // gün içinde location paylaşıldıysa sıradaki post BAŞKA bir özellik olur.
      const ctx = await getRecentPostContext(account.id);
      const feature = pickNextFeature(ctx.recentKeys);
      console.log(
        `🎨 [SOCIAL_CRON] ${account.name}: üretiliyor — özellik "${feature.key}" (${feature.template}) → ${scheduledAt.toLocaleTimeString("tr-TR")}`,
      );
      const content = await generatePostContent(account, feature, ctx.history);
      await supabaseAdmin.from("social_posts").insert({
        account_id: account.id,
        status:
          account.autopilot_mode === "auto" ? "scheduled" : "pending_approval",
        concept: feature.name,
        image_prompt: content.imagePrompt,
        caption: content.caption,
        image_url: content.imageUrl,
        storage_path: content.storagePath,
        story_image_url: content.storyImageUrl,
        story_storage_path: content.storyStoragePath,
        aspect_ratio: "4:5",
        scheduled_at: scheduledAt.toISOString(),
        meta: { ...content.meta, planned_by: "scheduler" },
      });
    } catch (error) {
      console.error(
        `❌ [SOCIAL_CRON] ${account.name} üretim hatası:`,
        error.message,
      );
    }
  }
}

async function planDay() {
  const { data: accounts, error } = await supabaseAdmin
    .from("social_accounts")
    .select("*")
    .eq("active", true)
    .neq("autopilot_mode", "off");
  if (error) {
    console.error("❌ [SOCIAL_CRON] planDay accounts error:", error.message);
    return;
  }
  for (const account of accounts || []) {
    await planDayForAccount(account);
  }
}

async function publishDue() {
  const { data: due, error } = await supabaseAdmin
    .from("social_posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .limit(10);
  if (error || !due?.length) return;

  for (const post of due) {
    // ATOMİK KİLİT: status hâlâ 'scheduled' ise 'publishing'e çevir.
    // Başka bir process (veya yarışan tick) önce davrandıysa satır dönmez
    // ve bu post atlanır — çift yayın imkânsız hale gelir.
    const { data: claimed } = await supabaseAdmin
      .from("social_posts")
      .update({ status: "publishing" })
      .eq("id", post.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed || claimed.length === 0) {
      console.log(`⏭️ [SOCIAL_CRON] Post ${post.id} başka süreç tarafından alınmış, atlanıyor`);
      continue;
    }

    const { data: account } = await supabaseAdmin
      .from("social_accounts")
      .select("*")
      .eq("id", post.account_id)
      .single();
    if (!account?.ig_user_id || !account?.access_token) {
      await supabaseAdmin
        .from("social_posts")
        .update({ status: "failed", error: "Account missing IG credentials" })
        .eq("id", post.id);
      continue;
    }

    try {
      const mediaId = await publishImagePost({
        igUserId: account.ig_user_id,
        accessToken: account.access_token,
        imageUrl: post.image_url,
        caption: post.caption,
      });

      // Story varyantı varsa onu da bas — story hatası feed'i düşürmez
      let storyId = null;
      let storyError = null;
      if (post.story_image_url) {
        try {
          storyId = await publishStoryImage({
            igUserId: account.ig_user_id,
            accessToken: account.access_token,
            imageUrl: post.story_image_url,
          });
        } catch (e) {
          storyError = e.message;
          console.error(`⚠️ [SOCIAL_CRON] Story hatası (feed OK):`, e.message);
        }
      }

      await supabaseAdmin
        .from("social_posts")
        .update({
          status: "published",
          published_at: new Date().toISOString(),
          ig_media_id: mediaId,
          error: null,
          meta: { ...post.meta, ig_story_id: storyId, story_error: storyError },
        })
        .eq("id", post.id);
      console.log(`📤 [SOCIAL_CRON] ${account.name}: post yayınlandı (${mediaId}${storyId ? ` + story ${storyId}` : ""})`);
    } catch (error) {
      console.error(`❌ [SOCIAL_CRON] publish hatası:`, error.message);
      await supabaseAdmin
        .from("social_posts")
        .update({ status: "failed", error: error.message })
        .eq("id", post.id);
    }
  }
}

function startSocialStudioScheduler() {
  // Gece 00:10 — günün içeriklerini üret + rastgele saatlere zamanla
  cron.schedule("10 0 * * *", planDay, { timezone: TZ });
  // Sunucu gün ortasında restart olursa eksik kalan günü tamamla
  cron.schedule("0 */3 * * *", planDay, { timezone: TZ });
  // 5 dakikada bir: zamanı gelen scheduled postları yayınla
  cron.schedule("*/5 * * * *", publishDue, { timezone: TZ });
  console.log("🗓️ [SOCIAL_CRON] Social Studio scheduler started");
}

module.exports = { startSocialStudioScheduler, planDay, publishDue };
