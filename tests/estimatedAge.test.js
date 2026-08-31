const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseEstimatedAgeResponse,
} = require("../src/utils/estimatedAge");

test("parses the classifier's numeric age formats", () => {
  assert.equal(parseEstimatedAgeResponse("7"), 7);
  assert.equal(parseEstimatedAgeResponse("AGE=10"), 10);
  assert.equal(parseEstimatedAgeResponse("Approximately 12 years old"), 12);
});

test("parses written English ages returned in accidental prose", () => {
  assert.equal(parseEstimatedAgeResponse("ten"), 10);
  assert.equal(
    parseEstimatedAgeResponse("A young girl, approximately ten years old."),
    10,
  );
  assert.equal(parseEstimatedAgeResponse("aged twenty-one years old"), 21);
});

test("rejects missing people and invalid classifier responses", () => {
  assert.equal(parseEstimatedAgeResponse("none"), null);
  assert.equal(parseEstimatedAgeResponse("AGE=none"), null);
  assert.equal(parseEstimatedAgeResponse("unknown"), null);
  assert.equal(parseEstimatedAgeResponse("100"), null);
});
