const sharp = require('sharp');
const { randomUUID } = require('crypto');
const { cleanImageUrlForApi } = require('../utils/imageOptimizer');
const MODEL = 'openai/gpt-image-2.5/sunburst/edit';
const LOCATION_DIRECTION = `LOCATION REFERENCE: The image with the bottom strip labelled "Location" shows the actual venue for this shoot. Preserve its recognizable architecture, materials, spatial character and distinctive features. Treat it as a real three-dimensional environment, not a flat backdrop or a camera/composition template. Freely choose a believable camera position, lens, framing and viewpoint suited to the product and model, reconstructing the same venue from that viewpoint. Integrate the subject with consistent scale, perspective, available light, contact shadows and occlusion. The product references remain the source of truth for the product. Do not copy people or products from the venue reference. The Location strip is reference metadata only: never reproduce the strip, label or border in the output.`;
const enhancementPrompt = notes => `Refine this photograph of the user's own venue into a clean, photorealistic location reference for a premium fashion/product shoot. Keep the SAME real venue: preserve its architecture, layout, characteristic furniture, materials, colors and identifying features. Improve exposure, white balance, natural light balance, clarity and subtle styling; tidy incidental clutter. Do not redesign the room, replace the venue or invent luxury architecture. Remove people, mannequins and temporary obstructions so the space is ready for a shoot. Keep realistic material texture and natural photographic lighting. No captions, borders, logos added, or watermarks. ${notes ? `User's optional styling notes (subject to preserving the venue): ${notes}` : ''}`;

async function normalizedReference(value) {
  if (typeof value !== 'string' || value.length > 17 * 1024 * 1024 || !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) throw Object.assign(new Error('Invalid location reference image'), { status: 400 });
  try {
    const buffer = await sharp(Buffer.from(value.split(',')[1], 'base64'), { limitInputPixels: 40000000 }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch { throw Object.assign(new Error('Invalid location reference image'), { status: 400 }); }
}

async function createReferenceLocation({ referenceImage, prompt = '', title, userId, uploadImage, saveLocation, fetchImpl = fetch }) {
  if (!userId) throw Object.assign(new Error('User ID required'), { status: 400 });
  const image = await normalizedReference(referenceImage);
  const notes = String(prompt || '').trim().slice(0, 500);
  const enhancedPrompt = enhancementPrompt(notes);
  const response = await fetchImpl(`https://fal.run/${MODEL}`, {
    method: 'POST', signal: AbortSignal.timeout(240000),
    headers: { Authorization: `Key ${process.env.FAL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: enhancedPrompt, image_urls: [image], image_size: 'auto', quality: 'medium', num_images: 1, output_format: 'jpeg' }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.images?.[0]?.url) throw new Error('Location enhancement failed. Please try again.');
  const id = `sunburst-location-${randomUUID()}`;
  const stored = await uploadImage(result.images[0].url, userId, id);
  const name = String(title || notes || 'Location').trim().slice(0, 100);
  // category describes ownership; location_type only accepts indoor/outdoor/studio/unknown.
  const saved = await saveLocation(name, notes, LOCATION_DIRECTION, stored.publicUrl, id, 'custom', userId, false, name, 'unknown', null, true);
  return { success: true, data: { id: saved.id, title: saved.title, generatedTitle: saved.generated_title, imageUrl: saved.image_url, category: 'custom', isPublic: false, enhancedPrompt: LOCATION_DIRECTION, createdAt: saved.created_at, locationType: saved.location_type } };
}

async function stampLocationReference(buffer) {
  const image = await sharp(buffer, { limitInputPixels: 40000000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).toBuffer();
  const { width, height } = await sharp(image).metadata();
  const band = Math.max(36, Math.round(width * 0.055));
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${band}"><rect width="100%" height="100%" fill="#111111"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="sans-serif" font-size="${Math.round(band * .48)}">Location</text></svg>`);
  return sharp(image).extend({ bottom: band, top: 0, left: 0, right: 0, background: '#111111' }).composite([{ input: label, top: height, left: 0 }]).jpeg({ quality: 94 }).toBuffer();
}

// Only photo-uploaded venues are visual references for the final image model.
// Public catalog and text-generated venues keep their existing prompt-analysis flow.
async function resolveUploadedLocationReference({ supabase, imageUrl, userId }) {
  if (!imageUrl || !userId || typeof imageUrl !== 'string') return null;
  const original = cleanImageUrlForApi(imageUrl);
  const aliases = [...new Set([original, original.replace('https://api.diress.ai', 'https://egpfenrpripkjpemjxtg.supabase.co')])];
  const { data, error } = await supabase.from('custom_locations')
    .select('image_url,replicate_id,user_id,status')
    .in('image_url', aliases)
    .eq('user_id', userId)
    .like('replicate_id', 'sunburst-location-%')
    .eq('status', 'completed')
    .limit(1).maybeSingle();
  if (error) throw error;
  return data?.image_url ? cleanImageUrlForApi(data.image_url) : null;
}
module.exports = { MODEL, LOCATION_DIRECTION, enhancementPrompt, normalizedReference, createReferenceLocation, stampLocationReference, resolveUploadedLocationReference };
