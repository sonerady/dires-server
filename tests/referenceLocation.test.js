const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {createReferenceLocation, normalizedReference, stampLocationReference, MODEL, LOCATION_DIRECTION} = require('../src/services/referenceLocation');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const venue = async () => sharp({create:{width:300,height:200,channels:3,background:'#b9c9d0'}}).png().toBuffer();
const input = async () => 'data:image/png;base64,'+(await venue()).toString('base64');
function fixtures(overrides={}) {
 const calls=[];
 return {calls,options:{userId:'anonymous-device-id',title:'My studio',
 fetchImpl:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({images:[{url:'https://fixture.invalid/enhanced.jpg'}]})};},
 uploadImage:async(url,user,id)=>{calls.push({upload:url,user,id});return {publicUrl:'https://fixture.invalid/saved.jpg'};},
 saveLocation:async(...args)=>{calls.push({save:args});return {id:75,title:args[0],image_url:args[3],generated_title:args[8],created_at:'2026-09-09T00:00:00Z'};},...overrides}};
}
test('photo-only creation enhances with GPT 2.5, saves to owner list, returns saved venue',async()=>{
 const f=fixtures();const result=await createReferenceLocation({...f.options,referenceImage:await input()});
 assert.equal(f.calls[0].url,'https://fal.run/'+MODEL);
 assert.equal(f.calls[0].body.num_images,1);assert.equal(f.calls[0].body.image_size,'auto');
 assert.match(f.calls[0].body.image_urls[0],/^data:image\/jpeg;base64,/);
 assert.match(f.calls[0].body.prompt,/SAME real venue/);
 assert.equal(f.calls[0].body.input_fidelity,undefined,'unsupported Fal parameter omitted');
 const save=f.calls.find(c=>c.save).save;assert.equal(save[6],'anonymous-device-id');assert.equal(save[7],false);assert.equal(save[11],true,'strict database save');
 assert.equal(save[5],'custom','user-created category');
 assert.equal(save[9],'unknown','location type conforms to live check_location_type constraint');
 assert.equal(result.data.id,75);assert.equal(result.data.imageUrl,save[3]);assert.equal(result.data.enhancedPrompt,LOCATION_DIRECTION);
});
test('invalid images, provider rejection and save failure never produce a saved result',async()=>{
 for(const value of ['https://fixture.invalid/photo.jpg','data:image/png;base64,AAAA',null])await assert.rejects(normalizedReference(value),e=>e.status===400);
 let uploads=0;
 await assert.rejects(createReferenceLocation({...fixtures({fetchImpl:async()=>({ok:false,json:async()=>({})}),uploadImage:async()=>{uploads++}}).options,referenceImage:await input()}),/enhancement failed/);
 assert.equal(uploads,0);
 await assert.rejects(createReferenceLocation({...fixtures({saveLocation:async()=>{throw Error('DB unavailable')}}).options,referenceImage:await input()}),/DB unavailable/);
});
test('Location strip is appended without cropping original venue',async()=>{
 const marked=await stampLocationReference(await venue());const meta=await sharp(marked).metadata();assert.equal(meta.width,300);assert.equal(meta.height,236);
 const {data,info}=await sharp(marked).raw().toBuffer({resolveWithObject:true});
 assert.ok(data[(215*info.width+5)*info.channels]<40,'dark strip on bottom');
 assert.ok(data[(10*info.width+5)*info.channels]>150,'original venue above strip retained');
 assert.match(LOCATION_DIRECTION,/Freely choose a believable camera/);assert.match(LOCATION_DIRECTION,/never reproduce the strip/);
});
for(const file of ['createLocationRoutes_v3.js','createLocationRoutesWeb.js'])test(`${file}: real database errors propagate for own-venue saves`,async()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/routes',file),'utf8');
 const fn=src.slice(src.indexOf('async function saveLocationToDatabase('),src.indexOf('// CREATE LOCATION ROUTE'));
 const db={from:()=>({insert:()=>({select:()=>({single:async()=>({error:{code:'42P01',message:'table missing'}})})})})};
 const save=vm.runInNewContext(fn+'; saveLocationToDatabase',{supabase:db,console:{log(){},error(){}}});
 await assert.rejects(save('Venue','','','url','id','custom','user',false,null,'custom',null,true),e=>e.code==='42P01');
});
for(const file of ['referenceBrowserRoutesV7.js','referenceJewelryBrowserRoutesV7.js'])test(`${file}: initial and retry references retain venue before final style reference`,()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/routes',file),'utf8');
 for(const key of ['imageInputArray','retryImageInputArray']){
  const line=src.match(new RegExp('if \\(locationReferenceUrl\\) '+key+' = [^;]+;'))[0];
  const result=vm.runInNewContext(`let ${key}=['product'];${line};if(styleReferenceUrl)${key}.push(styleReferenceUrl);${key}`,{locationReferenceUrl:'marked-venue',styleReferenceUrl:'style'});
  assert.deepEqual(Array.from(result),['product','marked-venue','style']);
  assert.ok(src.indexOf(line)<src.indexOf(`if (styleReferenceUrl)`,src.indexOf(line)));
 }
});

const {resolveUploadedLocationReference} = require('../src/services/referenceLocation');
test('only completed, photo-uploaded venues belonging to the requester enter final model references',async()=>{
 const base='https://api.diress.ai/storage/v1/object/public/user-locations/';
 const rows=[
  {image_url:base+'photo.jpg',replicate_id:'sunburst-location-upload',user_id:'owner',status:'completed'},
  {image_url:base+'text.jpg',replicate_id:'text-generated',user_id:'owner',status:'completed'},
  {image_url:base+'catalog.jpg',replicate_id:'catalog',user_id:'global',status:'completed'},
  {image_url:base+'other.jpg',replicate_id:'sunburst-location-other',user_id:'other',status:'completed'},
  {image_url:base+'pending.jpg',replicate_id:'sunburst-location-pending',user_id:'owner',status:'pending'},
 ];
 const supabase={from:()=>{let matches=rows;const q={select:()=>q,in:(k,v)=>{matches=matches.filter(r=>v.includes(r[k]));return q},eq:(k,v)=>{matches=matches.filter(r=>r[k]===v);return q},like:(k,v)=>{matches=matches.filter(r=>r[k].startsWith(v.slice(0,-1)));return q},limit:()=>q,maybeSingle:async()=>({data:matches[0]||null})};return q}};
 assert.equal(await resolveUploadedLocationReference({supabase,imageUrl:base+'photo.jpg',userId:'owner'}),base+'photo.jpg');
 assert.equal(await resolveUploadedLocationReference({supabase,imageUrl:'https://diress.ai/cdn-cgi/image/width=400/'+base+'photo.jpg',userId:'owner'}),base+'photo.jpg');
 for(const name of ['text','catalog','other','pending','missing'])assert.equal(await resolveUploadedLocationReference({supabase,imageUrl:base+name+'.jpg',userId:'owner'}),null,name);
 assert.equal(await resolveUploadedLocationReference({supabase,imageUrl:base+'photo.jpg',userId:null}),null);
});
for(const route of ['referenceBrowserRoutesV7.js','referenceJewelryBrowserRoutesV7.js'])test(`${route}: reference marking and upload are gated by the persisted photo-upload check`,async()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/routes',route),'utf8');
 const start=src.indexOf('    let locationReferenceUrl = null;');
 const code=src.slice(start,src.indexOf('    let sunburstRejected',start));
 for(const allowed of [null,'https://fixture.invalid/own.jpg']){
  let downloads=0,uploads=0;
  const result=await vm.runInNewContext(`(async()=>{let enhancedPrompt='original';${code};return {locationReferenceUrl,enhancedPrompt}})()`,{supabase:{},locationImage:'selected-location',userId:'owner',resolveUploadedLocationReference:async()=>allowed,axios:{get:async()=>{downloads++;return {data:Buffer.from('photo')}}},stampLocationReference:async b=>b,Buffer,uploadReferenceImageToSupabase:async()=>{uploads++;return 'stamped-reference'},LOCATION_DIRECTION});
  assert.equal(downloads,allowed?1:0);assert.equal(uploads,allowed?1:0);
  assert.equal(result.locationReferenceUrl,allowed?'stamped-reference':null);
  assert.equal(result.enhancedPrompt.includes(LOCATION_DIRECTION),Boolean(allowed));
 }
});
