const test = require("node:test");
const assert = require("node:assert/strict");
const { collectInputImages } = require("../src/utils/variationInputImages");

test("location image is excluded even when client sends it as a generic reference", () => {
  const hero = "https://cdn.example.com/hero.jpg";
  const product = "https://cdn.example.com/product.jpg";
  const location = "https://cdn.example.com/location.jpg?token=client";

  const images = collectInputImages({
    sourceImageUrl: hero,
    referenceImages: [product, location],
    extraImages: [location],
    excludedImages: ["https://cdn.example.com/location.jpg?token=database"],
  });

  assert.deepEqual(images, [hero, product]);
});

test("hero stays first while valid product references are deduplicated", () => {
  const hero = "https://cdn.example.com/hero.jpg";
  const product = "https://cdn.example.com/product.jpg";

  const images = collectInputImages({
    sourceImageUrl: hero,
    referenceImages: [product, { uri: `${product}?width=1024` }],
    extraImages: [{ url: "https://cdn.example.com/back.jpg" }],
  });

  assert.deepEqual(images, [
    hero,
    product,
    "https://cdn.example.com/back.jpg",
  ]);
});
