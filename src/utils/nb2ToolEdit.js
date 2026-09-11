// Direct model policy for color, pose, backside, Edit Room and Edit Chat.
const NB2_EDIT_MODEL = "fal-ai/nano-banana-2/edit";

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

module.exports = { NB2_EDIT_MODEL, buildNb2EditInput };
