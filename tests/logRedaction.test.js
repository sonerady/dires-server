const test = require('node:test');
const assert = require('node:assert/strict');
const { createLogRedactor, installLogRedaction } = require('../src/utils/logRedaction');

test('nested request/SDK objects lose credentials without mutation', () => {
  const input = { method: 'POST', headers: { Authorization: 'Bearer private-access-value', 'x-api-key': 'private-key-value', Cookie: 'session=private-cookie' }, body: { password: 'two secret words', refresh_token: 'refresh-value', receiptData: 'receipt-value' }, status: 502 };
  const snapshot = JSON.stringify(input), output = createLogRedactor({})(input);
  for (const secret of ['private-access-value', 'private-key-value', 'private-cookie', 'two secret words', 'refresh-value', 'receipt-value']) assert.ok(!output.includes(secret));
  assert.match(output, /POST/); assert.match(output, /502/); assert.equal(JSON.stringify(input), snapshot);
});
test('strings, printf labels, JSON, URLs, JWTs and env values are redacted', () => {
  const redact = createLogRedactor({ FAL_KEY: 'configured-fal-secret', ADMIN_AUTH_TOKEN: 'configured-admin-secret', REVENUECAT_WEBHOOK_AUTH: 'configured-webhook-secret' });
  // FAL_KEY is deliberately checked through the generic API/provider key env rule.
  const samples = [
    ['Authorization: %s', 'opaque access value'], ['password:', 'multiple secret words'],
    ['{"access_token":"json-secret","status":401}'],
    ['https://example.test/reset?token=query-secret&userId=test'],
    ['Bearer bearer-secret'], ['Cookie: session=cookie-one; auth=cookie-two'], ['configured-webhook-secret'], ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature'],
    ['provider failed: configured-admin-secret'], ['provider failed: configured-fal-secret'], ['https://user:dbpass@example.test/path'],
  ];
  for (const args of samples) {
    const output = redact(...args);
    assert.match(output, /REDACTED/);
    for (const secret of ['opaque access value', 'multiple secret words', 'json-secret', 'query-secret', 'bearer-secret', 'eyJhbGci', 'configured-admin-secret', 'configured-fal-secret', 'configured-webhook-secret', 'cookie-one', 'cookie-two', 'dbpass']) assert.ok(!output.includes(secret), output);
  }
});
test('Errors, cycles and custom inspectors cannot expose raw secrets', () => {
  const redact = createLogRedactor({}); const error = new Error('request failed token=error-secret');
  error.config = { headers: { Authorization: 'Bearer error-header' } }; error.cause = error;
  const output = redact(error); assert.match(output, /request failed/); assert.match(output, /Circular/);
  assert.ok(!output.includes('error-secret')); assert.ok(!output.includes('error-header'));
  const object = { status: 500, [Symbol.for('nodejs.util.inspect.custom')]: () => 'inspector-secret' };
  assert.ok(!redact(object).includes('inspector-secret'));
});
test('console boundary covers all severities and installs once', () => {
  const writes=[];const sink={};
  for (const method of ['log','info','warn','error','debug','trace','dir','table']) sink[method]=(...args)=>writes.push(args);
  sink.assert=(condition,...args)=>{if(!condition)writes.push(args);};
  installLogRedaction(sink, { API_KEY:'configured-secret-value' }); const first=sink.log;installLogRedaction(sink,{});assert.equal(sink.log,first);
  for(const method of ['log','info','warn','error','debug','trace','dir','table'])sink[method]({apiKey:'hidden-value',status:200});
  sink.assert(true,'configured-secret-value');sink.assert(false,'configured-secret-value');
  assert.equal(writes.length,9);assert.ok(!JSON.stringify(writes).includes('hidden-value'));assert.ok(!JSON.stringify(writes).includes('configured-secret-value'));
});
