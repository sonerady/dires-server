// Numeric selection takes precedence over legacy age-group labels.
function selectedAge(settings = {}) {
  const raw = settings.numericAge;
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const age = Number(raw);
  return Number.isInteger(age) && age >= 0 && age <= 100 ? age : null;
}
function normalizeGenerationAge(settings = {}, prompt = '') {
  const age = selectedAge(settings);
  if (age === null) return { settings, prompt };
  const description = `${age} years old (${age >= 18 ? 'adult' : 'minor'})`;
  return {
    settings: { ...settings, age: String(age) },
    // Only replace the application's generated age field, not user details.
    prompt: String(prompt || '').replace(/Age range:\s*[^.\n]+\.?/i, `Age range: ${description}.`),
  };
}
function ageDirective(settings) {
  const age = selectedAge(settings);
  return age === null ? '' : `The primary model's selected age is exactly ${age} years old (${age >= 18 ? 'adult' : 'minor'}). Preserve this age; do not reinterpret it from a legacy age-group label.`;
}
module.exports = { selectedAge, normalizeGenerationAge, ageDirective };
