const test = require("node:test");
const assert = require("node:assert/strict");
const { refundIdentity } = require("../src/middleware/refundIdentity");
const userId = "11111111-1111-4111-a111-111111111111";
function dbMock() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              id: userId,
              supabase_user_id: "auth-owner",
              device_id: "verified-device-123456789",
            },
          }),
        }),
      }),
    }),
    auth: {
      getUser: async (token) => ({
        data: {
          user: {
            id: token === "valid.jwt.token" ? "auth-owner" : "other-user",
          },
        },
      }),
    },
  };
}
async function invoke(headers, user = userId) {
  let status = 200,
    passed = false;
  const res = {
    status: (s) => {
      status = s;
      return res;
    },
    json: () => {},
  };
  await refundIdentity(dbMock())(
    { headers, body: { userId: user }, query: {} },
    res,
    () => {
      passed = true;
    },
  );
  return { status, passed };
}
test("a user UUID alone is never sufficient to access credit refunds", async () =>
  assert.deepEqual(await invoke({}), { status: 401, passed: false }));
test("verified native device identity works without email login", async () =>
  assert.equal(
    (await invoke({ "x-device-id": "verified-device-123456789" })).passed,
    true,
  ));
test("another device or another authenticated user cannot request a refund", async () => {
  assert.equal(
    (await invoke({ "x-device-id": "other-device-123456789000" })).status,
    401,
  );
  assert.equal(
    (await invoke({ authorization: "Bearer wrong.jwt.token" })).status,
    401,
  );
});
test("Supabase session must map to the owner of the native account", async () =>
  assert.equal(
    (await invoke({ authorization: "Bearer valid.jwt.token" })).passed,
    true,
  ));
