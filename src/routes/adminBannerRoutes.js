const express = require('express');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mounted only behind the existing requireAdmin middleware.
module.exports = function createAdminBannerRoutes(db) {
  const router = express.Router();
  router.get('/banners', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, Math.min(60, parseInt(req.query.limit, 10) || 30));
      const search = String(req.query.search || '').trim().slice(0, 254);
      let ownerIds = null;
      if (search) {
        if (UUID.test(search) || search === 'anonymous_user') ownerIds = [search];
        else {
          // Exact email search avoids unbounded user lists and PostgREST filter interpolation.
          const { data, error } = await db.from('users').select('id').ilike('email', search.replace(/[%_\\]/g, '\\$&'));
          if (error) throw error;
          ownerIds = (data || []).map(u => u.id);
        }
      }
      if (ownerIds && !ownerIds.length) return res.json({ success: true, data: [], total: 0, page, totalPages: 1 });
      let query = db.from('banner_studio_results')
        .select('id,user_id,image_url,preview_url,html,video_url,banner_type,ratio,options,credits_used,processing_time_seconds,created_at', { count: 'exact' })
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);
      if (ownerIds) query = query.in('user_id', ownerIds);
      const { data, count, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const ids = [...new Set(rows.map(r => r.user_id).filter(id => UUID.test(id)))];
      const owners = new Map();
      if (ids.length) {
        const { data: users, error: userError } = await db.from('users').select('id,email').in('id', ids);
        if (userError) throw userError;
        (users || []).forEach(u => owners.set(u.id, u.email));
      }
      res.json({ success: true, data: rows.map(r => ({ ...r, user_email: owners.get(r.user_id) || null })), total: count || 0, page, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) });
    } catch (error) {
      console.error('[Admin/Banners]', error.message);
      res.status(500).json({ success: false, error: 'Failed to load banners' });
    }
  });
  return router;
};
