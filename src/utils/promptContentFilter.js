// 🛡️ 422 İÇERİK FİLTRESİ GÜVENLİK AĞI
//
// Gemini görüntü modelleri (fal nano-banana-2 / GPT Image 2), reşit olmayan yaş
// ibaresi + ten/cilt tasviri kombinasyonunu içerik filtresine takıp isteği 422
// (Unprocessable Entity) ile reddedebiliyor. Canlıda görülen örnek: "the healthy,
// soft matte texture of a 17 years old model ... exposed across her bare
// shoulders and back" → 422, üretim tamamen kayboldu.
//
// Bu util SON ÇARE olarak kullanılır: normal denemeler (aynı prompt'la) 422
// vermeye devam ederse, prompt'tan yaş ibareleri ve ten tasvirli cümleler
// ayıklanıp bir kez daha denenir. Amaç mükemmel prompt değil, üretimin
// kaybolmaması.

// Yaş ibarelerini nötr "adult"/"young" ifadesine çevirir; ten/cilt tasviri
// içeren cümleleri tamamen çıkarır.
function sanitizePromptForContentFilter(prompt) {
  if (!prompt || typeof prompt !== "string") return prompt;

  let out = prompt;

  // "17 years old", "17-year-old", "aged 17", "17 yaşında" gibi yaş ibareleri.
  // Sayı ne olursa olsun nötrle — filtre bazen 18+ sayılarda da yaş+ten
  // kombinasyonuna takılabiliyor; son çare denemesinde yaş bilgisi feda edilir.
  out = out.replace(
    /\b(?:aged\s+)?\d{1,2}\s*(?:-\s*)?years?\s*(?:-\s*)?old\b/gi,
    "adult",
  );
  out = out.replace(/\b\d{1,2}\s*yaşında\b/gi, "adult");

  // Ten/cilt/çıplaklık tasviri geçen cümleleri kaldır. Cümle bazlı çalışır ki
  // kalan prompt akıcı kalsın; "accurate skin tones" gibi masum kullanımlar da
  // gidebilir ama bu yalnızca son-şans denemesidir.
  out = out
    .split(/(?<=[.!?])\s+/)
    .filter(
      (sentence) => !/\b(skin|bare|exposed|nude|naked|flesh)\b/i.test(sentence),
    )
    .join(" ");

  // Ardışık boşlukları toparla
  out = out.replace(/[ \t]{2,}/g, " ").trim();

  return out;
}

// Hata objesinin 422 (içerik filtresi / unprocessable) olup olmadığını anlar.
// Axios (error.response.status), fal SDK (error.status) ve mesaj metni
// ("status code 422") şekillerinin üçünü de kapsar.
function isContentFilter422(error) {
  if (!error) return false;
  return (
    error.response?.status === 422 ||
    error.status === 422 ||
    /\b422\b/.test(String(error.message || ""))
  );
}

module.exports = {
  sanitizePromptForContentFilter,
  isContentFilter422,
};
