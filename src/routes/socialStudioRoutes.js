// Social Studio — admin API (requireAdmin arkasında mount edilir)
// Hesap CRUD + post kuyruğu + özellik-bazlı üretim (prompt'suz) + yayınlama
const express = require("express");
const { supabaseAdmin } = require("../supabaseClient");
const {
  generatePostContent,
  persistImage,
  callFal,
  callGemini,
} = require("../utils/socialStudio/contentGenerator");
const {
  FEATURES,
  pickNextFeature,
  getFeature,
} = require("../utils/socialStudio/featureCatalog");
const {
  publishImagePost,
  publishStoryImage,
  verifyAccount,
} = require("../utils/socialStudio/igPublisher");

const router = express.Router();

function maskAccount(row) {
  if (!row) return row;
  const { access_token, ...rest } = row;
  return { ...rest, has_token: Boolean(access_token) };
}

// Son üretimler: rotasyon için feature key'leri + çeşitlilik için kurgu özetleri
async function getRecentPostContext(accountId, limit = 15) {
  const { data } = await supabaseAdmin
    .from("social_posts")
    .select("meta, created_at")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const posts = data || [];
  return {
    // Rotasyon penceresi: son 8 postun özelliği tekrarlanmaz
    recentKeys: posts.slice(0, 8).map((p) => p.meta?.feature_key).filter(Boolean),
    // Çeşitlilik hafızası: son 15 postun kurgu özeti Gemini'ye verilir
    history: posts
      .map((p) => {
        const day = p.created_at ? p.created_at.slice(0, 10) : "";
        return p.meta?.summary ? `[${day}] ${p.meta.summary}` : null;
      })
      .filter(Boolean),
  };
}

// Feed + (varsa) story'yi yayınla; story hatası postu düşürmez
async function publishPostToInstagram(account, post) {
  const mediaId = await publishImagePost({
    igUserId: account.ig_user_id,
    accessToken: account.access_token,
    imageUrl: post.image_url,
    caption: post.caption,
  });

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
      console.error("⚠️ [SOCIAL_IG] Story publish failed (feed OK):", e.message);
    }
  }
  return { mediaId, storyId, storyError };
}

// ---------------- Özellik kataloğu ----------------
router.get("/features", (req, res) => {
  res.json({
    success: true,
    features: FEATURES.map(({ key, name, template, angle }) => ({
      key,
      name,
      template,
      angle,
    })),
  });
});

// ---------------- Genel bakış ----------------
router.get("/overview", async (req, res) => {
  try {
    const [{ data: accounts }, { data: posts }] = await Promise.all([
      supabaseAdmin.from("social_accounts").select("id,name,active"),
      supabaseAdmin
        .from("social_posts")
        .select("id,account_id,status,scheduled_at,published_at,image_url,caption,created_at")
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    const stats = {
      accounts: accounts?.length || 0,
      active_accounts: accounts?.filter((a) => a.active).length || 0,
      pending_approval: posts?.filter((p) => p.status === "pending_approval").length || 0,
      scheduled: posts?.filter((p) => p.status === "scheduled").length || 0,
      published_today:
        posts?.filter((p) => p.published_at && new Date(p.published_at) >= todayStart).length || 0,
      published_week:
        posts?.filter((p) => p.published_at && new Date(p.published_at) >= weekAgo).length || 0,
      failed: posts?.filter((p) => p.status === "failed").length || 0,
    };

    res.json({ success: true, stats, recent: posts?.slice(0, 12) || [] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------------- Hesaplar ----------------
router.get("/accounts", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, accounts: (data || []).map(maskAccount) });
});

router.post("/accounts", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .insert(req.body || {})
    .select("*")
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, account: maskAccount(data) });
});

router.patch("/accounts/:id", async (req, res) => {
  const updates = { ...(req.body || {}) };
  if (updates.access_token === "" || updates.access_token == null)
    delete updates.access_token;
  const { data, error } = await supabaseAdmin
    .from("social_accounts")
    .update(updates)
    .eq("id", req.params.id)
    .select("*")
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, account: maskAccount(data) });
});

router.delete("/accounts/:id", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("social_accounts")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

router.post("/accounts/:id/verify", async (req, res) => {
  try {
    const { data: account, error } = await supabaseAdmin
      .from("social_accounts")
      .select("ig_user_id,access_token")
      .eq("id", req.params.id)
      .single();
    if (error || !account) throw new Error("Account not found");
    const info = await verifyAccount({
      igUserId: account.ig_user_id,
      accessToken: account.access_token,
    });
    res.json({ success: true, instagram: info });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// ---------------- Postlar ----------------
router.get("/posts", async (req, res) => {
  let query = supabaseAdmin
    .from("social_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(Number(req.query.limit) || 100);
  if (req.query.account_id) query = query.eq("account_id", req.query.account_id);
  if (req.query.status) query = query.eq("status", req.query.status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, posts: data || [] });
});

// Üretim: prompt YOK — özellik rotasyonla otomatik seçilir (veya feature_key ile)
router.post("/posts/generate", async (req, res) => {
  try {
    const { account_id, feature_key, scheduled_at } = req.body || {};
    const { data: account, error } = await supabaseAdmin
      .from("social_accounts")
      .select("*")
      .eq("id", account_id)
      .single();
    if (error || !account) throw new Error("Account not found");

    const ctx = await getRecentPostContext(account_id);
    let feature = feature_key ? getFeature(feature_key) : null;
    if (!feature) {
      feature = pickNextFeature(ctx.recentKeys);
    }
    console.log(`🎯 [SOCIAL_API] Generating feature: ${feature.key} (${feature.template})`);

    const content = await generatePostContent(account, feature, ctx.history);

    const { data: post, error: insertError } = await supabaseAdmin
      .from("social_posts")
      .insert({
        account_id,
        status: "pending_approval",
        concept: feature.name,
        image_prompt: content.imagePrompt,
        caption: content.caption,
        image_url: content.imageUrl,
        storage_path: content.storagePath,
        story_image_url: content.storyImageUrl,
        story_storage_path: content.storyStoragePath,
        aspect_ratio: "4:5",
        scheduled_at: scheduled_at || null,
        meta: content.meta,
      })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    res.json({ success: true, post });
  } catch (error) {
    console.error("❌ [SOCIAL_API] generate failed:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Görseli yeniden üret (aynı kilitli prompt'la; before_after ara görsellerini korur)
router.post("/posts/:id/regenerate-image", async (req, res) => {
  try {
    const { data: post } = await supabaseAdmin
      .from("social_posts").select("*").eq("id", req.params.id).single();
    if (!post) throw new Error("Post not found");

    const isBA = post.meta?.template === "before_after";
    const imageUrls = isBA && post.meta?.intermediate
      ? [post.meta.intermediate.amateur, post.meta.intermediate.editorial]
      : null;

    const image = await callFal({
      prompt: post.image_prompt,
      imageUrls,
      aspectRatio: post.aspect_ratio || "4:5",
      resolution: "4K",
    });
    const stored = await persistImage(image.url, post.account_id);

    const { data: updated, error } = await supabaseAdmin
      .from("social_posts")
      .update({
        image_url: stored.publicUrl,
        storage_path: stored.storagePath,
        meta: { ...post.meta, image_model: image.model, regenerated: true },
      })
      .eq("id", post.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, post: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Caption'ı yeniden yazdır (özellik bilgisinden)
router.post("/posts/:id/regenerate-caption", async (req, res) => {
  try {
    const { data: post } = await supabaseAdmin
      .from("social_posts").select("*").eq("id", req.params.id).single();
    if (!post) throw new Error("Post not found");
    const { data: account } = await supabaseAdmin
      .from("social_accounts").select("*").eq("id", post.account_id).single();

    const feature = getFeature(post.meta?.feature_key) || {
      name: post.concept || "AI fashion photoshoot",
      description: "AI fashion photoshoot app feature",
    };

    const result = await callGemini(
      `You write Instagram captions for "${account.name}" (${account.brand_persona || "AI fashion photoshoot app"}).
Feature being showcased: ${feature.name} — ${feature.description}
Write a fresh caption in ${account.language || "en"}: hook first line, 2-4 short lines, subtle CTA, blank line, 8-12 hashtags.
Reply ONLY a JSON object: {"caption": "..."}`,
    );

    const { data: updated, error } = await supabaseAdmin
      .from("social_posts")
      .update({ caption: result.caption })
      .eq("id", post.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, post: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.patch("/posts/:id", async (req, res) => {
  const allowed = ["caption", "concept", "scheduled_at", "status", "image_prompt"];
  const updates = {};
  for (const key of allowed)
    if (key in (req.body || {})) updates[key] = req.body[key];
  const { data, error } = await supabaseAdmin
    .from("social_posts")
    .update(updates)
    .eq("id", req.params.id)
    .select("*")
    .single();
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, post: data });
});

router.delete("/posts/:id", async (req, res) => {
  const { data: post } = await supabaseAdmin
    .from("social_posts").select("storage_path,story_storage_path").eq("id", req.params.id).single();
  const paths = [post?.storage_path, post?.story_storage_path].filter(Boolean);
  if (paths.length) {
    await supabaseAdmin.storage.from("social-studio").remove(paths);
  }
  const { error } = await supabaseAdmin
    .from("social_posts").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

router.post("/posts/:id/publish", async (req, res) => {
  try {
    const { data: post } = await supabaseAdmin
      .from("social_posts").select("*").eq("id", req.params.id).single();
    if (!post) throw new Error("Post not found");
    // Tekrar yayınlama: kullanıcı IG'den elle sildikten sonra force ile
    // yeni bir IG postu olarak basılabilir; eski media id meta'da saklanır.
    const isRepublish = post.status === "published";
    if (isRepublish && req.body?.force !== true)
      throw new Error("Already published (tekrar yayınlamak için force gerekli)");
    const { data: account } = await supabaseAdmin
      .from("social_accounts").select("*").eq("id", post.account_id).single();
    if (!account) throw new Error("Account not found");

    await supabaseAdmin
      .from("social_posts").update({ status: "publishing" }).eq("id", post.id);

    const { mediaId, storyId, storyError } = await publishPostToInstagram(account, post);

    // Tekrar yayınlamada eski media id'leri kaybolmasın
    const previousIds = Array.isArray(post.meta?.previous_media_ids)
      ? post.meta.previous_media_ids
      : [];
    if (isRepublish && post.ig_media_id) previousIds.push(post.ig_media_id);

    const { data: updated } = await supabaseAdmin
      .from("social_posts")
      .update({
        status: "published",
        published_at: new Date().toISOString(),
        ig_media_id: mediaId,
        error: null,
        meta: {
          ...post.meta,
          ig_story_id: storyId,
          story_error: storyError,
          previous_media_ids: previousIds,
        },
      })
      .eq("id", post.id)
      .select("*")
      .single();

    res.json({ success: true, post: updated });
  } catch (error) {
    await supabaseAdmin
      .from("social_posts")
      .update({ status: "failed", error: error.message })
      .eq("id", req.params.id);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
