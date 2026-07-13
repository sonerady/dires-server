# Adaptive Camera Prompt Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed camera and lighting examples in the normal prompt enhancer with an adaptive, scene-specific art-direction instruction.

**Architecture:** The change remains inside the normal-mode `Paragraph 4 → Photography, Light & Grade` template in `referenceBrowserRoutesV7.js`. A Node built-in test reads that template source as a regression contract: the adaptive direction must be present and the four fixed recipes must be absent.

**Tech Stack:** Node.js built-in `node:test`, CommonJS, Express backend prompt template.

## Global Constraints

- Do not change user-selected framing or perspective behavior.
- Do not change the location-reference behavior in this task.
- Remove only these fixed recipe examples: `three-point softbox`, `85mm f/2.8`, `clean high-key commercial grade`, and `medium-format film with fine grain`.
- Keep a concrete, professional camera/lighting/grade instruction rather than leaving this section unspecified.

---

### Task 1: Make normal-mode camera direction adaptive

**Files:**
- Create: `tests/reference-browser-camera-prompt.test.js`
- Modify: `src/routes/referenceBrowserRoutesV7.js:2933`

**Interfaces:**
- Consumes: the string template containing `Paragraph 4 → Photography, Light & Grade`.
- Produces: an adaptive camera-direction instruction used by the prompt enhancer.

- [ ] **Step 1: Write the failing regression test**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
  "utf8",
);

test("normal-mode camera guidance is adaptive rather than a fixed recipe", () => {
  assert.ok(
    source.includes(
      "Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment",
    ),
  );

  for (const fixedRecipe of [
    "three-point softbox",
    "85mm f/2.8",
    "clean high-key commercial grade",
    "medium-format film with fine grain",
  ]) {
    assert.ok(!source.includes(fixedRecipe), `remove ${fixedRecipe}`);
  }
});
```

- [ ] **Step 2: Run the regression test and confirm it fails**

Run: `node --test tests/reference-browser-camera-prompt.test.js`

Expected: FAIL because the adaptive camera-direction sentence is not present and the fixed examples remain.

- [ ] **Step 3: Replace the fixed camera recipe with the approved direction**

Replace the existing Paragraph 4 content with:

```text
Paragraph 4 → Photography, Light & Grade. Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment that genuinely serve this specific garment, pose, model, and location. Make these choices feel intentional and varied across generations: adapt the perspective, visual energy, contrast, depth, and mood to the scene rather than relying on a fixed studio recipe. Use precise professional photography language where it helps define the image, but never treat any particular focal length, lighting setup, or color grade as the default. The final result is a single, hyper-realistic, editorial-quality fashion photograph, seamlessly integrating model, garment, and environment at campaign-ready standards.
```

- [ ] **Step 4: Run the regression test and confirm it passes**

Run: `node --test tests/reference-browser-camera-prompt.test.js`

Expected: PASS with one passing test and zero failures.

- [ ] **Step 5: Inspect the final diff**

Run: `git diff --check && git diff -- src/routes/referenceBrowserRoutesV7.js tests/reference-browser-camera-prompt.test.js`

Expected: no whitespace errors; only the camera-direction template and its focused regression test differ.
