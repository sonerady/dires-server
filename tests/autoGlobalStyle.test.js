const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildAutoStyleGenderDirective,
  buildRepeatedAutoStylePoseDirective,
  buildAutoStyleUsagePatch,
  resolveAutoStyleMode,
  shouldUseAgeBand,
} = require("../src/utils/autoGlobalStyle");

test("uses soft mode only when the user chose a scene", () => {
  assert.equal(resolveAutoStyleMode(), "full");
  assert.equal(resolveAutoStyleMode({ hasUserScene: true }), "soft");
  assert.equal(resolveAutoStyleMode({ hasUserPose: true }), "full");
  assert.equal(resolveAutoStyleMode({ hasUserHair: true }), "full");
  assert.equal(
    resolveAutoStyleMode({ hasUserPose: true, hasUserHair: true }),
    "full",
  );
});

test("tracks automatically selected styles as profile usage", () => {
  assert.deepEqual(buildAutoStyleUsagePatch({ id: "style-123" }), {
    style_profile_id: "style-123",
    style_source: "profile",
  });
  assert.equal(buildAutoStyleUsagePatch(null), null);
  assert.equal(buildAutoStyleUsagePatch({}), null);
});

test("gives Gemini a general fresh-pose instruction when a hidden style repeats", () => {
  assert.equal(buildRepeatedAutoStylePoseDirective({ priorUseCount: 0 }), "");
  assert.equal(
    buildRepeatedAutoStylePoseDirective({
      priorUseCount: 2,
      userHasPose: true,
    }),
    "",
  );

  const firstRepeat = buildRepeatedAutoStylePoseDirective({
    priorUseCount: 1,
  });
  const secondRepeat = buildRepeatedAutoStylePoseDirective({
    priorUseCount: 2,
  });
  assert.match(firstRepeat, /MANDATORY FRESH POSE/);
  assert.match(firstRepeat, /own visual judgment/);
  assert.match(firstRepeat, /Do not choose from a predefined pose list/);
  assert.doesNotMatch(firstRepeat, /walking|contrapposto|wide stance/i);
  assert.match(secondRepeat, /fresh, natural and editorially appropriate pose/);
  assert.notEqual(firstRepeat, secondRepeat);
});

test("locks the user's gender to the hero while preserving supporting people", () => {
  const girlLock = buildAutoStyleGenderDirective({
    gender: "woman",
    userAge: 7,
  });
  const maleLock = buildAutoStyleGenderDirective({
    gender: "male",
    userAge: 30,
  });

  assert.match(girlLock, /age-appropriate girl/);
  assert.match(girlLock, /PRIMARY\/HERO model/);
  assert.match(girlLock, /KEEP that person and the interaction/);
  assert.match(girlLock, /applies to the PRIMARY\/HERO model only/);
  assert.match(maleLock, /male fashion model/);
  assert.equal(buildAutoStyleGenderDirective({ gender: "auto" }), "");
});

// Eşik 15 (kullanıcı kararı 14 Ağu): <15 kidswear bandı, 15+ yetişkin havuz.
test("applies the age band below 15 and disables it for 15+", () => {
  assert.equal(shouldUseAgeBand(0), true);
  assert.equal(shouldUseAgeBand(14), true);
  assert.equal(shouldUseAgeBand(15), false);
  assert.equal(shouldUseAgeBand(17), false);
  assert.equal(shouldUseAgeBand(45), false);
  assert.equal(shouldUseAgeBand(null), false);
});

// 🔁 Stil rotasyonu (20 Ağu): kullanıcının kullandığı stiller dışlanır,
// havuz bitince kademeli gevşer (en az kullanılanlar → rotasyonsuz), geçmiş
// okunamazsa rotasyonsuz devam eder ve iki V7 route'u da userId geçirir.
test("rotates auto styles per user with graceful reset", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );
  assert.match(source, /loadAutoStyleUsageCounts/);
  assert.match(source, /rotationExcludedIds\.join\(","\)/);
  assert.match(source, /usage\.get\(id\) > minCount/);
  assert.match(source, /rotationPlans\.push\(\[\]\)/);
  assert.match(source, /Rotasyon geçmişi okunamadı — rotasyonsuz devam/);

  for (const routeFile of [
    "../src/routes/referenceBrowserRoutesV7.js",
    "../src/routes/referenceJewelryBrowserRoutesV7.js",
  ]) {
    const route = fs.readFileSync(path.join(__dirname, routeFile), "utf8");
    assert.match(
      route,
      /userId: pendingGeneration\?\.user_id \|\| userId \|\| null,\n\s*\}\);/,
    );
  }
});

// 20 Ağu bug'ı: Editoryal (1) isteği fallback kademesine düşünce Sokak Stili
// (4) etiketli klipler kuraya giriyordu. Fallback'te yalnız etiketsiz +
// istenen tarzın kendi etiketi kalmalı; tarzsız isteklerde 4 hep dışlanmalı.
test("fallback tiers never leak street styles into other approaches", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );
  const filterBlock = source.slice(
    source.indexOf("const applyBaseFilters = ("),
    source.indexOf("const rowEligible = (row) =>"),
  );

  assert.match(filterBlock, /if \(!withApproach\) \{/);
  assert.match(
    filterBlock,
    /style_approach\.is\.null,style_approach\.eq\.\$\{requestedApproach\}/,
  );
  assert.match(
    filterBlock,
    /style_approach\.is\.null,style_approach\.neq\.\$\{STREET_STYLE_APPROACH\}/,
  );
});

test("referenceBrowserV7 persists the automatic usage patch", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
    "utf8",
  );

  assert.match(source, /buildAutoStyleUsagePatch\(autoStyleProfile\)/);
  assert.match(source, /\.update\(autoUsagePatch\)/);
  assert.match(source, /\.eq\("id", pendingGeneration\.id\)/);
  assert.match(source, /countPriorSuccessfulAutoStyleUses\(/);
  assert.match(source, /repeatPoseDirective: autoStyleRepeatPoseDirective/);
  assert.match(source, /buildAutoStyleGenderDirective\(/);
  assert.match(source, /autoStyleGenderDirective/);
});

test("studio styles are excluded only when the user selected a scene", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
    "utf8",
  );

  assert.match(source, /excludeStudioLocked: autoHasUserScene/);
  assert.doesNotMatch(source, /excludeStudioLocked: softNeeded/);

  const sceneDetectionBlock = source.slice(
    source.indexOf("const autoHasUserScene = Boolean("),
    source.indexOf("const autoHasUserPose = Boolean("),
  );
  assert.match(sceneDetectionBlock, /settings\?\.location/);
  assert.match(sceneDetectionBlock, /settings\?\.backgroundColorHex/);
  assert.doesNotMatch(sceneDetectionBlock, /settings\?\.weather/);
  assert.doesNotMatch(sceneDetectionBlock, /settings\?\.timeOfDay/);
});

test("does not exclude couple-locked profiles from the automatic pool", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );
  const eligibilityBlock = source.slice(
    source.indexOf("const rowEligible = (row) =>"),
    source.indexOf("const tryPick = async"),
  );

  assert.doesNotMatch(eligibilityBlock, /isCoupleLockedStylePrompt/);
  assert.match(eligibilityBlock, /excludeStudioLocked/);
});

test("prioritizes category + subtype + approach before broader auto-style pools", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );

  assert.match(source, /const SUBTYPE_FILTER_ENABLED = true/);
  const exactMatchIndex = source.indexOf(
    "const bySubtypeAndApproach = await tryPick(",
  );
  const subtypeMatchIndex = source.indexOf("const bySubtype = await tryPick(");
  const approachMatchIndex = source.indexOf("const byApproach = await tryPick(");
  const categoryMatchIndex = source.indexOf("const byCategory = await tryPick(");

  assert.ok(exactMatchIndex >= 0);
  assert.ok(exactMatchIndex < subtypeMatchIndex);
  assert.ok(subtypeMatchIndex < approachMatchIndex);
  assert.ok(approachMatchIndex < categoryMatchIndex);
  assert.match(
    source.slice(exactMatchIndex, subtypeMatchIndex),
    /true,\s*true,\s*true,/,
  );
});

test("requires jewelry-clean references and maps them into the active image fields", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );

  assert.match(source, /const requiresJewelryClean/);
  // Takı isteği temiz sürüm ister; TEK istisna ürün çekimi (tarz 2) stilleri.
  assert.match(
    source,
    /jewelry_clean_image_urls\.not\.is\.null,style_approach\.eq\.\$\{PRODUCT_SHOT_STYLE_APPROACH\}/,
  );
  assert.match(source, /image_urls: row\.jewelry_clean_image_urls/);
  assert.match(
    source,
    /stamped_grid_url: row\.jewelry_clean_stamped_grid_url \|\| null/,
  );
  assert.match(source, /uses_jewelry_clean_images: true/);
});

test("product-shot styles keep their jewelry and trigger the swap directive", () => {
  const pool = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );
  const factory = fs.readFileSync(
    path.join(__dirname, "../src/routes/styleProfileRouterFactory.js"),
    "utf8",
  );
  const jewelryRoute = fs.readFileSync(
    path.join(__dirname, "../src/routes/referenceJewelryBrowserRoutesV7.js"),
    "utf8",
  );

  // 1) Kayıtta: tarz 2 ise nano-banana-lite temizliği hiç çalışmaz.
  assert.match(factory, /normalizedApproach === PRODUCT_SHOT_STYLE_APPROACH/);
  assert.match(factory, /normalizedCategory === "jewelry" &&\s*!isProductShotApproach/);

  // 2) Seçimde: temiz sürümü olmayan satır orijinaliyle döner ve işaretlenir.
  assert.match(pool, /uses_jewelry_clean_images: false, jewelry_swap_required: true/);
  // ⚠️ style_approach PostgREST'ten METİN gelir — Number() olmadan tarz-2
  // stilleri sessizce elenir (17 Ağu bug'ı). Karşılaştırma sayıya çevrilmeli.
  assert.match(pool, /Number\(row\?\.style_approach\) === PRODUCT_SHOT_STYLE_APPROACH/);

  // 3) Ürün çekimi promptu: ürün, referanstaki parçanın TAM konumunu devralır
  //    (konum, açı, kompozisyon jesti) — yaratıcı kurgu korunur.
  const jewelryPrompt = fs.readFileSync(
    path.join(__dirname, "../src/utils/jewelryPrompt.js"),
    "utf8",
  );
  assert.match(jewelryPrompt, /PLACEMENT FIDELITY/);
  assert.match(jewelryPrompt, /same anchor point in the frame/);
  assert.match(jewelryPrompt, /same viewing angle and orientation/);
  assert.match(jewelryPrompt, /same compositional gesture/);
  assert.match(jewelryPrompt, /THE REFERENCE WINS/);

  // 4) Üretimde: referanstaki takının ürünle değiştirilmesi promptta emredilir.
  assert.match(jewelryRoute, /jewelrySwapRequired/);
  assert.match(jewelryRoute, /JEWELRY SWAP — THE REFERENCE PIECE IS NOT THE PRODUCT/);
  assert.match(
    jewelryRoute,
    /jewelryProductShotReference =\s*\n?\s*Number\(styleProfileRow\.style_approach\) === PRODUCT_SHOT_STYLE_APPROACH/,
  );
});

test("jewelry route keeps a separate clean grid cache", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/referenceJewelryBrowserRoutesV7.js"),
    "utf8",
  );

  assert.match(source, /usesJewelryCleanAutoImages/);
  assert.match(source, /jewelry_clean_stamped_grid_url/);
  assert.match(source, /autoStyleProfile\.uses_jewelry_clean_images/);
});

test("keeps a hair reference before the final hidden-style image", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/routes/referenceBrowserRoutesV7.js"),
    "utf8",
  );
  const hairIndex = source.indexOf(
    "💇 [HAIR REFERENCE] imageInputArray'e stil referansından önce eklendi",
  );
  const styleIndex = source.indexOf(
    "🎬 [STYLE REFERENCE] imageInputArray'e SON sıraya eklendi",
  );

  assert.ok(hairIndex >= 0);
  assert.ok(styleIndex > hairIndex);
});

test("routes shoes requests into the clothing pool without a subtype", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../src/utils/autoGlobalStyle.js"),
    "utf8",
  );

  assert.match(
    source,
    /const productCategory = isShoesRequest \? "clothing" : rawProductCategory/,
  );
  assert.match(
    source,
    /const productSubtype = isShoesRequest \? null : rawProductSubtype/,
  );
  // Yönlendirme, kategoriyi okuyan HER kademeden (jewelry-clean kontrolü dahil)
  // önce yapılmalı; aksi halde 'shoes' etiketi filtrelere sızar.
  const remapIndex = source.indexOf("const isShoesRequest =");
  const jewelryCleanIndex = source.indexOf("const requiresJewelryClean =");
  assert.ok(remapIndex >= 0);
  assert.ok(remapIndex < jewelryCleanIndex);
});
