// Editable fictional casting presets, not measurements inferred from a photo.
// These values are saved as profile metadata only, never sent to the portrait provider.
const DEFAULTS = {
  woman: { heightCm: 178, bustCm: 84, waistCm: 62, hipsCm: 90 },
  man: { heightCm: 188, bustCm: 98, waistCm: 78, hipsCm: 96 },
};

function starterModelProfile(gender) {
  if (!DEFAULTS[gender]) throw new Error('Invalid model gender');
  return { ...DEFAULTS[gender] };
}

module.exports = { starterModelProfile };
