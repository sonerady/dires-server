const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
  "utf8",
);

test("normal-mode camera guidance offers conditional studio and editorial styles", () => {
  assert.ok(
    source.includes(
      "Choose a camera, lens character, viewpoint, depth of field, lighting approach, and color treatment",
    ),
  );

  for (const conditionalStyle of [
    "clean high-key commercial grade",
    "balanced three-point softbox lighting",
    "medium-format film character with subtle fine grain",
    "Use these only when they genuinely suit the garment, location, and intended mood; never apply them as a default recipe.",
  ]) {
    assert.ok(source.includes(conditionalStyle), `include ${conditionalStyle}`);
  }

  assert.ok(!source.includes("white-background"));
});

test("global style prompts require a new face while preserving only casting energy", () => {
  for (const directive of [
    "GLOBAL STYLE CASTING & MANDATORY FACE REPLACEMENT — HIGHEST PRIORITY",
    "different face shape and proportions, eye shape and spacing, brows, nose structure, lips, cheekbones, jawline, hairline and distinctive marks",
    "Similar campaign energy is correct; similar facial identity is a hard failure.",
    "The output must fail any same-person or look-alike comparison with the collage people.",
  ]) {
    assert.ok(source.includes(directive), `include ${directive}`);
  }

  assert.ok(
    source.includes(
      "The collage may influence only non-identity performance direction such as gaze intensity, expression energy, attitude and posing register",
    ),
    "keep style-person identity separate when a user model reference is selected",
  );
});

test("profile-level couple lock requires a visible woman and male partner", () => {
  for (const directive of [
    "SUBJECT_COUNT_LOCK:\\s*COUPLE_FEMALE_MALE",
    "REQUIRED TWO-PERSON ROMANTIC COUPLE — HIGHEST PRIORITY, NON-NEGOTIABLE",
    "exactly TWO clearly visible adult people together in the same frame",
    "a solo woman, an obscured man, a cropped-out man",
    "This TWO-PERSON requirement overrides every singular use",
  ]) {
    assert.ok(source.includes(directive), `include ${directive}`);
  }
});
