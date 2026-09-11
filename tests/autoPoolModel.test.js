const test = require("node:test");
const assert = require("node:assert");
const { applyAutoPoolModel, parseAge, normalizeGender, POOL_MIN_AGE } = require("../src/utils/autoPoolModel");

const rows = [
  { id: "w1", image_url: "https://cdn/w1.jpg", age: "22", gender: "woman", model_profile: { heightCm: 175 } },
  { id: "w2", image_url: "https://cdn/w2.jpg", age: "28", gender: "woman", model_profile: {} },
  { id: "w17", image_url: "https://cdn/w17.jpg", age: "17", gender: "woman", model_profile: {} },
  { id: "m1", image_url: "https://cdn/m1.jpg", age: "25", gender: "man", model_profile: {} },
];
const fakeDb = (calls = []) => ({
  from(table) {
    calls.push(table);
    let gender = null;
    const api = {
      select: () => api,
      eq: (_col, value) => { gender = value; return api; },
      limit: () => Promise.resolve({ data: rows.filter((r) => r.gender === gender), error: null }),
    };
    return api;
  },
});
const silent = { warn() {}, log() {} };

test("yaş ayrıştırma", () => {
  assert.equal(parseAge("22"), 22);
  assert.equal(parseAge("young"), 22);
  assert.equal(parseAge("çocuk"), 5);
  assert.equal(parseAge(""), null);
});

test("cinsiyet normalize", () => {
  assert.equal(normalizeGender("female"), "woman");
  assert.equal(normalizeGender("man"), "man");
  assert.equal(normalizeGender("woman"), "woman");
});

test("18+ ise havuzdan cinsiyete uygun model seçilir", async () => {
  const result = await applyAutoPoolModel({ supabase: fakeDb(), gender: "man", age: "26", logger: silent });
  assert.ok(result);
  assert.equal(result.poolModelId, "m1");
  assert.equal(result.modelPhoto, "https://cdn/m1.jpg");
});

test("18 yaş altında havuz kullanılmaz", async () => {
  assert.equal(await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: "12", logger: silent }), null);
  assert.equal(await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: "çocuk", logger: silent }), null);
  assert.equal(POOL_MIN_AGE, 18);
});

test("17 yaşındaki havuz satırı seçilmez, seçim rastgeledir", async () => {
  const picked = new Set();
  for (let i = 0; i < 60; i++) {
    const r = await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: "24", logger: silent });
    picked.add(r.poolModelId);
  }
  assert.ok(!picked.has("w17"), "17 yaşındaki havuz modeli seçilmemeli");
  assert.deepEqual([...picked].sort(), ["w1", "w2"]);
});

test("yaş bilinmiyorsa yetişkin varsayılır ve havuz uygulanır", async () => {
  const r = await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: null, logger: silent });
  assert.ok(r);
  assert.ok(["w1", "w2"].includes(r.poolModelId));
});
