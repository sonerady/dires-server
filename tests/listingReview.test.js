const test = require('node:test');
const assert = require('node:assert/strict');
const {parseBrief, buildListingPrompt} = require('../src/utils/listingPrompts');
test('document facts survive validation without accepting unsupported claims',()=>{
 const raw=JSON.stringify({features:[{title:'Cotton',source:'notes',evidence:'100% cotton'},{title:'Waterproof',source:'notes',evidence:'waterproof'}]});
 const brief=parseBrief(raw,'',null,{contentDocs:[{text:'Material: 100%\n cotton'}]});
 assert.deepEqual(brief.features.map(f=>f.title),['Cotton']);
});
test('additional image facts require an actual content image',()=>{
 const raw=JSON.stringify({features:[{title:'500 ml',source:'content_image',evidence:'500 ml'}]});
 assert.equal(parseBrief(raw,'').features.length,0);
 assert.equal(parseBrief(raw,'',null,{contentImageCount:1}).features.length,1);
});
test('custom notes and reference roles are preserved without undefined direction',()=>{
 const type='custom:11111111-2222-4333-8444-555555555555';
 const p=buildListingPrompt({type,brief:{},notes:{[type]:'Keep a blue background'},customSet:{brief:'Match the reference layout',hasReference:true},exampleCount:1});
 assert.match(p,/Keep a blue background/);assert.match(p,/IMAGE 2 IS THE SELLER DESIGN REFERENCE/);assert.match(p,/last 1 images/);assert.doesNotMatch(p,/MANDATORY VISUAL ROLE: undefined/);
});
test('extra views cannot invent unseen surfaces or removable parts',()=>{
 assert.match(buildListingPrompt({type:'hero',brief:{},variantIndex:3,variantTotal:4}),/ONLY if supplied in a product reference/);
 assert.match(buildListingPrompt({type:'features',brief:{},variantIndex:3,variantTotal:4}),/ONLY if the supplied evidence shows they are removable/);
});
const {listingItemStatus, STALE_PROCESSING_MS} = require('../src/utils/listingJobState');
test('retry age follows the latest attempt, not original job creation',()=>{
 const now=Date.now();const old=new Date(now-STALE_PROCESSING_MS-1000).toISOString();
 assert.equal(listingItemStatus({status:'processing',created_at:old},now),'failed');
 assert.equal(listingItemStatus({status:'processing',created_at:old,brief:{listingAttemptStartedAt:new Date(now).toISOString()}},now),'processing');
 assert.equal(listingItemStatus({status:'completed',created_at:old},now),'completed');
});
const fs=require('node:fs');const vm=require('node:vm');
async function runWorker({saveFails=false,billingThrows=false}={}) {
 const source=fs.readFileSync(require.resolve('../src/routes/listingStudioRoutes'),'utf8');
 const fn=source.slice(source.indexOf('async function runJobInBackground'),source.indexOf('/* ───────────────────────── POST /retry'));
 const updates=[];let charged=0;let sent;
 const worker=vm.runInNewContext(`(${fn.trim()})`,{
  LISTING_CONCURRENCY:4,LISTING_STYLE_EXAMPLES:2,LISTING_CREDIT_PER_IMAGE:5,
  mapWithLimit:async(items,n,run)=>Promise.allSettled(items.map(run)),pickExamples:()=>['https://example.com/new-style.png'],
  generateOne:async args=>{sent=args;return {url:'https://example.com/result.png',provider:'test'}},
  saveResultToUserBucket:async url=>url,
  deductCredits:async()=>{charged++;if(billingThrows)throw Error('billing unavailable');return {success:true}},
  supabase:{from:()=>({update:value=>({eq:async()=>{updates.push(value);return {error:saveFails&&value.status==='completed'?Error('DB unavailable'):null}}})})},
  logger:{log(){},warn(){},error(){}},sendGenerationCompletedNotification:async()=>{}
 });
 await worker({jobId:'test',userId:'test',imageUrl:'https://example.com/product.png',inserted:[{id:'frame',image_type:'custom:test',prompt:'saved prompt',brief:{listingReferenceImages:['https://example.com/seller.png']}}],access:{creditOwnerId:'owner'},startedAt:Date.now(),total:1});
 return {updates,charged,sent};
}
test('retry worker uses exact saved reference images rather than random replacements',async()=>{
 const r=await runWorker();assert.deepEqual(r.sent.exampleUrls,['https://example.com/seller.png']);assert.equal(r.charged,1);
});
test('failed result persistence does not charge the user',async()=>{
 const r=await runWorker({saveFails:true});assert.equal(r.charged,0);assert.equal(r.updates.at(-1).status,'failed');
});
test('billing outage does not mark an already delivered image as failed',async()=>{
 const r=await runWorker({billingThrows:true});assert.ok(r.updates.some(x=>x.status==='completed'));assert.ok(!r.updates.some(x=>x.status==='failed'));
});
test('leaving Listing clears results and a late response cannot restore the previous visit',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../../client/screens/ListingStudioScreen.js'),'utf8');
 assert.ok(!source.includes('/listing-studio/results/${userId}?jobs=12'));
 let jobs=[],onBlur,finish;
 const context={API_URL:'https://example.com',setJobs:fn=>{jobs=typeof fn==='function'?fn(jobs):fn},
 navigation:{addListener:(event,callback)=>{assert.equal(event,'blur');onBlur=callback;return ()=>{}}},useEffect:fn=>fn(),
 buildFramePlan:()=>[{type:'hero',ratio:'1:1'}],uploadImageToStorage:async()=> 'https://example.com/product.png',
 fetch:()=>new Promise(resolve=>{finish=()=>resolve({ok:true,json:async()=>({success:true,jobId:'old-job',items:[]})})}),console:{warn(){}}};
 const effect=source.match(/  useEffect\(\(\) => navigation.addListener\("blur"[^\n]+/)[0];
 vm.runInNewContext(effect,context);
 const start=source.indexOf('  const runGeneration = async');const end=source.indexOf('  const handleGenerate =',start);
 const run=vm.runInNewContext(source.slice(start,end)+';runGeneration;',context);
 const pending=run({photoUri:'local',userId:'user',options:{},contentPhotos:[]});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(jobs.length,1);onBlur();assert.equal(jobs.length,0);finish();await pending;assert.equal(jobs.length,0);
});
test('original ratio uses the primary product dimensions, not style example dimensions',async()=>{
 const {GPT25_EDIT_MODEL,buildEditInput}=require('../src/utils/gpt25Edit');
 const source=fs.readFileSync(require.resolve('../src/routes/listingStudioRoutes'),'utf8');
 const fn=source.slice(source.indexOf('async function generateOne'),source.indexOf('async function buildBrief'));
 let sent;
 const generate=vm.runInNewContext(`(${fn.trim()})`,{GPT25_EDIT_MODEL,buildEditInput,process:{env:{}},axios:{post:async(url,body)=>{sent=body;return {data:{images:[{url:'https://example.com/result.png'}]}}}}});
 await generate({prompt:'product',imageUrl:'https://example.com/product.png',ratio:'original',sourceSize:{width:900,height:1600},exampleUrls:['https://example.com/square-style.png']});
 assert.deepEqual(sent.image_size,{width:1440,height:2560});
});
