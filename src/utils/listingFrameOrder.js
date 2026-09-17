// 🔢 Listing kare sırası (17 Eyl 2026).
//
// Bir işin kareleri tek insert ile yazıldığı için hepsi AYNI created_at'i alır;
// sıralama bu yüzden veritabanının keyfine kalıyordu. frame_index kolonu bunu
// çözüyor ama kolondan ÖNCE üretilmiş setlerde hepsi 0. O yüzden sıra:
//   frame_index → türün kanonik sırası → varyant numarası → id
// Böylece eski setler de her açılışta aynı ve mantıklı sırayla gelir.
const { IMAGE_TYPES } = require("./listingPrompts");

const TYPE_ORDER = new Map(IMAGE_TYPES.map((type, i) => [type, i]));
const typeRank = (type) => (TYPE_ORDER.has(type) ? TYPE_ORDER.get(type) : IMAGE_TYPES.length);

function compareListingFrames(a, b) {
  const fi = (Number(a?.frame_index) || 0) - (Number(b?.frame_index) || 0);
  if (fi !== 0) return fi;
  const tr = typeRank(a?.image_type) - typeRank(b?.image_type);
  if (tr !== 0) return tr;
  const vi = (Number(a?.variant_index) || 0) - (Number(b?.variant_index) || 0);
  if (vi !== 0) return vi;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

module.exports = { compareListingFrames, typeRank };
