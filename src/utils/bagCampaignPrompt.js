const {PRODUCT_INTERPRETATION_RULE, OUTFIT_IDENTITY_RULE} = require('./productReferencePrompt');
const clean = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

function isBagShoot(settings = {}, modes = {}) {
  // The primary product's detected subtype, never a bag mentioned in an
  // accessory list, location description or supporting outfit piece.
  return clean(settings?.productCategory) === 'clothing' && clean(settings?.productSubtype) === 'bag' &&
    !['isColorChange', 'isPoseChange', 'isEditMode', 'isRefinerMode', 'isBackSideAnalysis'].some(key => modes[key] === true);
}

function buildBagFocusDirective(settings = {}) {
  const framing = clean(settings?.framing);
  if (framing && framing !== 'auto') return `BAG COMPOSITION: Honor the explicitly selected ${framing} camera crop and perspective. Give the bag a clear silhouette and meaningful prominence within that crop; do not replace the user's framing.`;
  const focus = clean(settings?.focusArea);
  if (focus === 'upper_body') return 'BAG COMPOSITION: Frame the head, torso and hip-area interaction, including the complete bag when compatible with the selected crop. This is accessory composition, not a command to showcase an upper garment or crowd the person into the foreground.';
  if (focus === 'full_body') return 'BAG COMPOSITION: Honor full-body framing including both feet; keep the bag clearly readable at its real wearable scale, not enlarged to fill the frame.';
  return `BAG COMPOSITION: ${focus && focus !== 'auto' ? `Honor the selected ${focus} focus. ` : ''}Design an intentional camera-to-person-to-bag relationship; avoid accidental top-down distortion or an oversized foreground bag. Keep the product's visible details readable and proportionate.`;
}

function buildBagDirection({hasStyleReference = false} = {}) {
  return `BAG PRODUCT FIDELITY: Reproduce the reference bag's exact silhouette, orientation, dimensions relative to the wearer, material, weave, stitching, color, closures, hardware, embellishments and branding. Relight it in the actual scene without changing its construction. Never invent a strap, handle or logo. Determine the intended carrying method from visible construction: a clutch need not become a shoulder bag. Preserve credible grip, strap tension, gravity, contact shadows and natural material deformation. Multiple views show one product; do not duplicate it. User-requested changes override preservation only for the named changes.
${hasStyleReference ? 'BAG STYLE PRIORITY: Honor the selected style reference, pose, framing and photographic language. Keep the bag integrated naturally and legible within that direction; do not impose polished campaign styling on a deliberately candid or street-style brief.' : `BAG FASHION CAMPAIGN: Art-direct the person, complementary outfit, bag, camera and selected venue as one compelling accessories photograph. Give the model relaxed confidence, expressive character and purposeful body language appropriate to this bag and place; avoid a seller presenting merchandise, rigid mannequin stance or blank catalog portrait. Do not require sitting, a specific hand position, fixed gaze, garden, bench or ivory outfit across shoots. The bag can be carried, worn or naturally supported according to its construction and the situation; it need not always be held in two hands or shown straight to the lens. Build its prominence through composition, styling contrast and visible silhouette rather than artificial enlargement. Style a refined complete look that complements its palette, material and character; preserve every other supplied garment, selected identity, age, measurements, hair and modesty requirement. For adults use camera-ready grooming and makeup with real skin texture; for children use age-appropriate grooming without adult glamour. Preserve the chosen venue and make creative use of its real spatial possibilities rather than substituting a luxury room. Use flattering, scene-consistent directional light and balanced fill for luminous skin, tactile product detail and faithful color, not dull gray exposure or an automatic warm preset. Keep natural perspective, shared shadows, real surfaces and optical depth; no pasted subject, waxy skin or CGI bag. Explicit user pose, mood, framing, lighting and product-only requests take priority over campaign defaults.`}`;
}

function buildBagEnhanceInstruction({settings = {}, originalPrompt = '', customDetail = '', context = '', multipleAnglesCount = 0, kombinItemCount = 0, isMultipleProducts = false, hasStyleReference = false} = {}) {
  return `Write a concise English photographic brief for a premium BAG / HANDBAG accessories campaign, in four connected paragraphs. Start with "Create a new luxury accessories campaign photograph". This replaces generic clothing transformation instructions: the hero product is a bag, not fabric to wrap around the model's torso. Return only the image prompt.
First inspect the bag's actual construction, intended use, material and carrying options. Invent a garment- and venue-appropriate editorial idea, then translate it into concrete visible behavior, expression, styling and camera composition. Do not merely label an ordinary portrait "fashion". A sophisticated, relaxed human moment with an intentional accessory relationship is the goal; neither forced theatrics nor a person waiting to show an item. Make a fresh decision for this shoot rather than reuse any example pose. Pose presets guide the overall intent; explicit user-written pose requirements and separately selected mood prevail.
Describe one consistent action and support geometry throughout, never seated in one paragraph and standing in another. Explain how the bag stays visible without forcing a presentation gesture, and how the outfit and composition draw attention to it. Reference-model photos supply identity, not their old clothes, pose, light or framing. Preserve all user choices and any supplied outfit pieces. Choose framing and lens perspective appropriate to the actual posture and bag; keep user-selected crops and proportions. Ground the composition in the selected location with coherent professional lighting. Do not transplant a garden, sofa, bench, color palette or clothing from previous examples into every scene.
${buildBagFocusDirective(settings)}
${buildBagDirection({hasStyleReference})}
${PRODUCT_INTERPRETATION_RULE}
${multipleAnglesCount > 1 ? `The grid contains ${multipleAnglesCount} views of ONE bag; use them as complementary construction evidence, not separate items.` : ''}
${kombinItemCount > 1 || isMultipleProducts ? OUTFIT_IDENTITY_RULE : ''}
USER BRIEF:
${originalPrompt}
${customDetail ? `ADDITIONAL DETAILS — highest user priority: ${customDetail}` : ''}
SELECTED SETTINGS AND REFERENCE ROLES:
${context}
Check the final narrative for product accuracy, coherent posture, real support, readable bag, user requirements and location identity. Style references, when supplied, retain their own photographic language; do not override street/candid style with these standard campaign defaults.`;
}
module.exports = {isBagShoot, buildBagFocusDirective, buildBagDirection, buildBagEnhanceInstruction};
