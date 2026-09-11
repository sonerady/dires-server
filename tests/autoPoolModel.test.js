const test = require("node:test");
const assert = require("node:assert");
const { applyAutoPoolModel, pickRandomPoolModel, parseAge, normalizeGender, POOL_MIN_AGE } = require("../src/utils/autoPoolModel");

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

test("havuz seçicisi gerektiğinde cinsiyete uygun kayıt bulabilir", async () => {
  const result = await pickRandomPoolModel({ supabase: fakeDb(), gender: "man", logger: silent });
  assert.ok(result);
  assert.equal(result.id, "m1");
  assert.equal(result.image_url, "https://cdn/m1.jpg");
});

test("18 yaş altında havuz kullanılmaz", async () => {
  assert.equal(await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: "12", logger: silent }), null);
  assert.equal(await applyAutoPoolModel({ supabase: fakeDb(), gender: "woman", age: "çocuk", logger: silent }), null);
  assert.equal(POOL_MIN_AGE, 18);
});

test("17 yaşındaki havuz satırı seçilmez, seçim rastgeledir", async () => {
  const picked = new Set();
  for (let i = 0; i < 60; i++) {
    const r = await pickRandomPoolModel({ supabase: fakeDb(), gender: "woman", logger: silent });
    picked.add(r.id);
  }
  assert.ok(!picked.has("w17"), "17 yaşındaki havuz modeli seçilmemeli");
  assert.deepEqual([...picked].sort(), ["w1", "w2"]);
});

test("otomatik model ataması herkes için kapalıdır ve havuz hiç okunmaz", async () => {
  const calls = [];
  for (const gender of ["woman", "man", null]) for (const age of ["26", "45", "12", null]) {
    const result = await applyAutoPoolModel({supabase: fakeDb(calls), gender, age, logger: silent});
    assert.equal(result, null);
  }
  assert.deepEqual(calls, []);
});
