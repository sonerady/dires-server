const {accessibleTool}=require('../utils/productStudioCatalog');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const axios = require('axios');
const {randomUUID} = require('node:crypto');
const {rateLimit} = require('express-rate-limit');
const {supabaseAdmin:db} = require('../supabaseClient');
const {refundIdentity} = require('../middleware/refundIdentity');
const {askAstra,parseJsonLoose} = require('../utils/menuStudioAstra');
const {GPT25_EDIT_MODEL,buildEditInput} = require('../utils/gpt25Edit');
const {validateInput,briefPrompt,parseBrief,publicTool,toolHue} = require('../utils/customStudioBrief');
const {issueReview,readReview,reviewTool} = require('../utils/customToolReview');
const router = express.Router();
const TABLE='custom_studio_tools', BUCKET='user_image_results';
const check = result => {if(result.error) throw result.error; return result.data;};
const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use((req,res,next)=>db?next():res.status(503).json({success:false,reason:'unavailable'}));
router.use(rateLimit({windowMs:60000,limit:40,standardHeaders:true,legacyHeaders:false}));
// Verify identity before accepting binary data; userId lives in the query for multipart requests.
router.use((req,res,next)=>refundIdentity(db)(req,res,next));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:6,fields:8,fieldSize:24000}});
async function saveImage(buffer,owner,id,kind) {
 const webp=await sharp(buffer,{limitInputPixels:40000000}).rotate().resize(720,1280,{fit:'contain',background:'#f8f8f8'}).webp({quality:90}).toBuffer();
 const path=`${owner}/custom-tools/${id}/${kind}-${randomUUID()}.webp`;
 check(await db.storage.from(BUCKET).upload(path,webp,{contentType:'image/webp',cacheControl:'31536000',upsert:false}));
 return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
// Örnek fotoğrafların rolleri (22 Eyl 2026): istemci `roles`'u fotoğraflarla
// AYNI sırada gönderir. Biçim bozuksa rolsüz devam ediyoruz — etiket bir
// ipucu, doğrulama değil; hiçbir zaman isteği reddetmemeli.
function parseRoles(raw,count) {
 if(typeof raw!=='string'||!raw||!count)return [];
 let list;try{list=JSON.parse(raw);}catch{return [];}
 if(!Array.isArray(list)||list.length!==count)return [];
 return list.every(value=>typeof value==='string'&&/^[1-6]:(before|after)$/.test(value))?list:[];
}
async function render(prompt,source) {
 const model=source?GPT25_EDIT_MODEL:'openai/gpt-image-2.5/sunburst/text-to-image';
 const input=source?buildEditInput(model,{prompt,image_urls:[source],aspect_ratio:'9:16',quality:'high'}):{prompt,image_size:{width:1440,height:2560},quality:'high',num_images:1,output_format:'png'};
 const response=await axios.post(`https://fal.run/${model}`,input,{headers:{Authorization:`Key ${process.env.FAL_API_KEY || process.env.FAL_KEY}`},timeout:300000});
 const url=response.data?.images?.[0]?.url;
 if(!url)throw new Error('generation_failed');
 // Only provider-produced URLs are fetched, never arbitrary client URLs.
 const image=await axios.get(url,{responseType:'arraybuffer',timeout:60000,maxContentLength:30*1024*1024});
 return Buffer.from(image.data);
}
const astra=options=>askAstra({model:'openai/gpt-6-astra',maxRetries:1,timeoutMs:180000,tag:'CUSTOM_TOOL',...options});
// ⚡ Öncelik: KART GÖRSELİ (22 Eyl 2026, kullanıcı isteği). Eskiden dört örnek
// sırayla üretiliyor ve kapak çifti ancak QA'dan sonra yazılıyordu; kart
// dakikalarca boş bir yükleniyor kutusu olarak duruyordu. Şimdi:
//   1. brief gelir gelmez YALNIZ 0. örnek üretiliyor (kapak), başka hiçbir iş
//      onunla yarışmıyor,
//   2. iki karesi hazır olur olmaz QA BEKLENMEDEN karta yazılıyor — kullanıcı
//      görseli hemen görüyor; QA reddederse yeni çift aynı alanların üstüne
//      yazılıyor,
//   3. tanıtım örnekleri ondan sonra PARALEL üretiliyor ve her biri onaylandığı
//      anda satıra ekleniyor; hiçbiri diğerinin bitmesini beklemiyor.
const INTRO_CONCURRENCY=3;
async function processTool(row) {
 // Durable checkpoints and a heartbeat let restarts resume missing examples safely.
 const heartbeat=setInterval(()=>{db.from(TABLE).update({updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null).eq('status','processing').then(()=>{});},30000);
 heartbeat.unref();
 // Paralel örnekler aynı satıra yazıyor: yazmalar tek sıraya diziliyor ki
 // accepted_examples birbirinin üstünü ezmesin.
 let queue=Promise.resolve();
 const write=changes=>{
  const run=queue.then(()=>db.from(TABLE).update({...changes,updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null));
  queue=run.then(()=>{},()=>{});
  return run.then(check);
 };
 const alive=async()=>!!check(await db.from(TABLE).select('id').eq('id',row.id).is('deleted_at',null).maybeSingle());
 try {
  let plan=row.example_plan;
  if(!plan){
   const brief=parseBrief(await astra({prompt:briefPrompt(row),systemPrompt:'Return only strict JSON. Follow the schema. Uploaded images explain the user need; they are not products for generated examples.',imageUrls:row.reference_urls?.length?row.reference_urls:row.source_url?[row.source_url]:[],maxTokens:6500,tag:'CUSTOM_TOOL_DESIGN'}));
   plan=brief.examples;
   await write({title:brief.title,brief:brief.brief,screen_schema:brief.screen,translations:{[row.language]:{title:brief.title,description:brief.brief}},example_plan:plan});
  }
  const accepted=[...(row.accepted_examples||[])];
  const intros=()=>accepted.filter(e=>e.index>0).sort((a,b)=>a.index-b.index);
  const produce=async(i,onPublish)=>{
   if(accepted.some(e=>e.index===i))return;
   let feedback='',sample;
   for(let attempt=0;attempt<2;attempt++){
    if(!await alive())return;
    const before=await saveImage(await render(plan[i].before+' Portrait 9:16. One clean bright amateur seller photo. No collage, UI, captions, dark or dirty environment.'+(feedback?' Correct previous issues: '+feedback:'')),row.user_id,row.id,`example-${i}-before`);
    const after=await saveImage(await render(plan[i].after+' Preserve exactly the reference product. Demonstrate the tool through a distinct environment and commercial composition. Vivid, professional ecommerce photograph, portrait9:16. No collage or captions.'+(feedback?' Correct previous issues: '+feedback:''),before),row.user_id,row.id,`example-${i}-after`);
    // Kapak çifti QA'dan önce yayınlanıyor: kart boş kalmasın.
    if(i===0){await write({before_url:before,after_url:after});onPublish?.();}
    const review=parseJsonLoose(await astra({prompt:`Review these two photos as BEFORE (image1) and AFTER (image2) for this product photography tool: ${JSON.stringify(row.description)}. Sample product: ${JSON.stringify(plan[i].product)}. Does the pair accurately and obviously demonstrate the tool? Is the same product preserved, with a visibly transformed appropriate professional ecommerce setting in AFTER? BEFORE must be clean, bright, plausibly amateur; AFTER commercially polished and vibrant. Reject irrelevant photos, unintended product changes, same-scene-only retouch when the tool needs a new setting, malformed objects, collages, captions or bad anatomy. Return strict JSON {"approved":boolean,"feedback":"specific corrections if rejected"}.`,imageUrls:[before,after],maxTokens:1000,tag:'CUSTOM_TOOL_EXAMPLE_QA'}));
    if(review?.approved===true){sample={index:i,product:plan[i].product,beforeUrl:before,afterUrl:after};break;}
    feedback=String(review?.feedback||'Make the intended transformation obvious and preserve the product.').slice(0,2000);
   }
   if(!sample)throw new Error('example_quality_failed');
   accepted.push(sample);
   await write(i===0
    ?{accepted_examples:[...accepted],before_url:sample.beforeUrl,after_url:sample.afterUrl}
    :{accepted_examples:[...accepted],intro_examples:intros()});
  };
  // Kapak işi başlıyor; tanıtım örnekleri onun QA'sını değil, kartta görselin
  // BELİRMESİNİ bekliyor.
  let published;
  const shown=new Promise(resolve=>{published=resolve;});
  const cover=produce(0,published);
  await Promise.race([shown,cover]);
  if(!await alive())return;
  // Kalan örnekler paralel; biri patlasa bile diğerlerinin tamamlananları
  // kaydedilsin diye allSettled, ilk hata sonra fırlatılıyor.
  const pending=[1,2,3].filter(i=>!accepted.some(e=>e.index===i));
  const lane=async()=>{while(pending.length)await produce(pending.shift());};
  const results=await Promise.allSettled([cover,...Array.from({length:Math.min(INTRO_CONCURRENCY,pending.length)},lane)]);
  const failed=results.find(result=>result.status==='rejected');
  if(failed)throw failed.reason;
  check(await db.from(TABLE).update({status:'completed',intro_examples:intros(),error_code:null,updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null).eq('status','processing'));
 } catch(error) {
  console.warn('[custom-studio] generation failed',row.id,error.message);
  await db.from(TABLE).update({status:'failed',error_code:['unsupported_request','example_quality_failed'].includes(error.message)?error.message:'generation_failed',updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null).eq('status','processing');
 }finally{clearInterval(heartbeat);}
}
// Yeni araç sıra beklemiyor: tick artık işi BAŞLATIP dönüyor, bitmesini
// beklemiyordu diye yeni istek 10 sn'lik turu (ve önündeki aracın dakikalarını)
// beklemek zorunda kalmıyor.
const MAX_ACTIVE=2;
const active=new Set();
function start(row) {
 if(active.has(row.id))return;
 active.add(row.id);
 processTool(row).catch(error=>console.warn('[custom-studio] worker job:',error.message)).finally(()=>active.delete(row.id));
}
let running=false;
async function tick() {
 if(running||!db)return;
 running=true;
 try {
  // Interrupted jobs terminate visibly instead of leaving a permanent spinner or charging twice.
  check(await db.from(TABLE).update({status:'queued',error_code:null}).eq('status','processing').lt('attempts',3).lt('updated_at',new Date(Date.now()-15*60000).toISOString()));
  check(await db.from(TABLE).update({status:'failed',error_code:'interrupted'}).eq('status','processing').gte('attempts',3).lt('updated_at',new Date(Date.now()-15*60000).toISOString()));
  const free=MAX_ACTIVE-active.size;
  if(free>0){
   const rows=check(await db.from(TABLE).select('*').eq('status','queued').order('created_at').limit(free));
   for(const row of rows){
    const claimed=check(await db.from(TABLE).update({status:'processing',attempts:(row.attempts||0)+1,updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null).eq('status','queued').select('*').maybeSingle());
    if(claimed)start(claimed);
   }
  }
 }catch(error){console.warn('[custom-studio] worker:',error.message);}finally{running=false;}
}
if(db&&process.env.NODE_ENV!=='test'){const timer=setInterval(tick,10000);timer.unref();}
router.get('/',wrap(async(req,res)=>{
 const rows=check(await db.from(TABLE).select('*').eq('user_id',req.refundUserId).is('deleted_at',null).order('created_at',{ascending:false}).limit(50));
 res.set('Cache-Control','no-store').json({success:true,items:rows.map(row=>publicTool(row,req.query.language))});
}));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
router.get('/:id',wrap(async(req,res)=>{
 if(!UUID.test(req.params.id))return res.status(400).json({success:false,reason:'invalid_input'});
 const row=await accessibleTool(db,req.params.id,req.refundUserId);
 if(!row)return res.status(404).json({success:false,reason:'tool_not_ready'});
 res.json({success:true,item:{...publicTool(row,req.query.language),managed:row.catalogManaged===true}});
}));
const editFields=['cardBefore','cardAfter','intro1Before','intro1After','intro2Before','intro2After','intro3Before','intro3After'];
const editUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:8,fields:2,fieldSize:500}});
router.patch('/:id',editUpload.fields(editFields.map(name=>({name,maxCount:1}))),wrap(async(req,res)=>{
 if(!UUID.test(req.params.id))return res.status(400).json({success:false,reason:'invalid_input'});
 const row=check(await db.from(TABLE).select('*').eq('id',req.params.id).eq('user_id',req.refundUserId).is('deleted_at',null).maybeSingle());
 if(!row)return res.status(404).json({success:false,reason:'tool_not_found'});
 if(['queued','processing'].includes(row.status))return res.status(409).json({success:false,reason:'tool_busy'});
 const title=typeof req.body.title==='string'?req.body.title.trim():row.title;
 if(!title||title.length>70)return res.status(400).json({success:false,reason:'invalid_input'});
 const intro=(row.intro_examples||[]).map(e=>({...e})),accepted=(row.accepted_examples||[]).map(e=>({...e}));
 const requested=String(req.query.language||row.language).toLowerCase();
 const locale=Object.hasOwn(row.translations||{},requested)?requested:Object.hasOwn(row.translations||{},requested.split('-')[0])?requested.split('-')[0]:row.language;
 const translations={...(row.translations||{}),[locale]:{...row.translations?.[locale],title}};
 const changes={...(locale===row.language?{title}:{}),translations,updated_at:new Date().toISOString()};
 // Validate all images before uploading any of them.
 try{for(const [name,files] of Object.entries(req.files||{})){
  if(name.startsWith('intro')&&!intro[Number(name[5])-1])throw new Error('invalid_photo');
  await sharp(files[0].buffer,{limitInputPixels:40000000}).metadata();
 }}catch{return res.status(400).json({success:false,reason:'invalid_photo'});}
 for(const [name,files] of Object.entries(req.files||{})){
  const url=await saveImage(files[0].buffer,row.user_id,row.id,name),before=name.endsWith('Before');
  const index=name.startsWith('card')?0:Number(name[5]);
  if(index===0)changes[before?'before_url':'after_url']=url;
  else intro[index-1][before?'beforeUrl':'afterUrl']=url;
  const sample=accepted.find(e=>e.index===index);if(sample)sample[before?'beforeUrl':'afterUrl']=url;
 }
 changes.intro_examples=intro;changes.accepted_examples=accepted;
 const updated=check(await db.from(TABLE).update(changes).eq('id',row.id).eq('user_id',req.refundUserId).is('deleted_at',null).in('status',['completed','failed']).select('*').maybeSingle());
 if(!updated)return res.status(409).json({success:false,reason:'tool_busy'});
 res.json({success:true,item:publicTool(updated,req.query.language)});
}));
router.delete('/:id',wrap(async(req,res)=>{
 if(!UUID.test(req.params.id))return res.status(400).json({success:false,reason:'invalid_input'});
 const deleted=check(await db.from(TABLE).update({deleted_at:new Date().toISOString(),status:'failed',error_code:'deleted'}).eq('id',req.params.id).eq('user_id',req.refundUserId).is('deleted_at',null).select('id').maybeSingle());
 if(!deleted)return res.status(404).json({success:false,reason:'tool_not_found'});
 res.json({success:true,id:deleted.id});
}));
router.post('/review',rateLimit({windowMs:60000,limit:6,standardHeaders:true,legacyHeaders:false}),upload.fields([{name:'photos',maxCount:6}]),wrap(async(req,res)=>{
 const owner=req.refundUserId;
 let input,previous=null,reference_urls=[],reference_roles=[],feedback='';
 try{
  if(req.body.reviewToken){
   previous=readReview(req.body.reviewToken,owner);
   feedback=typeof req.body.feedback==='string'?req.body.feedback.trim():'';
   if(feedback.length<3||feedback.length>1500||(req.files?.photos||[]).length)throw new Error('invalid_input');
   input={description:previous.originalDescription,request_key:previous.requestKey,language:previous.language};
   reference_urls=previous.reference_urls;reference_roles=previous.reference_roles||[];
  }else input=validateInput(req.body);
 }catch(e){return res.status(400).json({success:false,reason:['review_expired','confirmation_required'].includes(e.message)?e.message:'invalid_input'});}
 if(!previous){
  const files=req.files?.photos||[];
  reference_roles=parseRoles(req.body.roles,files.length);
  try{reference_urls=await Promise.all(files.map((f,i)=>saveImage(f.buffer,owner,randomUUID(),`idea-${(reference_roles[i]||`reference-${i}`).replace(':','-')}`)));}
  catch{return res.status(400).json({success:false,reason:'invalid_photo'});}
 }
 const review=await reviewTool({description:input.description,language:input.language,images:reference_urls,roles:reference_roles,previous:previous?.review||null,feedback});
 const reviewToken=issueReview({owner,requestKey:input.request_key,language:input.language,originalDescription:input.description,reference_urls,reference_roles,review});
 res.set('Cache-Control','no-store').json({success:true,review,reviewToken});
}));
router.post('/:id/prepare',wrap(async(req,res)=>{
 const row=check(await db.from(TABLE).select('*').eq('id',req.params.id).eq('user_id',req.refundUserId).is('deleted_at',null).maybeSingle());
 if(!row)return res.status(404).json({success:false,reason:'tool_not_found'});
 if((!row.screen_schema || (row.intro_examples||[]).length<3) && ['completed','failed'].includes(row.status) && (row.attempts||0)<3 && row.error_code!=='unsupported_request') {
  check(await db.from(TABLE).update({status:'queued',error_code:null,updated_at:new Date().toISOString()}).eq('id',row.id).is('deleted_at',null).eq('status',row.status));
  row.status='queued';void tick();
 }
 res.json({success:true,item:publicTool(row,req.query.language)});
}));
router.post('/',upload.fields([{name:'photos',maxCount:6},{name:'photo',maxCount:1}]),wrap(async(req,res)=>{
 const owner=req.refundUserId;
 let approved,input;
 try{
  approved=readReview(req.body.reviewToken,owner);
  if(!approved.review.ready||req.body.requestKey!==approved.requestKey)throw new Error('confirmation_required');
  input=validateInput({description:approved.review.intent,requestKey:approved.requestKey,language:approved.language});
 }catch(e){return res.status(400).json({success:false,reason:e.message==='review_expired'?'review_expired':'confirmation_required'});}
 const existing=check(await db.from(TABLE).select('*').eq('user_id',owner).eq('request_key',input.request_key).maybeSingle());
 if(existing?.deleted_at)return res.status(410).json({success:false,reason:'tool_not_found'});
 if(existing)return res.json({success:true,item:publicTool(existing,req.query.language)});
 const recent=await db.from(TABLE).select('id',{count:'exact',head:true}).eq('user_id',owner).gte('created_at',new Date(Date.now()-86400000).toISOString());
 check(recent);
 if(recent.count>=3)return res.status(429).json({success:false,reason:'daily_limit'});
 const id=randomUUID();
 const reference_urls=approved.reference_urls;
 const result=await db.from(TABLE).insert({...input,id,user_id:owner,reference_urls,reference_roles:approved.reference_roles||[],button_hue:toolHue({id,description:input.description})}).select('*').single();
 if(result.error?.code==='23505'){
  const same=check(await db.from(TABLE).select('*').eq('user_id',owner).eq('request_key',input.request_key).maybeSingle());
  if(same)return res.json({success:true,item:publicTool(same,req.query.language)});
  return res.status(409).json({success:false,reason:'already_generating'});
 }
 const row=check(result);res.status(202).json({success:true,item:publicTool(row,req.query.language)});void tick();
}));
router.use((error,req,res,next)=>{console.warn('[custom-studio]',error.message);res.status(error instanceof multer.MulterError?400:500).json({success:false,reason:error instanceof multer.MulterError?'invalid_photo':error.message==='review_unavailable'?'review_unavailable':'request_failed'});});
module.exports=router;
