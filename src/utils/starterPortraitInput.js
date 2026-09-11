const { randomInt } = require('node:crypto');
const MODEL_T2I_API_URL = 'https://fal.run/fal-ai/nano-banana-2';

// Shared by manual text portraits and the automatic starter trio.
function starterPortraitInput(prompt) {
  return { prompt, seed: randomInt(0, 2147483648), aspect_ratio: '3:4', resolution: '1K', output_format: 'jpeg', num_images: 1 };
}

module.exports = { starterPortraitInput, MODEL_T2I_API_URL };
