#!/usr/bin/env node
// 🛍️ Ürün Stüdyosu araç spec'ini istemciye aktarır (23 Eyl 2026).
//
// Tek kaynak server/src/utils/studioTools.js. Bu betik:
//   1) client/commerce/studioToolsSpec.json — araçların yapısı (kimlikler, türler,
//      varsayılanlar, sınırlar) + her etiket için i18n anahtarı ve İngilizce
//      varsayılan. Üretim talimatları istemciye GİTMEZ.
//   2) client/locales/en.json + tr.json — "studioTools" ad alanı (metin tabanlı
//      ekleme/değiştirme; dosyanın geri kalanına dokunmaz).
//   3) Web aynası: web-dashboard/lib/studioToolsSpec.json + public/locales/en.json/tr.json
//      (web sözlükleri mobil sözlüklerin kopyası; diğer diller spec'teki İngilizceye düşer).
// Birden çok araçta aynı olan etiketler "_shared" altında tek anahtara iner
// (70 dile çeviride tekrar olmasın).
//
// Kullanım: node scripts/export-studio-tools.cjs
const fs = require("fs");
const path = require("path");
const { TOOLS, publicSpec } = require("../src/utils/studioTools");

const CLIENT = path.resolve(__dirname, "../../client");
const SPEC_PATH = path.join(CLIENT, "commerce/studioToolsSpec.json");
const LOCALES = { en: path.join(CLIENT, "locales/en.json"), tr: path.join(CLIENT, "locales/tr.json") };
const WEB = path.resolve(__dirname, "../../web-dashboard");
const WEB_SPEC_PATH = path.join(WEB, "lib/studioToolsSpec.json");
const WEB_LOCALES = { en: path.join(WEB, "public/locales/en.json"), tr: path.join(WEB, "public/locales/tr.json") };

const setDeep = (obj, parts, value) => {
  let node = obj;
  parts.slice(0, -1).forEach((part) => {
    node[part] = node[part] || {};
    node = node[part];
  });
  node[parts[parts.length - 1]] = value;
};

/** Kayıt defterinden istemci spec'i + en/tr locale ağaçları (dosyaya yazmaz; test de kullanır). */
function buildClientSpec() {
  const tree = { en: {}, tr: {} };

  // Paylaşılan etiket adayları: aynı (yol, en, tr) üçlüsü ≥ 2 araçta geçiyorsa
  const usage = new Map();
  const countUse = (sharedPath, label) => {
    const id = `${sharedPath.join(".")}|${label.en}|${label.tr}`;
    usage.set(id, (usage.get(id) || 0) + 1);
  };
  for (const tool of TOOLS) {
    for (const control of tool.controls || []) {
      countUse(["controls", control.id, "title"], control.title);
      if (control.hint) countUse(["controls", control.id, "hint"], control.hint);
      for (const option of control.options || []) countUse(["controls", control.id, "options", option.id], option.label);
    }
  }

  /** Etiket → { key, en } ve locale ağaçlarına yazar. */
  function label(value, toolId, parts, sharedParts = null) {
    if (!value) return null;
    const shared = sharedParts && usage.get(`${sharedParts.join(".")}|${value.en}|${value.tr}`) > 1;
    const keyParts = shared ? ["_shared", ...sharedParts] : [toolId, ...parts];
    setDeep(tree.en, keyParts, value.en);
    setDeep(tree.tr, keyParts, value.tr);
    return { key: `studioTools.${keyParts.join(".")}`, en: value.en };
  }

  const spec = TOOLS.map((tool) => {
    const pub = publicSpec(tool);
    return {
      ...pub,
      title: label(tool.title, tool.id, ["title"]),
      subtitle: label(tool.subtitle, tool.id, ["subtitle"]),
      upload: {
        ...pub.upload,
        title: label(tool.upload?.title, tool.id, ["upload", "title"]),
        hint: label(tool.upload?.hint, tool.id, ["upload", "hint"]),
      },
      refs: (tool.refs || []).map((ref) => ({
        id: ref.id,
        required: !!ref.required,
        max: ref.max || 1,
        title: label(ref.title, tool.id, ["refs", ref.id, "title"]),
        hint: label(ref.hint, tool.id, ["refs", ref.id, "hint"]),
      })),
      controls: (tool.controls || []).map((control, index) => {
        const base = pub.controls[index];
        const common = {
          ...base,
          title: label(control.title, tool.id, ["controls", control.id, "title"], ["controls", control.id, "title"]),
          hint: label(control.hint, tool.id, ["controls", control.id, "hint"], ["controls", control.id, "hint"]),
        };
        if (control.type === "text") return { ...common, placeholder: label(control.placeholder, tool.id, ["controls", control.id, "placeholder"]) };
        return {
          ...common,
          options: control.options.map((option) => ({
            id: option.id,
            label: label(option.label, tool.id, ["controls", control.id, "options", option.id], ["controls", control.id, "options", option.id]),
          })),
        };
      }),
    };
  });
  return { spec, locales: tree };
}

// Locale: metin tabanlı ekleme — dosyanın geri kalanı byte-byte aynı kalır.
function writeNamespace(file, value) {
  const text = fs.readFileSync(file, "utf8");
  JSON.parse(text); // bozuk dosyaya yazma
  const block = JSON.stringify({ studioTools: value }, null, 2).slice(2, -2); // `  "studioTools": {...}`
  const marker = '\n  "studioTools": {';
  let next;
  const start = text.indexOf(marker);
  if (start >= 0) {
    // mevcut bloğu parantez eşleştirerek değiştir
    let depth = 0;
    let i = text.indexOf("{", start + 1);
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) break; }
    }
    next = `${text.slice(0, start + 1)}${block.trimStart().replace(/^/, "  ")}${text.slice(i + 1)}`;
  } else {
    const end = text.lastIndexOf("}");
    const body = text.slice(0, end).replace(/\s*$/, "");
    next = `${body},\n${block}\n}\n`;
  }
  JSON.parse(next);
  fs.writeFileSync(file, next);
}

function main() {
  const { spec, locales: tree } = buildClientSpec();
  const specJson = `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString().slice(0, 10), tools: spec }, null, 1)}\n`;
  fs.writeFileSync(SPEC_PATH, specJson);
  writeNamespace(LOCALES.en, tree.en);
  writeNamespace(LOCALES.tr, tree.tr);
  if (fs.existsSync(WEB)) {
    fs.writeFileSync(WEB_SPEC_PATH, specJson);
    writeNamespace(WEB_LOCALES.en, tree.en);
    writeNamespace(WEB_LOCALES.tr, tree.tr);
  }

  const strings = JSON.stringify(tree.en).match(/":"/g)?.length || 0;
  console.log(`✅ ${spec.length} araç → ${path.relative(process.cwd(), SPEC_PATH)} · ${strings} etiket (en+tr)`);
}

if (require.main === module) main();

module.exports = { buildClientSpec, SPEC_PATH, WEB_SPEC_PATH };
