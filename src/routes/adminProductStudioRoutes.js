const express=require('express'),multer=require('multer'),sharp=require('sharp');
const {randomUUID}=require('node:crypto');
const {supabaseAdmin:db}=require('../supabaseClient');
const {normalizeDraft,UUID,SEED}=require('../utils/productStudioCatalog');
const router=express.Router(),TABLE='product_studio_catalog';
const check=r=>{if(r.error)throw r.error;return r.data;};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const {askAstra}=require('../utils/menuStudioAstra');
const {briefPrompt,parseBrief,validateInput,toolHue}=require('../utils/customStudioBrief');
const ideaUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:6,fields:3,fieldSize:6000}});
const aiLimiter=require('express-rate-limit').rateLimit({windowMs:60000,limit:6,standardHeaders:true,legacyHeaders:false});
function aiJob(row){return {id:row.id,status:row.status,error:row.error_code,completedPairs:(row.accepted_examples||[]).length,draft:{version:1,title:row.title,description:row.brief,language:row.language,buttonHue:row.button_hue,translations:{},screen:row.screen_schema,beforeUrl:row.before_url||'',afterUrl:row.after_url||'',introExamples:row.intro_examples||[]}};}
async function readAiJob(id){
 if(!UUID.test(id))throw Error('invalid_input');
 const row=check(await db.from('custom_studio_tools').select('*').eq('id',id).is('user_id',null).is('deleted_at',null).eq('source_url','admin-studio-design').single());
 return row;
}
router.post('/product-studio/design',aiLimiter,ideaUpload.array('photos',6),wrap(async(req,res)=>{
 const input=validateInput({...req.body,requestKey:randomUUID()}),id=randomUUID();
 // Uploaded references explain the feature; never silently turn them into cover assets.
 const buffers=await Promise.all((req.files||[]).map(f=>sharp(f.buffer,{limitInputPixels:40000000}).rotate().resize(1440,1440,{fit:'inside',withoutEnlargement:true}).webp({quality:88}).toBuffer()));
 const images=[];
 for(let i=0;i<buffers.length;i++){const key=`product-studio-admin/${id}/reference-${i}.webp`;check(await db.storage.from('reference').upload(key,buffers[i],{contentType:'image/webp',upsert:false}));images.push(db.storage.from('reference').getPublicUrl(key).data.publicUrl);}
 const brief=parseBrief(await askAstra({model:'openai/gpt-6-astra',maxRetries:1,timeoutMs:180000,tag:'ADMIN_CUSTOM_TOOL_DESIGN',prompt:briefPrompt(input),systemPrompt:'Return only strict JSON matching the requested schema. Reference photos explain the intended tool, never use them as its example products.',imageUrls:images,maxTokens:6500}));
 const row=check(await db.from('custom_studio_tools').insert({...input,id,user_id:null,source_url:'admin-studio-design',reference_urls:images,status:'completed',title:brief.title,brief:brief.brief,screen_schema:brief.screen,example_plan:brief.examples,button_hue:toolHue({id,description:input.description})}).select('*').single());
 res.json({success:true,job:aiJob(row)});
}));
router.get('/product-studio/ai-jobs/:id',wrap(async(req,res)=>{res.set('Cache-Control','no-store').json({success:true,job:aiJob(await readAiJob(req.params.id))});}));
router.post('/product-studio/ai-jobs/:id/images',aiLimiter,wrap(async(req,res)=>{
 const row=await readAiJob(req.params.id);
 if(!['queued','processing'].includes(row.status)&&(row.accepted_examples||[]).length<4){
  check(await db.from('custom_studio_tools').update({status:'queued',error_code:null,attempts:0,updated_at:new Date().toISOString()}).eq('id',row.id).eq('status',row.status));
 }
 res.status(202).json({success:true,job:aiJob(await readAiJob(row.id))});
}));
router.get('/product-studio',wrap(async(req,res)=>{res.json({success:true,items:check(await db.from(TABLE).select('*').order('position').order('id'))});}));
router.post('/product-studio/import',wrap(async(req,res)=>{
 // Explicit one-time import, safe to repeat without overwriting edits.
 check(await db.from(TABLE).upsert(SEED.map(x=>({...x,published:x.draft,enabled:true})),{onConflict:'builtin_id',ignoreDuplicates:true}));res.json({success:true});
}));
router.post('/product-studio/reorder',wrap(async(req,res)=>{const ids=req.body.ids;if(!Array.isArray(ids)||ids.some(id=>!UUID.test(id)))throw Error('invalid_order');check(await db.rpc('reorder_product_studio',{p_ids:ids}));res.json({success:true});}));
router.post('/product-studio/image',upload.single('image'),wrap(async(req,res)=>{
 if(!req.file)throw Error('invalid_image');const bytes=await sharp(req.file.buffer,{limitInputPixels:40000000}).rotate().resize(720,1280,{fit:'cover'}).webp({quality:88}).toBuffer();const key=`product-studio-admin/${randomUUID()}.webp`;
 check(await db.storage.from('reference').upload(key,bytes,{contentType:'image/webp',cacheControl:'31536000',upsert:false}));res.json({success:true,url:db.storage.from('reference').getPublicUrl(key).data.publicUrl});
}));
router.post('/product-studio',wrap(async(req,res)=>{
 const draft=normalizeDraft(req.body.draft);const last=check(await db.from(TABLE).select('position').order('position',{ascending:false}).limit(1));
 res.json({success:true,item:check(await db.from(TABLE).insert({draft,position:(last[0]?.position??-1)+1}).select('*').single())});
}));
router.put('/product-studio/:id',wrap(async(req,res)=>{
 if(!UUID.test(req.params.id))throw Error('invalid_input');const old=check(await db.from(TABLE).select('*').eq('id',req.params.id).single());
 const draft=normalizeDraft(req.body.draft,{builtinId:old.builtin_id});const row=check(await db.from(TABLE).update({draft,revision:old.revision+1,updated_at:new Date().toISOString()}).eq('id',old.id).eq('revision',req.body.revision).select('*').maybeSingle());
 if(!row)return res.status(409).json({error:'Başka bir düzenleme var. Listeyi yenileyin.'});res.json({success:true,item:row});
}));
router.post('/product-studio/:id/publish',wrap(async(req,res)=>{
 const row=check(await db.from(TABLE).select('*').eq('id',req.params.id).single());normalizeDraft(row.draft,{builtinId:row.builtin_id,publish:true});
 res.json({success:true,item:check(await db.rpc('publish_product_studio',{p_id:row.id,p_revision:req.body.revision}))});
}));
router.post('/product-studio/:id/hide',wrap(async(req,res)=>{const row=check(await db.from(TABLE).update({enabled:false}).eq('id',req.params.id).select('*').single());res.json({success:true,item:row});}));
router.use((e,req,res,next)=>{console.warn('[admin-product-studio]',e.message);res.status(/conflict/.test(e.message)?409:400).json({success:false,error:e.message==='publish_incomplete'?'Yayınlamak için kapak çifti, 3 örnek çifti ve araç talimatı gerekir.':/invalid/.test(e.message)?'Alanları, görselleri ve seçenekleri kontrol edin.':e.message==='revision_conflict'?'Taslak değişti. Yenileyip tekrar deneyin.':'İşlem tamamlanamadı.'});});
module.exports=router;
