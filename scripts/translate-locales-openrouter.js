#!/usr/bin/env node

/**
 * Türkçe uygulama locale'ını OpenRouter üzerinden doğal, UI'a uygun çevirilerle
 * üretir. Her batch sonrası checkpoint alır; yarıda kesilirse kaldığı yerden
 * devam eder.
 *
 * Ön kontrol:
 *   npm run locales:rtl -- --check
 *
 * Üretim:
 *   npm run locales:rtl
 *   npm run locales:rtl -- --languages ar,he
 *
 * Model değiştirme:
 *   OPENROUTER_TRANSLATION_MODEL=openai/gpt-5.6-luna npm run locales:rtl
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

const SERVER_ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");
const LOCALES_DIR = path.join(PROJECT_ROOT, "client", "locales");
const NATIVE_LOCALES_DIR = path.join(LOCALES_DIR, "native");
const PROGRESS_DIR = path.join(SERVER_ROOT, ".locale-translation-progress");
const SOURCE_LANGUAGE = "tr";
const DEFAULT_LANGUAGES = ["ar", "he", "fa", "ur"];
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

const LANGUAGE_INFO = {
  ar: { name: "Arabic", nativeName: "العربية", locale: "ar-SA" },
  he: { name: "Hebrew", nativeName: "עברית", locale: "he-IL" },
  fa: { name: "Persian", nativeName: "فارسی", locale: "fa-IR" },
  ur: { name: "Urdu", nativeName: "اردو", locale: "ur-PK" },
};

function parseArgs(argv) {
  const options = {
    check: false,
    force: false,
    languages: DEFAULT_LANGUAGES,
    batchSize: 40,
    maxRetries: 4,
    model: process.env.OPENROUTER_TRANSLATION_MODEL || DEFAULT_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") options.check = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--languages") {
      options.languages = String(argv[++index] || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    } else if (arg === "--batch-size") {
      options.batchSize = Number(argv[++index]);
    } else if (arg === "--max-retries") {
      options.maxRetries = Number(argv[++index]);
    } else if (arg === "--model") {
      options.model = String(argv[++index] || "").trim();
    } else {
      throw new Error(`Bilinmeyen parametre: ${arg}`);
    }
  }

  if (!options.languages.length) throw new Error("En az bir hedef dil gerekli.");
  for (const language of options.languages) {
    if (!LANGUAGE_INFO[language]) {
      throw new Error(
        `Desteklenmeyen dil: ${language}. Desteklenenler: ${Object.keys(LANGUAGE_INFO).join(", ")}`,
      );
    }
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 5 || options.batchSize > 100) {
    throw new Error("--batch-size 5 ile 100 arasında bir tam sayı olmalı.");
  }
  if (!Number.isInteger(options.maxRetries) || options.maxRetries < 1 || options.maxRetries > 10) {
    throw new Error("--max-retries 1 ile 10 arasında bir tam sayı olmalı.");
  }
  if (!options.model) throw new Error("Model adı boş olamaz.");
  return options;
}

function printHelp() {
  console.log(`
RTL locale çeviri aracı (OpenRouter)

Kullanım:
  npm run locales:rtl -- --check
  npm run locales:rtl
  npm run locales:rtl -- --languages ar,he

Parametreler:
  --check                 API çağrısı yapmadan dosyaları ve iş miktarını gösterir
  --languages ar,he,fa,ur Virgülle ayrılmış hedef diller
  --batch-size 40         İstek başına metin sayısı (5-100)
  --max-retries 4         Hatalı istek için yeniden deneme sayısı
  --model <model-id>      OpenRouter model kimliği
  --force                 Mevcut tamamlanmış hedef locale'ı yeniden üretir
  --help                  Bu yardımı gösterir

Ortam değişkenleri:
  OPENROUTER_API_KEY              Zorunlu (yalnız gerçek üretimde)
  OPENROUTER_TRANSLATION_MODEL    Varsayılan: ${DEFAULT_MODEL}
  OPENROUTER_SITE_URL             İsteğe bağlı
  OPENROUTER_APP_NAME             İsteğe bağlı

İlerleme dosyaları:
  ${PROGRESS_DIR}
`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function countLeaves(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countLeaves(item), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((sum, item) => sum + countLeaves(item), 0);
  }
  return 1;
}

function flatten(value, currentPath = [], result = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, [...currentPath, index], result));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => flatten(item, [...currentPath, key], result));
  } else {
    result.push({ path: currentPath, value });
  }
  return result;
}

function pathId(parts) {
  return JSON.stringify(parts);
}

function displayPath(parts) {
  return parts
    .map((part, index) => (typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`))
    .join("");
}

function setAtPath(target, parts, value) {
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]];
  cursor[parts[parts.length - 1]] = value;
}

function isTranslatable(value) {
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (!text || text.length === 1) return false;
  if (/^#[0-9a-f]{3,8}$/i.test(text)) return false;
  if (/^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i.test(text)) return false;
  if (/^(?:https?:\/\/|mailto:|tel:)/i.test(text)) return false;
  if (/^[\d\s.,:+\-/%₺$€£¥₽]+$/u.test(text)) return false;
  if (/^\{\{[^{}]+\}\}$/.test(text)) return false;
  if (/^[\w./@-]+\.(?:png|jpe?g|webp|gif|svg|mp4|mov|json)$/i.test(text)) return false;
  return /\p{L}/u.test(text);
}

function protectedTokens(text) {
  const patterns = [
    /\{\{[^{}]+\}\}/g,
    /\$\{[^{}]+\}/g,
    /%\{[^{}]+\}/g,
    /<\/?[a-zA-Z][^>]*>/g,
    /https?:\/\/[^\s)]+/g,
  ];
  return patterns.flatMap((pattern) => text.match(pattern) || []).sort();
}

function sameProtectedTokens(source, translated) {
  return JSON.stringify(protectedTokens(source)) === JSON.stringify(protectedTokens(translated));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function loadCheckpoint(language, sourceEntries, sourceHash, reset) {
  const filePath = path.join(PROGRESS_DIR, `${SOURCE_LANGUAGE}-to-${language}.json`);
  if (!reset && fs.existsSync(filePath)) {
    const checkpoint = readJson(filePath);
    if (checkpoint.sourceEntries !== sourceEntries || checkpoint.sourceHash !== sourceHash) {
      throw new Error(
        `${language} checkpoint'i eski Türkçe locale'a ait. Yeniden başlatmak için --force kullan.`,
      );
    }
    checkpoint.translations ||= {};
    return { checkpoint, filePath };
  }
  return {
    checkpoint: {
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage: language,
      sourceEntries,
      sourceHash,
      translations: {},
      updatedAt: new Date().toISOString(),
    },
    filePath,
  };
}

function buildTarget(source, entries, translations) {
  const target = deepClone(source);
  for (const entry of entries) {
    const translated = translations[pathId(entry.path)];
    if (typeof translated === "string") setAtPath(target, entry.path, translated);
  }
  return target;
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "hesaplanıyor";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}s ${minutes}dk`;
  if (minutes) return `${minutes}dk ${seconds}sn`;
  return `${seconds}sn`;
}

function progressBar(percent, width = 24) {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function printProgress({ language, languageDone, languageTotal, overallDone, overallTotal, startedAt }) {
  const languagePercent = languageTotal ? (languageDone / languageTotal) * 100 : 100;
  const overallPercent = overallTotal ? (overallDone / overallTotal) * 100 : 100;
  const elapsed = Date.now() - startedAt;
  const completedThisRun = Math.max(0, overallDone - printProgress.initialDone);
  const remaining = Math.max(0, overallTotal - overallDone);
  const eta = completedThisRun ? (elapsed / completedThisRun) * remaining : NaN;
  const info = LANGUAGE_INFO[language];

  console.log(`\n${progressBar(overallPercent)}  TOPLAM %${overallPercent.toFixed(1)}`);
  console.log(
    `Aktif dil: ${language} — ${info.nativeName} | ${languageDone}/${languageTotal} (%${languagePercent.toFixed(1)})`,
  );
  console.log(`Geçen: ${formatDuration(elapsed)} | Tahmini kalan: ${formatDuration(eta)}`);
}
printProgress.initialDone = 0;

function extractJson(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = text.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw new Error("Model cevabında geçerli JSON bulunamadı.");
  }
}

function createMessages(language, batch) {
  const info = LANGUAGE_INFO[language];
  const payload = batch.map((entry, id) => ({
    id: String(id),
    key: displayPath(entry.path),
    tr: entry.value,
    sourceCharacters: [...entry.value].length,
  }));

  return [
    {
      role: "system",
      content: `You are the senior ${info.name} (${info.nativeName}) UX writer for Diress, an AI fashion and e-commerce product photography app. Translate Turkish UI copy into natural, polished ${info.name}.

Rules:
- Translate meaning and intent, never word-for-word. It must sound originally written by a native product copywriter.
- Keep titles energetic, direct and immediately understandable. Keep descriptions warm, concise and persuasive.
- Match the source's visual compactness. Prefer a similar rendered UI width and line count; do not add explanations.
- Use terminology natural to fashion sellers, e-commerce teams and social media creators.
- Preserve every placeholder, interpolation token, URL and markup tag EXACTLY (for example {{count}}, {{credits}}, <b>…</b>).
- Preserve emoji only when present and keep its intent.
- Do not translate product name Diress or common brand/model names.
- Return every item exactly once. Return valid JSON only with this shape: {"translations":[{"id":"0","text":"..."}]}`,
    },
    {
      role: "user",
      content: `Translate these Turkish locale entries into ${info.name}. JSON input:\n${JSON.stringify(payload)}`,
    },
  ];
}

async function requestTranslation({ apiKey, model, language, batch, maxRetries }) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://diress.ai",
          "X-Title": process.env.OPENROUTER_APP_NAME || "Diress Locale Translator",
        },
        body: JSON.stringify({
          model,
          messages: createMessages(language, batch),
          temperature: 0.25,
          response_format: { type: "json_object" },
        }),
      });

      const raw = await response.text();
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${raw.slice(0, 500)}`);
      const completion = JSON.parse(raw);
      const parsed = extractJson(completion?.choices?.[0]?.message?.content);
      if (!Array.isArray(parsed.translations)) throw new Error("Cevapta translations dizisi yok.");

      const byId = new Map(parsed.translations.map((item) => [String(item.id), item.text]));
      return batch.map((entry, id) => {
        const text = byId.get(String(id));
        if (typeof text !== "string" || !text.trim()) {
          throw new Error(`${displayPath(entry.path)} için çeviri eksik.`);
        }
        if (!sameProtectedTokens(entry.value, text)) {
          throw new Error(`${displayPath(entry.path)} içinde placeholder/URL/tag değişti.`);
        }
        return text.trim();
      });
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      const waitMs = Math.min(30000, 1500 * 2 ** (attempt - 1));
      console.warn(`⚠️  İstek başarısız (${attempt}/${maxRetries}): ${error.message}`);
      console.warn(`   ${formatDuration(waitMs)} sonra yeniden denenecek…`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

function existingLocaleStatus(language, sourceLeafCount) {
  const targetPath = path.join(LOCALES_DIR, `${language}.json`);
  const nativePath = path.join(NATIVE_LOCALES_DIR, `${language}.json`);
  let mainLeaves = 0;
  let mainError = null;
  if (fs.existsSync(targetPath)) {
    try {
      mainLeaves = countLeaves(readJson(targetPath));
    } catch (error) {
      mainError = error.message;
    }
  }
  let nativeLeaves = 0;
  if (fs.existsSync(nativePath)) nativeLeaves = countLeaves(readJson(nativePath));
  return {
    targetPath,
    mainExists: fs.existsSync(targetPath),
    mainComplete: mainLeaves === sourceLeafCount,
    mainLeaves,
    mainError,
    nativeExists: fs.existsSync(nativePath),
    nativeLeaves,
  };
}

function printCheck(source, translatableEntries, languages, batchSize) {
  const sourceLeafCount = countLeaves(source);
  console.log("\nRTL locale ön kontrolü");
  console.log(`Kaynak: client/locales/${SOURCE_LANGUAGE}.json`);
  console.log(`Toplam değer: ${sourceLeafCount} | Çevrilecek metin: ${translatableEntries.length}`);
  console.log("\nDil  Tam uygulama locale       Native sistem locale");
  console.log("---  -----------------------  --------------------");
  for (const language of languages) {
    const status = existingLocaleStatus(language, sourceLeafCount);
    const main = status.mainError
      ? "bozuk JSON"
      : status.mainExists
        ? `${status.mainLeaves} değer${status.mainComplete ? " (tam)" : " (eksik)"}`
        : "YOK";
    const native = status.nativeExists ? `${status.nativeLeaves} değer` : "YOK";
    console.log(`${language.padEnd(4)} ${main.padEnd(23)}  ${native}`);
  }
  console.log(
    `\nTahmini batch: dil başına ${Math.ceil(translatableEntries.length / batchSize)} (${batchSize} metin/batch)`,
  );
  console.log("--check API çağrısı yapmadı ve hiçbir locale dosyasını değiştirmedi.\n");
}

async function main() {
  dotenv.config({ path: path.join(SERVER_ROOT, ".env"), override: false, quiet: true });
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sourcePath = path.join(LOCALES_DIR, `${SOURCE_LANGUAGE}.json`);
  const source = readJson(sourcePath);
  const allEntries = flatten(source);
  const translatableEntries = allEntries.filter((entry) => isTranslatable(entry.value));
  const sourceHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(translatableEntries))
    .digest("hex");

  if (options.check) {
    printCheck(source, translatableEntries, options.languages, options.batchSize);
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY bulunamadı. Anahtarı server/.env içine ekle veya terminal ortam değişkeni olarak ver.",
    );
  }

  const sourceLeafCount = allEntries.length;
  const jobs = [];
  for (const language of options.languages) {
    const status = existingLocaleStatus(language, sourceLeafCount);
    if (status.mainExists && !options.force) {
      console.log(
        `⏭️  ${language}: client/locales/${language}.json zaten var (${status.mainLeaves} değer). Yenilemek için --force kullan.`,
      );
      continue;
    }
    const loaded = loadCheckpoint(
      language,
      translatableEntries.length,
      sourceHash,
      options.force,
    );
    const completed = translatableEntries.filter(
      (entry) => typeof loaded.checkpoint.translations[pathId(entry.path)] === "string",
    ).length;
    jobs.push({ language, ...loaded, completed });
  }

  if (!jobs.length) {
    console.log("Çevrilecek yeni dil kalmadı.");
    return;
  }

  const overallTotal = jobs.length * translatableEntries.length;
  let overallDone = jobs.reduce((sum, job) => sum + job.completed, 0);
  printProgress.initialDone = overallDone;
  const startedAt = Date.now();

  console.log("\n🌍 RTL locale üretimi başladı");
  console.log(`Model: ${options.model}`);
  console.log(`Diller: ${jobs.map((job) => job.language).join(", ")}`);
  console.log(`Batch boyutu: ${options.batchSize} | Checkpoint: ${PROGRESS_DIR}`);
  console.log("Durdurmak güvenli: Ctrl+C. Sonraki çalıştırmada kaldığı yerden devam eder.");

  for (const job of jobs) {
    const { language, checkpoint, filePath } = job;
    let languageDone = job.completed;
    let pending = translatableEntries.filter(
      (entry) => typeof checkpoint.translations[pathId(entry.path)] !== "string",
    );
    const batchTotal = Math.ceil(pending.length / options.batchSize);

    console.log(`\n▶ ${language} — ${LANGUAGE_INFO[language].nativeName} başladı`);
    if (languageDone) console.log(`   Checkpoint'ten ${languageDone} metin yüklendi.`);
    printProgress({
      language,
      languageDone,
      languageTotal: translatableEntries.length,
      overallDone,
      overallTotal,
      startedAt,
    });

    for (let offset = 0; offset < pending.length; offset += options.batchSize) {
      const batch = pending.slice(offset, offset + options.batchSize);
      const batchNumber = Math.floor(offset / options.batchSize) + 1;
      console.log(`\n⏳ ${language} batch ${batchNumber}/${batchTotal} — ${batch.length} metin gönderiliyor…`);

      const translated = await requestTranslation({
        apiKey,
        model: options.model,
        language,
        batch,
        maxRetries: options.maxRetries,
      });

      batch.forEach((entry, index) => {
        checkpoint.translations[pathId(entry.path)] = translated[index];
      });
      checkpoint.updatedAt = new Date().toISOString();
      atomicWriteJson(filePath, checkpoint);
      atomicWriteJson(
        path.join(PROGRESS_DIR, `${SOURCE_LANGUAGE}-to-${language}.partial.json`),
        buildTarget(source, translatableEntries, checkpoint.translations),
      );

      languageDone += batch.length;
      overallDone += batch.length;
      console.log(`✅ ${language} batch ${batchNumber}/${batchTotal} kaydedildi`);
      printProgress({
        language,
        languageDone,
        languageTotal: translatableEntries.length,
        overallDone,
        overallTotal,
        startedAt,
      });
    }

    const target = buildTarget(source, translatableEntries, checkpoint.translations);
    atomicWriteJson(path.join(LOCALES_DIR, `${language}.json`), target);
    console.log(`\n🎉 ${language} tamamlandı → client/locales/${language}.json`);
  }

  console.log(`\n🏁 Tüm diller tamamlandı. Toplam süre: ${formatDuration(Date.now() - startedAt)}`);
  console.log("Sonraki adım: üretilen metinleri gözden geçirip i18n.js'e dilleri eklemek.");
}

process.on("SIGINT", () => {
  console.log("\n\n⏸️  Durduruldu. Tamamlanan son batch checkpoint'te; aynı komutla devam edebilirsin.");
  process.exit(130);
});

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exit(1);
});
