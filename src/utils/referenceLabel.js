const path = require('path');
const { createCanvas, registerFont } = require('canvas');

let fontRegistered = false;
const FONT_FAMILY = 'DiressReferenceLabel';

// Rasterize with the bundled font: SVG <text> relies on the host's fontconfig
// and becomes missing-glyph boxes in containers without Arial/Helvetica.
function renderReferenceLabel({ width, height, label, fontSize = 24,
  foreground = '#FFFFFF', background = '#0A0A0C', padding = 12 }) {
  if (!fontRegistered) {
    registerFont(path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf'), {
      family: FONT_FAMILY, weight: 'bold',
    });
    fontRegistered = true;
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const text = String(label);
  const available = Math.max(1, width - Math.min(padding, width / 4) * 2);
  ctx.font = `bold ${fontSize}px "${FONT_FAMILY}"`;
  const measured = ctx.measureText(text);
  const fittedSize = Math.min(fontSize,
    fontSize * available / Math.max(1, measured.width),
    fontSize * (height * 0.7) / Math.max(1, measured.actualBoundingBoxAscent + measured.actualBoundingBoxDescent));
  ctx.font = `bold ${fittedSize}px "${FONT_FAMILY}"`;
  const metrics = ctx.measureText(text);
  ctx.fillStyle = foreground;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const baseline = (height + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  ctx.fillText(text, width / 2, baseline);
  return canvas.toBuffer('image/png');
}

module.exports = { renderReferenceLabel };
