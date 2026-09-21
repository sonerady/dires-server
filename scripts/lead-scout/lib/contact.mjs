// ✉️ SADECE kurumsal rol hesapları.
//
// Politika (bilinçli ve sıkı): isimli kişi adresleri (ahmet@, a.yilmaz@)
// KVKK/GDPR anlamında kişisel veridir ve bu araç onları TOPLAMAZ. Yalnızca
// şirketin kendi yayınladığı rol adresleri (info@, iletisim@, satis@…)
// kaydedilir. Beyaz liste dışındaki her local-part atılır.

import { get, sleep } from "./shopify.mjs";

const ROLE_WHITELIST = new Set([
  "info", "bilgi", "iletisim", "İletisim", "contact", "hello", "merhaba",
  "satis", "sales", "siparis", "order", "orders", "destek", "support",
  "musteri", "musterihizmetleri", "customerservice", "cs", "kurumsal",
  "pazarlama", "marketing", "isbirligi", "collab", "collaboration",
  "toptan", "wholesale", "press", "basin", "admin", "mail", "eticaret",
]);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Şablon/örnek adresler: bazı temalar iletişim sayfasında "info@ornekmail.com"
// gibi doldurulmamış placeholder bırakıyor. Bunlar gerçek adres değil.
const JUNK_DOMAIN = /(sentry|wixpress|example|shopify\.com|godaddy|cloudflare|ornekmail|örnekmail|yourdomain|yourmail|yoursite|domain\.com|siteadi|firmaniz|sirketiniz|mailadresi|\.png|\.jpg|\.webp)/i;

const PATHS = ["", "/pages/iletisim", "/pages/contact", "/pages/contact-us", "/iletisim", "/contact", "/pages/hakkimizda", "/pages/about-us"];

function isRoleAddress(email) {
  const [local, domain] = email.toLowerCase().split("@");
  if (!local || !domain) return false;
  if (JUNK_DOMAIN.test(email)) return false;
  return ROLE_WHITELIST.has(local.replace(/[._-]/g, ""));
}

export async function findRoleEmails(domain) {
  const found = new Set();
  const phones = new Set();
  const visited = [];

  for (const path of PATHS) {
    if (found.size >= 3) break;
    const url = `https://www.${domain}${path}`;
    let html;
    try {
      html = await get(url, { timeout: 15000 });
    } catch {
      continue;
    }
    visited.push(path || "/");

    for (const m of html.match(EMAIL_RE) || []) {
      if (isRoleAddress(m)) found.add(m.toLowerCase());
    }
    // Kurumsal telefon — sadece tel: linkinden, serbest metinden değil.
    for (const m of html.match(/tel:\+?[0-9()\s.-]{7,20}/gi) || []) {
      phones.add(m.replace(/^tel:/i, "").replace(/[()\s.-]/g, ""));
    }
    await sleep(250);
  }

  return {
    emails: [...found],
    phones: [...phones].slice(0, 2),
    checkedPaths: visited,
  };
}
