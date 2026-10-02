const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { refinerBackgroundMode, refinerBackgroundInput } = require('../src/utils/refinerBackground');
const { buildEditInput, GPT25_EDIT_MODEL } = require('../src/utils/gpt25Edit');
const { prepareRefinerResultImage } = require('../src/utils/refinerResultImage');

test('phone and web/tablet settings send actual GPT alpha output, overriding staged backdrops', () => {
  for (const settings of [{backgroundMode:'transparent'}, {refinerSettings:{backgroundMode:'transparent'}}]) {
    const input = buildEditInput(GPT25_EDIT_MODEL, {
      ...refinerBackgroundInput('Use a white studio background', refinerBackgroundMode({settings})),
      image_urls:['https://example.test/product.jpg'], aspect_ratio:'2:3', quality:'high',
    });
    assert.equal(input.background, 'transparent');
    assert.equal(input.output_format, 'png');
    assert.match(input.prompt, /Empty areas must have zero alpha/);
    assert.match(input.prompt, /Do not draw a checkerboard/);
    assert.match(input.prompt, /Honor the shadow and reflection settings above/);
    assert.match(input.prompt, /graduated alpha beneath the product/);
    assert.match(input.prompt, /Do not add effects that are switched off/);
    assert.deepEqual(input.image_size, {width:1632,height:2448});
  }
});
test('opaque and old requests retain their background prompt and JPEG output', () => {
  for (const settings of [{}, {backgroundMode:'opaque'}, {backgroundMode:'invalid'}]) {
    const input = refinerBackgroundInput('Use blue', refinerBackgroundMode({settings}));
    assert.equal(input.background, 'opaque'); assert.equal(input.output_format, 'jpeg'); assert.equal(input.prompt, 'Use blue');
  }
});
test('transparent generated image is stored with PNG extension and MIME without losing alpha', async () => {
  const original = await sharp({create:{width:8,height:12,channels:4,background:{r:220,g:50,b:30,alpha:0.5}}}).png().toBuffer();
  const prepared = await prepareRefinerResultImage(original);
  assert.equal(prepared.extension,'png'); assert.equal(prepared.contentType,'image/png');
  assert.equal((await sharp(prepared.buffer).metadata()).hasAlpha,true);
  assert.deepEqual(prepared.buffer,original);
});
test('JPEG sharpening output regains the original alpha mask at the new resolution', async () => {
  const rgba = Buffer.from([240,20,30,0, 240,20,30,255, 240,20,30,0, 240,20,30,255]);
  const original = await sharp(rgba,{raw:{width:2,height:2,channels:4}}).png().toBuffer();
  const sharpened = await sharp({create:{width:20,height:20,channels:3,background:'#f0141e'}}).jpeg().toBuffer();
  const prepared = await prepareRefinerResultImage(sharpened,original);
  const metadata = await sharp(prepared.buffer).metadata();
  assert.equal(metadata.width,20); assert.equal(metadata.height,20); assert.equal(metadata.hasAlpha,true);
  const alpha = await sharp(prepared.buffer).extractChannel('alpha').raw().toBuffer();
  assert.equal(alpha[0],0); assert.equal(alpha[19],255);
});
