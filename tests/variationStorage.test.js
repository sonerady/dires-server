const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVariationStoragePath,
  persistVariationImage,
} = require("../src/utils/variationStorage");

test("variation bucket paths are stable and sanitized", () => {
  assert.equal(
    buildVariationStoragePath({
      userId: "user/42",
      sourceGenerationId: "source 7",
      generationId: "var:9",
    }),
    "variations/user_42/source_7/var_9.jpg",
  );
});

test("completed variation images are uploaded to the permanent images bucket", async () => {
  const calls = [];
  const storage = {
    async upload(path, buffer, options) {
      calls.push({ path, buffer: buffer.toString(), options });
      return { error: null };
    },
    getPublicUrl(path) {
      return { data: { publicUrl: `https://cdn.example/${path}` } };
    },
  };
  const supabase = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "images");
        return storage;
      },
    },
  };
  const httpClient = {
    async get(url, options) {
      assert.equal(url, "https://fal.example/result.jpg");
      assert.equal(options.responseType, "arraybuffer");
      return { data: Buffer.from("jpeg-data") };
    },
  };

  const result = await persistVariationImage({
    supabase,
    sourceUrl: "https://fal.example/result.jpg",
    userId: "u1",
    sourceGenerationId: "s1",
    generationId: "v1",
    httpClient,
  });

  assert.equal(result.publicUrl, "https://cdn.example/variations/u1/s1/v1.jpg");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "variations/u1/s1/v1.jpg");
  assert.equal(calls[0].options.contentType, "image/jpeg");
  assert.equal(calls[0].options.upsert, true);
});

test("a bucket upload failure rejects instead of storing the temporary provider URL", async () => {
  const supabase = {
    storage: {
      from() {
        return {
          async upload() {
            return { error: { message: "bucket unavailable" } };
          },
          getPublicUrl() {
            return { data: {} };
          },
        };
      },
    },
  };

  await assert.rejects(
    persistVariationImage({
      supabase,
      sourceUrl: "https://fal.example/result.jpg",
      userId: "u1",
      sourceGenerationId: "s1",
      generationId: "v1",
      httpClient: { get: async () => ({ data: Buffer.from("jpeg-data") }) },
    }),
    /bucket upload failed/,
  );
});
