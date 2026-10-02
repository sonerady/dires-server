# Authored banner localization

These server-owned JSON catalogs contain translations written directly during the banner localization task. Runtime gallery requests do not invoke a translation provider.

## Record format

Each template record contains its localized name, a hash of its current static and animated source copy, and an exact source-to-translation map. A record is used only when the hash and every source key match.

An explicit `null` means that the value has been reviewed and should be preserved (for example, a brand or discount code), or formatted with the locale's numeric/currency formatter. It must not be used to mark untranslated English copy as complete. Sample prices keep their fictional numeric amount and use the locale's currency; they are not foreign-exchange conversions.

Source extraction includes accessible labels, CSS text, letter artwork, calendar labels and countdown units. Layout adjustments shared by the static and animated versions live in `../localizedLayout.js`.

## Continue authoring

From the server directory:

```sh
node scripts/banner-templates/author.js source ar
node scripts/banner-templates/author.js source ar template-id,another-id
node scripts/banner-templates/author.js write ar /tmp/reviewed-batch.json
node scripts/banner-templates/author.js coverage
```

The input batch maps each template ID to an ordered array matching the exact `strings` array printed by `source`. Its first value is the localized template name. Review both the meaning and the reading order of separately styled fragments before writing the batch.

`coverage.json` lists reviewed records and pending IDs for every application language. English has the existing source catalog, but only its reviewed records count as complete: some original designs contain French labels or foreign price/date formats. An English fallback is deliberately returned for pending translations, as approved by the user, so those banners remain visible. Fallbacks are never counted as completed translations.

## Verified checkpoint

- Turkish and Arabic: all 610 source-copy records authored in each language.
- All 71 languages: the first 14 manifest templates (including `contents-page` and `pull-quote`), plus `price-only`, `quiet`, `plinth-column`, `correspondence-card`, `festive-lights`, `vertical-cover`, `flacon-window`, `pressed-compact`, `missing-piece`, `bandana-paisley`, `gaffer-tape`, `cut-collage`, `stable-plaque`, `ex-libris`, `show-schedule`, `broadsheet`, `the-five`, `folio-spread`, `cut-zine`, `editors-letter`, `street-diary`, `swiss`, `raffle-drop`, `sticker-bomb`, `ship-label`, `skate-zine`, `tech-spec`, `collab-x`, `graffiti-throw`, `restock-board` and `varsity-letter` authored. This is a common set of 45 templates.
- English: all 610 source-copy records reviewed, including foreign labels, calendar/countdown tokens and embedded date/price text. Proper names, addresses and technical product codes are preserved.
- French: 122 source-copy records authored. German, Spanish, Italian and Portuguese: 46 each.
- Of the other 63 language catalogs, 11 have 46 reviewed templates and 52 have 45. Total: 4,982 of 43,310 locale-template records.
- The remaining templates in other languages still need their own translations. This is not a completed 71-language catalog.
- Selected portrait, square and landscape layouts have been inspected locally. This is not visual sign-off for all 610 templates in all languages.
- Specific checks caught and fixed reversed RTL price drums, overflowing scale readings, constrained seals, countdown headings and buttons. Local visual checks use fallback fonts with external network requests blocked.
- The latest additions include currencies and embedded date/number formats. The two editorial templates also account for long headings, quote/byline spacing and nested script spans that inherited unintended hiding or badge styles.
- Correspondence cards preserve monogram order in RTL. Vertical covers keep Arabic-script words joined and East Asian glyphs upright. Powder compacts preserve the large percentage figure and place the discount label before it where the language requires it.
- The four fashion templates `missing-piece`, `bandana-paisley`, `gaffer-tape` and `cut-collage` passed 1,136 local layout checks (71 languages at four sizes) and 284 API checks for static and animated HTML. Their fixes cover narrow bandana panels, rotated tape-strip spacing, joined-script collage headlines and locale-formatted price scraps. Tall collages now allocate photo space around the actual text height.
- Stable plaques and bookplates now include all languages. Bookplate dates retain the stated Gregorian October deadline; proper names and coupon codes are preserved. The show schedule formats October 8–12, 2026 with the actual Thursday/Saturday/Sunday/Monday weekdays, including the corrected Turkish entries. Localized headers, event columns and coupon borders account for longer copy and script wrappers.
- Those three additions were checked at four sizes in all 71 languages (852 combinations). The detected plaque and schedule-header collisions were fixed and the affected cases rechecked. Their 213 API responses include both localized still and motion HTML. The 21 localization/favorites tests pass.
- Broadsheet now has complete article copy in all 71 languages, including the 40% discount, free-delivery terms and Sunday-midnight deadline. Its September 25, 2026 dateline uses the correct Friday and locale date formatting; Nepali and Amharic explicitly identify the Gregorian date. Chinese copy expresses the discount as paying 60% of the original price.
- Broadsheet's shared still/motion layout uses the actual text height, keeps mastheads inside their header, mirrors its photo/article placement in RTL, and preserves website text inside script wrappers. All 284 local checks (71 languages at four sizes, with fallback fonts ready) passed after fixing article overflow. All 71 API responses included the localized still and motion HTML; the 21 localization/favorites tests passed with the common set increased to 30 templates.

- The Five and Folio Spread are now authored in all 71 languages. The trend list preserves its five distinct suggestions and discount scope; the spread uses local currencies and numeric formatting while preserving photo credits and brand names. Their responsive layouts allocate room for longer headers and body text, mirror columns and margins for RTL, and preserve spacing when headline line breaks collapse. The 568 layout combinations and 142 still/motion API responses passed; the common catalog check now covers 32 templates.

- Cut Zine now has complete copy in all 71 languages, preserving its small-batch/no-restock condition and this-week-only 30% discount. The Chinese copy uses 七折. The shared layout keeps joined scripts intact, scales long cut-letter words to the available space, mirrors the photo and text in RTL, and gives the landscape offer more readable type. Its 284 local language/size checks and 71 still/motion API responses passed, as did the 21 catalog/favorites tests.

- Editor's Letter is now authored in all 71 languages, including its full paragraph, editor role and checkout deadline. The campaign year is localized (including Thai 2569 and an explicit Gregorian label for Persian/Nepali/Amharic); Chinese expresses 20% off as 八折. Responsive text flow and signature padding passed 284 local layout checks. The 71 API responses contain localized still/motion HTML, and all 21 catalog/favorites tests passed with a common set of 34 templates.

- Street Diary is now authored in all 71 languages. Its September 25, 2026 stamp, volume/frame numbers and Paris wall-clock times use locale formatting; Persian and Thai dates follow their locale calendars. Proper place names are preserved. The shared responsive layout keeps long titles, caption labels and joined-script CTA text visible, mirrors columns and arrows in RTL, and passed 284 language/size checks. All 71 still/motion API checks and 21 catalog/favorites tests passed.

- New Season (`swiss`) is in progress: 19 languages are authored. Its static and motion headlines now use one semantic phrase instead of English syllables; the eight existing catalogs were migrated to the new source hash. Eleven additional catalogs were authored (af/ca/da/eu/fi/gl/is/nl/no/rm/sv). These 19 languages passed 76 layout checks and 19 still/motion API checks; all 21 existing localization/favorites tests passed. The remaining 52 languages still need this template, so the common set remains 35.

Run `node --test tests/bannerTemplateLocalization.test.js tests/bannerFavorites.test.js` to check catalog completeness, source hashes, numeric layout, letter artwork, RTL SVG text, gallery fallbacks and locale-aware favorites. Visual previews must also be reviewed when introducing longer text or a new script to a constrained template.

- New Season (`swiss`) now has complete copy in all 71 languages. Its headline is translated as a whole phrase rather than English-specific syllables. The resort collection, garment labels, hand-embroidery description, season and shopping labels are localized; Persian, Nepali and Amharic explicitly identify the Gregorian year, and Thai uses Buddhist year 2569 (69). Shared still/motion styles mirror the photo and text in RTL and accommodate longer season labels. All 284 local layout combinations, 71 still/motion API responses and 21 catalog/favorites tests passed; the common catalog set is now 36 templates.

- Raffle Drop now includes 11 additional Western European/Afrikaans catalogs (19 of 71 languages so far). They preserve the March 10–12 entry period, March 13 notification, one-entry restriction and 24-hour payment requirement. The shared layout keeps the steps visible at every tested aspect ratio, accommodates long headings and mirrors the artwork and ticker motion in RTL. The currently authored 19 languages passed 76 local layout checks. Remaining languages are pending.

- Raffle Drop is now authored in all 71 languages. Its March dates use explicit month names; Amharic and Nepali identify the Gregorian calendar. Numeric labels and ticket digits use locale formatting, while RTL layouts mirror the panels, countdown order and ticker motion. All 284 local language/size checks and 71 API responses containing still/motion HTML passed. The 21 catalog/favorites tests passed with the common set increased to 37 templates.

- Sticker Bomb now includes 29 additional catalogs (37 of 71 languages so far). These translate both headline strips, the 20% discount, starting-price label and spring/summer limited-run label. Sample prices use local currency formatting. Its shared responsive layout allocates photo space around the text, keeps currency labels within price stickers and provides space around rotated strips. All 148 current language/size checks and 37 API responses with still/motion HTML passed; all 21 catalog/favorites tests passed. The other 34 languages remain pending for this template.

- Sticker Bomb is now authored in all 71 languages. Chinese uses 八折 for 20% off; Thai uses 2569 for the campaign year, while Persian, Nepali and Amharic explicitly identify the Gregorian year. The starting-price stickers use locale currencies and number formatting. All 71 API responses contain localized static and motion HTML; all 21 catalog/favorites tests pass with a common set of 38 templates.

- Ship Label now has 11 additional catalogs (19 of 71 languages). New records preserve the strict order-over-75 condition with local sample currencies, format 0.9 kg and March 10, 2026 locally, and retain the 18:00 order deadline in static and split-clock motion copy. The shared layout reveals the shipping date at every size, supports longer delivery headings, and mirrors the label in RTL. The 19 API responses include localized still/motion HTML. The other 52 languages remain pending.

- Ship Label has expanded to 49 of 71 languages with 30 additional Eastern European, Central Asian, RTL and African catalogs. Its newly authored shipping terms retain the strict order threshold. Persian dates use the Persian calendar through Intl; Amharic dates explicitly identify the Gregorian year. All 196 current language/size checks and 49 API responses containing static/motion HTML passed. The 21 catalog/favorites tests passed. The remaining 22 languages are still pending.

- Ship Label is now authored in all 71 languages. The last 22 languages place the today label consistently before the deadline in static and animated copy; Nepali explicitly labels its Gregorian shipping date. Existing German and French terms were corrected to strictly above 75 rather than at least 75. All 284 local layout combinations, 71 static/motion API responses and 21 catalog/favorites tests passed, with the common set increased to 39 templates.

- Skate Zine now has 11 additional catalogs (19 of 71 languages). They preserve the Friday launch, free zine with every order and 25% discount. Its responsive grid allocates photo space around longer headings and paragraphs, mirrors reading order in RTL, and keeps the coupon visible. The current 19 languages have localized static/motion API responses; 52 languages remain pending.

- Skate Zine has expanded to 49 languages with 30 more authored catalogs. Persian and Amharic explicitly identify the Gregorian season year; RTL discount phrases and coupon codes retain their reading order. Visual inspection caught isolated trailing letters in Persian/Armenian headlines, which now use more suitable sizing. All 49 static/motion API responses and 21 catalog/favorites tests passed. The remaining 22 languages are pending.

- Skate Zine is now authored in all 71 languages. Chinese uses 七五折 for the 25% discount; Thai uses 2569 for the campaign year and Nepali explicitly labels its Gregorian year. Full body copy retains both Friday availability channels and the free zine with every order. Long discount phrases now fit their hand-drawn circles; square headline sizing prevents collisions with offers and body copy. All 284 local layout checks, 71 static/motion API responses and 21 catalog/favorites tests passed with a common set of 40 templates.

- Tech Spec now has 11 additional catalogs (19 of 71 languages). These localize specification labels, March 26 release date, worldwide quantity and starting prices while retaining technical identifiers and the explicit CET timezone. The full small-numbered-run/archive paragraph is preserved. A responsive grid keeps all table rows and the description visible, mirrors figure/data order in RTL and accommodates longer month labels. All 19 API responses contain static/motion HTML. The remaining 52 languages are pending.

- Tech Spec now includes 18 more Eastern European catalogs, bringing this template to 37 of 71 languages. The full production/archive paragraph, worldwide quantity, March 26 date and local starting prices are retained. All 148 local language/size checks and 37 API responses containing still/motion HTML passed; the 21 catalog/favorites tests passed. The other 34 languages remain pending.

- Tech Spec has expanded to 49 languages with 12 additional RTL, Central Asian and African catalogs. Persian numbers are localized; technical identifiers and the stated CET time are retained. Visual inspection caught nested Amharic figure-label spans inheriting positioning and rotation, now reset inside the shared still/motion layout. All 49 static/motion API responses and 21 catalog/favorites tests passed. The remaining 22 languages are pending.

- Tech Spec is now authored in all 71 languages. The last 22 catalogs localize the full production/archive paragraph, specification labels, March 26 date, quantities and starting prices. Technical identifiers and the CET timezone are retained. The 284 local layout combinations, 71 static/motion API responses and all 21 catalog/favorites tests passed; the common set now includes 41 templates. Indic-script and RTL square previews were visually reviewed with local fallback fonts.

- Collab Lockup now has 11 additional catalogs (19 of 71 languages). The collaboration brands remain intact; capsule information, March dates, Friday launch time and online/selected-store availability are translated. No year was supplied in the source, so no year or calendar conversion was invented. The shared grid allocates space for longer dates and CTA text and mirrors the photo/info columns in RTL. All 76 current language/size checks, 19 static/motion API responses and 21 catalog/favorites tests passed. The remaining 52 languages are pending.

- Collab Lockup is now authored in all 71 languages. New copy preserves both sales channels, the 14-piece count and Friday March 10 launch; dates use explicit month names without inventing a year. Amharic and Nepali identify the Gregorian month, while Bengali, Marathi and Nepali use local digits. All 284 layout checks and 71 static/motion API responses passed. Representative RTL, East Asian and Indic square layouts were visually reviewed. The shared catalog test now checks 42 common templates.

- Graffiti Throw is now authored in all 71 languages. The new-release headline, summer label, 30% discount, TAG30 coupon, this-week restriction and both sales channels are translated; Chinese expresses the discount as 七折. Headline sizing accounts for translated length, RTL mirrors the photo/wall order and CTA arrow, and responsive text flow keeps long discount/coupon phrases inside the stencil. All 284 local language/size checks and 71 static/motion API responses passed. Representative RTL, Asian and Indic square previews were inspected with fallback fonts.

- Restock Board now has 29 additional catalogs (37 of 71 languages). The new translations cover stock status, size/quantity columns, core collection, update time and purchase CTA. The total of 42 remaining units and original size identifiers are retained. Shared layout rules expose all six size rows at every aspect ratio, adapt split-flap lettering to translated length, preserve whole joined-script words and mirror the board/photo order in RTL. The remaining 34 languages are pending.

- The current 37 Restock Board languages passed 148 layout combinations and 37 API checks with localized still/motion HTML. All 21 catalog/favorites tests passed. Western European and Arabic square previews were visually reviewed using local fallback fonts.

- Restock Board is now authored in all 71 languages. All stock statuses, size/quantity labels, update time, count and purchase CTA are localized. The last 34 languages retain joined-script headings and use locale digits where appropriate; original numeric sizes remain the same sizing system. All 284 local layout combinations, 71 still/motion API checks and 21 catalog/favorites tests passed. RTL and Asian/Indic square previews were visually inspected. Coverage was regenerated from the actual catalogs and confirms 4,904 complete records, with 44 common templates.

- Varsity Letter now has 11 additional catalogs (19 of 71 languages). They translate the athletics emblem, university-style collection, autumn/winter season, 2026 establishment year and member-only 15% discount while preserving VARSITY15. Responsive grid rules accommodate long headings and button text; SVG badge lettering scales with translated length. Visual review caught the existing Arabic four-digit year overflowing its circle, now fitted by digit count. All 76 current language/size checks and 19 static/motion API responses passed; the 21 catalog/favorites tests passed. The remaining 52 languages are pending.

- Varsity Letter is now authored in all 71 languages. Chinese uses 八五折 for the member-only 15% discount; Thai uses Buddhist year 2569 (badge 69), while Persian, Amharic and Nepali explicitly identify the Gregorian year. Catalan, Romanian and Romansh heading fragments follow their natural word order. The 568 local layout combinations cover both static and animated initial frames at four sizes, including SVG year bounds; all passed. All 71 API checks returned localized still/motion HTML. Representative RTL, European, Asian and Indic square previews were visually reviewed using local fallback fonts.

- The 21 catalog/favorites tests passed after adding Varsity Letter to the 45-template common set. Regenerated source-hash coverage confirms 4,967 of 43,310 records.

- Receipt Print now has 15 additional catalogs (19 of 71 languages). Item descriptions, summer discount, store/register labels, total, savings and thank-you copy are translated. March 10, 2026 at 14:07 is formatted by locale; amounts retain their fictional values and receipt arithmetic with local currency and two decimal places. The shared responsive grid keeps every receipt row visible and preserves the discount percentage on one line. All 152 static/animated initial-frame layout checks passed. The other 52 languages remain pending.

- Receipt Print: all 19 static/motion API checks passed after the local server reload. The full 21-test catalog/favorites suite passed, and the catalog source/hash check was rerun successfully after the final four translations.
