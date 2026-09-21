# Diress Lead Scout

Shopify mağazalarını tarayıp **fotoğrafı zayıf, kataloğu büyük** olanları bulur —
yani Diress'in gerçek müşteri adaylarını. Ham e-posta listesi değil, kanıtlı liste.

## Çalıştırma

```bash
export OPENROUTER_API_KEY=...        # sk-or-...  (server/.env'de zaten var)
# veya: export AI_GATEWAY_API_KEY=...

node run.mjs                          # seeds.txt
node run.mjs --in liste.txt           # başka liste
node run.mjs --no-jev                 # sadece katalog profili (anahtarsız)
node run.mjs --offset 20 --limit 20   # parça parça (uzun taramalar)
node run.mjs --min-fit 2 --median 4   # eşikler
```

Sonuçlar `out/` altında: `leads.csv`, `leads.json`, `rejected.csv`, `rows.jsonl`.
`rows.jsonl` satır satır yazılır — tarama yarıda kalırsa kaldığı yerden devam eder.

## Panel

```bash
node details.mjs            # her mağazanın ürün listesini çeker (out/stores/)
node dashboard.mjs          # → http://localhost:4400
```

Liste görünümünde mağaza adına tıklayınca detaya iniyorsun: kategori kırılımı,
ürün kartları (kapak görseli, başlık, kategori, fiyat, açıklama), her kartta
kaç görseli olduğu. Filtreler: tek görselli / 3'ten az görselli / açıklaması
olmayan ürünler. Büyük kataloglarda (10.000 ürün) filtreleme ve sayfalama
sunucuda yapılıyor, tarayıcıya sadece 40 ürünlük sayfa gidiyor.

## Boru hattı

1. `lib/shopify.mjs` — `/products.json` ile hem Shopify tespiti hem tam katalog.
   Ürün sayısı, görsel sayısı, ürün başına foto, tek-fotoluk ürün oranı.
2. `lib/contact.mjs` — ana sayfa + iletişim sayfalarından **yalnızca rol hesapları**
   (`info@`, `iletisim@`, `satis@`…). İsimli kişi adresleri bilinçli olarak
   toplanmaz; onlar KVKK/GDPR kapsamında kişisel veridir.
3. `lib/jev.mjs` — Jev'e dört tiplenmiş soru: giyim mi, fotoğraf açığı ne kadar,
   katalog ölçeği, lead uygunluğu. OpenRouter veya Vercel AI Gateway üzerinden.
4. `run.mjs` — sıralar, eşikler, CSV yazar; her satıra mağazanın kendi verisinden
   üretilmiş bir "ilk cümle" ekler.

## Notlar

- Jev'in yerli sözlüğünde boolean'ın adı `noul`; OpenRouter yolunda çeviriliyor.
- Maliyet: mağaza başına ~$0.000034 (ölçüldü). 1000 mağaza ≈ 3 kuruş.
- Toplu mail atacaksan: İYS kaydı ve 3 iş günü içinde ret zorunlu, ve
  **diress.ai'den değil ayrı bir domainden** gönder — ana domainin itibarı yanar.
