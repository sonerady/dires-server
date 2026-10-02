// Letter-by-letter artwork must be translated as a phrase, never as isolated letters.
const WORDS = [
  [".cut", "NeWDRoP", "New Drop"],
  [".flaps", "RESTOCK", "RESTOCK"],
  [".flags", "SUMMER✶", "SUMMER"],
  [".ramp", "Fromlighttobold.", "From light to bold."],
  [".blk .word", "new", "new"],
  [".bul", "SALE", "SALE"],
  [".slab h1", "Pressedbyhand.", "Pressed by hand."],
  [".slab h1", "Pressedbyhand", "Pressed by hand."],
  [".pylon .ls", "SALE", "SALE"],
  [".hl", "JUsTLAnDED", "Just landed"],
  [".letters", "HANDPICKED", "Hand picked"],
];

function letteredNodes(raw, $) {
  const nodes = [];
  for (const [selector, expected, text] of WORDS) $(selector).each((_, element) => {
    if ($(element).text().replace(/\s/g, "") !== expected) return;
    const location = element.sourceCodeLocation;
    if (!location?.startTag || !location?.endTag) return;
    const letters = $(element).find("span,b,i").toArray().filter(child =>
      child.children?.length === 1 && child.children[0].type === "text" && child.children[0].data.trim().length === 1);
    if (!letters.length) return;
    const parents = [...new Set(letters.map(letter => letter.parent))];
    const words = parents.every(parent => parent !== element) ? parents.map(parent => {
      const loc = parent.sourceCodeLocation;
      return { start: loc.startTag.endOffset - location.startTag.endOffset, end: loc.endTag.startOffset - location.startTag.endOffset,
        count: letters.filter(letter => letter.parent === parent).length };
    }) : null;
    nodes.push({ start: location.startTag.endOffset, end: location.endTag.startOffset, text,
      lettered: { words, letters: letters.map(letter => {
        const loc = letter.sourceCodeLocation;
        return { open: raw.slice(loc.startTag.startOffset, loc.startTag.endOffset), close: raw.slice(loc.endTag.startOffset, loc.endTag.endOffset) };
      }), original: raw.slice(location.startTag.endOffset, location.endTag.startOffset) } });
  });
  $(".sheet > .word").each((_, element) => {
    if ($(element).text() !== "Swap") return;
    const loc = element.sourceCodeLocation;
    nodes.push({ start: loc.startTag.endOffset, end: loc.endTag.startOffset, text: "Swap" });
  });
  $("h1").contents().each((_, node) => {
    if (node.type !== "text" || node.data.trim() !== "a") return;
    const loc = node.sourceCodeLocation;
    if (loc) nodes.push({ start: loc.startOffset, end: loc.endOffset, text: "a" });
  });
  $(".clock,.hero .big > span").contents().each((_, node) => {
    if (node.type !== "text" || !/^[dhm]$/.test(node.data.trim())) return;
    const unit = { d: "day", h: "hour", m: "minute" }[node.data.trim()];
    const loc = node.sourceCodeLocation;
    if (loc) nodes.push({ start: loc.startOffset, end: loc.endOffset, text: `[unit:${unit}]` });
  });
  // These headings are spread across independent grid cells and contain unrelated labels.
  for (const [selector, expected, text] of [
    [".c.n .L,.c.e .L,.c.w .L", "NEW", "NEW"],
    [".rack .rail:nth-child(2) .face > b", "OFF", "OFF"],
    [".c.d3 .L,.c.d0 .L,.c.pc .L", "30%", "[percent:30]"],
    [".rack .rail:first-child .face > b", "30%", "[percent:30]"],
  ]) {
    const elements = $(selector).toArray();
    if (elements.map(element => $(element).text()).join("") !== expected) continue;
    const slots = elements.map(element => element.children.find(node => node.type === "text")).filter(Boolean);
    slots.forEach((slot, index) => nodes.push({ start: slot.sourceCodeLocation.startOffset, end: slot.sourceCodeLocation.endOffset, text, letterSlot: { index, count: slots.length } }));
  }
  for (const selector of [".week > div > b", ".cal .grid > .dow", ".towel .cal > b"]) {
    const days = $(selector).toArray();
    if (days.map(day => $(day).text()).join("") !== "MTWTFSS") continue;
    days.forEach((day, index) => {
      const loc = day.children[0]?.sourceCodeLocation;
      if (loc) nodes.push({ start: loc.startOffset, end: loc.endOffset, text: `[weekday:${index + 1}]` });
    });
  }
  const months = $(".months > span").toArray();
  if (months.map(month => $(month).text()).join("") === "JFMAMJJASOND") months.forEach((month, index) => {
    const loc = month.children[0]?.sourceCodeLocation;
    if (loc) nodes.push({ start: loc.startOffset, end: loc.endOffset, text: `[month:${index + 1}]` });
  });
  return nodes;
}

function renderLettered(node, translated, lang, rtl, escapeHtml) {
  if (node.letterSlot) {
    const units = rtl && !node.text.startsWith("[percent:") ? translated.split(/\s+/) : Array.from(new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(translated.replace(/[\u200e\u200f\u061c]/g, "")), part => part.segment);
    const { index, count } = node.letterSlot;
    const from = Math.floor(index * units.length / count), to = Math.floor((index + 1) * units.length / count);
    const piece = units.slice(from, to).join(rtl ? " " : "");
    return `<bdi dir="${rtl ? "rtl" : "ltr"}" style="letter-spacing:normal;font-size:${Math.min(100, 100 / Math.max(1, to - from))}%">${escapeHtml(piece)}</bdi>`;
  }
  if (translated === node.text && lang === "en") return node.lettered.original;
  const letters = node.lettered.letters;
  // Joining scripts need whole words. Individual letter wrappers break Arabic shaping.
  if (rtl || /^(am|bn|gu|hi|km|kn|lo|ml|mr|ne|pa|si|ta|te|th)$/.test(lang)) {
    return `<bdi dir="${rtl ? "rtl" : "ltr"}" style="display:block;width:100%;font:700 clamp(20px,8vmin,96px)/1.15 Tahoma,Arial,sans-serif;letter-spacing:normal;white-space:normal">${escapeHtml(translated)}</bdi>`;
  }
  const draw = (text, count) => {
  const units = Array.from(new Intl.Segmenter(lang, { granularity: "grapheme" }).segment(text), part => part.segment);
  const scale = Math.min(1, count / units.length);
  return units.map((unit, index) => {
    if (/\s/.test(unit)) return '<span style="display:inline-block;width:.25em"></span>';
    const shell = letters[index % letters.length];
    const open = shell.open.replace(/>$/, ` data-banner-letter style="zoom:${scale.toFixed(3)}" >`).replace(/style="([^"]*)"([^>]*?) style="([^"]*)"/, 'style="$1;$3"$2');
    return open + escapeHtml(unit) + shell.close;
  }).join("");
  };
  if (node.lettered.words) {
    const words = translated.split(/\s+/), slots = node.lettered.words;
    let result = node.lettered.original;
    for (let index = slots.length - 1; index >= 0; index--) {
      const slot = slots[index];
      const text = words.slice(Math.floor(index * words.length / slots.length), Math.floor((index + 1) * words.length / slots.length)).join(" ");
      result = result.slice(0, slot.start) + draw(text, slot.count) + result.slice(slot.end);
    }
    return result;
  }
  return draw(translated, letters.length);
}

module.exports = { letteredNodes, renderLettered };
