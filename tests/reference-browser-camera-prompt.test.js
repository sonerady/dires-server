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

test("garments are reconstructed on the body and relit inside the final scene", () => {
  for (const directive of [
    "GARMENT-TO-BODY & SCENE INTEGRATION — MANDATORY",
    "not as a flat layer to paste onto the model",
    "Discard the source mannequin, hanger, display form, background, cutout edges and source-photo lighting completely",
    "Create pose-specific tension, compression, folds, drape, overlap, occlusion and contact shadows",
    "Relight the garment from scratch inside the final scene",
    "never as though the garment was composited afterward",
  ]) {
    assert.ok(source.includes(directive), `include ${directive}`);
  }
});

test("two-person styles preserve the pair without fixed gender or romance", () => {
  for (const directive of [
    "SUBJECT_COUNT_LOCK:\\s*COUPLE_FEMALE_MALE",
    "REQUIRED TWO-PERSON COMPOSITION — HIGHEST PRIORITY, NON-NEGOTIABLE",
    "exactly TWO clearly visible, age-appropriate people together in the same frame",
    "Do not impose a fixed woman/man pairing",
    "The PRIMARY/HERO person follows every user-selected model attribute",
    "The second person supports the composition in a newly invented, complementary, style-appropriate outfit",
    "This TWO-PERSON requirement overrides every singular use",
    "EXACT SUBJECT-COUNT & INTERACTION LOCK",
    "SUBJECT COUNT & INTERACTION — state the exact number",
  ]) {
    assert.ok(source.includes(directive), `include ${directive}`);
  }

  assert.ok(!source.includes("REQUIRED TWO-PERSON ROMANTIC COUPLE"));
  assert.ok(!source.includes("primary adult woman"));
});
