// Native clients before pagination support request this endpoint without a limit.
// Fetch every page for them; an implicit 20-row cap hides older personal models
// after automatic pool copies have been added to the same library.
const PAGE_SIZE = 500;
function parseInteger(value, fallback, minimum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid pagination');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) throw new Error('Invalid pagination');
  return number;
}
async function listUserModels(db, userId, query = {}) {
  let offset, limit;
  try {
    offset = parseInteger(query.offset, 0, 0);
    limit = parseInteger(query.limit, null, 1);
    if (limit !== null && !Number.isSafeInteger(offset + limit)) throw new Error('Invalid pagination');
  } catch (error) { return { data: null, error: { message: error.message, status: 400 } }; }
  const models = [];
  for (;;) {
    const size = limit === null ? PAGE_SIZE : Math.min(PAGE_SIZE, limit - models.length);
    if (size === 0) break;
    const from = offset + models.length;
    const result = await db.from('user_models').select('*')
      .eq('user_id', userId).eq('status', 'completed')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + size - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data || [];
    models.push(...page);
    if (page.length < size) break;
  }
  return { data: models, error: null };
}
module.exports = { listUserModels };
