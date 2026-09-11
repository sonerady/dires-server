// Model references establish identity; unselected hairstyling can follow the shoot.
function buildModelHairDirection({
  hasModelReference = false,
  settings = {},
  hairStyleImage = null,
  isEditMode = false,
  isRefinerMode = false,
  isColorChange = false,
  isPoseChange = false,
  isBackSideAnalysis = false,
} = {}) {
  const hairStyle = String(settings?.hairStyle ?? '').trim().toLowerCase();
  const hasSelectedStyle = hairStyle && !['auto', 'automatic', 'default'].includes(hairStyle);
  const hijabEnabled = [true, 'true', 1, '1'].includes(settings?.hijabMode);
  if (!hasModelReference || hijabEnabled || hasSelectedStyle || hairStyleImage ||
      isEditMode || isRefinerMode || isColorChange || isPoseChange || isBackSideAnalysis) {
    return '';
  }
  return "MODEL HAIRSTYLING: Preserve the selected model reference's recognizable face, identity, skin tone and apparent age. Treat that photo as an identity reference, not a fixed hairstyle reference: choose a hairstyle that naturally complements the user's outfit and the scene's atmosphere rather than automatically copying the reference hairstyle. Keep important garment details visible. Honor any explicit user hair instructions, including a selected hair color. This styling freedom applies only to the primary model's hair, never to their facial identity.";
}

module.exports = { buildModelHairDirection };
