const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getTool, validateOptions, buildPrompt } = require('../src/utils/studioTools');
const tool = getTool('food-photography');
const custom = {
  purposeCustom: 'Cookbook cover', angleCustom: 'Low 30 degree angle',
  lightingCustom: 'Soft backlight', sceneCustom: 'Blue ceramic tabletop',
  stylingCustom: 'Folded linen beside the plate',
};

test('food custom choices replace preset instructions and preserve the dish', () => {
  const prompt = buildPrompt(tool, { ...validateOptions(tool, custom), refs: [{id:'style',count:1}], foodStylePrompt:'Warm restaurant mood' });
  for (const value of Object.values(custom)) assert.ok(prompt.includes(value));
  for (const control of tool.controls) {
    assert.ok(!prompt.includes(control.options.find(option => option.id === control.default).instruction));
  }
  assert.match(prompt, /supplied dish, ingredients and plate must remain unchanged/);
  assert.match(prompt, /FOOD FIDELITY/);
  assert.match(prompt, /explicit light\/scene overrides win/);
});

test('food free text is bounded and does not enable unrelated fields or tools', () => {
  for (const key of Object.keys(custom)) {
    for (const value of ['', ' ', 'a'.repeat(121), 12, {}]) assert.throws(() => validateOptions(tool, {[key]:value}), /invalid_input/);
    assert.equal(validateOptions(tool, {[key]:'  sample  '}).texts[key], 'sample');
  }
  assert.throws(() => validateOptions(tool, {productCustom:'pasta'}), /invalid_input/);
  assert.throws(() => validateOptions(getTool('marketplace-main-image'), {lightingCustom:'Soft light'}), /invalid_input/);
});

test('app and web send custom fields consistently and resolve style changes', async () => {
  const files = ['client/commerce/foodPhotography.js','web-dashboard/lib/foodPhotography.js'];
  const sources = files.map(file => fs.readFileSync(path.resolve(__dirname, '../..', file),'utf8'));
  assert.equal(sources[0], sources[1]);
  const helper = await import(`data:text/javascript;base64,${Buffer.from(sources[0]).toString('base64')}`);
  assert.equal(helper.foodCustomMissing({sceneCustom:''}), true);
  assert.equal(helper.foodCustomMissing({sceneCustom:null}), false);
  assert.deepEqual(helper.applyFoodOptions({scene:'neutral', angle:'auto'}, {sceneCustom:'Blue tabletop'}), {sceneCustom:'Blue tabletop',angle:'auto'});
  const selected = helper.foodStyleSelections({lighting:'studio',lightingCustom:'Side light',sceneCustom:'Marble',purposeCustom:'Book'}, {});
  assert.equal(selected.lightingCustom, null); assert.equal(selected.sceneCustom,null);
  assert.equal(selected.lighting,'reference'); assert.equal(selected.scene,'reference');
  assert.equal(selected.purposeCustom,'Book');
  const removed = helper.foodStyleSelections({...selected,lightingCustom:'Custom light'}, null);
  assert.equal(removed.lighting,'window'); assert.equal(removed.scene,'neutral');
  assert.equal(removed.lightingCustom,'Custom light');
  assert.ok(helper.foodControls(tool,null).every(control=>control.options.every(option=>option.id!=='reference')));
  assert.ok(helper.foodControls(tool,{}).find(control=>control.id==='lighting').options.some(option=>option.id==='reference'));
});
