const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildJewelryGenerationPrompt,
  extractJewelryCompatibleDirection,
} = require("../src/utils/jewelryPrompt");

test("jewelry prompt removes apparel-specific draft instructions", () => {
  const prompt = buildJewelryGenerationPrompt({
    draftPrompt:
      "Use warm window light. Preserve the garment fabric, seams and hem. Shoot in a marble studio.",
    productSubtype: "earring",
  });

  assert.match(prompt, /anatomically correct earlobe or cartilage point/i);
  assert.match(prompt, /warm window light/i);
  assert.match(prompt, /marble studio/i);
  assert.doesNotMatch(prompt, /preserve the garment fabric/i);
});

test("necklace prompt prioritizes collarbone visibility and exact construction", () => {
  const prompt = buildJewelryGenerationPrompt({ productSubtype: "necklace" });
  assert.match(prompt, /neck and collarbone/i);
  assert.match(prompt, /stone count/i);
  assert.match(prompt, /commercial hero is the necklace/i);
  assert.match(prompt, /chain must wrap behind the neck/i);
  assert.match(prompt, /physically lowest point dictated by gravity/i);
});

test("jewelry prompt physically integrates the product into the reference model", () => {
  const prompt = buildJewelryGenerationPrompt({ productSubtype: "earring" });

  assert.match(prompt, /target model or jewelry campaign reference/i);
  assert.match(prompt, /replace it with the user's exact product/i);
  assert.match(prompt, /post, hook or wire must physically pass through/i);
  assert.match(prompt, /not as a flat overlay, sticker or pasted cutout/i);
  assert.match(prompt, /micro contact shadows/i);
  assert.match(prompt, /no part may sink into, float above/i);
});

test("target reference cannot transfer placeholder jewelry scale", () => {
  const prompt = buildJewelryGenerationPrompt({ productSubtype: "ring" });

  assert.match(prompt, /provides ZERO information about the replacement jewelry's size/i);
  assert.match(prompt, /Never inherit, match or approximate the placeholder jewelry's diameter/i);
  assert.match(prompt, /small or delicate product as small and delicate/i);
  assert.match(prompt, /conservative, plausible real-world scale/i);
  assert.match(prompt, /Recalculate the replacement's pixel dimensions against the target/i);
});

test("creative direction filter drops clothing sentences", () => {
  assert.equal(
    extractJewelryCompatibleDirection(
      "Soft side light. The dress has flowing fabric. Neutral stone background.",
    ),
    "Soft side light. Neutral stone background.",
  );
});

test("creative direction filter drops automatic face and beauty instructions", () => {
  assert.equal(
    extractJewelryCompatibleDirection(
      "Use crisp side light. Invent an oval face with almond-shaped eyes, refined cheekbones and natural makeup. Keep controlled gemstone reflections.",
    ),
    "Use crisp side light. Keep controlled gemstone reflections.",
  );
});

test("jewelry final prompt cannot inherit clothing face-generation copy", () => {
  const prompt = buildJewelryGenerationPrompt({
    productSubtype: "earring",
    draftPrompt:
      "FACE DESCRIPTION: Create a unique face with expressive eyes and full lips. Use a soft silver edge light.",
  });

  assert.doesNotMatch(prompt, /unique face|expressive eyes|full lips/i);
  assert.match(prompt, /soft silver edge light/i);
  assert.match(prompt, /preserve that exact person's face/i);
  assert.match(prompt, /every unrelated part of the target model remains faithful/i);
});
