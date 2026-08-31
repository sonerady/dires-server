const SMALL_NUMBERS = new Map([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
]);

const TENS = new Map([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

function parseNumberWords(value) {
  const words = String(value || "")
    .toLowerCase()
    .replace(/-/g, " ")
    .trim()
    .split(/\s+/)
    .filter(
      (word) =>
        word &&
        !["age", "aged", "is", "approximately", "about", "year", "years", "old"].includes(
          word,
        ),
    );

  if (words.length === 1 && SMALL_NUMBERS.has(words[0])) {
    return SMALL_NUMBERS.get(words[0]);
  }
  if (words.length >= 1 && TENS.has(words[0])) {
    const ones = words[1] ? SMALL_NUMBERS.get(words[1]) : 0;
    if (ones !== undefined && ones < 10) return TENS.get(words[0]) + ones;
  }
  return null;
}

function parseEstimatedAgeResponse(raw) {
  const text = String(raw || "").trim().toLowerCase();
  if (!text || /^(?:age\s*[:=]\s*)?none\.?$/.test(text)) return null;

  const numericMatch = text.match(/\b(?:age\s*[:=]\s*)?(\d{1,2})\b/);
  if (numericMatch) {
    const age = Number.parseInt(numericMatch[1], 10);
    return age >= 0 && age <= 99 ? age : null;
  }

  const wordPatterns = [
    /\b([a-z]+(?:[- ]+[a-z]+)?)\s+years?\s+old\b/,
    /\b(?:age(?:d)?(?:\s+is)?|approximately|about)\s+([a-z]+(?:[- ]+[a-z]+)?)/,
    /^([a-z]+(?:[- ]+[a-z]+)?)$/,
  ];
  for (const pattern of wordPatterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const age = parseNumberWords(match[1]);
    if (age !== null && age >= 0 && age <= 99) return age;
  }
  return null;
}

module.exports = { parseEstimatedAgeResponse };
