const {accessibleTool}=require('../utils/productStudioCatalog');
const express=require('express');
const multer=require('multer');
const sharp=require('sharp');
const axios=require('axios');
const {randomUUID}=require('node:crypto');
const {rateLimit}=require('express-rate-limit');
const {supabaseAdmin:db}=require('../supabaseClient');
const {refundIdentity}=require('../middleware/refundIdentity');
const teamService=require('../services/teamService');
const {normalizeSchema,validateSelections,generationPrompt}=require('../utils/customToolSchema');
const {GPT25_EDIT_MODEL,buildEditInput}=require('../utils/gpt25Edit');
const router=express.Router(),TABLE='custom_studio_generations',BUCKET='user_image_results';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const check=r=>{if(r.error)throw r.error;return r.data;};
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
router.use((req,res,next)=>db?next():res.status(503).json({success:false,reason:'unavailable'}));
router.use(rateLimit({windowMs:60000,limit:40,standardHeaders:true,legacyHeaders:false}));
router.use((req,res,next)=>refundIdentity(db)(req,res,next));
const upload=multer({storage:multer.memoryStorage(),limits:{files:8,fileSize:10*1024*1024,fields:8,fieldSize:12000}});
const publicGeneration=r=>({id:r.id,toolId:r.tool_id,status:r.status==='failed'?'error':r.status==='queued'?'processing':r.status,isProcessing:['queued','processing'].includes(r.status),resultImage:r.result_url,uploadedImage:r.input.images[0],createdAt:r.created_at,error:r.error_code,creditCost:10,settings:{customToolGeneration:true,customToolId:r.tool_id,qualityVersion:'v1'}});
async function storeImage(buffer,user,id,kind,{source=false}={}){
 const image=sharp(buffer,{limitInputPixels:50000000}).rotate();
 const data=source?await image.resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:95}).toBuffer():await image.png().toBuffer();
 const path=`${user}/custom-tools/results/${id}/${kind}-${randomUUID()}.${source?'jpg':'png'}`;
 check(await db.storage.from(BUCKET).upload(path,data,{contentType:source?'image/jpeg':'image/png',upsert:false}));
 return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
async function finish(id,url,error){return check(await db.rpc('finish_custom_studio_generation',{p_id:id,p_url:url||null,p_error:error||null}));}
async function processGeneration(job){
 try{
  const input=buildEditInput(GPT25_EDIT_MODEL,{prompt:job.input.prompt,image_urls:job.input.images,aspect_ratio:job.input.ratio,quality:'high',num_images:1});
  const response=await axios.post(`https://fal.run/${GPT25_EDIT_MODEL}`,input,{headers:{Authorization:`Key ${process.env.FAL_API_KEY||process.env.FAL_KEY}`},timeout:300000});
  const url=response.data?.images?.[0]?.url;if(!url)throw new Error('generation_failed');
  const binary=await axios.get(url,{responseType:'arraybuffer',timeout:60000,maxContentLength:40*1024*1024});
  const stored=await storeImage(Buffer.from(binary.data),job.user_id,job.id,'result');
  await finish(job.id,stored);
 }catch(error){console.warn('[custom-tool] generation',job.id,error.message);await finish(job.id,null,'generation_failed');}
}
let active=false;
async function tick(){
 if(active||!db)return;active=true;
 try{
  const stale=check(await db.from(TABLE).select('id').eq('status','processing').lt('updated_at',new Date(Date.now()-15*60000).toISOString()).limit(20));
  for(const row of stale)await finish(row.id,null,'interrupted');
  const queued=check(await db.from(TABLE).select('*').eq('status','queued').order('created_at').limit(2));
  await Promise.all(queued.map(async job=>{const claim=check(await db.from(TABLE).update({status:'processing',updated_at:new Date().toISOString()}).eq('id',job.id).eq('status','queued').select('*').maybeSingle());if(claim)await processGeneration(claim);}));
 }catch(e){console.warn('[custom-tool] worker',e.message);}finally{active=false;}
}
if(db&&process.env.NODE_ENV!=='test'){const timer=setInterval(tick,8000);timer.unref();}
router.get('/:toolId',wrap(async(req,res)=>{
 if(!UUID.test(req.params.toolId))return res.status(400).json({success:false,reason:'invalid_input'});
 const [result,credits]=await Promise.all([db.from(TABLE).select('*').eq('tool_id',req.params.toolId).eq('user_id',req.refundUserId).order('created_at',{ascending:false}).limit(50),teamService.getEffectiveCredits(req.refundUserId)]);
 res.set('Cache-Control','no-store').json({success:true,items:check(result).map(publicGeneration),creditBalance:credits.creditBalance,isPro:credits.isPro,isInTrial:credits.isInTrial,userId:req.refundUserId});
}));
router.post('/:toolId',upload.any(),wrap(async(req,res)=>{
 if(!UUID.test(req.params.toolId)||!UUID.test(req.body.requestKey||''))return res.status(400).json({success:false,reason:'invalid_input'});
 const owner=req.refundUserId;
 const old=check(await db.from(TABLE).select('*').eq('user_id',owner).eq('request_key',req.body.requestKey).maybeSingle());
 if(old){if(old.tool_id!==req.params.toolId)return res.status(409).json({success:false,reason:'invalid_request_key'});return res.json({success:true,item:publicGeneration(old)});}
 const tool=await accessibleTool(db,req.params.toolId,owner);
 if(!tool?.screen_schema)return res.status(404).json({success:false,reason:'tool_not_ready'});
 let schema,selections,details,ratio,products,references;
 try{
  schema=normalizeSchema(tool.screen_schema);selections=validateSelections(schema,JSON.parse(req.body.selections||'{}'));
  details=req.body.details||'';if(typeof details!=='string'||details.length>3000||schema.detailsRequired&&!details.trim())throw new Error();
  ratio=req.body.ratio||'9:16';if(!['1:1','9:16','16:9','3:4','4:3','4:5','5:4','2:3','3:2','21:9','auto','original'].includes(ratio))throw new Error();
  products=(req.files||[]).filter(f=>f.fieldname==='product');if(!products.length||products.length>6)throw new Error();
  references=[];
  for(const field of schema.controls.filter(c=>c.type==='image')){const files=(req.files||[]).filter(f=>f.fieldname===`ref_${field.id}`);if(files.length>1||field.required&&!files.length)throw new Error();if(files[0])references.push({id:field.id,file:files[0]});}
  if(products.length+references.length!==(req.files||[]).length)throw new Error();
 }catch{return res.status(400).json({success:false,reason:'invalid_input'});}
 const effective=await teamService.getEffectiveCredits(owner);
 if(effective.creditBalance<10)return res.status(402).json({success:false,reason:'insufficient_credit'});
 const staging=randomUUID();let images;
 try{images=await Promise.all([...products,...references.map(r=>r.file)].map((f,i)=>storeImage(f.buffer,owner,staging,`source-${i}`,{source:true})));}
 catch{return res.status(400).json({success:false,reason:'invalid_photo'});}
 const prompt=generationPrompt(schema,{selections,details,angleCount:products.length,references});
 const job=check(await db.rpc('start_custom_studio_generation',{p_user:owner,p_tool:tool.id,p_request:req.body.requestKey,p_owner:effective.creditOwnerId||owner,p_input:{prompt,details,selections,ratio,images,angleCount:products.length}}));
 res.status(202).json({success:true,item:publicGeneration(job)});void tick();
}));
router.use((error,req,res,next)=>{console.warn('[custom-tool] API',error.message);const reason=/insufficient_credit|too_many_generations/.exec(error.message)?.[0];res.status(reason==='insufficient_credit'?402:reason?429:error instanceof multer.MulterError?400:500).json({success:false,reason:reason|| (error instanceof multer.MulterError?'invalid_photo':'request_failed')});});
module.exports=router;
