const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabaseClient');

/**
 * 🔗 App Store ve Google Play Store linklerini getirir
 * 
 * GET /api/app-links
 * Query parameters:
 * - platform: ios | android (opsiyonel, tümü getirir)
 * - country: tr | us | global (varsayılan: tr)
 * 
 * Örnek kullanım:
 * - GET /api/app-links → Tüm aktif linkler
 * - GET /api/app-links?platform=ios → Sadece iOS linkler
 * - GET /api/app-links?platform=android&country=us → Android US linkler
 */
router.get('/', async (req, res) => {
  try {
    const { platform, country = 'tr' } = req.query;

    // Supabase sorgusu
    let query = supabase
      .from('app_links')
      .select('*')
      .eq('is_active', true)
      .order('platform')
      .order('country_code');

    // Platform filtresi
    if (platform && ['ios', 'android'].includes(platform)) {
      query = query.eq('platform', platform);
    }

    // Ülke filtresi
    if (country) {
      query = query.eq('country_code', country);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ [APP_LINKS] Supabase hatası:', error);
      return res.status(500).json({
        success: false,
        error: 'Veritabanı hatası',
        details: error.message
      });
    }

    // Eğer spesifik country bulunamazsa global'a fallback
    if (data.length === 0 && country !== 'global') {
      const fallbackQuery = supabase
        .from('app_links')
        .select('*')
        .eq('is_active', true)
        .eq('country_code', 'global')
        .order('platform');

      if (platform) {
        fallbackQuery.eq('platform', platform);
      }

      const { data: fallbackData, error: fallbackError } = await fallbackQuery;

      if (fallbackError) {
        console.error('❌ [APP_LINKS] Fallback sorgu hatası:', fallbackError);
        return res.status(500).json({
          success: false,
          error: 'Fallback sorgu hatası',
          details: fallbackError.message
        });
      }

      return res.json({
        success: true,
        data: fallbackData,
        fallback: true,
        message: `${country} ülkesi bulunamadı, global linkler döndürüldü`
      });
    }

    console.log(`✅ [APP_LINKS] ${data.length} link getirildi (platform: ${platform || 'all'}, country: ${country})`);

    res.json({
      success: true,
      data: data,
      count: data.length
    });

  } catch (error) {
    console.error('❌ [APP_LINKS] API hatası:', error);
    res.status(500).json({
      success: false,
      error: 'Sunucu hatası',
      details: error.message
    });
  }
});

/**
 * 🎯 Spesifik platform için rating linkini getirir
 * 
 * GET /api/app-links/rating/:platform
 * Path parameters:
 * - platform: ios | android
 * Query parameters:
 * - country: tr | us | global (varsayılan: tr)
 * 
 * Örnek kullanım:
 * - GET /api/app-links/rating/ios → iOS Türkiye link
 * - GET /api/app-links/rating/android?country=us → Android US link
 */
router.get('/rating/:platform', async (req, res) => {
  try {
    const { platform } = req.params;
    const { country = 'tr' } = req.query;

    // Platform validasyonu
    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz platform',
        message: 'Platform ios veya android olmalı'
      });
    }

    // Önce spesifik ülke için ara
    let { data, error } = await supabase
      .from('app_links')
      .select('*')
      .eq('platform', platform)
      .eq('country_code', country)
      .eq('is_active', true)
      .single();

    // Bulunamazsa global'a fallback
    if (error && error.code === 'PGRST116') {
      console.log(`🔄 [APP_LINKS] ${platform}-${country} bulunamadı, global'a geçiliyor...`);
      
      const fallbackResult = await supabase
        .from('app_links')
        .select('*')
        .eq('platform', platform)
        .eq('country_code', 'global')
        .eq('is_active', true)
        .single();

      data = fallbackResult.data;
      error = fallbackResult.error;

      if (data) {
        console.log(`✅ [APP_LINKS] Global ${platform} linki döndürüldü`);
        return res.json({
          success: true,
          data: data,
          fallback: true,
          message: `${country} ülkesi bulunamadı, global link döndürüldü`
        });
      }
    }

    if (error) {
      console.error('❌ [APP_LINKS] Rating link hatası:', error);
      return res.status(404).json({
        success: false,
        error: 'Link bulunamadı',
        message: `${platform} platformu için ${country} ülkesinde aktif link bulunamadı`
      });
    }

    console.log(`✅ [APP_LINKS] Rating linki getirildi: ${platform}-${country}`);

    res.json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('❌ [APP_LINKS] Rating API hatası:', error);
    res.status(500).json({
      success: false,
      error: 'Sunucu hatası',
      details: error.message
    });
  }
});

/**
 * 🛠️ App link güncelleme (Admin sadece)
 * 
 * PUT /api/app-links/:id
 * Body: { app_store_url, bundle_id, app_name, is_active }
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { app_store_url, bundle_id, app_name, is_active } = req.body;

    // ID validasyonu
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz ID'
      });
    }

    // Güncelleme objesi hazırla
    const updateData = {};
    if (app_store_url) updateData.app_store_url = app_store_url;
    if (bundle_id) updateData.bundle_id = bundle_id;
    if (app_name) updateData.app_name = app_name;
    if (typeof is_active === 'boolean') updateData.is_active = is_active;

    // Boş güncelleme kontrolü
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Güncellenecek alan bulunamadı'
      });
    }

    const { data, error } = await supabase
      .from('app_links')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('❌ [APP_LINKS] Güncelleme hatası:', error);
      return res.status(500).json({
        success: false,
        error: 'Güncelleme hatası',
        details: error.message
      });
    }

    console.log(`✅ [APP_LINKS] Link güncellendi: ID ${id}`);

    res.json({
      success: true,
      data: data,
      message: 'Link başarıyla güncellendi'
    });

  } catch (error) {
    console.error('❌ [APP_LINKS] Güncelleme API hatası:', error);
    res.status(500).json({
      success: false,
      error: 'Sunucu hatası',
      details: error.message
    });
  }
});

/**
 * ➕ Yeni app link ekleme
 * 
 * POST /api/app-links
 * Body: { platform, country_code, app_store_url, bundle_id, app_name }
 */
router.post('/', async (req, res) => {
  try {
    const { platform, country_code, app_store_url, bundle_id, app_name } = req.body;

    // Gerekli alanlar kontrolü
    if (!platform || !country_code || !app_store_url || !app_name) {
      return res.status(400).json({
        success: false,
        error: 'Eksik alan',
        message: 'platform, country_code, app_store_url ve app_name gerekli'
      });
    }

    // Platform validasyonu
    if (!['ios', 'android'].includes(platform)) {
      return res.status(400).json({
        success: false,
        error: 'Geçersiz platform',
        message: 'Platform ios veya android olmalı'
      });
    }

    const { data, error } = await supabase
      .from('app_links')
      .insert([{
        platform,
        country_code,
        app_store_url,
        bundle_id,
        app_name
      }])
      .select()
      .single();

    if (error) {
      console.error('❌ [APP_LINKS] Ekleme hatası:', error);
      return res.status(500).json({
        success: false,
        error: 'Ekleme hatası',
        details: error.message
      });
    }

    console.log(`✅ [APP_LINKS] Yeni link eklendi: ${platform}-${country_code}`);

    res.status(201).json({
      success: true,
      data: data,
      message: 'Link başarıyla eklendi'
    });

  } catch (error) {
    console.error('❌ [APP_LINKS] Ekleme API hatası:', error);
    res.status(500).json({
      success: false,
      error: 'Sunucu hatası',
      details: error.message
    });
  }
});

module.exports = router;
