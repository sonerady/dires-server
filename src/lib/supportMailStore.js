const { randomUUID } = require('node:crypto');

function createSupportMailStore(db) {
  const unwrap = ({ data, error }) => { if (error) throw Object.assign(new Error('Support storage unavailable'), { code: error.code }); return data; };
  return {
    async conversation(id) { return unwrap(await db.from('support_conversations').select('*').eq('id', id).maybeSingle()); },
    async byToken(kind, token) { return unwrap(await db.from('support_conversations').select('*').eq(kind === 'agent' ? 'agent_token' : 'customer_token', token).maybeSingle()); },
    async createConversation(value) {
      const result = await db.from('support_conversations').insert(value).select().single();
      if (result.error?.code === '23505') return this.conversation(value.id);
      return unwrap(result);
    },
    async updateConversation(id, value) { unwrap(await db.from('support_conversations').update(value).eq('id', id)); },
    async deliver(id, prepare, send) {
      const token = randomUUID();
      const row = unwrap(await db.rpc('claim_support_mail', { delivery_id: id, lease_token: token }));
      if (!row) throw Object.assign(new Error('Delivery is already processing'), { status: 503 });
      if (row.status === 'sent' || row.status === 'ignored') return { duplicate: true };
      if (row.status === 'review') throw Object.assign(new Error('Delivery requires review'), { status: 503 });
      const save = async values => unwrap(await db.from('support_mail_deliveries').update(values).eq('id', id).eq('lock_token', token));
      try {
        const payload = row.payload || await prepare();
        if (!payload) { await save({ status: 'ignored', reason: 'unroutable_or_automatic', completed_at: new Date().toISOString(), locked_until: null }); return { ignored: true }; }
        // Persist exactly what will be sent so retries keep the same idempotency payload.
        await save({ payload, first_attempt_at: row.first_attempt_at || new Date().toISOString() });
        const result = await send(payload, id);
        await save({ status: 'sent', provider_id: result.id, payload: null, completed_at: new Date().toISOString(), locked_until: null });
        return { sent: true };
      } catch (error) {
        await save({ locked_until: null }).catch(() => {});
        throw error;
      }
    },
  };
}
module.exports = { createSupportMailStore };
