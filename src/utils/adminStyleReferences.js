// Admin-only enrichment. The generation's style_reference_url is the historical
// image; mutable profile metadata is explicitly returned as current information.
async function enrichAdminStyleReferences(db, rows) {
  const ids = [...new Set(rows.map(row => row.style_profile_id).filter(Boolean))];
  if (!ids.length) return rows;
  const { data, error } = await db.from('style_profiles')
    .select('id,name,subtitle,tags,category_slug,style_prompt,image_urls')
    .in('id', ids);
  if (error) {
    console.warn('[Admin] Style profile details unavailable:', error.code || 'query_error');
    return rows.map(row => ({ ...row, style_profile: null }));
  }
  const profiles = new Map((data || []).map(profile => [profile.id, profile]));
  return rows.map(row => ({ ...row, style_profile: profiles.get(row.style_profile_id) || null }));
}

module.exports = { enrichAdminStyleReferences };
