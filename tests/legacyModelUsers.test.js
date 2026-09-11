const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const parser = require("../../client/node_modules/@babel/parser");

function freshModule() {
  delete require.cache[require.resolve("../src/utils/legacyModelUsers")];
  return require("../src/utils/legacyModelUsers");
}

const rows = [
  { email: "Andy@SheIsMe.com", use_nbpro_v2: true, skip_auto_pool_model: true },
  { email: "solo@example.com", use_nbpro_v2: true, skip_auto_pool_model: false },
];
const fakeDb = (users = {}) => ({
  from(table) {
    const api = {
      _col: null, _val: null,
      select: () => api,
      eq: (col, value) => { api._col = col; api._val = value; return api; },
      in: () => api,
      maybeSingle: () => Promise.resolve({ data: users[api._val] ? { email: users[api._val] } : null, error: null }),
      then: (resolve) => resolve({ data: table === "legacy_model_users" ? rows : [], error: null }),
    };
    if (table === "legacy_model_users") {
      return { select: () => Promise.resolve({ data: rows, error: null }) };
    }
    return api;
  },
});
const silent = { warn() {}, log() {} };

test("e-posta büyük/küçük harften bağımsız eşleşir", async () => {
  const { getLegacyFlagsByEmail, invalidateLegacyCache } = freshModule();
  invalidateLegacyCache();
  const flags = await getLegacyFlagsByEmail(fakeDb(), "ANDY@sheisme.COM", silent);
  assert.equal(flags.isLegacy, true);
  assert.equal(flags.useNbproV2, true);
  assert.equal(flags.skipAutoPoolModel, true);
});

test("listede olmayan kullanıcı etkilenmez", async () => {
  const { getLegacyFlagsByEmail, invalidateLegacyCache } = freshModule();
  invalidateLegacyCache();
  const flags = await getLegacyFlagsByEmail(fakeDb(), "shirley@kissprom.com", silent);
  assert.equal(flags.isLegacy, false);
  assert.equal(flags.useNbproV2, false);
  assert.equal(flags.skipAutoPoolModel, false);
});

test("bayraklar tek tek kapatılabilir", async () => {
  const { getLegacyFlagsByEmail, invalidateLegacyCache } = freshModule();
  invalidateLegacyCache();
  const flags = await getLegacyFlagsByEmail(fakeDb(), "solo@example.com", silent);
  assert.equal(flags.useNbproV2, true);
  assert.equal(flags.skipAutoPoolModel, false);
});

test("kullanıcı id'sinden e-posta çözülür", async () => {
  const { getLegacyFlags, invalidateLegacyCache } = freshModule();
  invalidateLegacyCache();
  const db = fakeDb({ "u-1": "andy@sheisme.com" });
  const flags = await getLegacyFlags(db, "u-1", silent);
  assert.equal(flags.isLegacy, true);
  assert.equal(await getLegacyFlags(db, null, silent).then((f) => f.isLegacy), false);
});

test("rotalar legacy bayraklarını uyguluyor", () => {
  for (const route of ["referenceBrowserRoutesV7", "referenceJewelryBrowserRoutesV7"]) {
    const src = fs.readFileSync(path.join(__dirname, `../src/routes/${route}.js`), "utf8");
    assert.ok(src.includes("!legacyFlags.skipAutoPoolModel"), `${route}: havuz atlama`);
    assert.ok(src.includes("!legacyFlags.useNbproV2"), `${route}: V2 nb-pro`);
    assert.ok(src.includes("getLegacyFlags(modelPoolDb || supabase, requestUserId"), `${route}: admin bağlantısı ve istek kullanıcı id'si`);
  }
});

for (const route of ["referenceBrowserRoutesV7", "referenceJewelryBrowserRoutesV7"]) {
  test(`${route}: RLS ile gizlenen liste admin bağlantısından okunur ve V2 NB Pro 2K'ya gider`, async () => {
    const src = fs.readFileSync(path.join(__dirname, `../src/routes/${route}.js`), "utf8");
    const ast = parser.parse(src, {sourceType: "script"}), nodes = [];
    function visit(n) {
      if (!n || typeof n !== "object") return;
      if (n.type) nodes.push(n);
      for (const [k, v] of Object.entries(n)) if (k !== "loc") Array.isArray(v) ? v.forEach(visit) : visit(v);
    }
    visit(ast);
    const code = n => src.slice(n.start, n.end);
    const lookup = nodes.find(n => n.type === "CallExpression" && n.callee.name === "getLegacyFlags");
    const gptBranch = nodes.find(n => n.type === "IfStatement" && code(n.test).includes("!v2GptFailed"));
    const model = nodes.find(n => n.type === "VariableDeclarator" && n.id.name === "falModel" && n.init?.value === "fal-ai/nano-banana-pro/edit");
    const input = nodes.find(n => n.type === "ObjectExpression" && n.properties.some(p => p.key?.name === "prompt" && p.value?.name === "promptForNanoBananaPro") && n.properties.some(p => p.key?.name === "resolution" && p.value?.value === "2K"));
    const send = nodes.find(n => n.type === "CallExpression" && n.callee.object?.name === "axios" && n.callee.property?.name === "post" && code(n.arguments[0]).includes("${falModel}"));
    let anonReads = 0, sent;
    const context = {
      getLegacyFlags: freshModule().getLegacyFlags,
      modelPoolDb: fakeDb({"u-1": "andy@sheisme.com"}),
      supabase: {from: () => {anonReads++; return {select: async () => ({data: [], error: null})};}},
      requestUserId: "u-1", logger: silent,
      isV2: true, req: {body: {}}, v2GptFailed: false, getV2Model: () => "gpt25",
      promptForNanoBananaPro: "preserve product", imageInputArray: ["https://test/product"],
      aspectRatioForRequest: "9:16", qualityParam: "2K", safetyTolerance: "4",
      process: {env: {FAL_API_KEY: "fixture"}},
      axios: {post: async (url, body) => {sent = {url, body};}},
    };
    context.legacyFlags = await vm.runInNewContext(code(lookup), context);
    assert.equal(anonReads, 0);
    assert.equal(context.legacyFlags.useNbproV2, true);
    assert.equal(vm.runInNewContext(code(gptBranch.test), context), false);
    context.falModel = vm.runInNewContext(code(model.init), context);
    context.requestBody = vm.runInNewContext(`(${code(input)})`, context);
    await vm.runInNewContext(code(send), context);
    assert.equal(sent.url, "https://fal.run/fal-ai/nano-banana-pro/edit");
    assert.equal(sent.body.resolution, "2K");
    assert.equal(sent.body.image_urls, context.imageInputArray);
  });
}
