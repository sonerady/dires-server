const sharp = require("sharp");

// Keep the model's alpha mask even when a sharpening provider returns JPEG.
// Resize only the mask; never crop the generated composition.
async function prepareRefinerResultImage(buffer, alphaSourceBuffer = null) {
  if (alphaSourceBuffer) {
    const source = sharp(alphaSourceBuffer);
    const original = await source.metadata();
    if (!original.hasAlpha) throw new Error("REFINER_TRANSPARENT_ALPHA_MISSING");
    const { width, height } = await sharp(buffer).metadata();
    const alpha = await source.extractChannel("alpha")
      .resize(width, height, { fit: "fill" }).raw().toBuffer();
    const rgb = await sharp(buffer).removeAlpha().toColourspace("srgb").png().toBuffer();
    buffer = await sharp(rgb).joinChannel(alpha, { raw: { width, height, channels: 1 } }).png().toBuffer();
  }
  const metadata = await sharp(buffer).metadata();
  const extension = metadata.hasAlpha || metadata.format === "png" ? "png"
    : metadata.format === "webp" ? "webp" : "jpg";
  return { buffer, extension, contentType: extension === "jpg" ? "image/jpeg" : `image/${extension}` };
}
module.exports = { prepareRefinerResultImage };
