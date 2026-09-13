// Detector labels and photo counts are evidence, not authoritative product
// identities. Resolve them visually with the user's multilingual clarification.
const PRODUCT_INTERPRETATION_RULE = 'PRODUCT INTERPRETATION: Automatic category/subtype labels are provisional. An explicit user clarification of the product type takes precedence over those labels; use the reference images for its exact construction. Translate user details from any language into concrete visible requirements in the scene narrative, including how the garment silhouette and requested footwear must read. Preserve unmentioned design details; do not redesign the product just to fit an automatic label.';

const OUTFIT_IDENTITY_RULE = 'Inspect all reference views and identify every distinct supplied product. Photo/cell count is NOT a distinct-item count: front, back and detail views of one item describe one product, worn once. Conversely, matching names, colors or patterns alone do NOT prove two products are identical; preserve all genuinely distinct outfit pieces and their intended layering. Resolve identity from visible construction and explicit user clarification. Do not invent extra garments, duplicate a product, omit a genuine piece or combine separate views into layers.';

function buildOutfitReferencePrompt({photoCount = 0, pieces = []} = {}) {
  const count = Number(photoCount);
  if (!Number.isInteger(count) || count < 1) return '';
  const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  const lines = (Array.isArray(pieces) ? pieces : []).flatMap(piece => {
    const cells = [...new Set((Array.isArray(piece?.cells) ? piece.cells : [])
      .filter(cell => Number.isInteger(cell) && cell >= 1 && cell <= count))];
    if (!cells.length) return [];
    // Keep useful visual hints and cell associations, but never repeat a
    // detector noun such as "dress" that can contradict the user's "jumpsuit".
    const attributes = [text(piece.color), text(piece.pattern) !== 'solid' ? text(piece.pattern) : ''].filter(Boolean);
    return [`${cells.map(cell => `Cell ${cell}`).join(' & ')}: ${attributes.join(' ') || 'product reference'}${cells.length > 1 ? '; analysis groups these as views of the same item; verify visually' : ''}.`];
  });
  return `PRODUCT REFERENCE PHOTOS: Alongside the main grid, ${count} individual reference photo(s) are attached. Use them for faithful colors, prints, stitching, trims and construction; do not invent unseen details.
${OUTFIT_IDENTITY_RULE}
${PRODUCT_INTERPRETATION_RULE}${lines.length ? `\nREFERENCE CELL MAP (left-to-right, top-to-bottom; provisional visual hints, not garment counts or type labels):\n${lines.join('\n')}` : ''}`;
}

module.exports = { PRODUCT_INTERPRETATION_RULE, OUTFIT_IDENTITY_RULE, buildOutfitReferencePrompt };
