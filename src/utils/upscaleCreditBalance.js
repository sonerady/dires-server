// Compare-and-set prevents overlapping upscales/refunds from overwriting balances.
// Retry only a confirmed conflict (zero updated rows), never an uncertain write.
async function changeUpscaleBalance(db, ownerId, delta) {
  if (!ownerId || ['anonymous_user', 'anonymous'].includes(ownerId)) {
    throw Object.assign(new Error('USER_ACCOUNT_REQUIRED'), { status: 400 });
  }
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('INVALID_CREDIT_AMOUNT');
  for (let attempt = 0; attempt < 32; attempt++) {
    const { data: user, error } = await db.from('users').select('credit_balance').eq('id', ownerId).single();
    if (error || !user || !Number.isFinite(user.credit_balance)) throw new Error('CREDIT_BALANCE_UNAVAILABLE');
    const before = user.credit_balance;
    const after = before + delta;
    if (after < 0) throw Object.assign(new Error('INSUFFICIENT_CREDITS'), { status: 402 });
    const result = await db.from('users').update({ credit_balance: after })
      .eq('id', ownerId).eq('credit_balance', before).select('credit_balance');
    if (result.error) throw new Error('CREDIT_UPDATE_FAILED');
    if (result.data?.length === 1) return { before, after };
    if (!Array.isArray(result.data) || result.data.length !== 0) throw new Error('CREDIT_UPDATE_UNCONFIRMED');
  }
  throw new Error('CREDIT_BALANCE_BUSY');
}
module.exports = { changeUpscaleBalance };
