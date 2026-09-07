// Only explicitly allowed diagnostics are retained; never serialize request headers or sessions.
const fields = { reportedUserId: 80, platform: 32, appVersion: 64, buildVersion: 80, os: 120, device: 120, browser: 240, language: 32, screen: 80, viewport: 40 };
const clean = (value, max = 200) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
function clientContext(value) {
  const result = {};
  for (const [key, max] of Object.entries(fields)) {
    const text = clean(value?.[key], max);
    if (text) result[key] = text;
  }
  return result;
}
async function resolveSupportContext(req, db) {
  const context = { client: clientContext(req.body?.context), account: null };
  const authorization = req.headers.authorization;
  if (!authorization) return context;
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const invalid = () => Object.assign(new Error('Invalid support session'), { status: 401, code: 'INVALID_SUPPORT_SESSION' });
  if (!match) throw invalid();
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data?.user) throw invalid();
  const user = data.user;
  if (user.is_anonymous) return context;
  const result = await db.from('users').select('id,email,full_name,subscription_type,is_pro,created_at').eq('supabase_user_id', user.id).maybeSingle();
  if (result.error) throw Object.assign(new Error('Support account unavailable'), { status: 503 });
  const account = result.data;
  context.account = {
    userId: account?.id || null,
    authUserId: user.id,
    email: clean(user.email || account?.email, 254),
    name: clean(account?.full_name, 120),
    plan: clean(account?.subscription_type, 80) || (account?.is_pro ? 'Pro' : ''),
    registeredAt: clean(account?.created_at, 40),
  };
  return context;
}
function formatSupportContext(context) {
  if (!context) return '';
  const account = context.account;
  const rows = [
    ['Oturum', account ? 'Doğrulanmış kullanıcı' : 'Misafir / doğrulanmış oturum yok'],
    ['User ID', account?.userId], ['Auth User ID', account?.authUserId],
    ['Hesap e-postası', account?.email], ['Ad soyad', account?.name],
    ['Plan', account?.plan], ['Kayıt tarihi', account?.registeredAt],
  ];
  const labels = { reportedUserId: 'Bildirilen User ID (doğrulanmamış)', platform: 'Platform', appVersion: 'Uygulama sürümü', buildVersion: 'Build', os: 'İşletim sistemi', device: 'Cihaz', browser: 'Tarayıcı', language: 'Dil', screen: 'Ekran', viewport: 'Pencere boyutu' };
  for (const [key, value] of Object.entries(clientContext(context.client))) rows.push([labels[key], value]);
  return `\nİlk talebin kullanıcı ve cihaz bilgileri (cihaz bilgileri istemciden):\n${rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${clean(String(value), 254)}`).join('\n')}\n`;
}
module.exports = { clientContext, resolveSupportContext, formatSupportContext };
