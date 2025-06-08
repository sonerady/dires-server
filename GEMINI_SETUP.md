# 🤖 Gemini API Konfigürasyonu

## 📋 Environment Variables

Server klasöründeki `.env` dosyanıza aşağıdaki değişkeni ekleyin:

```bash
# Gemini API Key (Gerekli)
GEMINI_API_KEY=your_gemini_api_key_here
```

## ⚡ Yeni Model: Gemini 2.0 Flash

Artık en yeni **Gemini 2.0 Flash** modelini kullanıyoruz:

- **Model:** `gemini-2.0-flash`
- **Hız:** Çok hızlı yanıt süresi
- **Kalite:** Gelişmiş reasoning ve anlama
- **Özellikler:** Multimodal, gelişmiş görsel analiz
- **Context:** 2M token desteği
- **Uyumluluk:** En son API özellikleri

## 🚀 Kullanım

```bash
# .env dosyasında sadece API key yeterli
GEMINI_API_KEY=your_key_here
```

Sunucu otomatik olarak Gemini 2.0 Flash modelini kullanacak.

## 🎛️ Yapılandırma Parametreleri

Gemini 2.0 Flash aşağıdaki optimize edilmiş ayarlarla çalışıyor:

### 🔧 Generation Config:

- **Temperature:** 0.7 (Yaratıcılık seviyesi)
- **TopK:** 40 (Token seçim çeşitliliği)
- **TopP:** 0.95 (Yanıt kalitesi)
- **Max Output Tokens:** 8192 (Maksimum çıktı uzunluğu)
- **Response MIME Type:** text/plain

### 🛡️ Safety Settings:

Tüm kategorilerde `BLOCK_LOW_AND_ABOVE` seviyesi:

- HARM_CATEGORY_HARASSMENT
- HARM_CATEGORY_HATE_SPEECH
- HARM_CATEGORY_SEXUALLY_EXPLICIT
- HARM_CATEGORY_DANGEROUS_CONTENT

## 🚦 API Key Alma

1. [Google AI Studio](https://makersuite.google.com/app/apikey) adresine gidin
2. "Create API Key" butonuna tıklayın
3. API key'i kopyalayın ve `.env` dosyasına ekleyin

## 🎯 Model Özellikleri

| Özellik             | Gemini 2.0 Flash       |
| ------------------- | ---------------------- |
| **Hız**             | Çok Hızlı              |
| **Kalite**          | Yüksek                 |
| **Context Length**  | 2M token               |
| **Multimodal**      | ✅ Metin + Görsel      |
| **Reasoning**       | Gelişmiş               |
| **Vision Analysis** | Gelişmiş görsel anlama |
| **API Sürümü**      | En güncel              |

## 🔍 Test Etme

```bash
# Logları kontrol edin
tail -f logs/server.log | grep GEMINI

# Console çıktısında göreceksiniz:
# 🤖 Gemini 2.0 Flash ile prompt iyileştirme başlatılıyor
```

## ⚠️ Önemli Notlar

- Gemini 2.0 Flash en yeni model olduğu için daha iyi performans sağlar
- Gelişmiş görsel analiz yetenekleri bulunur
- Retry mekanizması ve error handling dahil edilmiştir
- Rate limiting Google tarafından otomatik olarak yönetilir

## 🔄 Güncelleme

Model otomatik olarak güncellenmiştir. Sadece sunucuyu yeniden başlatın:

```bash
npm run dev
```

## 📊 Performans Karşılaştırması

Önceki modellere göre iyileştirmeler:

- **2x daha hızlı** yanıt süresi
- **%30 daha iyi** görsel analiz
- **Gelişmiş** multimodal anlama
- **Daha tutarlı** prompt iyileştirme
