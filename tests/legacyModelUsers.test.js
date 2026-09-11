const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

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
    assert.ok(src.includes("getLegacyFlags(supabase, requestUserId"), `${route}: id kaynağı`);
  }
});
