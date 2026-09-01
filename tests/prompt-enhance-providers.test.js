// 1 Eyl 2026 (kullanıcı kararı): DOĞRUDAN OPENROUTER YOLU KALDIRILDI.
// Prompt enhance artık yalnız iki sağlayıcı tanır — Replicate ⇄ DeepSeek — ve
// app_config.prompt_enhance_provider hangisinin ÖNCE deneneceğini seçer.
// (fal üzerinden giden "openrouter/router/vision" geçidi bu testin kapsamı
// dışındadır; o fal faturasına yazılır ve productTypeRoutes/bannerStudio'da durur.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ||= "test-anon-key";
const provider = require("../src/utils/promptEnhanceProvider");

const DISPATCHER_FILES = [
  "../src/utils/promptEnhanceProvider.js",
  "../src/routes/referenceBrowserRoutesV7.js",
  "../src/routes/referenceJewelryBrowserRoutesV7.js",
  "../src/routes/generateProductKitRoutesV2.js",
];

test("no dispatcher calls OpenRouter directly any more", () => {
  for (const relativePath of DISPATCHER_FILES) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /callOpenRouterGeminiFlash|openrouter\.ai|OPENROUTER_API_KEY/,
      `${relativePath}: doğrudan OpenRouter kalıntısı var`,
    );
  }
});

test("the provider module no longer exports OpenRouter or Luna helpers", () => {
  for (const removed of [
    "callOpenRouterGeminiFlash",
    "OPENROUTER_GEMINI_MODEL",
    "callLunaFlash",
    "callLunaVisionClassifier",
  ]) {
    assert.equal(
      provider[removed],
      undefined,
      `${removed} hâlâ dışa açık — OpenRouter yolu tam kaldırılmamış`,
    );
  }
});

test("every prompt dispatcher honours app_config and keeps both providers", () => {
  for (const relativePath of DISPATCHER_FILES) {
    const source = fs.readFileSync(path.join(__dirname, relativePath), "utf8");
    assert.ok(
      source.includes("await getPromptEnhanceProvider()"),
      `${relativePath}: config okunmuyor`,
    );
    // "deepseek" dışındaki her değer (eski "gemini" dahil) Replicate demektir.
    assert.ok(
      source.includes('provider !== "deepseek"'),
      `${relativePath}: sağlayıcı eşlemesi güncel değil`,
    );
    assert.ok(
      /callReplicateGeminiFlash(Raw)?\(/.test(source),
      `${relativePath}: Replicate yolu yok`,
    );
    assert.ok(
      source.includes("callDeepSeekFlashRaw("),
      `${relativePath}: DeepSeek yolu yok`,
    );
  }
});
