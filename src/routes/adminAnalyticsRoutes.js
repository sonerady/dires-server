const express = require('express');
const { optimizeForThumbnail } = require('../utils/imageOptimizer');
const SOURCES = {
 'virtual-model': { table:'reference_results', reference:true },
 refiner: {table:'refiner_generations'},
 'pose-change': {table:'pose_change_generations'},
 'back-side': {table:'back_side_generations'},
 'color-change': {table:'color_change_generations'},
 variations: {table:'variation_generations'},
 upscale: {table:'upscale_generations'},
 'chat-edit': {table:'chat_edits'},
 videos: {table:'video_generations'},
 'ecommerce-kits': {table:'product_kits', completedOnly:true},
 'product-stories': {table:'product_stories', completedOnly:true},
 'unboxing-stories': {table:'product_unboxing_stories', completedOnly:true},
 'street-icon-kits': {table:'product_street_icon_kits', completedOnly:true},
 banners: {table:'banner_studio_results', completedOnly:true},
};
const ACTIVE=['pending','queued','starting','processing','running','in_progress'];
function sourceQuery(db,feature,select,options) {
 const config=SOURCES[feature];
 let q=db.from(config.table).select(select,options);
 if(config.reference) {
  for(const flag of ['isPoseChange','isColorChange','isBackSideCloset','isRefinerMode','isEditMode']) q=q.or(`settings->>${flag}.is.null,settings->>${flag}.neq.true`);
 }
 return q;
}
function period(query,now=new Date()) {
 if(query.from || query.to) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(query.from||'') || !/^\d{4}-\d{2}-\d{2}$/.test(query.to||'')) throw Error('Use YYYY-MM-DD dates');
  const from=new Date(query.from+'T00:00:00Z'),to=new Date(query.to+'T00:00:00Z');
  if(!Number.isFinite(+from)||!Number.isFinite(+to)||from.toISOString().slice(0,10)!==query.from||to.toISOString().slice(0,10)!==query.to) throw Error('Use valid calendar dates');
  to.setUTCDate(to.getUTCDate()+1);
  if(!Number.isFinite(+from)||!Number.isFinite(+to)||to<=from||to-from>90*86400000) throw Error('Choose 1–90 days');
  return {from:from.toISOString(),to:to.toISOString()};
 }
 const days=Number(query.days||30);
 if(![7,30,90].includes(days)) throw Error('Choose 7, 30 or 90 days');
 const to=new Date(now);to.setUTCDate(to.getUTCDate()+1);to.setUTCHours(0,0,0,0);
 return {from:new Date(+to-days*86400000).toISOString(),to:to.toISOString()};
}
module.exports=function createAdminAnalyticsRouter(db) {
 const router=express.Router(),cache=new Map(),pending=new Map();
 async function memo(key,ttl,work) {
  const cached=cache.get(key);if(cached&&cached.until>Date.now()) return cached.data;
  if(pending.has(key)) return pending.get(key);
  const promise=work().then(data=>{if(cache.size>24)cache.delete(cache.keys().next().value);cache.set(key,{until:Date.now()+ttl,data});return data}).finally(()=>pending.delete(key));
  pending.set(key,promise);return promise;
 }
 router.get('/analytics',async(req,res)=>{
  let dates;try{dates=period(req.query)}catch(e){return res.status(400).json({error:e.message})}
  try {
   const data=await memo('analytics:'+dates.from+dates.to,300000,async()=>{
    const {data,error}=await db.rpc('admin_analytics_report',{p_from:dates.from,p_to:dates.to});if(error)throw error;
    for(const key of ['locations','models'])for(const item of data[key]||[])if(item.image)item.image=optimizeForThumbnail(item.image);
    return data;
   });res.set('Cache-Control','private, no-store').json(data);
  }catch(e){console.error('[Admin analytics]',e.code||e.name);res.status(503).json({error:'Analytics could not be loaded. Try a shorter date range or retry.'})}
 });
 router.get('/variation-usage',async(req,res)=>{
  let dates;try{dates=period(req.query)}catch(e){return res.status(400).json({error:e.message})}
  try{const data=await memo('variation-usage:'+dates.from+dates.to,10000,async()=>{
   const {data,error}=await db.rpc('admin_variation_usage',{p_from:dates.from,p_to:dates.to});if(error)throw error;return data;
  });res.set('Cache-Control','private, no-store').json(data)}catch(e){console.error('[Admin variation usage]',e.code||e.name);res.status(503).json({error:'Variation usage unavailable'})}
 });
 router.get('/activity/:feature',async(req,res)=>{
  const feature=req.params.feature,source=SOURCES[feature];if(!source)return res.status(400).json({error:'Unknown feature'});
  try {
   const result=await memo('activity:'+feature,10000,async()=>{
    if(source.completedOnly)return {tracked:false,pending:null,processing:null,stale:null,updatedAt:new Date().toISOString()};
    // Exact full status counts: old unfinished jobs are reported separately, never silently hidden.
    const counts=await Promise.all([
     sourceQuery(db,feature,'id',{count:'exact',head:true}).in('status',['pending','queued','starting']),
     sourceQuery(db,feature,'id',{count:'exact',head:true}).in('status',['processing','running','in_progress']),
     sourceQuery(db,feature,'id',{count:'exact',head:true}).in('status',ACTIVE).lt('created_at',new Date(Date.now()-3600000).toISOString()),
    ]);for(const r of counts)if(r.error)throw r.error;
    return {tracked:true,pending:counts[0].count,processing:counts[1].count,stale:counts[2].count,updatedAt:new Date().toISOString()};
   });res.set('Cache-Control','private, no-store').json(result);
  }catch(e){console.error('[Admin activity]',e.code||e.name);res.status(503).json({error:'Activity temporarily unavailable'})}
 });
 router.get('/operations/:feature',async(req,res)=>{
  const feature=req.params.feature;if(!['pose-change','back-side','upscale','chat-edit','variations'].includes(feature))return res.status(400).json({error:'Unknown feature'});
  const page=Number(req.query.page||1),status=String(req.query.status||'');
  if(!Number.isInteger(page)||page<1||page>100000|| (status&&!['completed','succeeded','failed',...ACTIVE].includes(status)))return res.status(400).json({error:'Invalid page or status'});
  try {
   let q=sourceQuery(db,feature,'*',{count:'exact'}).order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*30,page*30-1);
   if(status)q=q.eq('status',status);
   if(req.query.user_id)q=q.eq('user_id',String(req.query.user_id));
   const {data,error,count}=await q;if(error)throw error;
   const ids=[...new Set(data.map(r=>r.user_id).filter(x=>/^[0-9a-f-]{36}$/i.test(x)))];
   const owners=ids.length?await db.from('users').select('id,email').in('id',ids):{data:[]};if(owners.error)throw owners.error;
   const emails=new Map(owners.data.map(u=>[u.id,u.email]));
   res.json({data:data.map(r=>({...r,user_email:emails.get(r.user_id)||null,original_image_url:r.original_image_url||r.source_image_url,thumbnail: r.result_image_url?optimizeForThumbnail(r.result_image_url):null})),total:count,totalPages:Math.max(1,Math.ceil(count/30))});
  }catch(e){console.error('[Admin operations]',e.code||e.name);res.status(503).json({error:'Operations could not be loaded'})}
 });
 return router;
};
module.exports.period=period;
module.exports.SOURCES=SOURCES;
