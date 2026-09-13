const { USER_SELECT } = require('../utils/adminUserFields');
const express = require('express');
const { ADMIN_OWNER_FIELDS, adminGenerationOwner } = require('../utils/adminGenerationOwner');
const { enrichAdminStyleReferences } = require('../utils/adminStyleReferences');
const { optimizeHistoryImages, optimizeForThumbnail } = require('../utils/imageOptimizer');
const TABLES = {
  users: 'users',
  'virtual-model': 'reference_results', refiner: 'refiner_generations',
  'pose-change': 'pose_change_generations', 'back-side': 'back_side_generations',
  'color-change': 'color_change_generations', upscale: 'upscale_generations',
  'chat-edit': 'chat_edits', variations: 'variation_generations', videos: 'video_generations',
  'ecommerce-kits': 'product_kits', 'product-stories': 'product_stories',
  'unboxing-stories': 'product_unboxing_stories', 'street-icon-kits': 'product_street_icon_kits',
  banners: 'banner_studio_results',
};

// Mounted behind the same requireAdmin guard as the generation lists.
module.exports = function adminGenerationDetailRoutes(db) {
  const router = express.Router();
  router.get('/generation-detail/:feature/:id', async (req, res) => {
    const { feature, id } = req.params;
    if (!TABLES[feature] || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'Geçersiz oluşturma bağlantısı.' });
    }
    try {
      const { data, error } = await db.from(TABLES[feature]).select(feature === 'users' ? USER_SELECT : '*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Oluşturma kaydı bulunamadı.' });
      if (feature === 'users') return res.set('Cache-Control', 'private, no-store').json({ data });
      const owner = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(data.user_id || '')
        ? await db.from('users').select(ADMIN_OWNER_FIELDS).eq('id', data.user_id).maybeSingle()
        : { data: null };
      if (owner.error) throw owner.error;
      let row = { ...data, ...adminGenerationOwner(owner.data) };
      if (feature === 'virtual-model') [row] = await enrichAdminStyleReferences(db, [row]);
      if (['virtual-model', 'refiner'].includes(feature) && row.generation_id) {
        const variations = await db.from('variation_generations')
          .select('generation_id,result_image_url,variation_index,created_at')
          .eq('user_id', row.user_id).eq('source_generation_id', row.generation_id)
          .eq('status', 'completed').not('result_image_url', 'is', null)
          .order('created_at', { ascending: true });
        if (variations.error) throw variations.error;
        row.variation_images = (variations.data || []).map(v => ({
          generation_id: v.generation_id, url: v.result_image_url,
          thumbnail_url: optimizeForThumbnail(v.result_image_url),
          variation_index: v.variation_index, created_at: v.created_at,
        }));
      }
      row.original_image_url ||= row.source_image_url;
      [row] = optimizeHistoryImages([row]);
      res.set('Cache-Control', 'private, no-store').json({ data: row });
    } catch (error) {
      console.warn('[Admin generation detail]', error.code || error.name);
      res.status(503).json({ error: 'Oluşturma ayrıntıları yüklenemedi.' });
    }
  });
  return router;
};
