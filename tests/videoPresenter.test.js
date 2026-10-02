const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSkill, presenterDirection, buildSkillGeminiPrompt, buildSkillFallbackPrompt, skillIdentityClause } = require('../src/utils/videoSkillPrompt');
const { buildCommerceGridPrompt } = require('../src/utils/videoGridPreview');
test('UGC exact ages are bounded and legacy age categories remain compatible', () => {
  for (const age of [0, 22, 47, 99]) assert.equal(sanitizeSkill('ugc', {presenterAge:age}).presenterAge, age);
  assert.equal(sanitizeSkill('ugc', {presenterAge:1000}).presenterAge,99);
  assert.equal(sanitizeSkill('ugc', {presenterAge:NaN}).presenterAge,'auto');
  assert.equal(sanitizeSkill('ugc', {presenterAge:'mature'}).presenterAge,'mature');
});
test('UGC selected model is an identity reference, separate from product and storyboard references', () => {
  const s=sanitizeSkill('ugc',{presenterGender:'woman',presenterAge:47,presenterHijab:true});
  const ctx={audio:false,duration:10,imageCount:2,presenterImageIndex:3};
  for(const prompt of [buildSkillGeminiPrompt(s,ctx),buildSkillFallbackPrompt(s,ctx),skillIdentityClause(s,2,3)]) {
    assert.match(prompt,/@Image3/); assert.match(prompt,/aged 47 years/); assert.match(prompt,/identity reference, never as a product reference/); assert.match(prompt,/hijab/);
    assert.doesNotMatch(prompt,/a fictional person/);
  }
  const grid=buildCommerceGridPrompt({productCount:2,presenterImageIndex:3,direction:presenterDirection(s,3)});
  assert.match(grid,/first 2 input photo\(s\) show the product/);
  assert.match(grid,/Input photo 3 is ONLY the chosen presenter identity reference/);
  assert.match(grid,/aged 47 years/);
});
test('AI presenter mode has no model-image reference and still respects selected age', () => {
 const s=sanitizeSkill('ugc',{presenterGender:'man',presenterAge:32,presenterHijab:true});
 const prompt=presenterDirection(s);
 assert.match(prompt,/aged 32 years/); assert.match(prompt,/fictional person/);
 assert.doesNotMatch(prompt,/@Image|hijab/);
 assert.equal(presenterDirection(sanitizeSkill('spin360',{}),2),'');
});
