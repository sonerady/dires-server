const { ADMIN_OWNER_FIELDS, adminGenerationOwner } = require('../utils/adminGenerationOwner');
const express = require('express');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 🧩 Banner galerisi (BannerGalleryScreen) — admin paneli (25 Eyl 2026, kullanıcı isteği: "kullanıcıların
// indirdiği bannerları admin'de güzelce göreyim; eski banner kısmını kaldır, yenisini oluştur").
//   GET /banner-gallery/stats        → özet sayılar + son 7 günün en çok indirilen şablonları
//   GET /banner-gallery/downloads    → banner_gallery_downloads (indir / paylaş kayıtları, JPG ya da MP4)
//   GET /banner-gallery/adaptations  → banner_studio_results'taki galeri AI uyarlamaları ("İçeriği değiştir")
// Mounted only behind the existing requireAdmin middleware.
module.exports = function createAdminBannerGalleryRoutes(db) {
  const router = express.Router();

  async function ownerFilter(search) {
    if (!search) return null;
    if (UUID.test(search) || search === 'anonymous_user') return [search];
    // exact email match — no unbounded user lists, no PostgREST filter interpolation
    const { data, error } = await db.from('users').select('id').ilike('email', search.replace(/[%_\\]/g, '\\$&'));
    if (error) throw error;
    return (data || []).map((u) => u.id);
  }

  async function withOwners(rows) {
    const ids = [...new Set(rows.map((r) => r.user_id).filter((id) => UUID.test(id)))];
    const owners = new Map();
    if (ids.length) {
      const { data, error } = await db.from('users').select(ADMIN_OWNER_FIELDS).in('id', ids);
      if (error) throw error;
      (data || []).forEach((u) => owners.set(u.id, u));
    }
    return rows.map((r) => ({ ...r, ...adminGenerationOwner(owners.get(r.user_id)) }));
  }

  const paging = (req) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(60, parseInt(req.query.limit, 10) || 30));
    return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
  };

  router.get('/banner-gallery/stats', async (req, res) => {
    try {
      const now = Date.now();
      const dayAgo = new Date(now - 864e5).toISOString();
      const weekAgo = new Date(now - 7 * 864e5).toISOString();
      const count = async (build) => {
        const { count: c, error } = await build(db.from('banner_gallery_downloads').select('id', { count: 'exact', head: true }));
        if (error) throw error;
        return c || 0;
      };
      const [total, today, week, videos] = await Promise.all([
        count((q) => q),
        count((q) => q.gte('created_at', dayAgo)),
        count((q) => q.gte('created_at', weekAgo)),
        count((q) => q.eq('format', 'video')),
      ]);
      const { count: adaptations, error: adaptError } = await db.from('banner_studio_results')
        .select('id', { count: 'exact', head: true }).eq('banner_type', 'template');
      if (adaptError) throw adaptError;
      const { data: recent, error } = await db.from('banner_gallery_downloads')
        .select('template_id,template_name,category,format,user_id').gte('created_at', weekAgo).limit(5000);
      if (error) throw error;
      const byTemplate = new Map();
      const users = new Set();
      (recent || []).forEach((r) => {
        users.add(r.user_id);
        const t = byTemplate.get(r.template_id) || { template_id: r.template_id, template_name: r.template_name, category: r.category, downloads: 0, videos: 0 };
        t.downloads += 1;
        if (r.format === 'video') t.videos += 1;
        byTemplate.set(r.template_id, t);
      });
      const topTemplates = [...byTemplate.values()].sort((a, b) => b.downloads - a.downloads).slice(0, 8);
      res.json({ success: true, stats: { total, today, week, videos, images: total - videos, adaptations: adaptations || 0, weekUsers: users.size, topTemplates } });
    } catch (error) {
      console.error('[Admin/BannerGallery] stats', error.message);
      res.status(500).json({ success: false, error: 'Failed to load banner stats' });
    }
  });

  router.get('/banner-gallery/downloads', async (req, res) => {
    try {
      const { page, limit, from, to } = paging(req);
      const search = String(req.query.search || '').trim().slice(0, 254);
      const format = ['image', 'video'].includes(req.query.format) ? req.query.format : null;
      const ownerIds = await ownerFilter(search);
      if (ownerIds && !ownerIds.length) return res.json({ success: true, data: [], total: 0, page, totalPages: 1 });
      let query = db.from('banner_gallery_downloads')
        .select('id,user_id,template_id,template_name,category,format,action,mode,result_id,file_url,ratio_value,language,is_sample_photo,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(from, to);
      if (ownerIds) query = query.in('user_id', ownerIds);
      if (format) query = query.eq('format', format);
      if (req.query.template) query = query.eq('template_id', String(req.query.template).slice(0, 80));
      const { data, count, error } = await query;
      if (error) throw error;
      res.json({ success: true, data: await withOwners(data || []), total: count || 0, page, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) });
    } catch (error) {
      console.error('[Admin/BannerGallery] downloads', error.message);
      res.status(500).json({ success: false, error: 'Failed to load banner downloads' });
    }
  });

  router.get('/banner-gallery/adaptations', async (req, res) => {
    try {
      const { page, limit, from, to } = paging(req);
      const search = String(req.query.search || '').trim().slice(0, 254);
      const ownerIds = await ownerFilter(search);
      if (ownerIds && !ownerIds.length) return res.json({ success: true, data: [], total: 0, page, totalPages: 1 });
      let query = db.from('banner_studio_results')
        .select('id,user_id,image_url,preview_url,video_url,options,processing_time_seconds,created_at', { count: 'exact' })
        .eq('banner_type', 'template')
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(from, to);
      if (ownerIds) query = query.in('user_id', ownerIds);
      const { data, count, error } = await query;
      if (error) throw error;
      res.json({ success: true, data: await withOwners(data || []), total: count || 0, page, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) });
    } catch (error) {
      console.error('[Admin/BannerGallery] adaptations', error.message);
      res.status(500).json({ success: false, error: 'Failed to load banner adaptations' });
    }
  });

  return router;
};
