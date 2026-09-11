const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeModelProfile, buildModelProfileDirective } = require('../src/utils/modelProfile');

test('optional profiles normalize units and reject invalid data before generation', () => {
  assert.deepEqual(normalizeModelProfile(null), {});
  assert.deepEqual(normalizeModelProfile({ heightCm: '178,5', waistCm: '', mood: 'confident', notes: '  Calm gaze  ', ignored: 'x' }), { heightCm: 178.5, mood: 'confident', notes: 'Calm gaze' });
  for (const profile of [{heightCm: true}, {heightCm:'x'}, {heightCm:300}, {waistCm:-1}, [], 'text', {mood:'invented'}, {notes:'x'.repeat(401)}]) assert.throws(() => normalizeModelProfile(profile));
  assert.equal(buildModelProfileDirective({}), '');
});
for (const route of ['referenceBrowserRoutesV7.js', 'referenceJewelryBrowserRoutesV7.js']) {
  const source = fs.readFileSync(`${__dirname}/../src/routes/${route}`, 'utf8');
  const block = source.slice(source.indexOf('    // Apply after all prompt rewrites'), source.indexOf('    logger.log("✨ [BACKEND MAIN] Enhanced prompt:"'));
  function run(overrides = {}) {
    const context = { enhancedPrompt: 'STYLEREF: preserve garment', settings: { framing: 'full_body' }, modelPhoto: 'portrait.jpg', modelProfile: {heightCm:178, mood:'confident'}, isEditMode:false, isRefinerMode:false, isColorChange:false, isPoseChange:false, req:{body:{}}, buildModelProfileDirective, ...overrides };
    vm.runInNewContext(block, context);
    return context;
  }
  test(`${route}: profile reaches final fashion prompt and saved settings, including style-reference bypass`, () => {
    const result = run();
    assert.match(result.enhancedPrompt, /STYLEREF/);
    assert.match(result.enhancedPrompt, /Height \(cm\).*178/);
    assert.equal(result.settings.modelProfile.mood,'confident');
    assert.ok(source.indexOf('// Apply after all prompt rewrites') > source.indexOf('enhancedPrompt = buildStyleReferencePrompt'));
  });
  test(`${route}: random model and non-fashion edits do not inherit stale profiles`, () => {
    for (const overrides of [{modelPhoto:null}, {modelProfile:{}}, {isEditMode:true}, {isRefinerMode:true}, {isColorChange:true}, {isPoseChange:true}, {req:{body:{isBackSideAnalysis:true}}}]) {
      assert.equal(run(overrides).enhancedPrompt,'STYLEREF: preserve garment');
    }
  });
}
for (const route of ['createModelRoutes.js','createModelRoutesWeb.js']) {
  const source = fs.readFileSync(`${__dirname}/../src/routes/${route}`,'utf8');
  test(`${route}: saved casting metadata is isolated from every portrait generator and analysis function`, async () => {
    const start = source.indexOf('async function saveModelToDatabase(');
    const end = source.indexOf('\n//', source.indexOf('\n}', start));
    let inserted;
    const chain = { insert(data) { inserted=data;return this; }, select(){return this;}, single:async()=>({data:{id:42},error:null}) };
    const save = vm.runInNewContext(`${source.slice(start,end)}; saveModelToDatabase`, {supabase:{from:()=>chain}, supabaseAdmin:null, logger:{log(){}}, console});
    const profile={heightCm:182,mood:'serene'};
    await save('Ava','passport prompt','portrait description','portrait.jpg','id','woman',22,'user',false,null,null,profile);
    assert.deepEqual(inserted.model_profile, profile);
    assert.equal(inserted.original_prompt,'passport prompt');
    assert.equal(inserted.enhanced_prompt,'portrait description');
    // All portrait prompt builders and provider calls precede persistence.
    assert.doesNotMatch(source.slice(0,start).replace('const { normalizeModelProfile } = require("../utils/modelProfile");',''), /modelProfile|model_profile/);
  });
}
test('clothing size is never retained or forwarded, including legacy payloads', () => {
  assert.deepEqual(normalizeModelProfile({clothingSize:'EU 38',heightCm:178}), {heightCm:178});
  assert.doesNotMatch(buildModelProfileDirective({clothingSize:'EU 38',heightCm:178}), /EU 38|Clothing size/);
});
for (const route of ['createModelRoutes.js','createModelRoutesWeb.js']) {
  const source = fs.readFileSync(`${__dirname}/../src/routes/${route}`,'utf8');
  const block=source.slice(source.indexOf('router.put("/update-model/:modelId"'),source.indexOf('\nmodule.exports = router;'));
  test(`${route}: profile update round-trips, clearing resets to automatic, legacy rename preserves profile`,async()=>{
    let handler, changes;
    let row={id:42,name:'Ava',model_profile:{heightCm:178,mood:'confident'}};
    const chain={update(data){changes=data;return this;},eq(){return this;},select(){return this;},single:async()=>({data:row={...row,...changes},error:null})};
    vm.runInNewContext(block,{router:{put:(_,fn)=>handler=fn},supabase:{from:()=>chain},normalizeModelProfile,logger:{log(){}},console});
    let status=200,result;
    const res={status(code){status=code;return this;},json(data){result=data;return this;}};
    const request=body=>handler({params:{modelId:42},body},res);
    await request({modelName:'Ava',modelProfile:{heightCm:'180,5',mood:'warm'}});
    assert.equal(result.data.model_profile.heightCm,180.5);
    assert.equal(result.data.model_profile.mood,'warm');
    await request({modelName:'New name'});
    assert.equal(result.data.model_profile.heightCm,180.5);
    await request({modelName:'New name',modelProfile:{}});
    assert.equal(Object.keys(result.data.model_profile).length,0);
    await request({modelName:'New name',modelProfile:{heightCm:999}});
    assert.equal(status,400);
  });
}
