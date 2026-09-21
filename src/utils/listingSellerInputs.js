// Reference order is part of the persisted job contract. Never derive it on retry.
const ROLES = new Set(['front', 'back', 'label', 'detail']);
const isImageUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) && value.length < 4096;
function normalizeProductReferences(value, mainUrl) {
  const seen = new Set([mainUrl]);
  return (Array.isArray(value) ? value : []).filter(ref => {
    if (!ref || !ROLES.has(ref.role) || !isImageUrl(ref.url) || seen.has(ref.url)) return false;
    seen.add(ref.url); return true;
  }).slice(0, 5).map(({url, role}) => ({url, role}));
}
function normalizeBrand(value) {
  if (!value || value.enabled !== true) return null;
  return {
    enabled: true,
    name: String(value.name || '').trim().slice(0, 80),
    colors: (Array.isArray(value.colors) ? value.colors : []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 3),
    font: String(value.font || '').trim().slice(0, 80),
    language: /^[a-z]{2}(?:[-_][a-z]{2})?$/i.test(value.language || '') ? value.language : null,
    logoUrl: isImageUrl(value.logoUrl) ? value.logoUrl : null,
  };
}
function referenceDirection(refs, firstIndex = 2) {
  if (!refs.length) return '';
  return `\nADDITIONAL PRODUCT REFERENCES (same item, not style examples):\n${refs.map((r, i) => `IMAGE ${firstIndex + i}: ${r.role.toUpperCase()} view.`).join('\n')}\nUse the relevant supplied view when showing that surface or detail. Back views govern rear construction; label views supply only clearly legible label information; detail views govern seams, texture and fastenings. Never mirror the front to invent the back, mix products, or treat these views as additional sale items. Preserve the primary product's identity across every view.\n`;
}
function brandDirection(brand, logoIndex) {
  if (!brand) return '';
  return `\nSAVED STORE IDENTITY — overrides optional palette and typography suggestions, NOT product fidelity, verified facts or marketplace main-image restrictions. Store: ${JSON.stringify(brand.name)}. Graphic colors: ${brand.colors.join(', ') || 'derive from product'}. Lettering preference: ${JSON.stringify(brand.font || 'derive from product')} (visual reference, exact font rendering is not guaranteed). Keep these choices consistent across products. Never recolor the product. ${logoIndex ? `IMAGE ${logoIndex} is the STORE LOGO, not a product or style reference. Preserve its shape and lettering. Use unobtrusively only on secondary promotional frames where allowed; never add it to a restricted marketplace main image.` : 'Do not invent a store logo.'}\n`;
}
module.exports = { normalizeProductReferences, normalizeBrand, referenceDirection, brandDirection };
