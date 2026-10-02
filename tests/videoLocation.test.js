const test = require('node:test');
const assert = require('node:assert/strict');
const {sanitizeSkill, locationDirection, buildSkillGeminiPrompt, buildSkillFallbackPrompt, skillIdentityClause} = require('../src/utils/videoSkillPrompt');
const {buildCommerceGridPrompt} = require('../src/utils/videoGridPreview');
test('360 environment reference stays separate from product angles throughout prompt paths', () => {
 const s=sanitizeSkill('spin360',{location:'Garden',locationPrompt:'Quiet garden with a stone floor',weather:'cloudy',timeOfDay:'sunset'});
 const ctx={duration:5,imageCount:5,locationImageIndex:6};
 for(const prompt of [buildSkillGeminiPrompt(s,ctx),buildSkillFallbackPrompt(s,ctx),skillIdentityClause(s,5,null,6)]) {
  assert.match(prompt,/@Image6 ONLY as the selected location\/background reference, never as a product reference/);
  assert.match(prompt,/Quiet garden with a stone floor/); assert.match(prompt,/Weather: cloudy/); assert.match(prompt,/Time and lighting: sunset/);
  assert.match(prompt,/override the default studio/);
 }
 const grid=buildCommerceGridPrompt({productCount:5,locationImageIndex:6,direction:locationDirection(s,6)});
 assert.match(grid,/first 5 input photo\(s\) show the product/);
 assert.match(grid,/Input photo 6 is ONLY the selected location\/background reference/);
 assert.match(grid,/Preserve that environment/);
});
test('360 location input is bounded, ignores invalid weather and preserves legacy backgrounds', () => {
 const s=sanitizeSkill('spin360',{location:'x'.repeat(300),locationPrompt:'y'.repeat(2000),backgroundColorHex:'#123456',weather:'invalid',timeOfDay:'invalid'});
 assert.equal(s.location.length,180); assert.equal(s.locationPrompt.length,1600);
 assert.equal(s.weather,null); assert.equal(s.timeOfDay,null);
 assert.match(locationDirection(s),/exactly #123456/);
 assert.equal(sanitizeSkill('spin360',{backgroundColorHex:'red'}).backgroundColorHex,null);
 assert.equal(locationDirection(sanitizeSkill('ugc',{location:'garden'}),3),'');
 assert.match(buildSkillFallbackPrompt(sanitizeSkill('spin360',{background:'white'}),{duration:5,imageCount:1}),/seamless white backdrop/);
});
