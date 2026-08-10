const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyRevenueCatTransfer,
} = require("../src/utils/revenuecatTransfer");

// users.update().eq().select() ve purchase_history.insert() taklidi.
function fakeSupabase({ knownUserIds = [], updateError = null } = {}) {
  const calls = { updates: [], inserts: [] };
  const client = {
    from(table) {
      if (table === "purchase_history") {
        return {
          insert: (row) => {
            calls.inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      let pendingFields = null;
      const builder = {
        update: (fields) => {
          pendingFields = fields;
          return builder;
        },
        eq: (_col, id) => {
          builder._id = id;
          return builder;
        },
        select: () => {
          calls.updates.push({ id: builder._id, fields: pendingFields });
          if (updateError) return Promise.resolve({ data: null, error: updateError });
          return Promise.resolve({
            data: knownUserIds.includes(builder._id) ? [{ id: builder._id }] : [],
            error: null,
          });
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

const OLD = "old-user-1";
const NEW = "new-user-1";

test("transferred_from kullanıcısı PRO'dan düşürülür, krediye dokunulmaz", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: [OLD] });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: { type: "TRANSFER", transferred_from: [OLD], transferred_to: [NEW], id: "evt-1" },
  });

  assert.deepEqual(result.downgraded, [OLD]);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.updates[0].fields, {
    is_pro: false,
    is_in_trial: false,
    subscription_type: null,
    team_max_members: 0,
    team_subscription_active: false,
  });
  // credit_balance ASLA yazılmamalı
  assert.equal("credit_balance" in calls.updates[0].fields, false);
});

test("yeni sahip (transferred_to) asla düşürülmez", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: [NEW] });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: { type: "TRANSFER", transferred_from: [NEW], transferred_to: [NEW], id: "evt-2" },
  });

  assert.deepEqual(result.downgraded, []);
  assert.equal(calls.updates.length, 0);
});

test("birden fazla eski sahip varsa hepsi düşürülür", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: ["a", "b"] });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: { type: "TRANSFER", transferred_from: ["a", "b"], transferred_to: ["c"], id: "evt-3" },
  });

  assert.deepEqual(result.downgraded, ["a", "b"]);
  assert.equal(calls.updates.length, 2);
});

test("users tablosunda olmayan RC anonim id'leri atlanır", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: [] });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: {
      type: "TRANSFER",
      transferred_from: ["$RCAnonymousID:abc123"],
      transferred_to: [NEW],
      id: "evt-4",
    },
  });

  assert.deepEqual(result.downgraded, []);
  assert.deepEqual(result.skipped, ["$RCAnonymousID:abc123"]);
  assert.equal(calls.inserts.length, 0);
});

test("her düşürme için denetim izi (purchase_history) yazılır", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: [OLD] });

  await applyRevenueCatTransfer({
    supabase: client,
    event: {
      type: "TRANSFER",
      transferred_from: [OLD],
      transferred_to: [NEW],
      id: "evt-5",
      store: "APP_STORE",
      environment: "PRODUCTION",
    },
  });

  assert.equal(calls.inserts.length, 1);
  assert.equal(calls.inserts[0].event_type, "TRANSFER");
  assert.equal(calls.inserts[0].user_id, OLD);
  assert.equal(calls.inserts[0].credits_added, 0);
  assert.equal(calls.inserts[0].transaction_id, `transfer_evt-5_${OLD}`);
});

test("transferred_from boşsa hiçbir şey yapılmaz", async () => {
  const { client, calls } = fakeSupabase({ knownUserIds: [OLD] });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: { type: "TRANSFER", transferred_to: [NEW], id: "evt-6" },
  });

  assert.deepEqual(result.downgraded, []);
  assert.equal(calls.updates.length, 0);
});

test("DB hatasında failed listesine düşer, patlamaz", async () => {
  const { client } = fakeSupabase({
    knownUserIds: [OLD],
    updateError: { message: "boom" },
  });

  const result = await applyRevenueCatTransfer({
    supabase: client,
    event: { type: "TRANSFER", transferred_from: [OLD], transferred_to: [NEW], id: "evt-7" },
  });

  assert.deepEqual(result.failed, [OLD]);
  assert.deepEqual(result.downgraded, []);
});
