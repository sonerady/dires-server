const test = require('node:test');
const assert = require('node:assert/strict');
const {isFootwearShoot, buildFootwearDirection, buildFootwearEnhanceInstruction, buildMultiAngleProductScopeDirection} = require('../src/utils/footwearPrompt');

test('outfits and multiple products never activate the footwear specialist even with a shoes hero category', () => {
  for (const scope of [{isMultipleProducts:true}, {isKombinMode:true}, {kombinItemCount:4}]) {
    assert.equal(isFootwearShoot({productCategory:'shoes'}, scope), false);
    assert.equal(isFootwearShoot({productCategory:'shoes', ...scope}), false);
  }
  assert.equal(isFootwearShoot({productCategory:'shoes'}, {kombinItemCount:1}), true);
});

test('reported four-image outfit mislabeled as shoe angles does not get an unconditional footwear crop', () => {
  const settings = {productCategory:'shoes', productSubtype:'loafers', isMultipleAnglesMode:true, multipleAnglesCount:4};
  assert.equal(isFootwearShoot(settings), false);
  assert.equal(isFootwearShoot({productCategory:'shoes'}, {multipleAnglesCount:4}), false);
  const prompt = buildMultiAngleProductScopeDirection({settings, photoCount:4});
  assert.match(prompt, /jacket, polo, trousers and loafers/);
  assert.match(prompt, /retain every distinct product together as a complete outfit/);
  assert.match(prompt, /ONLY if every distinct supplied product is footwear/);
  assert.doesNotMatch(prompt, /Use a footwear-led crop|TOP EDGE OF THE IMAGE|must NEVER be combined/);
});

test('actual shoe angle sets still receive conditional footwear direction without inventing extra pairs', () => {
  const prompt = buildMultiAngleProductScopeDirection({settings:{productCategory:'shoes'}, photoCount:4});
  assert.match(prompt, /one normal left\/right pair/);
  assert.match(prompt, /Repeated views of the same shoe are not additional products/);
  assert.match(prompt, /model identity, pose and location references are not additional products/);
  const outfit = buildMultiAngleProductScopeDirection({settings:{productCategory:'shoes'}, modes:{isMultipleProducts:true}, photoCount:4});
  assert.doesNotMatch(outfit, /use footwear-led photography/);
  assert.match(outfit, /footwear included in an outfit must not take over/);
});

test('only classified footwear in virtual-model creation gets the footwear brief', () => {
  assert.equal(isFootwearShoot({productCategory:' shoes '}), true);
  for (const productCategory of ['clothing','jewelry','boots','',null]) assert.equal(isFootwearShoot({productCategory}), false);
  assert.equal(isFootwearShoot(null), false);
  for(const mode of ['isRefinerMode','isEditMode','isColorChange','isPoseChange','isBackSideAnalysis']) {
    assert.equal(isFootwearShoot({productCategory:'shoes'},{[mode]:true}), false, mode);
  }
});

test('automatic footwear framing targets products; explicit framing and style references keep control', () => {
  const automatic = buildFootwearDirection({settings:{focusArea:'auto',pose:'auto'}});
  assert.match(automatic,/Use a footwear-led crop/);
  assert.match(automatic,/Choose a quiet, balanced stance/);
  for(const settings of [{focusArea:'full_body'},{framing:'full_body'},{perspective:'high_angle'}]) {
    const prompt=buildFootwearDirection({settings});
    assert.doesNotMatch(prompt,/Use a footwear-led crop/);
    assert.match(prompt,/Honor the explicit style reference and user-selected framing/);
  }
  const style=buildFootwearDirection({hasStyleReference:true});
  assert.doesNotMatch(style,/Use a footwear-led crop|Choose a quiet, balanced stance/);
  const pose=buildFootwearDirection({hasPoseReference:true});
  assert.doesNotMatch(pose,/Choose a quiet, balanced stance/);
  assert.match(pose,/Preserve the requested pose/);
});

test('multi-angle shoe views do not turn into multiple pairs and all outfit pieces are retained', () => {
  const prompt=buildFootwearEnhanceInstruction({multipleAnglesCount:3,kombinItemCount:2,
    customDetail:'Keep the red laces',originalPrompt:'Photograph in Aspen',context:'Selected age: 22'});
  assert.match(prompt,/SAME footwear design/);
  assert.match(prompt,/one left and one right shoe/);
  assert.match(prompt,/Retain every distinct supplied item/);
  assert.match(prompt,/Keep the red laces/);
  assert.match(prompt,/Selected age: 22/);
});

test('display and vacant-location failure modes do not erase the wearer or alter shoe construction', () => {
  const prompt=buildFootwearDirection();
  assert.match(prompt,/not part of the product/);
  assert.match(prompt,/never an instruction to remove the wearer/);
  assert.match(prompt,/Boot shafts contain the wearer's legs/);
  assert.match(prompt,/rigid sole and heel retain their construction/);
  assert.match(prompt,/unless the user explicitly requests a product-only photograph/);
});
