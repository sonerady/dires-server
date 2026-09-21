// ⚖️ Jev karar katmanı — iki sağlayıcı.
//
// AI_GATEWAY_API_KEY varsa  → AI SDK experimental_evaluate (typesafe-ai/jev)
// OPENROUTER_API_KEY (sk-or-) varsa → OpenRouter decisions endpoint
//
// Soru tipleri gerçek API'ye göre: boolean/choice/score + `criteria`.
// Cevaplar `answers` altında; boolean OLASILIK döner (0-1), çıplak true/false
// değil — eşiği burada biz koyuyoruz.

// `ai` paketi yalnızca Vercel Gateway yolunda gerekli — OpenRouter yolunda
// hiç yüklenmesin diye dinamik import ediyoruz (server'da `ai` kurulu değil).

export const QUESTIONS = {
  isApparel: {
    type: "boolean",
    instructions: "Is this an online store that sells clothing, apparel, or fashion accessories as its main business?",
    criteria: {
      true: "clothing, dresses, knitwear, outerwear, scarves, or fashion accessories dominate the catalogue",
      false: "the catalogue is mainly food, electronics, furniture, cosmetics, pet supplies, or anything else",
    },
  },
  photographyGap: {
    type: "score",
    instructions: "How badly does this store need better product photography, judged from the catalogue statistics?",
    criteria: [
      "none: rich imagery, four or more photos per product",
      "mild: around three photos per product",
      "clear: around two photos per product, many single-photo listings",
      "severe: about one photo per product across a large catalogue",
    ],
  },
  catalogueScale: {
    type: "choice",
    instructions: "How large is this store's catalogue?",
    criteria: {
      tiny: "under 50 products",
      small: "50 to 300 products",
      medium: "300 to 1500 products",
      large: "over 1500 products",
    },
  },
  leadFit: {
    type: "score",
    instructions:
      "How good a sales prospect is this store for an AI product-photography service that generates additional on-model and lifestyle photos? Weigh catalogue size against how weak the current imagery is. A store that already photographs well is a poor prospect no matter how large.",
    criteria: [
      "poor: already photographs well, or too small to matter",
      "weak: some gap but little volume",
      "good: real imagery gap and enough products to matter",
      "excellent: large catalogue with clearly thin imagery",
    ],
  },
};

function buildState(prof, opp, contact) {
  return {
    store: prof.domain,
    catalogue: {
      products: prof.products,
      total_images: prof.images,
      images_per_product: prof.imagesPerProduct,
      percent_products_with_one_image: prof.pctOneImage,
      percent_products_with_four_or_more: prof.pctFourPlus,
      category_median_images_per_product: opp.categoryMedian,
    },
    top_product_types: prof.topTypes,
    sample_product_titles: prof.sampleTitles,
    apparel_keyword_ratio: prof.apparelRatio,
    public_contact_found: contact.emails.length > 0,
  };
}

// OpenRouter / TypeSafe'in YERLİ sözlüğünde boolean'ın adı "noul".
// Vercel Gateway bunu "boolean" diye yeniden adlandırıyor; biz kanonik olarak
// "boolean" yazıp OpenRouter yolunda geri çeviriyoruz.
function toNativeQuestions(questions) {
  const out = {};
  for (const [id, q] of Object.entries(questions)) {
    out[id] = { ...q, type: q.type === "boolean" ? "noul" : q.type };
  }
  return out;
}

async function askOpenRouter(state, questions, signal) {
  questions = toNativeQuestions(questions);
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://diress.ai",
      "X-Title": "diress-lead-scout",
    },
    body: JSON.stringify({ model: "typesafe/jev-1.13", state, questions }),
    signal,
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  return { answers: body.answers ?? {}, usage: body.usage ?? {} };
}

async function askGateway(state, questions, signal) {
  let evaluate;
  try {
    ({ experimental_evaluate: evaluate } = await import("ai"));
  } catch {
    throw new Error("Vercel Gateway yolu icin `npm i ai@^7` gerekli; ya da OPENROUTER_API_KEY kullan.");
  }
  const r = await evaluate({ model: "typesafe-ai/jev", state, questions, abortSignal: signal });
  return { answers: r.answers ?? {}, usage: r.usage ?? {} };
}

export function provider() {
  if (process.env.AI_GATEWAY_API_KEY) return "vercel";
  if (/^sk-or-/.test(process.env.OPENROUTER_API_KEY || "")) return "openrouter";
  return null;
}

export async function judge(prof, opp, contact) {
  const p = provider();
  if (!p) throw new Error("AI_GATEWAY_API_KEY veya sk-or- ile baslayan OPENROUTER_API_KEY gerekli.");
  const state = buildState(prof, opp, contact);
  const { answers, usage } = p === "vercel" ? await askGateway(state, QUESTIONS) : await askOpenRouter(state, QUESTIONS);

  const bool = (a) => (a?.probability ?? a?.noul ?? 0);
  return {
    provider: p,
    isApparel: Number(bool(answers.isApparel).toFixed?.(3) ?? bool(answers.isApparel)),
    photographyGap: answers.photographyGap?.score ?? null,
    catalogueScale: answers.catalogueScale?.choice ?? null,
    leadFit: answers.leadFit?.score ?? null,
    usage,
  };
}

// Kişiye özel ilk cümle — uydurma yok, yalnız ölçülen sayılar.
export function openingLine(prof, opp) {
  if (prof.pctOneImage >= 50) {
    return `${prof.products} ürününüzün %${prof.pctOneImage}'inde tek fotoğraf var; bu kategoride ortalama ürün başına ${opp.categoryMedian} görsel kullanılıyor.`;
  }
  return `${prof.products} ürününüzde ürün başına ortalama ${prof.imagesPerProduct} görsel var; kategori ortalaması ${opp.categoryMedian}.`;
}
