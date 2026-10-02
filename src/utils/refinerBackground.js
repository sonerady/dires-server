function refinerBackgroundMode(request = {}) {
  const settings = request.settings || {};
  return (settings.backgroundMode ?? settings.refinerSettings?.backgroundMode) === "transparent"
    ? "transparent" : "opaque";
}

function refinerBackgroundInput(prompt, backgroundMode) {
  const transparent = backgroundMode === "transparent";
  return {
    background: transparent ? "transparent" : "opaque",
    output_format: transparent ? "png" : "jpeg",
    prompt: transparent
      ? `${prompt}\n\nFINAL OUTPUT REQUIREMENT — overrides background, backdrop and floor-surface instructions above: isolate the complete product on a truly transparent alpha background. Preserve the requested product composition, framing, lighting and details. Honor the shadow and reflection settings above: render any requested shadow or reflection with graduated alpha beneath the product, without adding an opaque floor or background. Do not add effects that are switched off. No studio background or visible floor surface. Do not draw a checkerboard or simulate transparency with a solid color. Empty areas must have zero alpha.`
      : prompt,
  };
}
module.exports = { refinerBackgroundMode, refinerBackgroundInput };
