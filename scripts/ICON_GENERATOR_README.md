# 🎨 Icon Generator

AccessoryLibrary verilerinden Replicate API kullanarak iconlar oluşturan otomatik sistem.

## 📁 Dosyalar

- `icon-generator.js` - Ana script dosyası
- `../icon-generator-ui.html` - Web arayüzü
- `../src/routes/iconGeneratorRoutes.js` - API routes
- `../generated-icons/` - Oluşturulan iconların kaydedildiği klasör

## 🚀 Kurulum

1. **Environment Variables**
   ```bash
   # .env dosyasında olduğundan emin ol
   REPLICATE_API_TOKEN=your_replicate_token_here
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_anon_key
   ```

2. **Supabase Storage Setup**
   - Supabase projesinde `icons` bucket'ını oluştur
   - Public access'e izin ver
   - `generated-icons/` klasörü otomatik oluşturulacak

2. **Gerekli Packages**
   ```bash
   cd server
   npm install # Tüm dependencies yüklü olmalı
   ```

## 💻 Kullanım

### 1. Command Line (Terminal)

```bash
cd server/scripts

# Tüm iconları oluştur
node icon-generator.js

# Sadece belirli kategori
node icon-generator.js --category Casual

# Kategorileri listele
node icon-generator.js --list-categories
```

### 2. Web Arayüzü

1. Server'ı başlat:
   ```bash
   cd server
   npm start
   ```

2. Web arayüzünü aç:
   ```
   http://localhost:3001/icon-generator-ui.html
   ```

3. Arayüzden:
   - Kategori seç (veya "Tüm Kategoriler")
   - "🚀 Başlat" butonuna bas
   - İlerlemeyi takip et
   - Oluşturulan iconları galerde gör

## 🛠️ API Endpoints

- `GET /api/icon-generator/categories` - Kategorileri listele
- `POST /api/icon-generator/generate` - Icon generation başlat
- `GET /api/icon-generator/gallery` - Oluşturulan iconları listele
- `GET /api/icon-generator/image/:filename` - Tekil icon serve et
- `GET /api/icon-generator/status` - Sistem durumu
- `GET /api/icon-generator/report` - Generation raporu
- `DELETE /api/icon-generator/clear` - Tüm iconları sil

## 📊 Özellikler

### ✅ Tamamlanan
- AccessoryLibrary verilerini otomatik okuma
- Replicate API entegrasyonu
- Retry mekanizması (3 deneme)
- Hata yönetimi
- Progress tracking
- Web arayüzü
- Galeri görüntüleme
- API endpoints
- Kategoriye göre filtreleme
- **Supabase Storage entegrasyonu**
- **Dual storage (Local + Cloud)**
- **Public URL generation**

### 🎯 Icon Özellikleri
- Flat design
- Bold outlines
- Single color stroke (red, yellow, green, orange)
- White background
- Minimalist style
- JPG format

### 📈 İstatistikler
- Toplam item sayısı
- İşlenen item sayısı
- Başarılı generation sayısı
- Hatalı generation sayısı
- Tahmini kalan süre

## 🗂️ Çıktı Formatı

### Local Storage
```
server/generated-icons/
├── Casual_sunglasses.jpg
├── Casual_baseball_cap.jpg
├── Formal_tie.jpg
├── Business_briefcase.jpg
└── generation-report.json
```

### Supabase Storage
```
icons bucket:
└── generated-icons/
    ├── Casual_sunglasses.jpg
    ├── Casual_baseball_cap.jpg
    ├── Formal_tie.jpg
    └── Business_briefcase.jpg
```

**Not**: Her icon hem local'e hem de Supabase'e kaydedilir. Web arayüzü öncelikle Supabase URL'lerini kullanır.

## 🔧 Konfigürasyon

### Script Ayarları
```javascript
const MAX_RETRIES = 3;           // Maksimum deneme sayısı
const DELAY_BETWEEN_REQUESTS = 1000; // API istekleri arası bekleme (ms)
```

### Prompt Template
```javascript
const promptTemplate = `Draw a simple flat icon of a {{ACCESSORY_NAME}} in the same style as the reference:
- clean outline illustration with bold lines
- single color stroke (red, yellow, green, or orange)
- no shading, no gradients, no 3D effects
- white background
- minimalist, sticker-like style`;
```

## 📋 Kategoriler

Desteklenen kategoriler:
- Casual (30 item)
- Formal (30 item)
- Business (30 item)
- Streetwear (30 item)
- Sporty (30 item)
- Tennis (30 item)
- Golf (30 item)
- Running (30 item)
- Cycling (30 item)
- Hiking (30 item)

**Toplam: ~300 accessory**

## 🚨 Hata Yönetimi

- **API Rate Limit**: Otomatik retry mekanizması
- **Network Hatası**: 3 deneme sonrası skip
- **Invalid Response**: Error logging
- **File Write Error**: Detaylı hata mesajı

## 📊 Rapor Sistemi

Generation sonunda `generation-report.json` oluşturulur:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "totalCount": 300,
  "successful": 285,
  "failed": 15,
  "details": {
    "successful": [...],
    "failed": [...]
  }
}
```

## 🔍 Debug

Hata ayıklama için:

```bash
# Verbose output
DEBUG=true node icon-generator.js

# Log level ayarla
LOG_LEVEL=debug node icon-generator.js
```

## 💡 İpuçları

1. **Performans**: API rate limit nedeniyle yaklaşık 1 saniye/icon
2. **Disk Alanı**: Her icon ~50-100KB, toplam ~30MB
3. **Network**: Stable internet bağlantısı gerekli
4. **Credits**: Replicate API kullanım ücretleri geçerli

## 🐛 Sorun Giderme

### Yaygın Hatalar:

1. **"REPLICATE_API_TOKEN not found"**
   - `.env` dosyasını kontrol et
   - Token'ın geçerli olduğundan emin ol

2. **"AccessoryLibrary import error"**
   - Dosya yolunu kontrol et
   - Export syntax'ını doğrula

3. **"Directory creation failed"**
   - Write permissions kontrol et
   - Disk alanını kontrol et

4. **API 429 (Rate Limit)**
   - Bekleme sürelerini artır
   - Paralel request sayısını azalt

## 📞 Destek

Sorun yaşadığında:
1. Error log'larını kontrol et
2. Network bağlantısını test et
3. API token'ını doğrula
4. Script'i tek kategori ile test et
