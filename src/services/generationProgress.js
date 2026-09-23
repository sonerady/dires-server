// 🧭 Üretim aşaması (23 Eyl 2026) — Results kartının altındaki kısa, kullanıcı dostu
// durum yazısı için ("Ürünün inceleniyor", "İsteklerin analiz ediliyor"…).
//
// ⚠️ Bilerek BELLEKTE tutulur, reference_results.settings'e YAZILMAZ: settings JSON'u
// üretim sırasında başka yerlerden de (ör. kredi düşüldü bayrağı) oku-yaz ile güncelleniyor;
// sık aşama yazımı o bayrağı ezip çift kredi kesintisine yol açabilirdi. Kayıp tolere
// edilir: aşama yoksa (sunucu yeniden başladı / başka örneğe düşen sorgu) istemci
// süreye dayalı tahmine geçer.
const logger = require("../utils/logger");

// İstemcideki metin anahtarlarıyla sözleşme (client/components/Results.js GENERATION_STAGES)
const STAGES = ["preparing", "product", "request", "scene", "generating", "retrying", "upscaling", "finishing"];
const LABELS = {
  preparing: "fotoğraflar hazırlanıyor",
  product: "ürün inceleniyor",
  request: "istekler analiz ediliyor",
  scene: "çekim planlanıyor",
  generating: "görsel oluşturuluyor",
  retrying: "daha iyi bir kare deneniyor",
  upscaling: "detaylar netleştiriliyor",
  finishing: "son dokunuşlar yapılıyor",
};
const TTL_MS = 30 * 60 * 1000;
const progress = new Map(); // generationId → { stage, at, startedAt }

function setGenerationProgress(generationId, stage) {
  if (!generationId || !STAGES.includes(stage)) return;
  const id = String(generationId);
  const prev = progress.get(id);
  if (prev?.stage === stage) return;
  const now = Date.now();
  const startedAt = prev?.startedAt || now;
  progress.set(id, { stage, at: now, startedAt });
  logger.log(`🧭 [PROGRESS] ${id.slice(0, 8)} → ${LABELS[stage]} (+${((now - startedAt) / 1000).toFixed(1)} sn)`);
  if (progress.size > 5000) {
    for (const [key, value] of progress) if (now - value.at > TTL_MS) progress.delete(key);
  }
}

function getGenerationProgress(generationId) {
  const entry = progress.get(String(generationId || ""));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    progress.delete(String(generationId));
    return null;
  }
  return entry.stage;
}

function clearGenerationProgress(generationId, outcome = "done") {
  const id = String(generationId || "");
  const entry = progress.get(id);
  if (!entry) return;
  logger.log(`🧭 [PROGRESS] ${id.slice(0, 8)} ✓ ${outcome} (toplam ${((Date.now() - entry.startedAt) / 1000).toFixed(1)} sn)`);
  progress.delete(id);
}

module.exports = { setGenerationProgress, getGenerationProgress, clearGenerationProgress, GENERATION_STAGES: STAGES };
