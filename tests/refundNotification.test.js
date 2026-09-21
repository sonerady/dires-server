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
