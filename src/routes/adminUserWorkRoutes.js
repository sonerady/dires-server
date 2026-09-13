const express = require('express');
const { optimizeForThumbnail } = require('../utils/imageOptimizer');
const SOURCES = require('./adminAnalyticsRoutes').SOURCES;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const LIMIT = 30;
const compare = (a,b) => b.created_at.localeCompare(a.created_at) || b.record_id.localeCompare(a.record_id) || b.feature.localeCompare(a.feature);
function encodeCursor(row) {
  return Buffer.from(JSON.stringify({created_at:row.created_at,record_id:row.record_id,feature:row.feature})).toString('base64url');
}
function decodeCursor(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 512) throw Error('Invalid cursor');
  const row = JSON.parse(Buffer.from(value,'base64url').toString());
  if (!UUID.test(row.record_id) || !SOURCES[row.feature] || !/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|\+00:00)$/.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at))) throw Error('Invalid cursor');
  return row;
}
function imageUrl(value) {
  if (Array.isArray(value)) return imageUrl(value[0]);
  if (value && typeof value === 'object') return imageUrl(value.url || value.image_url || value.imageUrl || value.uri);
  return typeof value === 'string' && /^https?:\/\//.test(value) ? value : null;
}
module.exports = function adminUserWorkRoutes(db) {
  const router=express.Router();
  router.get('/user-work/:userId',async(req,res)=>{
    const {userId}=req.params;
    const feature=String(req.query.feature||'');
    let cursor;
    try {if(!UUID.test(userId) || (feature && !SOURCES[feature])) throw Error();cursor=decodeCursor(req.query.cursor)} catch {return res.status(400).json({error:'Geçersiz çalışma bağlantısı.'})}
    try {
      const owner=await db.from('users').select('id,email').eq('id',userId).maybeSingle();
      if(owner.error)throw owner.error;
      if(!owner.data)return res.status(404).json({error:'Kullanıcı bulunamadı.'});
      const entries=feature?[[feature,SOURCES[feature]]]:Object.entries(SOURCES);
      const chunks=await Promise.all(entries.map(async([key,config])=>{
        const media=key==='banners'?'preview_url,image_url':key==='videos'?'original_image_url':key==='ecommerce-kits'?'kit_images':config.completedOnly?'story_images':'result_image_url';
        let q=db.from(config.table).select(`id,created_at,${media}${config.completedOnly?'':',status'}`).eq('user_id',userId);
        if(config.reference)for(const flag of ['isPoseChange','isColorChange','isBackSideCloset','isRefinerMode','isEditMode'])q=q.or(`settings->>${flag}.is.null,settings->>${flag}.neq.true`);
        if(cursor)q=q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lte.${cursor.record_id})`);
        const {data,error}=await q.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(LIMIT+2);
        if(error)throw error;
        return (data||[]).map(row=>({id:`${key}:${row.id}`,record_id:row.id,feature:key,user_id:userId,created_at:row.created_at,status:row.status||'completed',thumbnail:optimizeForThumbnail(imageUrl(row.preview_url||row.result_image_url||row.original_image_url||row.kit_images||row.story_images||row.image_url))}));
      }));
      const candidates=chunks.flat().filter(row=>!cursor || compare(row,cursor)>0).sort(compare);
      const rows=candidates.slice(0,LIMIT);
      res.set('Cache-Control','private, no-store').json({data:rows,owner:owner.data,nextCursor:candidates.length>LIMIT?encodeCursor(rows[rows.length-1]):null});
    } catch(error) {console.warn('[Admin user work]',error.code||error.name);res.status(503).json({error:'Kullanıcının çalışmaları yüklenemedi.'})}
  });
  return router;
};
module.exports.compare=compare;
module.exports.encodeCursor=encodeCursor;
module.exports.decodeCursor=decodeCursor;
