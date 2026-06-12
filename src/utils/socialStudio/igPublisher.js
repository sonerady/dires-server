// Social Studio — Instagram Content Publishing API
// Akış: media container oluştur → durumunu bekle → publish
// Gereksinim: IG Business hesabı + instagram_content_publish izinli token
const axios = require("axios");

const GRAPH = "https://graph.facebook.com/v21.0";

async function createMediaContainer({ igUserId, accessToken, imageUrl, caption, mediaType }) {
  const params = {
    image_url: imageUrl,
    access_token: accessToken,
  };
  if (mediaType === "STORIES") {
    params.media_type = "STORIES"; // story'de caption desteklenmez
  } else {
    params.caption = caption || "";
  }
  const { data } = await axios.post(`${GRAPH}/${igUserId}/media`, null, {
    params,
    timeout: 60000,
  });
  if (!data.id) throw new Error("No container id returned from IG API");
  return data.id;
}

async function waitForContainer({ containerId, accessToken, maxWaitMs = 90000 }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const { data } = await axios.get(`${GRAPH}/${containerId}`, {
      params: { fields: "status_code", access_token: accessToken },
      timeout: 30000,
    });
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR")
      throw new Error("IG container processing failed (status ERROR)");
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("IG container processing timeout");
}

async function publishContainer({ igUserId, accessToken, containerId }) {
  const { data } = await axios.post(
    `${GRAPH}/${igUserId}/media_publish`,
    null,
    {
      params: { creation_id: containerId, access_token: accessToken },
      timeout: 60000,
    },
  );
  if (!data.id) throw new Error("No media id returned from media_publish");
  return data.id;
}

function normalizeIgError(error) {
  const igError = error.response?.data?.error;
  if (igError) {
    const e = new Error(
      `IG API: ${igError.message} (code ${igError.code}${igError.error_subcode ? `/${igError.error_subcode}` : ""})`,
    );
    e.isTransient = Boolean(igError.is_transient) || igError.code === 2;
    return e;
  }
  return error;
}

async function publishOnce({ igUserId, accessToken, imageUrl, caption, mediaType }) {
  const containerId = await createMediaContainer({
    igUserId,
    accessToken,
    imageUrl,
    caption,
    mediaType,
  });
  await waitForContainer({ containerId, accessToken });
  return publishContainer({ igUserId, accessToken, containerId });
}

/**
 * Tek görselli feed postu yayınlar (transient hatalarda 3 deneme).
 * Yayınlanan medyanın IG ID'sini döner.
 */
async function publishImagePost({ igUserId, accessToken, imageUrl, caption }) {
  if (!igUserId || !accessToken)
    throw new Error("Account is missing ig_user_id or access_token");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const mediaId = await publishOnce({ igUserId, accessToken, imageUrl, caption });
      console.log(`✅ [SOCIAL_IG] Published feed media ${mediaId}`);
      return mediaId;
    } catch (error) {
      lastError = normalizeIgError(error);
      console.error(`❌ [SOCIAL_IG] Feed attempt ${attempt}:`, lastError.message);
      if (!lastError.isTransient && attempt > 1) break;
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  throw lastError;
}

/**
 * 9:16 story yayınlar (transient hatalarda 3 deneme — 12 Haz testinde
 * Meta'nın code 2 transient hatası ilk denemede görüldü, retry'da geçti).
 */
async function publishStoryImage({ igUserId, accessToken, imageUrl }) {
  if (!igUserId || !accessToken)
    throw new Error("Account is missing ig_user_id or access_token");
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const mediaId = await publishOnce({
        igUserId,
        accessToken,
        imageUrl,
        mediaType: "STORIES",
      });
      console.log(`✅ [SOCIAL_IG] Published story ${mediaId}`);
      return mediaId;
    } catch (error) {
      lastError = normalizeIgError(error);
      console.error(`❌ [SOCIAL_IG] Story attempt ${attempt}:`, lastError.message);
      if (!lastError.isTransient && attempt > 1) break;
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  throw lastError;
}

/** Token'ın geçerli olup olmadığını ve bağlı IG hesabını kontrol eder. */
async function verifyAccount({ igUserId, accessToken }) {
  const { data } = await axios.get(`${GRAPH}/${igUserId}`, {
    params: { fields: "id,username", access_token: accessToken },
    timeout: 30000,
  });
  return data; // { id, username }
}

module.exports = { publishImagePost, publishStoryImage, verifyAccount };
