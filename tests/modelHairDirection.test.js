const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { buildModelHairDirection } = require('../src/utils/modelHairDirection');

test('selected identity gets general outfit/atmosphere hairstyling without a fixed style', () => {
  const prompt = buildModelHairDirection({ hasModelReference: true });
  assert.match(prompt, /recognizable face, identity/);
  assert.match(prompt, /outfit and the scene's atmosphere/);
  assert.match(prompt, /not a fixed hairstyle reference/);
  assert.doesNotMatch(prompt, /ponytail|bun|bob|waves|slick|curly/i);
  assert.equal(buildModelHairDirection(), '');
  for (const hairStyle of [null, '', 'auto', 'automatic', 'default', ' AUTO ']) {
    assert.equal(buildModelHairDirection({ hasModelReference: true, settings: { hairStyle } }), prompt);
  }
});

test('manual hairstyle and hijab choices disable automatic styling; hair color stays respected', () => {
  for (const hijabMode of [true, 'true', 1, '1']) {
    assert.equal(buildModelHairDirection({ hasModelReference: true, settings: { hijabMode } }), '');
  }
  assert.equal(buildModelHairDirection({ hasModelReference: true, settings: { hairStyle: 'curtain_bangs' } }), '');
  assert.equal(buildModelHairDirection({ hasModelReference: true, hairStyleImage: 'https://example.com/hair.jpg' }), '');
  assert.match(buildModelHairDirection({ hasModelReference: true, settings: { hairColor: 'brown', hijabMode: false } }), /Honor any explicit user hair instructions, including a selected hair color/);
});

test('editing existing results never introduces automatic hair changes', () => {
  for (const flag of ['isEditMode', 'isRefinerMode', 'isColorChange', 'isPoseChange', 'isBackSideAnalysis']) {
    assert.equal(buildModelHairDirection({ hasModelReference: true, [flag]: true }), '');
  }
});

for (const route of ['referenceBrowserRoutesV7.js', 'referenceJewelryBrowserRoutesV7.js']) {
  test(`${route}: final prompt includes direction even when enhancement was bypassed`, () => {
    const source = fs.readFileSync(require.resolve('../src/routes/' + route), 'utf8');
    const start = source.indexOf('    // Apply after enhancement and style-reference bypasses');
    const end = source.indexOf('    // 🔒 ADD DETAIL + ADVANCED SETTINGS SON KİLİT', start);
    assert(start > 0 && end > start);
    for (const settings of [{}, { hijabMode: true }, { hairStyle: 'selected style' }]) {
      const context = {
        buildModelHairDirection, settings, modelReferenceImage: { uri: 'model.jpg' },
        hairStyleImage: null, isEditMode: false, isRefinerMode: false,
        isColorChange: false, isPoseChange: false, req: { body: {} },
        enhancedPrompt: 'Style reference shoot brief',
      };
      vm.runInNewContext(source.slice(start, end), context);
      assert.equal(context.enhancedPrompt.includes('MODEL HAIRSTYLING:'), Object.keys(settings).length === 0);
    }
    // The normal enhancement branch must not reintroduce an unconditional hair lock.
    assert.doesNotMatch(source, /apparent age, and hair exactly as seen in the model reference image/);
    assert.match(source, /\$\{modelHairDirection \|\| "Preserve their reference hairstyle unless explicit user hair or hijab instructions override it\."\}/);
  });
}
