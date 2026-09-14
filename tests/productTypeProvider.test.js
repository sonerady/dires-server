const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyWithProvider } = require("../src/utils/productTypeProvider");

test("DeepSeek remains the default and a successful analysis never calls Fal", async () => {
  const result = await classifyWithProvider({
    deepseek: async () => '{"category":"shoes"}',
    fal: () => assert.fail("Fallback must not be called"),
  });
  assert.deepEqual(result, { raw: '{"category":"shoes"}', provider: "deepseek" });
});

test("a provider failure uses Fal once, without retrying DeepSeek", async () => {
  const calls = [];
  const result = await classifyWithProvider({
    deepseek: async () => { calls.push("deepseek"); throw new Error("unavailable"); },
    onFallback: () => calls.push("fallback"),
    fal: async () => { calls.push("fal"); return '{"category":"jewelry"}'; },
  });
  assert.deepEqual(calls, ["deepseek", "fallback", "fal"]);
  assert.equal(result.provider, "fal");
});

test("a hung primary is aborted and cannot overwrite the fallback result", async () => {
  let primarySignal;
  let finishPrimary;
  const result = await classifyWithProvider({
    deepseekTimeoutMs: 10,
    deepseek: (signal) => {
      primarySignal = signal;
      return new Promise((resolve) => { finishPrimary = resolve; });
    },
    fal: async () => "fallback analysis",
  });
  assert.equal(primarySignal.aborted, true);
  finishPrimary("late primary analysis");
  assert.deepEqual(result, { raw: "fallback analysis", provider: "fal" });
});

test("empty primary output also uses Fal", async () => {
  const result = await classifyWithProvider({ deepseek: async () => "  ", fal: async () => "valid" });
  assert.equal(result.provider, "fal");
});

test("an explicit Fal config never calls DeepSeek", async () => {
  const result = await classifyWithProvider({
    provider: "fal",
    deepseek: () => assert.fail("DeepSeek must not be called"),
    fal: async () => "valid",
  });
  assert.equal(result.provider, "fal");
});

test("both failed providers reject so the route can return its safe fallback", async () => {
  await assert.rejects(classifyWithProvider({
    deepseek: async () => { throw new Error("primary down"); },
    fal: async () => { throw new Error("fallback down"); },
  }), /fallback down/);
});

test("a hung Fal attempt also has a deadline and aborts", async () => {
  let fallbackSignal;
  await assert.rejects(classifyWithProvider({
    provider: "fal",
    falTimeoutMs: 10,
    fal: (signal) => { fallbackSignal = signal; return new Promise(() => {}); },
  }), { code: "ANALYSIS_TIMEOUT" });
  assert.equal(fallbackSignal.aborted, true);
});
