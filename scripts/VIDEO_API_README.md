# Video API Kullanım Kılavuzu

## 📋 Genel Bakış

Video API'si HomeScreen ve PaywallV3Screen'de kullanılan videoları dinamik olarak yönetmek için oluşturulmuştur.

## 🗃️ Supabase Tablosu

### Videos Tablosu Yapısı

```sql
CREATE TABLE videos (
    id UUID PRIMARY KEY,
    type VARCHAR(50) CHECK (type IN ('hero', 'paywall', 'before_after')),
    title VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
```

### Video Tipleri

- **hero**: HomeScreen hero videoları
- **paywall**: PaywallV3Screen arka plan videoları
- **before_after**: Popular cards için before/after videoları

## 🚀 API Endpoints

### 1. Tip Bazında Video Getirme

```http
GET /api/videos/:type
```

**Örnek Kullanım:**

```javascript
// HomeScreen için hero videoları
const response = await fetch(`${API_URL}/api/videos/hero`);
const data = await response.json();

// PaywallV3Screen için paywall videoları
const response = await fetch(`${API_URL}/api/videos/paywall`);
const data = await response.json();

// Before/After videoları
const response = await fetch(`${API_URL}/api/videos/before_after`);
const data = await response.json();
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "hero",
      "title": "Ana Hero Video",
      "url": "https://example.com/video.mp4",
      "description": "Ana sayfa hero videosu",
      "priority": 1,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "count": 1
}
```

### 2. Tüm Videoları Getirme

```http
GET /api/videos
```

**Response:**

```json
{
  "success": true,
  "data": {
    "hero": [...],
    "paywall": [...],
    "before_after": [...]
  },
  "count": 6
}
```

### 3. Video Ekleme (Admin)

```http
POST /api/videos
```

**Body:**

```json
{
  "type": "hero",
  "title": "Yeni Hero Video",
  "url": "https://example.com/new-video.mp4",
  "description": "Yeni hero videosu",
  "priority": 2
}
```

### 4. Video Güncelleme (Admin)

```http
PUT /api/videos/:id
```

### 5. Video Silme (Admin)

```http
DELETE /api/videos/:id
```

## 📱 Client Entegrasyonu

### HomeScreen.js İçin

```javascript
// Hero videoları için
const [heroVideos, setHeroVideos] = useState([]);

useEffect(() => {
  const fetchHeroVideos = async () => {
    try {
      const response = await fetch(`${API_URL}/api/videos/hero`);
      const data = await response.json();

      if (data.success && data.data.length > 0) {
        setHeroVideos(data.data);
        // İlk video'yu kullan veya random seç
        const randomVideo =
          data.data[Math.floor(Math.random() * data.data.length)];
        setCurrentHeroVideo(randomVideo.url);
      }
    } catch (error) {
      console.error("Hero videoları alınamadı:", error);
      // Fallback video kullan
      setCurrentHeroVideo(VIDEO_URLS.hero);
    }
  };

  fetchHeroVideos();
}, []);

// Video component'te
<Video
  source={{ uri: currentHeroVideo }}
  style={styles.heroVideo}
  // ... diğer props
/>;
```

### PaywallV3Screen.js İçin

```javascript
// Paywall videoları için
const [paywallVideos, setPaywallVideos] = useState([]);

useEffect(() => {
  const fetchPaywallVideos = async () => {
    try {
      const response = await fetch(`${API_URL}/api/videos/paywall`);
      const data = await response.json();

      if (data.success && data.data.length > 0) {
        setPaywallVideos(data.data);
        // Priority'ye göre sırala ve ilkini kullan
        const primaryVideo = data.data.sort(
          (a, b) => a.priority - b.priority
        )[0];
        setCurrentPaywallVideo(primaryVideo.url);
      }
    } catch (error) {
      console.error("Paywall videoları alınamadı:", error);
      // Fallback video kullan
      setCurrentPaywallVideo(VIDEO_URLS.hero);
    }
  };

  fetchPaywallVideos();
}, []);
```

## 🛠️ Kurulum Adımları

### 1. Supabase Tablosu Oluşturma

```bash
# SQL dosyasını Supabase SQL Editor'da çalıştır
cat server/scripts/create_videos_table.sql
```

### 2. Varsayılan Videoları Ekleme

```bash
cd server
node scripts/setup_default_videos.js
```

### 3. API Test Etme

```bash
# Tüm videoları getir
curl http://localhost:3001/api/videos

# Hero videoları getir
curl http://localhost:3001/api/videos/hero

# Paywall videoları getir
curl http://localhost:3001/api/videos/paywall
```

## 📊 Video Yönetimi

### Priority Sistemi

- **Priority 1**: Ana/birincil video
- **Priority 2+**: Alternatif videolar
- **Random Selection**: Client'ta random seçim yapılabilir
- **Fallback**: API başarısız olursa mevcut VIDEO_URLS kullanılır

### Performans Optimizasyonu

- Videos cache'lenebilir (Redis/Memory)
- CDN kullanımı önerilir
- Video preloading yapılabilir
- Error handling ve fallback mekanizması

## 🔧 Geliştirme Notları

### Error Handling

```javascript
const fetchVideosWithFallback = async (type, fallbackUrl) => {
  try {
    const response = await fetch(`${API_URL}/api/videos/${type}`);
    const data = await response.json();

    if (data.success && data.data.length > 0) {
      return data.data[0].url; // İlk video'yu döndür
    }

    return fallbackUrl; // Fallback kullan
  } catch (error) {
    console.error(`${type} video fetch error:`, error);
    return fallbackUrl; // Fallback kullan
  }
};
```

### Video Rotation

```javascript
// Videoları döngüsel olarak değiştir
const rotateVideos = (videos, interval = 30000) => {
  let currentIndex = 0;

  setInterval(() => {
    currentIndex = (currentIndex + 1) % videos.length;
    setCurrentVideo(videos[currentIndex].url);
  }, interval);
};
```

## 📈 İzleme ve Analytics

### API Metrikleri

- Video fetch success/error rates
- En çok kullanılan video tipleri
- Response time monitoring

### Video Metrikleri

- Video load success rates
- Playback completion rates
- Error tracking

Bu API sayesinde videolar artık dinamik olarak yönetilebilir ve A/B test edilebilir! 🎬
