// Upload analysis must finish promptly even when a provider stops responding.
const DEEPSEEK_TIMEOUT_MS = 10000;
const FAL_TIMEOUT_MS = 15000;

async function callWithinDeadline(call, timeoutMs, provider) {
  const controller = new AbortController();
  let timer;
  try {
    const output = await Promise.race([
      Promise.resolve().then(() => call(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${provider} analysis timed out`);
          error.code = "ANALYSIS_TIMEOUT";
          reject(error);
          controller.abort();
        }, timeoutMs);
      }),
    ]);
    if (typeof output !== "string" || !output.trim()) {
      throw new Error(`${provider} returned empty analysis`);
    }
    return output;
  } finally {
    clearTimeout(timer);
  }
}

async function classifyWithProvider({
  provider = "deepseek",
  deepseek,
  fal,
  onFallback = () => {},
  deepseekTimeoutMs = DEEPSEEK_TIMEOUT_MS,
  falTimeoutMs = FAL_TIMEOUT_MS,
}) {
  if (provider !== "fal") {
    try {
      return {
        raw: await callWithinDeadline(deepseek, deepseekTimeoutMs, "deepseek"),
        provider: "deepseek",
      };
    } catch (error) {
      onFallback(error);
    }
  }
  // One fallback attempt only. If both fail, the route retains its existing
  // non-blocking fallback response so generation remains available.
  return {
    raw: await callWithinDeadline(fal, falTimeoutMs, "fal"),
    provider: "fal",
  };
}

module.exports = { classifyWithProvider, DEEPSEEK_TIMEOUT_MS };
