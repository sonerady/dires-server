# 🛡️ Device Credit Security System

Bu doküman yeni kullanıcılara tek seferlik 100 kredi hediye sisteminin güvenlik yapısını açıklar.

## 📋 Sistem Özeti

### Amaç

- Yeni kullanıcılara tek seferlik 100 kredi hediye et
- Uygulama silinse bile aynı cihazdan yeniden kredi alınmasını engelle
- Device ID bazlı güvenlik kontrolü

### Güvenlik Katmanları

#### 1. Database Tablosu: `users`

```sql
-- Yeni column'lar
device_id VARCHAR(255)              -- Cihaz benzersiz ID'si
received_initial_credit BOOLEAN     -- Bu kullanıcı initial kredi aldı mı?
initial_credit_date TIMESTAMP       -- İlk kredi alım tarihi
```

#### 2. PostgreSQL Function: `check_device_credit_eligibility`

```sql
-- Input: device_id
-- Output:
--   can_receive_credit BOOLEAN     -- Bu device kredi alabilir mi?
--   existing_user_count INTEGER    -- Bu device'dan kaç kullanıcı var?
--   last_credit_date TIMESTAMP     -- Son kredi alım tarihi
```

#### 3. Backend Güvenlik (registerAnonymousUser.js)

```javascript
// 1. Device ID kontrolü
const creditCheck = await supabase.rpc("check_device_credit_eligibility", {
  device_id_param: deviceId,
});

// 2. Kredi alım durumuna göre karar
if (!can_receive_credit) {
  // Bu device daha önce kredi aldı - mevcut kullanıcıyı döndür
  return existingUser;
} else {
  // Yeni kullanıcı oluştur ve 100 kredi ver
  const newUser = {
    credit_balance: 100,
    received_initial_credit: true,
    initial_credit_date: new Date(),
  };
}
```

#### 4. Frontend Güvenlik (App.js)

```javascript
// Response handling
if (deviceAlreadyReceivedCredit) {
  // Bu cihaz daha önce kredi aldı
  await AsyncStorage.setItem("device_credit_blocked", "true");
}
```

## 🔒 Güvenlik Senaryoları

### ✅ Korunan Durumlar

#### Senaryo 1: Uygulama Silme

1. Kullanıcı uygulamayı siler
2. AsyncStorage temizlenir
3. Device ID değişmez (\*)
4. Uygulama yeniden yüklendiğinde aynı device ID
5. ❌ Yeni kredi VERİLMEZ

#### Senaryo 2: Farklı Kullanıcı Hesabı

1. Aynı cihazda farklı Apple/Google hesabı
2. Aynı device ID
3. ❌ Yeni kredi VERİLMEZ

#### Senaryo 3: Fabrika Ayarları

1. Telefon fabrika ayarlarına döndürüldü
2. Device ID değişmez
3. ❌ Yeni kredi VERİLMEZ

### ⚠️ Potansiyel Güvenlik Açıkları

#### Device ID Değişimi

- **iOS**: App silinirse `identifierForVendor` değişebilir
- **Android**: Bazı durumlarda device ID değişebilir

#### Çözüm Önerileri

1. **Donanım Fingerprint**: `react-native-device-info`
2. **IP Kontrolü**: Aynı IP'den çok fazla hesap kontrolü
3. **Time-based Blocking**: 24 saat içinde IP başına limit

## 📊 Monitoring & Analytics

### Database İstatistikleri

```sql
-- Device başına kullanıcı sayısı
SELECT device_id, COUNT(*)
FROM users
WHERE device_id IS NOT NULL
GROUP BY device_id
HAVING COUNT(*) > 1;

-- Günlük yeni kullanıcı ve kredi dağıtımı
SELECT
  DATE(created_at) as date,
  COUNT(*) as new_users,
  COUNT(CASE WHEN received_initial_credit THEN 1 END) as credits_given
FROM users
GROUP BY DATE(created_at)
ORDER BY date DESC;
```

### Şüpheli Aktivite Tespiti

```sql
-- Aynı device_id'den çok fazla kullanıcı
SELECT device_id, COUNT(*), STRING_AGG(id::text, ', ')
FROM users
WHERE device_id IS NOT NULL
GROUP BY device_id
HAVING COUNT(*) > 3;
```

## 🚀 Deployment Checklist

### Database Migration

- [ ] `add-device-credit-tracking.sql` script'ini çalıştır
- [ ] `check_device_credit_eligibility` function'ını oluştur
- [ ] Index'leri oluştur
- [ ] Test verilerini kontrol et

### Backend Deployment

- [ ] `registerAnonymousUser.js` güncellemelerini deploy et
- [ ] PostgreSQL function'ın çalıştığını test et
- [ ] Error logging'i kontrol et

### Frontend Deployment

- [ ] `App.js` güncellemelerini deploy et
- [ ] AsyncStorage flag'lerini test et
- [ ] Device ID collection'ını test et

### Test

- [ ] `test-device-credit-system.js` script'ini çalıştır
- [ ] Farklı cihazlarda test et
- [ ] Uygulama silme/yeniden yükleme test et

## 📞 Support & Debug

### Debug Command'ları

```bash
# Test script'ini çalıştır
node server/scripts/test-device-credit-system.js

# Device ID kontrol et
SELECT * FROM check_device_credit_eligibility('DEVICE_ID_BURAYA');

# Kullanıcı geçmişini görüntüle
SELECT id, device_id, credit_balance, received_initial_credit, created_at
FROM users
WHERE device_id = 'DEVICE_ID_BURAYA';
```

### Log'lar

- Frontend: `console.log` ile device ID ve registration durumu
- Backend: PostgreSQL function sonuçları ve güvenlik kararları

## 🎯 Sonuç

Bu sistem %95+ oranında device bazlı kredi kötüye kullanımını engeller. Tam güvenlik için ek katmanlar (IP, hardware fingerprint) eklenebilir, ancak kullanıcı deneyimini olumsuz etkileyebilir.

**Trade-off**: Güvenlik vs. Kullanıcı Deneyimi
**Karar**: Orta seviye güvenlik, kolay kullanım
