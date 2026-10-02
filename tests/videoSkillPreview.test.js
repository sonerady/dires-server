const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSkill, buildSkillPreviewDirection, buildSkillGeminiPrompt } = require('../src/utils/videoSkillPrompt');
const ctx={duration:10,imageCount:2,audio:true,presenterImageIndex:null,locationImageIndex:null};
for(const [skill,inputs,expected] of [
 ['sales',{tone:'plot_twist',hook:'problem_solution',platform:'amazon',sellingPoints:'30 hour battery'},[/surprising twist/,/everyday PROBLEM/,/Marketplace-safe/,/30 hour battery/]],
 ['ugc',{ugcStyle:'unboxing',presenterAge:47,presenterGender:'woman',presenterHijab:true,voiceLanguage:'tr'},[/opens the package/,/aged 47 years/,/hijab/,/Turkish/]],
 ['closeup',{focus:['stitching','mechanism']},[/stitching and seams/,/moving parts and mechanisms/,/extreme macro/i]],
 ['spin360',{location:'Garden',spinSpeed:'slow',weather:'sunny'},[/Garden/,/slow, elegant rotation/,/Weather: sunny/,/1 continuous shot/]],
 ['commercial',{adType:'reaction',hook:'social_proof',platform:'meta_ads'},[/delighted reaction/,/trusted recommendation/,/Facebook\/Instagram/]],
]) {
 test(`${skill}: storyboard and video share every selected creative option`,()=>{
  const s=sanitizeSkill(skill,inputs);
  for(const prompt of [buildSkillPreviewDirection(s,ctx),buildSkillGeminiPrompt(s,ctx)]) for(const pattern of expected) assert.match(prompt,pattern);
  assert.match(buildSkillPreviewDirection(s,ctx),/never render dialogue or directions as text/);
 });
}
