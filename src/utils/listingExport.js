const sharp = require('sharp');
const JSZip = require('jszip');
// Export presets, not a guarantee of category-specific marketplace approval.
const EXPORT_PRESETS = {
  amazon: [2000, 2000], shopify: [2000, 2000], ebay: [2000, 2000],
  etsy: [2400, 1800], trendyol: [1200, 1800], original: null,
};
function exportName(index, row) {
  const type = String(row.image_type || 'image').replace(/[^a-z0-9_-]/gi, '-').slice(0, 60);
  return `${String(index + 1).padStart(2, '0')}_${type}_${String((row.variant_index || 0) + 1).padStart(2, '0')}.jpg`;
}
async function createListingArchive({ rows, preset, getImage }) {
  if (!Object.prototype.hasOwnProperty.call(EXPORT_PRESETS, preset)) throw new Error('INVALID_EXPORT_PRESET');
  const zip = new JSZip();
  const manifest = [];
  // Bound memory and network use: one decoded frame at a time, <=12 frames.
  for (const [index, row] of rows.entries()) {
    const source = await getImage(row);
    let pipeline = sharp(source, { limitInputPixels: 40000000 }).rotate().flatten({ background: '#ffffff' });
    const size = EXPORT_PRESETS[preset];
    if (size) pipeline = pipeline.resize(size[0], size[1], { fit: 'contain', background: '#ffffff' });
    const { data, info } = await pipeline.jpeg({ quality: 94 }).toBuffer({ resolveWithObject: true });
    const file = exportName(index, row);
    zip.file(file, data);
    manifest.push({ file, type: row.image_type, width: info.width, height: info.height });
  }
  zip.file('manifest.json', JSON.stringify({ preset, fit: 'contain', images: manifest }, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}
module.exports = { EXPORT_PRESETS, exportName, createListingArchive };
