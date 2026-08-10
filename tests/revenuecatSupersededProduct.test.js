const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSupersededByNewerPaidSubscription,
} = require("../src/utils/revenuecatSupersededProduct");

// purchase_history sorgusunu taklit eden zincirlenebilir sahte supabase istemcisi.
// Gerçek çağrı: .from().select().eq().gt().in().order().limit() → { data, error }
function fakeSupabase(result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(result),
  };
  return { from: () => builder };
}

const USER = "user-1";

// Zenilda senaryosu: haftalık trial 01:30'da başladı, 16:17'de aylık ücretliye
// yükseltildi. Haftalığın EXPIRATION'ı geldiğinde ödeyen aboneyi düşürmemeli.
test("eski trial ürününün expiration'ı, DAHA YENİ ücretli abonelik varken bayat sayılır", async () => {
  const supabase = fakeSupabase({
    data: [
      {
        product_id: "com.diress.standard.monthly.v2.2400:v2-standard-monthly",
        price: 40.98,
        purchased_at: "2026-08-07T16:17:31Z",
        event_type: "INITIAL_PURCHASE",
      },
      {
        product_id: "com.diress.standard.weekly.v2.600:v2-standard-weekly",
        price: 0,
        purchased_at: "2026-08-07T01:30:29Z",
        event_type: "INITIAL_PURCHASE",
      },
    ],
    error: null,
  });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    true,
  );
});

// ⚠️ REGRESYON: geri dönen müşteri. Haziran'da ödemiş, aboneliği bitmiş,
// Ağustos'ta YENİ bir trial başlatmış. Trial'ın EXPIRATION'ı geldiğinde ödeme
// DAHA ESKİ olduğu için guard tetiklenmemeli — aksi halde kullanıcı hiç
// düşürülmez ve ömür boyu bedava PRO kalır (tam da temizlediğimiz hayalet durum).
test("geri dönen müşterinin ESKİ ödemesi, yeni trial'ın expiration'ını engellemez", async () => {
  const supabase = fakeSupabase({
    data: [
      {
        product_id: "com.diress.standard.weekly.v2.600",
        price: 0,
        purchased_at: "2026-08-01T10:00:00Z", // yeni trial — DAHA YENİ
        event_type: "INITIAL_PURCHASE",
      },
      {
        product_id: "com.diress.standard.monthly.v2.2400",
        price: 40.98,
        purchased_at: "2026-06-01T10:00:00Z", // eski ödeme — DAHA ESKİ
        event_type: "INITIAL_PURCHASE",
      },
    ],
    error: null,
  });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    false,
  );
});

test("geçmişte kayıt yoksa event'in purchased_at_ms'i referans alınır", async () => {
  const supabase = fakeSupabase({
    data: [
      {
        product_id: "com.diress.standard.monthly.v2.2400",
        price: 40.98,
        purchased_at: "2026-08-07T16:17:31Z",
        event_type: "INITIAL_PURCHASE",
      },
    ],
    error: null,
  });

  // Süresi dolan ürünün kendi satın alma kaydı yok; event zamanı ödemeden ÖNCE
  // → ödeme daha yeni → bayat sayılmalı.
  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
      purchasedAtMs: Date.parse("2026-08-07T01:30:29Z"),
    }),
    true,
  );

  // Referans zaman hiç yoksa guard uygulanmaz (mevcut davranış korunur).
  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    false,
  );
});

test("kullanıcının güncel ücretli ürününün expiration'ı normal işlenir", async () => {
  const supabase = fakeSupabase({
    data: [
      {
        product_id: "com.diress.standard.monthly.v2.2400:v2-standard-monthly",
        price: 40.98,
        purchased_at: "2026-08-07T16:29:30Z",
        event_type: "INITIAL_PURCHASE",
      },
    ],
    error: null,
  });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      // Android base plan suffix'i olsa da aynı ürün olarak eşleşmeli
      productId: "com.diress.standard.monthly.v2.2400:v2-standard-monthly",
    }),
    false,
  );
});

test("hiç ödenmiş abonelik yoksa guard devreye girmez (saf trial expiration)", async () => {
  const supabase = fakeSupabase({ data: [], error: null });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    false,
  );
});

test("coin paketleri abonelik sayılmaz, guard'ı tetiklemez", async () => {
  const supabase = fakeSupabase({
    data: [
      {
        product_id: "com.micro.diress",
        price: 26.82,
        purchased_at: "2026-08-08T10:00:00Z",
        event_type: "INITIAL_PURCHASE",
      },
    ],
    error: null,
  });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    false,
  );
});

test("DB hatasında guard sessizce atlanır (mevcut davranış korunur)", async () => {
  const supabase = fakeSupabase({ data: null, error: { message: "boom" } });

  assert.equal(
    await isSupersededByNewerPaidSubscription({
      supabase,
      userId: USER,
      productId: "com.diress.standard.weekly.v2.600",
    }),
    false,
  );
});
