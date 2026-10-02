const fs = require("node:fs");
const path = require("node:path");
const names = require("./names.json");
const catalogs = new Map();

function catalog(language) {
  if (!catalogs.has(language)) {
    const file = path.join(__dirname, `${language}.json`);
    catalogs.set(language, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  }
  return catalogs.get(language);
}

function templateName(entry, language) {
  return catalog(language)[entry.id]?.name || names[language]?.[entry.id] || (language === "tr" && entry.name_tr) || entry.name;
}

function authoredRow(entry, source, language, formatFragment) {
  const record = catalog(language)[entry.id];
  if (!record || record.source_hash !== source.sourceHash) return null;
  if (!source.strings.every(text => Object.hasOwn(record.translations, text))) return null;
  const translations = Object.fromEntries(source.strings.map(text => [text,
    record.translations[text] === null ? formatFragment(text, language) || text : record.translations[text],
  ]));
  return { language, template_id: entry.id, source_hash: source.sourceHash, name: record.name, translations };
}

module.exports = { authoredRow, templateName, catalog };
