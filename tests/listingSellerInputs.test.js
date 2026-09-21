const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProductReferences, normalizeBrand } = require('../src/utils/listingSellerInputs');
const { buildListingPrompt } = require('../src/utils/listingPrompts');
const { createListingArchive, exportName } = require('../src/utils/listingExport');
const sharp = require('sharp');
const JSZip = require('jszip');

test('product views reject unknown roles, repeated main image, invalid URLs and excess inputs', () => {
  const refs = normalizeProductReferences([{url:'https://img/main',role:'front'}, {url:'file:///test',role:'back'}, {url:'https://img/x',role:'other'}, ...Array.from({length:8},(_,i)=>({url:`https://img/${i}`,role:'detail'}))], 'https://img/main');
  assert.equal(refs.length, 5); assert.equal(refs[0].url, 'https://img/0');
});
test('disabled brand profile cannot silently change a generation', () => { assert.equal(normalizeBrand({enabled:false,name:'shop'}),null); });
test('brand palette and URL are normalized', () => {
  const b=normalizeBrand({enabled:true,colors:['#123456','red'],logoUrl:'file:///secret',language:'en',font:'Inter'});
  assert.deepEqual(b.colors,['#123456']); assert.equal(b.logoUrl,null);
});
test('custom reference, product angles and logo receive distinct image numbers', () => {
  const prompt=buildListingPrompt({type:'detail',marketplace:'shopify',brief:{},customSet:{hasReference:true},productReferences:[{role:'back'},{role:'label'}],brandProfile:{name:'Store',colors:['#123456'],font:'Inter',logoUrl:'https://img/logo'},exampleCount:2});
  assert.match(prompt,/IMAGE 2 IS THE SELLER DESIGN REFERENCE/);
  assert.match(prompt,/IMAGE 3: BACK/); assert.match(prompt,/IMAGE 4: LABEL/);
  assert.match(prompt,/IMAGE 5 is the STORE LOGO/); assert.match(prompt,/last 2 images/);
});
test('Amazon hero restrictions take precedence over brand identity', () => {
  const prompt=buildListingPrompt({type:'hero',marketplace:'amazon',brief:{},brandProfile:{name:'Store',colors:[],logoUrl:'https://img/logo'}});
  assert.match(prompt,/No props, inset views, added text, graphics, logos or badges/);
  assert.match(prompt,/never add it to a restricted marketplace main image/);
});
test('export filenames are ordered and cannot create zip paths', () => {
  assert.equal(exportName(0,{image_type:'../hero',variant_index:2}), '01_---hero_03.jpg');
});
test('ZIP preserves requested order, uses exact preset size and contains the entire source', async () => {
  const source=await sharp({create:{width:80,height:160,channels:3,background:'#ff0000'}}).png().toBuffer();
  const rows=[{image_type:'detail',variant_index:0},{image_type:'hero',variant_index:0}];
  const zip=await JSZip.loadAsync(await createListingArchive({rows,preset:'amazon',getImage:async()=>source}));
  assert.deepEqual(Object.keys(zip.files),['01_detail_01.jpg','02_hero_01.jpg','manifest.json']);
  const data=await zip.file('01_detail_01.jpg').async('nodebuffer');
  const meta=await sharp(data).metadata();assert.equal(meta.width,2000);assert.equal(meta.height,2000);
  const corner=await sharp(data).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();assert.ok(corner[0]>245 && corner[1]>245);
  const center=await sharp(data).extract({left:1000,top:1000,width:1,height:1}).raw().toBuffer();assert.ok(center[0]>240 && center[1]<15);
});
test('original preset preserves pixels and failed frame aborts the whole ZIP', async () => {
  const source=await sharp({create:{width:80,height:160,channels:3,background:'#fff'}}).png().toBuffer();
  const zip=await JSZip.loadAsync(await createListingArchive({rows:[{image_type:'hero'}],preset:'original',getImage:async()=>source}));
  const meta=await sharp(await zip.file('01_hero_01.jpg').async('nodebuffer')).metadata(); assert.equal(meta.height,160); assert.equal(meta.width,80);
  await assert.rejects(createListingArchive({rows:[{}],preset:'amazon',getImage:async()=>{throw Error('fetch failed')}}),/fetch failed/);
});

const fs = require('fs'); const vm = require('vm');
async function callExport({paid=false, ids='b,a', missing=false}={}) {
  const source=fs.readFileSync(require.resolve('../src/routes/listingStudioRoutes'),'utf8');
  const code=source.slice(source.indexOf('const listingExportsInFlight'), source.indexOf('// 📎 İçerik girdileri'));
  let handler, watermarks=0, fetched=0, archiveRows;
  const filters=[];
  const rows=missing?[]:[{id:'a',image_type:'hero',status:'completed',result_image_url:'https://img/a'},{id:'b',image_type:'detail',status:'completed',result_image_url:'https://img/b'}];
  const query={select(){return this},eq(k,v){filters.push([k,v]);return this},in:async()=>({data:rows})};
  vm.runInNewContext(code,{Set,Map,Buffer,router:{get:(path,fn)=>handler=fn},supabase:{from:()=>query},logger:{warn(){}},axios:{get:async()=>{fetched++;return {data:Buffer.from('paid')}}},require:path=>path.includes('listingExport')?{
    EXPORT_PRESETS:{amazon:[2000,2000]},createListingArchive:async({rows,getImage})=>{archiveRows=rows.map(r=>r.id);for(const row of rows) await getImage(row);return Buffer.from('zip')}
  }:{checkUserDownloadAccess:async()=>({canDownloadOriginal:paid,isInTrial:!paid}),getLastSubscriptionPeriod:async()=>null,addWatermarkToImage:async()=>{watermarks++;return Buffer.from('watermarked')}}});
  const res={statusCode:200,headers:{},status(n){this.statusCode=n;return this},json(body){this.body=body;return this},send(body){this.body=body;return this},setHeader(k,v){this.headers[k]=v}};
  await handler({query:{userId:'11111111-2222-4333-8444-555555555555',ids,preset:'amazon'},params:{jobId:'test-job'}},res);
  return {res,watermarks,fetched,archiveRows,filters};
}
test('export is scoped by user/job, follows requested order and watermarks trial frames', async()=>{
 const r=await callExport();assert.equal(r.res.statusCode,200);assert.deepEqual(Array.from(r.archiveRows),['b','a']);assert.equal(r.watermarks,2);assert.equal(r.fetched,0);
 assert.deepEqual(r.filters,[['user_id','11111111-2222-4333-8444-555555555555'],['job_id','test-job']]);assert.equal(r.res.headers['Cache-Control'],'private, no-store');
});
test('paid exports use originals; missing or duplicate selections produce no archive', async()=>{
 const paid=await callExport({paid:true});assert.equal(paid.watermarks,0);assert.equal(paid.fetched,2);
 const missing=await callExport({missing:true});assert.equal(missing.res.statusCode,404);assert.equal(missing.fetched,0);
 const duplicate=await callExport({ids:'a,a'});assert.equal(duplicate.res.statusCode,400);assert.equal(duplicate.watermarks,0);
});

test('client sends uploaded angle roles, primary role and store logo together; a failed view aborts generation', async()=>{
  const source=fs.readFileSync(require('path').join(__dirname,'../../client/screens/ListingStudioScreen.js'),'utf8');
  const start=source.indexOf('  const runGeneration = async'); const end=source.indexOf('  const handleGenerate =',start);
  const code=source.slice(start,end)+'\nrunGeneration;';
  let sent, calls=0;
  const context={API_URL:'https://api.example.com',setJobs:()=>{},buildFramePlan:()=>[],console:{warn(){}},uploadImageToStorage:async uri=>`https://img/${uri}`,fetch:async(url,options)=>{calls++;sent=JSON.parse(options.body);return {ok:true,json:async()=>({success:true,jobId:'a',items:[]})}}};
  const run=vm.runInNewContext(code,context);
  const request={photoUri:'main',productPhotos:[{uri:'back',role:'back'},{uri:'label',role:'label'}],brandProfile:{enabled:true,name:'Store',logoUrl:'logo'},userId:'user',options:{primaryRole:'front'},contentPhotos:[]};
  await run(request);
  assert.deepEqual(sent.options.productReferences,[{role:'back',url:'https://img/back'},{role:'label',url:'https://img/label'}]);
  assert.equal(sent.options.primaryRole,'front');assert.equal(sent.options.brandProfile.logoUrl,'https://img/logo');
  context.uploadImageToStorage=async uri=>{if(uri==='back')throw Error('upload failed');return 'https://img/'+uri};
  await run(request);assert.equal(calls,1);
});
