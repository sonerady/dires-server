// 🚦 mapWithLimit — Promise.allSettled ile aynı sonuç şeklini döndüren, ama aynı
// anda en fazla `limit` iş çalıştıran havuz (17 Eyl 2026). Listing Stüdyosu'nda
// kare tavanı 9'dan 12'ye çıkınca tek istek 12 paralel görüntü çağrısı açıyor,
// sağlayıcı hız sınırına takılınca kareler toplu hâlde düşüyordu.
//
// Dönen dizi girdiyle AYNI sırada: [{status:"fulfilled",value} | {status:"rejected",reason}]
async function mapWithLimit(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const out = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= list.length) return;
      try {
        out[i] = { status: "fulfilled", value: await fn(list[i], i) };
      } catch (e) {
        out[i] = { status: "rejected", reason: e };
      }
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

module.exports = { mapWithLimit };
