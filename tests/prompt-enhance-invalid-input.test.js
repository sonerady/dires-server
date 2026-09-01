// 1 Eyl 2026 (kullanıcı kararı): Replicate "The input was invalid … (E006)"
// döndürdüğünde TEKRAR DENEME YAPILMAZ ve iş beklemeden DeepSeek'e geçer.
// (Aynı gün OpenRouter yolu tamamen kaldırıldı — zincir artık Replicate ⇄ DeepSeek.)
// Testler gerçek HTTP yerine axios.post'u taklit edip çağrı sırasını doğrular.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const axios = require("axios");

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
const provider = require("../src/utils/promptEnhanceProvider");

const E006 =
  "Async prediction failed: ModelError: The input was invalid. Please try again with different inputs. (E006) (uIJ6l3ruRD)";

function withStubbedProviders(handler, run) {
  const original = {
    post: axios.post,
    replicate: process.env.REPLICATE_API_TOKEN,
    deepseek: process.env.DEEPSEEK_API_KEY,
  };
  process.env.REPLICATE_API_TOKEN = "test-replicate-token";
  process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
  axios.post = handler;
  return run().finally(() => {
    axios.post = original.post;
    for (const [key, envName] of [
      ["replicate", "REPLICATE_API_TOKEN"],
      ["deepseek", "DEEPSEEK_API_KEY"],
    ]) {
      if (original[key] === undefined) delete process.env[envName];
      else process.env[envName] = original[key];
    }
  });
}

test("recognises the Replicate E006 invalid-input signature", () => {
  assert.equal(provider.isInvalidInputError(new Error(E006)), true);
  assert.equal(
    provider.isInvalidInputError({
      response: { data: { error: { message: "The input was invalid." } } },
    }),
    true,
  );
  // Geçici hatalar bu yola girmemeli — onlar normal retry + yedek yaşar.
  assert.equal(
    provider.isInvalidInputError(new Error("timeout of 120000ms exceeded")),
    false,
  );
  assert.equal(provider.isInvalidInputError(new Error("Rate limit exceeded")), false);
});

test("E006 skips retries and hands the job straight to DeepSeek", async () => {
  const calls = [];
  const output = await withStubbedProviders(
    async (url, body) => {
      if (url.includes("api.replicate.com")) {
        calls.push("replicate");
        // Replicate E006'yı 200 gövdesinde `error` alanıyla döndürür.
        return { data: { error: E006, status: "failed" } };
      }
      calls.push(`deepseek:${body.model}`);
      return { data: { choices: [{ message: { content: "DeepSeek prompt" } }] } };
    },
    () => provider.callGeminiFlash("brief", ["https://example.com/1.jpg"], 3),
  );

  assert.equal(output, "DeepSeek prompt");
  // maxRetries=3 verilmiş olmasına rağmen Replicate TEK kez denenir.
  assert.equal(calls.filter((c) => c === "replicate").length, 1);
  // Görsel varken DeepSeek vision modeline gider.
  assert.equal(calls.at(-1), "deepseek:deepseek-v4-flash-vision-exp");
});

test("a transient Replicate failure still retries before DeepSeek takes over", async () => {
  const calls = [];
  const output = await withStubbedProviders(
    async (url, body) => {
      if (url.includes("api.replicate.com")) {
        calls.push("replicate");
        throw new Error("timeout of 120000ms exceeded");
      }
      calls.push(`deepseek:${body.model}`);
      return { data: { choices: [{ message: { content: "DeepSeek prompt" } }] } };
    },
    () => provider.callGeminiFlash("brief", [], 2),
  );

  assert.equal(output, "DeepSeek prompt");
  // Geçici hata: maxRetries kadar denenir (E006'nın aksine).
  assert.equal(calls.filter((c) => c === "replicate").length, 2);
  // Görsel yokken düz metin modeli kullanılır.
  assert.equal(calls.at(-1), "deepseek:deepseek-v4-flash");
});

test("every prompt dispatcher breaks retries and falls back on invalid input", () => {
  for (const relativePath of [
    "../src/utils/promptEnhanceProvider.js",
    "../src/routes/referenceBrowserRoutesV7.js",
    "../src/routes/referenceJewelryBrowserRoutesV7.js",
    "../src/routes/generateProductKitRoutesV2.js",
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.match(source, /isInvalidInputError\(/, `${relativePath}: E006 tespiti yok`);
    assert.match(
      source,
      /fallback = useReplicateFirst \? "deepseek" : "replicate"/,
      `${relativePath}: DeepSeek yedeği bağlanmamış`,
    );
  }
});
