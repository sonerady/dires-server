const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const parser = require('../../client/node_modules/@babel/parser');

for (const route of ['changePose', 'changePoseWeb']) {
  function setup() {
    const source = fs.readFileSync(path.join(__dirname, '../src/routes', route + '.js'), 'utf8');
    const ast = parser.parse(source, {sourceType: 'script'});
    const names = ['ensureRemoteReferenceImage', 'sanitizeImageUrl', 'enhancePromptWithGemini', 'buildPoseChangeDirectiveItem', 'sanitizePoseText'];
    const declarations = ast.program.body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)).map(n => source.slice(n.start, n.end)).join('\n');
    const uploads = [], calls = [], errors = [];
    const context = vm.createContext({
      Buffer, URL, console: {log(){}, error(...args){errors.push(args);}}, logger: {log(){}},
      uploadReferenceImageToSupabase: async (data, user) => {uploads.push({data, user}); return 'https://test/source.jpg';},
      axios: {get: async () => ({data: Buffer.from('fixture')})},
      generatePoseDescriptionWithGemini: async () => 'Stand with one hand raised.',
      callReplicateGeminiFlash: async (prompt, images) => {
        calls.push({prompt, images: Array.from(images)});
        return ('Keep the source person and the black sweater unchanged while raising one arm naturally. ').repeat(5);
      },
    });
    vm.runInContext(declarations, context);
    return {context, uploads, calls, errors};
  }
  test(`${route}: inline model image reaches prompt analysis before the pose sample`, async () => {
    const h = setup();
    const data = 'data:image/png;base64,' + Buffer.from('source model').toString('base64');
    const model = await h.context.ensureRemoteReferenceImage({uri: data, type:'model'}, 'test-user');
    assert.equal(model.uri, 'https://test/source.jpg');
    assert.equal(model.alreadyUploaded, true);
    assert.equal(h.uploads[0].data, data);
    await h.context.enhancePromptWithGemini('Raise one arm', model.uri, {pose:'Raise one arm'}, null, 'https://test/pose.jpg', null, false, false, null, true);
    assert.deepEqual(h.errors, []);
    const analysis = h.calls.at(-1);
    assert.ok(analysis, 'prompt analysis must run');
    assert.deepEqual(analysis.images, ['https://test/source.jpg','https://test/pose.jpg']);
    assert.match(analysis.prompt, /Image 1 is the source photograph/);
    assert.match(analysis.prompt, /pose example ONLY/);
  });
  test(`${route}: remote references are retained and string data URLs are uploaded`, async () => {
    const h = setup();
    const remote = await h.context.ensureRemoteReferenceImage({uri:'https://test/existing.jpg', type:'model'}, 'test-user');
    assert.equal(remote.uri,'https://test/existing.jpg');assert.equal(h.uploads.length,0);
    await h.context.ensureRemoteReferenceImage('data:image/jpeg;base64,ZmFrZQ==','test-user');
    assert.equal(h.uploads.length,1);
    const file = await h.context.ensureRemoteReferenceImage({uri:'file:///photo.jpg',base64:'ZmFrZQ=='},'test-user');
    assert.equal(file.uri,'https://test/source.jpg');assert.equal(h.uploads.length,2);
  });
}
