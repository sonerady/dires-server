// Display-only exclusions. Never use this client in the customer app or generation flow.
const HIDDEN_ADMIN_USER_IDS = ['61038732-9077-4731-bf51-178ba7a3cac5'];
const HIDDEN_ADMIN_EMAILS = ['fatih66klcc@gmail.com'];
const OWNED_TABLES = new Set([
  'reference_results', 'refiner_generations', 'pose_change_generations',
  'back_side_generations', 'color_change_generations', 'upscale_generations',
  'chat_edits', 'variation_generations', 'video_generations', 'product_kits',
  'product_stories', 'product_unboxing_stories', 'product_street_icon_kits',
  'banner_studio_results', 'user_albums', 'user_unboxing_preferences',
]);
function adminVisibleData(client) {
  return new Proxy(client, {
    get(target, key) {
      if (key !== 'from') {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return table => {
        const builder = target.from(table);
        // Only SELECTs are filtered; no write operation or application policy is changed.
        const select = builder.select.bind(builder);
        builder.select = (...args) => {
          let query = select(...args);
          const column = table === 'users' ? 'id' : OWNED_TABLES.has(table) ? 'user_id' : null;
          if (column) query = query.or(`${column}.is.null,${column}.not.in.(${HIDDEN_ADMIN_USER_IDS.join(',')})`);
          if (table === 'legacy_model_users') for (const email of HIDDEN_ADMIN_EMAILS) query = query.not('email', 'ilike', email);
          return query;
        };
        return builder;
      };
    },
  });
}
async function hideAdminPersonalAssets(client, report) {
  // Aggregate statistics remain aggregate; hide identifiable personal asset cards.
  const lookups = [
    ['models', 'user_models', 'image_url'],
    ['locations', 'custom_locations', 'id'],
    ['styles', 'style_profiles', 'id'],
  ];
  for (const [key, table, column] of lookups) {
    if (!report[key]?.length) continue;
    const candidates = report[key].map(row => row.id).filter(value => value && (column !== 'id' || /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)));
    if (!candidates.length) continue;
    const { data, error } = await client.from(table).select(column)
      .in('user_id', HIDDEN_ADMIN_USER_IDS).in(column, candidates);
    if (error) throw error;
    const hidden = new Set((data || []).map(row => String(row[column])));
    report[key] = report[key].filter(row => !hidden.has(String(row.id)));
  }
  return report;
}
module.exports = { adminVisibleData, HIDDEN_ADMIN_USER_IDS, hideAdminPersonalAssets };
