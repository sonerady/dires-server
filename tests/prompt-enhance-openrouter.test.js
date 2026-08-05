const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
const provider = require("../src/utils/promptEnhanceProvider");

test("OpenRouter Gemini sends text first and preserves all image references", async () => {
  const originalPost = axios.post;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";

  try {
    axios.post = async (url, body, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(body.model, "google/gemini-3.5-flash");
      assert.deepEqual(body.reasoning, { effort: "low", exclude: true });
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].content[0].type, "text");
      assert.equal(body.messages[1].content[0].text, "Improve this prompt");
      assert.deepEqual(
        body.messages[1].content.slice(1),
        ["https://example.com/one.jpg", "https://example.com/two.webp"].map(
          (url) => ({ type: "image_url", image_url: { url } }),
        ),
      );
      assert.equal(options.headers.Authorization, "Bearer test-openrouter-key");
      return { data: { choices: [{ message: { content: "Enhanced prompt" } }] } };
    };

    const output = await provider.callOpenRouterGeminiFlash(
      "Improve this prompt",
      ["https://example.com/one.jpg", "https://example.com/two.webp"],
      1,
    );
    assert.equal(output, "Enhanced prompt");
  } finally {
    axios.post = originalPost;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test("every app-config prompt dispatcher maps gemini to OpenRouter", () => {
  for (const relativePath of [
    "../src/utils/promptEnhanceProvider.js",
    "../src/routes/referenceBrowserRoutesV7.js",
    "../src/routes/generateProductKitRoutesV2.js",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.ok(source.includes("Provider: gemini (OpenRouter"), relativePath);
    assert.ok(source.includes("callOpenRouterGeminiFlash("), relativePath);
  }
});
