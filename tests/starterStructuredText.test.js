const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(primary, post) {
  const context = { module: { exports: {} }, process: { env: { DEEPSEEK_API_KEY: 'fixture', REPLICATE_API_TOKEN: 'fixture' } }, console: { log() {}, error() {} }, setTimeout };
  context.require = name => {
    if (name === 'axios') return { post };
    if (name === '@supabase/supabase-js') return { createClient: () => ({ from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { prompt_enhance_provider: primary } }) }) }) }) }) };
    throw new Error('Unexpected module: ' + name);
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/utils/promptEnhanceProvider'), 'utf8'), context);
  return context.module.exports.callStructuredText;
}

test('both name providers receive JSON instructions, bounded output/time and cancellation', async () => {
  for (const primary of ['deepseek', 'replicate']) {
    const controller = new AbortController(); let calls = 0;
    const complete = fixture(primary, async (url, body, options) => {
      calls++;
      assert.equal(options.timeout, 20000);
      assert.equal(options.signal, controller.signal);
      const instruction = body.input?.system_instruction || body.messages[0].content;
      assert.match(instruction, /only valid JSON/);
      assert.doesNotMatch(instruction, /photographer|fluent, natural English/);
      assert.equal(body.input?.max_output_tokens || body.max_tokens, 512);
      return { data: primary === 'deepseek' ? { choices: [{ message: { content: '["Ada","Mira","Lina"]' } }] } : { status: 'succeeded', output: '["Ada","Mira","Lina"]' } };
    });
    assert.equal(await complete('Names in Turkish', { signal: controller.signal }), '["Ada","Mira","Lina"]');
    assert.equal(calls, 1);
  }
});

test('one provider failure uses its fallback; cancellation never starts a fallback', async () => {
  let calls = 0;
  const fallback = fixture('deepseek', async () => {
    if (++calls === 1) throw new Error('Timeout');
    return { data: { status: 'succeeded', output: '["Ada","Mira","Lina"]' } };
  });
  await fallback('Names'); assert.equal(calls, 2);
  const controller = new AbortController(); calls = 0;
  const cancelled = fixture('deepseek', async () => { calls++; controller.abort(); throw new Error('Cancelled'); });
  await assert.rejects(cancelled('Names', { signal: controller.signal }));
  assert.equal(calls, 1);
});
