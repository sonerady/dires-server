const test = require("node:test");
const assert = require("node:assert/strict");
const {
  sendRefundNotification,
} = require("../src/services/refundNotification");
const row = {
  id: "a1123456-1111-4111-a111-111111111111",
  user_id: "user",
  status: "refunded",
  reviewed_by: "admin",
  refunded_credits: 20,
  language_code: "tr",
  notification_status: "pending",
};
function dbMock() {
  const writes = [];
  return {
    writes,
    from: () => ({
      update: (v) => ({
        eq: async () => {
          writes.push(v);
          return { error: null };
        },
      }),
    }),
  };
}
test("admin refund notification is targeted, localized and idempotent", async () => {
  const db = dbMock();
  const result = await sendRefundNotification(db, row, {
    env: { ONESIGNAL_APP_ID: "app", ONESIGNAL_REST_API_KEY: "key" },
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload.include_aliases, { external_id: ["user"] });
      assert.equal(payload.idempotency_key, row.id);
      assert.match(payload.contents.en, /20 kredi/);
      return { ok: true, json: async () => ({ id: "notification" }) };
    },
  });
  assert.equal(result.notification_status, "sent");
  assert.equal(db.writes[0].notification_id, "notification");
});
test("notification failure never rolls back credits or reports success", async () => {
  const db = dbMock();
  const result = await sendRefundNotification(db, row, { env: {} });
  assert.equal(result.status, "refunded");
  assert.equal(result.notification_status, "failed");
  assert.equal(result.refunded_credits, 20);
});
test("sent notifications are never resent", async () => {
  let called = false;
  await sendRefundNotification(
    dbMock(),
    { ...row, notification_status: "sent" },
    {
      fetchImpl: () => {
        called = true;
      },
    },
  );
  assert.equal(called, false);
});

// 25 Eyl 2026: bildirim uygulama dilinde (70 dil), reddedilen itiraza bildirim YOK
const { refundCopy } = require("../src/services/refundNotification");
test("push copy follows the app language and falls back to English", () => {
  assert.match(refundCopy("de", 12).body, /12/);
  assert.notEqual(refundCopy("de", 12).title, refundCopy("en", 12).title);
  assert.match(refundCopy("pt-BR", 5).body, /5/);
  assert.equal(refundCopy("xx", 3).title, refundCopy("en", 3).title);
  assert.doesNotMatch(refundCopy("ar", 7).body, /\{\{/);
});
test("a rejected appeal never sends a notification", async () => {
  let called = false;
  const result = await sendRefundNotification(
    dbMock(),
    { ...row, status: "appeal_rejected" },
    { env: { ONESIGNAL_APP_ID: "app", ONESIGNAL_REST_API_KEY: "key" }, fetchImpl: async () => { called = true; } },
  );
  assert.equal(called, false);
  assert.equal(result.status, "appeal_rejected");
});
test("the push opens the refund result screen", async () => {
  await sendRefundNotification(dbMock(), row, {
    env: { ONESIGNAL_APP_ID: "app", ONESIGNAL_REST_API_KEY: "key" },
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(payload.data.type, "credit_refund");
      assert.equal(payload.data.requestId, row.id);
      assert.equal(payload.data.screen, "CreditRefundResultScreen");
      return { ok: true, json: async () => ({ id: "n" }) };
    },
  });
});
const { refundExplanation, buildExplanationPrompt } = require("../src/services/refundExplanation");
test("refund explanation is written in the user's language and falls back to the analysis summary", async () => {
  const r = { id: "r1", admin_note: "ürün boyu değişmiş, iade", summary: "The dress became a gown.", defects: ["wrong_shape"], refunded_credits: 10 };
  assert.match(buildExplanationPrompt(r, "de"), /German/);
  assert.match(buildExplanationPrompt(r, "de"), /untrusted data/);
  const ok = await refundExplanation(r, "de", { env: { REPLICATE_API_TOKEN: "t" }, post: async () => ({ data: { status: "succeeded", output: ['{"message": "Dein Kleid wurde zu einem langen Abendkleid. Deshalb erstatten wir die Credits."}'] } }) });
  const leaked = await refundExplanation({ ...r, id: "r3" }, "de", { env: { REPLICATE_API_TOKEN: "t" }, post: async () => ({ data: { status: "succeeded", output: ["Let's review the facts: - the note says"] } }) });
  assert.equal(leaked, "The dress became a gown.");
  assert.match(ok, /Kleid/);
  const fallback = await refundExplanation({ ...r, id: "r2" }, "de", { env: {}, post: async () => { throw new Error("x"); } });
  assert.equal(fallback, "The dress became a gown.");
});

// 25 Eyl 2026: reddedilen itirazda iç admin notu yerine kullanıcı dilinde nazik açıklama; saklanan not tekrar üretilmez
test("rejected appeals get a kind explanation prompt; a stored note in the same language is reused", async () => {
  const rejected = { id: "r9", status: "appeal_rejected", admin_note: "ürün aynı, iade yok", summary: "Product matches.", defects: [], refunded_credits: 0 };
  const prompt = buildExplanationPrompt(rejected, "tr");
  assert.match(prompt, /NOT approved/);
  assert.match(prompt, /Never promise a refund/);
  let called = false;
  const text = await refundExplanation({ ...rejected, raw_response: { userNote: { text: "Kayıtlı açıklama.", lang: "tr" } } }, "tr", { env: { REPLICATE_API_TOKEN: "t" }, post: async () => { called = true; return {}; } });
  assert.equal(text, "Kayıtlı açıklama.");
  assert.equal(called, false);
});
