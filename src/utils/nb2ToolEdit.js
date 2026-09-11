// Direct model policy for color, pose, backside, Edit Room and Edit Chat.
const NB2_EDIT_MODEL = "fal-ai/nano-banana-2/edit";
const NBPRO_EDIT_MODEL = "fal-ai/nano-banana-pro/edit";

/**
 * Araç ekranlarının (renk değiştir, poz değiştir, arka taraf) kalite versiyonu
 * → model/çözünürlük eşlemesi — 11 Eyl 2026 (kullanıcı kararı):
 *   v1 → nano-banana-2, 1K
 *   v2 → nano-banana-pro, 2K
 * Öncesinde her iki versiyon da NB2 2K'ya gidiyordu, yani 35 kredilik v2 ile
 * 10 kredilik v1 arasında hiçbir çıktı farkı yoktu.
 */
function selectToolEditModel(qualityVersion) {
  return String(qualityVersion) === "v2"
    ? { model: NBPRO_EDIT_MODEL, resolution: "2K" }
    : { model: NB2_EDIT_MODEL, resolution: "1K" };
}

// Keep tool inputs in the NB2 schema. In particular, GPT quality/image_size
// and our internal source_size must never leak into the provider request.
// NB2's native auto ratio uses the source image without GPT size quantization.
function buildNb2EditInput(params = {}) {
    const {
        quality, image_size, input_fidelity, source_size,
        ...input
    } = params;
    return {
        ...input,
        aspect_ratio: !input.aspect_ratio || input.aspect_ratio === "original"
            ? "auto" : input.aspect_ratio,
        resolution: input.resolution || "2K",
        num_images: input.num_images ?? 1,
        output_format: input.output_format || "png",
    };
}

module.exports = { NB2_EDIT_MODEL, NBPRO_EDIT_MODEL, selectToolEditModel, buildNb2EditInput };
