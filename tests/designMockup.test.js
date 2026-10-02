const test = require('node:test');
const assert = require('node:assert/strict');
const {getTool, validateOptions, buildPrompt} = require('../src/utils/studioTools');
const tool = getTool('design-mockup');
test('own product overrides preset and custom product/colour, while retaining presentation', () => {
 const options = validateOptions(tool, {product:'tshirt', color:'white', productCustom:'steel bottle', colorCustom:'red', presentationCustom:'On a kitchen shelf'});
 const prompt = buildPrompt(tool, {...options, refs:[{id:'blank',count:1}]});
 assert.match(prompt, /sole source of product type/);
 assert.doesNotMatch(prompt, /classic crew-neck|steel bottle|custom description "red"|- Product colour: white/);
 assert.match(prompt, /On a kitchen shelf/);
 assert.match(prompt, /preserve the supplied artwork’s lettering exactly/);
});
test('custom choices replace defaults when no product is uploaded', () => {
 const prompt = buildPrompt(tool, validateOptions(tool, {productCustom:'Ceramic plant pot', colorCustom:'Terracotta', presentationCustom:'On a windowsill'}));
 for(const text of ['Ceramic plant pot','Terracotta','On a windowsill']) assert.ok(prompt.includes(text));
 assert.doesNotMatch(prompt, /classic crew-neck|overhead flat lay|- Product colour: white/);
});
test('removing own product restores preset choices', () => {
 const prompt = buildPrompt(tool, validateOptions(tool,{product:'mug',color:'navy'}));
 assert.match(prompt,/glossy 11oz ceramic mug/); assert.match(prompt,/navy blue/);
});
test('custom options are bounded and exclusive to mockups', () => {
 for(const value of ['', ' ', 'a'.repeat(121), 12, {}]) assert.throws(()=>validateOptions(tool,{productCustom:value}),/invalid_input/);
 assert.throws(()=>validateOptions(getTool('marketplace-main-image'),{productCustom:'bag'}),/invalid_input/);
 assert.throws(()=>validateOptions(tool,{unsupportedCustom:'bag'}),/invalid_input/);
});
