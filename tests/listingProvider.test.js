const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { GPT25_EDIT_MODEL, buildEditInput } = require('../src/utils/gpt25Edit');
test('listing invokes Sunburst High with GPT fields and records actual provider', async () => {
  const source = fs.readFileSync(require.resolve('../src/routes/listingStudioRoutes'), 'utf8');
  const fn = source.slice(source.indexOf('async function generateOne'), source.indexOf('async function buildBrief'));
  let sent;
  const run = vm.runInNewContext(`(${fn.trim()})`, {
    GPT25_EDIT_MODEL, buildEditInput, process:{env:{FAL_API_KEY:'test'}},
    axios:{post:async (url,body)=>{sent={url,body};return {data:{images:[{url:'https://example.com/result.png'}]}}}}
  });
  const output=await run({prompt:'product campaign',imageUrl:'https://example.com/product.png',ratio:'4:5'});
  assert.equal(sent.url,'https://fal.run/openai/gpt-image-2.5/sunburst/edit');
  assert.equal(sent.body.quality,'high');
  assert.deepEqual(sent.body.image_size,{width:1792,height:2240});
  assert.equal(sent.body.resolution,undefined);
  assert.equal(sent.body.safety_tolerance,undefined);
  assert.equal(output.provider,'gpt-image-2.5:sunburst:high');
});
