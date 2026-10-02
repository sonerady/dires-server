// Local file-only authoring. No network or translation provider is used.
const fs = require("node:fs");
const path = require("node:path");
const { TEMPLATES } = require("../../src/data/bannerTemplates");
const { sourceFor } = require("../../src/data/bannerTemplates/localize");
const root = path.resolve(__dirname, "../../src/data/bannerTemplates/authored");
const [mode, language, input] = process.argv.slice(2);
if (mode === "source") {
  const file = path.join(root, `${language}.json`);
  const done = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const entries = input ? TEMPLATES.filter(entry => input.split(",").includes(entry.id)) : TEMPLATES.filter(entry => !done[entry.id]).slice(0, 20);
  for (const entry of entries) console.log(JSON.stringify({ id: entry.id, name: entry.name, strings: sourceFor(entry).strings }));
} else if (mode === "write") {
  const file = path.join(root, `${language}.json`);
  const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const authored = JSON.parse(fs.readFileSync(input));
  for (const [id, values] of Object.entries(authored)) {
    const entry = TEMPLATES.find(template => template.id === id);
    if (!entry) throw new Error(`Unknown template ${id}`);
    const source = sourceFor(entry);
    if (values.length !== source.strings.length) throw new Error(`${id}: expected ${source.strings.length}, received ${values.length}`);
    if (typeof values[0] !== "string" || values.some(value => value !== null && (typeof value !== "string" || !value.trim()))) throw new Error(`Invalid translation in ${id}`);
    // null is an explicitly reviewed brand/code/number; numeric fragments use Intl at display time.
    catalog[id] = { name: values[0], source_hash: source.sourceHash, translations: Object.fromEntries(source.strings.map((text, index) => [text, values[index]])) };
  }
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${language}: ${Object.keys(catalog).length}/${TEMPLATES.length} fully authored templates`);
} else if (mode === "coverage") {
  const locales = fs.readdirSync(path.resolve(__dirname, "../../../client/locales")).filter(name => name.endsWith(".json") && name !== "web.json").map(name => name.slice(0, -5));
  const sources = new Map(TEMPLATES.map(entry => [entry.id, sourceFor(entry)]));
  const report = {};
  for (const locale of locales) {
    const file = path.join(root, `${locale}.json`);
    const catalog = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
    const complete = TEMPLATES.filter(entry => {
      const source = sources.get(entry.id), row = catalog[entry.id];
      return row?.source_hash === source.sourceHash && source.strings.every(text => Object.hasOwn(row.translations, text));
    }).map(entry => entry.id);
    report[locale] = { complete: complete.length, total: TEMPLATES.length, sourceLanguage: locale === "en", pending: TEMPLATES.filter(entry => !complete.includes(entry.id)).map(entry => entry.id) };
  }
  fs.writeFileSync(path.join(root, "coverage.json"), JSON.stringify(report, null, 2) + "\n");
  for (const [locale, status] of Object.entries(report)) console.log(`${locale}: ${status.complete}/${status.total}`);
} else throw new Error("Use source <language> [ids], write <language> <file>, or coverage");
