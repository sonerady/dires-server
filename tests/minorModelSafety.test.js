// Çocuk model güvenliği: küçük yaşta prompt "woman"/"bust" demesin, sona çocuk oranları kilidi eklensin.
// Çalıştır: node --test tests/minorModelSafety.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyMinorModelSafety, minorAgeOf, childGenderTerm } = require("../src/utils/minorModelSafety");

const SAMPLE = [
  "PRIMARY/HERO MODEL: Create a brand-new, 6-year-old woman AI-generated fashion model with natural skin.",
  "Preserve its design while naturally adapting its worn geometry to the model's bust, waist, hips, shoulders and limbs through believable fabric thickness.",
  "- PRIMARY/HERO MODEL GENDER PRESENTATION: woman.",
].join("\n");

test("minor girl: woman → girl, bust sentence replaced, child directive appended", () => {
  const out = applyMinorModelSafety(SAMPLE, { age: "6", gender: "woman" });
  assert.match(out, /6-year-old girl AI-generated/);
  assert.doesNotMatch(out, /year-old woman/);
  assert.doesNotMatch(out, /model's bust, waist, hips/);
  assert.match(out, /GENDER PRESENTATION: girl \(a 6-year-old child\)/);
  assert.match(out, /CHILD MODEL — HIGHEST PRIORITY/);
  assert.match(out, /no grown-up or womanly figure/);
  // eklenen metin anatomi kelimesi içermez (görsel sağlayıcının içerik filtresi)
  const added = out.slice(SAMPLE.length);
  assert.doesNotMatch(added, /breast|bust|cleav|\bchest\b|\bhips?\b/i);
  assert.match(out, /clearly a GIRL/);
});

test("minor boy maps man → boy", () => {
  const out = applyMinorModelSafety(SAMPLE.replace(/woman/g, "man"), { age: 7, gender: "man" });
  assert.match(out, /7-year-old boy/);
  assert.match(out, /GENDER PRESENTATION: boy/);
  assert.match(out, /clearly a BOY/);
});

test("adults and missing age are untouched; idempotent", () => {
  assert.equal(applyMinorModelSafety(SAMPLE, { age: "22", gender: "woman" }), SAMPLE);
  assert.equal(applyMinorModelSafety(SAMPLE, { gender: "woman" }), SAMPLE);
  assert.equal(applyMinorModelSafety(SAMPLE, { age: "auto", gender: "woman" }), SAMPLE);
  const once = applyMinorModelSafety(SAMPLE, { age: "5", gender: "woman" });
  assert.equal(applyMinorModelSafety(once, { age: "5", gender: "woman" }), once);
});

test("age parsing and gender terms", () => {
  assert.equal(minorAgeOf({ age: "12" }), 12);
  assert.equal(minorAgeOf({ age: "13" }), null);
  assert.equal(minorAgeOf({ age: "18 months" }), 0);
  assert.equal(minorAgeOf({ age: 4 }), 4);
  assert.equal(childGenderTerm("woman"), "girl");
  assert.equal(childGenderTerm("Male"), "boy");
  assert.equal(childGenderTerm("auto"), null);
});
