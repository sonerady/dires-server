const CREATION_MODES = new Set(["crystal", "canvas"]);

function normalizeCreationMode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return CREATION_MODES.has(normalized) ? normalized : null;
}

module.exports = {
  normalizeCreationMode,
};
