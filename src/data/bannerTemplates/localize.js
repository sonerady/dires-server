const crypto = require("crypto");
const cheerio = require("cheerio");
const { readRaw, readAnimated } = require("./index");
const REVIEWED_COPY = require("./reviewedCopy");
const { authoredRow, templateName } = require("./authored");
const { letteredNodes, renderLettered } = require("./letteredCopy");
const { localizedLayout } = require("./localizedLayout");

// Keep this list in step with client/i18n.js. The full tag matters for Traditional Chinese.
const LANGUAGES = new Set("af am ar az be bg bn ca cs da de el en es et eu fa fi fil fr gl gu he hi hr hu hy id is it ja ka kk km kn ko ky lo lt lv mk ml mn mr ms ne nl no pa pl pt rm ro ru si sk sl sr sv sw ta te th tr uk ur uz vi zh zu".split(" "));
const RTL = new Set(["ar", "fa", "he", "ur"]);
const COMPLEX_SCRIPTS = new Set(["am", "bn", "gu", "hi", "ja", "km", "kn", "ko", "lo", "ml", "mr", "ne", "pa", "si", "ta", "te", "th", "zh", "zh-Hant"]);
const REGION_CURRENCY = Object.fromEntries("ZA:ZAR ET:ETB EG:EGP AZ:AZN BY:BYN BG:EUR BD:BDT ES:EUR CZ:CZK DK:DKK DE:EUR GR:EUR US:USD EE:EUR IR:IRR FI:EUR PH:PHP FR:EUR IN:INR IL:ILS HR:EUR HU:HUF AM:AMD ID:IDR IS:ISK IT:EUR JP:JPY GE:GEL KZ:KZT KH:KHR KR:KRW KG:KGS LA:LAK LT:EUR LV:EUR MK:MKD MN:MNT MY:MYR NP:NPR NL:EUR NO:NOK PL:PLN BR:BRL CH:CHF RO:RON RU:RUB LK:LKR SK:EUR SI:EUR RS:RSD SE:SEK TZ:TZS TH:THB TR:TRY UA:UAH PK:PKR UZ:UZS VN:VND CN:CNY TW:TWD".split(" ").map(pair => pair.split(":")));
const memory = new Map();
const inflight = new Map();

function normalizeLanguage(input) {
  const tag = String(input || "en").replace(/_/g, "-").toLowerCase();
  if (tag === "zh-hant" || /^zh-(tw|hk|mo)(-|$)/.test(tag)) return "zh-Hant";
  const base = tag.split("-")[0];
  const aliased = { nb: "no", nn: "no", tl: "fil", iw: "he" }[base] || base;
  return LANGUAGES.has(aliased) ? aliased : "en";
}

function marketCurrency(lang) {
  const region = lang === "zh-Hant" ? "TW" : new Intl.Locale(lang).maximize().region;
  return { region, currency: REGION_CURRENCY[region] || "USD" };
}
function marketLocale(lang) {
  return `${lang}-${marketCurrency(lang).region}`;
}

function fixedFragment(text, lang) {
  const wholePercent = text.match(/^\[percent:(\d+)\]$/);
  if (wholePercent) return new Intl.NumberFormat(marketLocale(lang), { style: "percent" }).format(Number(wholePercent[1]) / 100);
  const unit = text.match(/^\[unit:(day|hour|minute)\]$/);
  if (unit) return new Intl.NumberFormat(marketLocale(lang), { style: "unit", unit: unit[1], unitDisplay: "short" }).formatToParts(2).find(part => part.type === "unit")?.value || unit[1];
  const calendar = text.match(/^\[(weekday|month):(\d+)\]$/);
  if (calendar) {
    const value = Number(calendar[2]);
    const date = calendar[1] === "weekday" ? new Date(Date.UTC(2024, 0, value)) : new Date(Date.UTC(2024, value - 1, 1));
    return new Intl.DateTimeFormat(marketLocale(lang), { [calendar[1]]: "short", timeZone: "UTC", calendar: "gregory" }).format(date);
  }
  if (RTL.has(lang) && /^[→←›‹]$/.test(text)) return { "→": "←", "←": "→", "›": "‹", "‹": "›" }[text];
  if (text === "%") return new Intl.NumberFormat(marketLocale(lang), { style: "percent" }).formatToParts(0.5).find(part => part.type === "percentSign")?.value || "%";
  if (/^\d+$/.test(text)) {
    const digits = Array.from({ length: 10 }, (_, n) => new Intl.NumberFormat(marketLocale(lang), { useGrouping: false }).format(n));
    return text.replace(/\d/g, digit => digits[Number(digit)]);
  }
  if (/^[$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨]$/u.test(text)) {
    const { currency } = marketCurrency(lang);
    return new Intl.NumberFormat(marketLocale(lang), { style: "currency", currency }).formatToParts(1).find(part => part.type === "currency")?.value || currency;
  }
  const price = text.match(/^([$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨])\s*(\d[\d,]*(?:\.\d{1,2})?)$/u)
    || text.match(/^(\d[\d,]*(?:\.\d{1,2})?)\s*([$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨])$/u);
  if (price) {
    const amount = Number(price[1].match(/\d/) ? price[1].replace(/,/g, "") : price[2].replace(/,/g, ""));
    if (Number.isFinite(amount)) {
      const { currency } = marketCurrency(lang);
      return new Intl.NumberFormat(marketLocale(lang), { style: "currency", currency }).format(amount);
    }
  }
  const percent = text.match(/^([+\-−]?)(\d+(?:[.,]\d+)?)\s*%$/);
  if (percent) {
    const amount = Number(percent[2].replace(",", "."));
    if (Number.isFinite(amount)) return `${percent[1]}${new Intl.NumberFormat(marketLocale(lang), { style: "percent", maximumFractionDigits: 2 }).format(amount / 100)}`;
  }
  return null;
}

function isCopy(text) {
  const value = text.trim();
  return /[\p{L}\p{N}$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨%→←›‹]/u.test(value)
    && !/^(?:XS|S|M|L|XL|XXL|SKU|QR)$/i.test(value)
    && (value.length > 1 || /[^\x00-\x7f]/.test(value) || /[\p{N}$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨%→←›‹]/u.test(value));
}

function textNodes(raw) {
  const $ = cheerio.load(raw, { sourceCodeLocationInfo: true });
  const nodes = [];
  $("body *").contents().each((_, node) => {
    if (node.type !== "text" || !node.sourceCodeLocation) return;
    const text = node.data.trim().replace(/\s+/g, " ");
    if (isCopy(text)) nodes.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset, text, svg: node.parent?.namespace === "http://www.w3.org/2000/svg" });
  });
  // Accessible labels are visible to assistive technology and need the same language as the banner.
  $("body *").each((_, element) => {
    for (const name of ["aria-label", "alt", "title", "placeholder"]) {
      const location = element.sourceCodeLocation?.attrs?.[name];
      const value = element.attribs?.[name]?.trim();
      if (!location || !isCopy(value || "")) continue;
      const source = raw.slice(location.startOffset, location.endOffset);
      const match = source.match(/^[\w:-]+\s*=\s*(["'])([\s\S]*?)\1$/);
      if (!match) continue;
      const relative = source.indexOf(match[1] + match[2] + match[1]) + 1;
      nodes.push({ start: location.startOffset + relative, end: location.startOffset + relative + match[2].length, text: value, attributeQuote: match[1] });
    }
  });
  // A few templates print words from CSS pseudo-elements rather than DOM nodes.
  for (const style of $("style").toArray()) {
    const loc = style.children?.[0]?.sourceCodeLocation;
    if (!loc) continue;
    const css = raw.slice(loc.startOffset, loc.endOffset);
    const re = /\bcontent\s*:\s*(["'])([^"'\\]*(?:\\.[^"'\\]*)*)\1/g;
    for (const match of css.matchAll(re)) {
      if (!isCopy(match[2]) || /\\[0-9a-f]/i.test(match[2])) continue;
      const relative = match.index + match[0].indexOf(match[1] + match[2] + match[1]) + 1;
      nodes.push({ start: loc.startOffset + relative, end: loc.startOffset + relative + match[2].length, text: match[2], cssQuote: match[1] });
    }
  }
  const lettered = letteredNodes(raw, $);
  return [...nodes.filter(node => !lettered.some(group => node.start >= group.start && node.end <= group.end)), ...lettered].sort((a, b) => a.start - b.start);
}

function sourceFor(entry) {
  const still = readRaw(entry);
  const motion = readAnimated(entry);
  const strings = [...new Set([entry.name, ...textNodes(still).map(n => n.text), ...textNodes(motion || "").map(n => n.text)])];
  // Ignore rows created by the former automatic translator. Only reviewed copy is used now.
  const sourceHash = crypto.createHash("sha256").update(`codex-reviewed-v1:${JSON.stringify(strings)}`).digest("hex");
  return { still, motion, strings, sourceHash };
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formattedNumberGroups(raw, lang) {
  const $ = cheerio.load(raw, { sourceCodeLocationInfo: true });
  const candidates = [];
  $("body *").each((_, element) => {
    if (element.namespace === "http://www.w3.org/2000/svg") return;
    const loc = element.sourceCodeLocation;
    if (!loc?.startTag || !loc?.endTag) return;
    const leafTexts = [];
    const walk = node => {
      if (node.type === "text" && node.data.trim()) leafTexts.push(node);
      for (const child of node.children || []) walk(child);
    };
    walk(element);
    if (leafTexts.length !== 2 || $(element).find("img,svg,br,input").length) return;
    const symbol = leafTexts.find(node => /^[$€£¥₺₹₩₽₪﷼₫₱₦₴₸₾₭₨%]$/.test(node.data.trim()));
    const number = leafTexts.find(node => /^[+\-−]?\d[\d,]*(?:\.\d+)?$/.test(node.data.trim()));
    if (!symbol || !number) return;
    const numericSource = number.data.trim();
    const value = Number(numericSource.replace(/,/g, "").replace("−", "-"));
    const percent = symbol.data.trim() === "%";
    const fractionDigits = numericSource.split(".")[1]?.length || 0;
    const format = new Intl.NumberFormat(marketLocale(lang), {
      style: percent ? "percent" : "currency", ...(percent ? {} : { currency: marketCurrency(lang).currency }),
      minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits,
    });
    const symbolParent = symbol.parent !== element ? symbol.parent : null;
    const symbolLoc = symbolParent?.sourceCodeLocation;
    const parts = format.formatToParts(percent ? value / 100 : value).map(part => {
      const text = escapeHtml(part.value);
      if (!["currency", "percentSign"].includes(part.type) || !symbolLoc?.startTag || !symbolLoc?.endTag) return text;
      return raw.slice(symbolLoc.startTag.startOffset, symbolLoc.startTag.endOffset) + text + raw.slice(symbolLoc.endTag.startOffset, symbolLoc.endTag.endOffset);
    }).join("");
    candidates.push({ start: loc.startTag.endOffset, end: loc.endTag.startOffset,
      translated: `<bdi data-banner-number dir="${RTL.has(lang) ? "rtl" : "ltr"}" style="white-space:nowrap;letter-spacing:normal">${parts}</bdi>` });
  });
  const groups = [];
  for (const candidate of candidates.sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    if (!groups.some(group => candidate.start < group.end && candidate.end > group.start)) groups.push(candidate);
  }
  return groups;
}

function applyTranslations(raw, translations, lang, templateId) {
  const rtl = RTL.has(lang);
  const numberGroups = formattedNumberGroups(raw, lang);
  const changes = textNodes(raw).filter(node => !numberGroups.some(group => node.start >= group.start && node.end <= group.end)).map(node => {
    let translated = translations[node.text];
    if (typeof translated !== "string" || !translated.trim()) throw new Error(`Missing banner copy: ${node.text}`);
    if (node.lettered || node.letterSlot) {
      translated = renderLettered(node, translated, lang, rtl, escapeHtml);
    } else if (node.attributeQuote) {
      translated = escapeHtml(translated).replace(new RegExp(node.attributeQuote, "g"), node.attributeQuote === '"' ? "&quot;" : "&#39;");
    } else if (node.cssQuote) {
      translated = translated.replace(/\\/g, "\\\\").replace(new RegExp(node.cssQuote, "g"), `\\${node.cssQuote}`);
    } else {
      const original = raw.slice(node.start, node.end);
      const before = original.match(/^\s*/)?.[0] || "";
      const after = original.match(/\s*$/)?.[0] || "";
      const copy = escapeHtml(translated);
      translated = before + (node.svg && (rtl || COMPLEX_SCRIPTS.has(lang))
        ? `<tspan direction="${rtl ? "rtl" : "ltr"}" unicode-bidi="isolate" style="font-family:Tahoma,Arial,sans-serif;letter-spacing:normal">${copy}</tspan>` : rtl
        ? `<bdi dir="rtl" style="letter-spacing:normal;text-transform:none">${copy}</bdi>`
        : COMPLEX_SCRIPTS.has(lang) ? `<span lang="${lang}" style="letter-spacing:normal;text-transform:none">${copy}</span>` : copy) + after;
    }
    return { ...node, translated };
  });
  let result = raw;
  for (const item of [...changes, ...numberGroups].sort((a, b) => b.start - a.start)) result = result.slice(0, item.start) + item.translated + result.slice(item.end);
  result = result.replace(/<html\b([^>]*)>/i, (_, attrs) => `<html${attrs.replace(/\s(?:lang|dir)=["'][^"']*["']/gi, "")} lang="${lang}" dir="${rtl ? "rtl" : "ltr"}">`);
  if (rtl) result = result.replace(/<\/head>/i, `<style>
    html[dir="rtl"] bdi { unicode-bidi:isolate; font-family:Tahoma,Arial,sans-serif; line-height:1.1; }
    html[dir="rtl"] :is(h1,h2,.title,.headline,.hero,.big) bdi { font-size:.78em; }
    html[dir="rtl"] :is(.off,.discount) bdi { font-size:.52em; }
    html[dir="rtl"] :is(.badge,.sticker,.seal) bdi { font-size:.62em; }
  </style></head>`);
  const layout = localizedLayout(templateId, lang, translations);
  if (layout) result = result.replace(/<\/head>/i, `<style data-banner-localized-layout>${layout}</style></head>`);
  return result;
}

async function translateGroup(group, lang, sources, db, translator) {
  const items = group.flatMap(entry => sources.get(entry.id).strings.map(text => ({ template: entry.name, text })));
  const translated = [];
  for (let i = 0; i < items.length; i += 80) translated.push(...await translator(items.slice(i, i + 80), lang));
  let offset = 0;
  const rows = group.map(entry => {
    const source = sources.get(entry.id);
    const translations = Object.fromEntries(source.strings.map((text, i) => [text, fixedFragment(text, lang) || translated[offset + i]]));
    offset += source.strings.length;
    const row = { language: lang, template_id: entry.id, source_hash: source.sourceHash, name: (lang === "tr" && entry.name_tr) || translations[entry.name], translations };
    memory.set(`${lang}:${entry.id}`, row);
    return row;
  });
  if (db) {
    const { error } = await db.from("banner_template_localizations").upsert(rows, { onConflict: "language,template_id" });
    if (error) console.warn("[BANNER_LOCALE] cache save failed:", error.message);
  }
  return new Map(rows.map(row => [row.template_id, row]));
}

async function translateGroupResilient(group, lang, sources, db, translator) {
  try { return await translateGroup(group, lang, sources, db, translator); }
  catch (error) {
    if (group.length === 1) throw error;
    // One difficult template must not prevent its neighbours from appearing.
    const middle = Math.ceil(group.length / 2);
    const halves = await Promise.allSettled([
      translateGroupResilient(group.slice(0, middle), lang, sources, db, translator),
      translateGroupResilient(group.slice(middle), lang, sources, db, translator),
    ]);
    const rows = new Map();
    for (const half of halves) {
      if (half.status === "fulfilled") for (const [id, row] of half.value) rows.set(id, row);
      else console.warn("[BANNER_LOCALE] template translation failed:", half.reason?.message);
    }
    return rows;
  }
}

async function localizeTemplates(entries, language, { db, translator = null, animated = true, partial = false, fallbackToSource = translator == null } = {}) {
  const lang = normalizeLanguage(language);
  if (lang === "en") return entries.map(entry => {
    const source = sourceFor(entry);
    const authored = authoredRow(entry, source, lang, fixedFragment);
    const copy = authored?.translations || Object.fromEntries(source.strings.map(text => [text, fixedFragment(text, lang) || text]));
    return { id: entry.id, cat: entry.cat, name: authored?.name || entry.name, html: applyTranslations(source.still, copy, lang, entry.id), ...(animated ? { animHtml: source.motion ? applyTranslations(source.motion, copy, lang, entry.id) : null } : {}) };
  });
  const sources = new Map(entries.map(entry => [entry.id, sourceFor(entry)]));
  const byId = new Map();
  if (!translator) for (const entry of entries) {
    const row = authoredRow(entry, sources.get(entry.id), lang, fixedFragment);
    if (row) byId.set(entry.id, row);
  }
  const reviewed = REVIEWED_COPY[lang];
  if (reviewed && !translator) for (const entry of entries) {
    if (byId.has(entry.id)) continue;
    if (lang === "tr" ? !reviewed.__templates.includes(entry.id) : entry.id !== "price-only") continue;
    const source = sources.get(entry.id);
    const translations = Object.fromEntries(source.strings.map(text => [text, fixedFragment(text, lang) || reviewed[text] || text]));
    byId.set(entry.id, { language: lang, template_id: entry.id, source_hash: source.sourceHash, name: (lang === "tr" && entry.name_tr) || translations[entry.name], translations });
  }
  for (const entry of entries) {
    if (byId.has(entry.id)) continue;
    const row = memory.get(`${lang}:${entry.id}`);
    if (row?.source_hash === sources.get(entry.id).sourceHash) byId.set(entry.id, row);
  }
  const missing = entries.filter(entry => !byId.has(entry.id));
  if (missing.length && db) {
    const { data, error } = await db.from("banner_template_localizations")
      .select("template_id,language,source_hash,name,translations")
      .eq("language", lang).in("template_id", missing.map(entry => entry.id));
    if (error) console.warn("[BANNER_LOCALE] cache read failed:", error.message);
    else for (const row of data || []) {
      if (row.source_hash !== sources.get(row.template_id)?.sourceHash) continue;
      byId.set(row.template_id, row);
      memory.set(`${lang}:${row.template_id}`, row);
    }
  }
  const missingEntries = entries.filter(entry => !byId.has(entry.id));
  const fresh = translator ? missingEntries.filter(entry => !inflight.has(`${lang}:${entry.id}:${sources.get(entry.id).sourceHash}`)) : [];
  const groups = [];
  for (const entry of fresh) {
    const last = groups[groups.length - 1];
    if (!last || last.count + sources.get(entry.id).strings.length > 70) groups.push({ entries: [entry], count: sources.get(entry.id).strings.length });
    else { last.entries.push(entry); last.count += sources.get(entry.id).strings.length; }
  }
  for (const group of groups) {
    const job = translateGroupResilient(group.entries, lang, sources, db, translator);
    for (const entry of group.entries) {
      const key = `${lang}:${entry.id}:${sources.get(entry.id).sourceHash}`;
      const one = job.then(rows => {
        const row = rows.get(entry.id);
        if (!row) throw new Error(`Banner translation unavailable: ${entry.id}`);
        return row;
      });
      inflight.set(key, one);
      one.finally(() => inflight.delete(key)).catch(() => {});
    }
  }
  const results = await Promise.allSettled(missingEntries.filter(entry => translator || inflight.has(`${lang}:${entry.id}:${sources.get(entry.id).sourceHash}`)).map(async entry => {
    const key = `${lang}:${entry.id}:${sources.get(entry.id).sourceHash}`;
    return { id: entry.id, row: await inflight.get(key) };
  }));
  for (const result of results) {
    if (result.status === "fulfilled") byId.set(result.value.id, result.value.row);
    else if (!partial) throw result.reason;
  }
  return entries.filter(entry => fallbackToSource || byId.has(entry.id)).map(entry => {
    const source = sources.get(entry.id), row = byId.get(entry.id);
    if (!row) return { id: entry.id, cat: entry.cat, name: templateName(entry, lang), html: source.still, ...(animated ? { animHtml: source.motion } : {}) };
    return { id: entry.id, cat: entry.cat, name: row.name, html: applyTranslations(source.still, row.translations, lang, entry.id), ...(animated ? { animHtml: source.motion ? applyTranslations(source.motion, row.translations, lang, entry.id) : null } : {}) };
  });
}

module.exports = { normalizeLanguage, textNodes, applyTranslations, localizeTemplates, sourceFor };
