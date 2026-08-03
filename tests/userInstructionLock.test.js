const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appendUserInstructionLock,
  buildUserInstructionLock,
} = require("../src/utils/userInstructionLock");

test("locks Add Detail and visible Advanced Settings into the final prompt", () => {
  const lock = buildUserInstructionLock({
    customDetail: "Add a wide leather belt and gold earrings",
    settings: {
      location: "Paris street",
      productColor: "burgundy",
      accessories: "structured handbag, gold earrings",
      pose: "walking pose",
      perspective: "low_angle",
      framing: "full_body",
      focusArea: "product",
      bodyShape: "plus size",
      ethnicity: "İspanyol",
      hijabMode: true,
      qualityVersion: "v2",
      locationId: "internal-id",
    },
  });

  assert.match(lock, /ADD DETAIL — HIGHEST USER PRIORITY/);
  assert.match(lock, /wide leather belt and gold earrings/);
  assert.match(lock, /allowed exception to general product-preservation rules/);
  assert.match(lock, /ACCESSORIES: Include all of these requested accessories clearly/);
  assert.match(lock, /complete head-to-toe full-body frame/);
  assert.match(lock, /FOCUS AREA: Prioritize the garment\/product/);
  assert.match(lock, /BODY SHAPE \/ SIZE: plus size/);
  assert.match(lock, /MODEL ETHNICITY \/ HERITAGE: İspanyol/);
  assert.match(lock, /MODEST HIJAB/);
  assert.doesNotMatch(lock, /qualityVersion|locationId|internal-id/);
});

test("adds reference-image requirements when Advanced Settings use references", () => {
  const lock = buildUserInstructionLock({
    settings: {},
    hasLocationReference: true,
    hasPoseReference: true,
    hasHairReference: true,
  });

  assert.match(lock, /LOCATION REFERENCE/);
  assert.match(lock, /POSE REFERENCE/);
  assert.match(lock, /HAIR REFERENCE/);
});

test("appends the user lock without trimming a long model prompt", () => {
  const lock = buildUserInstructionLock({
    customDetail: "Show a clearly visible red silk scarf",
  });
  const full = appendUserInstructionLock("A".repeat(5000), lock);

  assert.ok(full.length > 5000);
  assert.ok(full.startsWith("A".repeat(5000)));
  assert.ok(full.endsWith(lock));
  assert.match(full, /red silk scarf/);
});

test("keeps a Turkish backside color-and-prop request after preservation text", () => {
  const detail =
    "Havada güvercinler uçsun ve kıyafetin rengini kırmızıyla değiştir";
  const lock = buildUserInstructionLock({ customDetail: detail });
  const full = appendUserInstructionLock(
    "Keep the garment colors unchanged and preserve the existing scene.",
    lock,
  );

  assert.ok(full.endsWith(lock));
  assert.match(full, /Havada güvercinler uçsun/);
  assert.match(full, /kıyafetin rengini kırmızıyla değiştir/);
  assert.match(full, /ADD DETAIL has priority if two user inputs conflict/);
  assert.match(full, /allowed exception to general product-preservation rules/);
});
