# Supabase Storage - Setup Guide

Bu dosya, Supabase Storage ve Row Level Security (RLS) politikalarının doğru yapılandırılması için rehber olarak hazırlanmıştır.

## Supabase Storage Setup

Gemini API ile oluşturulan görüntüleri Supabase'e yüklemek için gerekli ayarlar:

### 1. Bucket Oluşturma

1. Supabase proje panelinize giriş yapın
2. Sol menüden "Storage" seçeneğine tıklayın
3. "New Bucket" butonuna tıklayın
4. Bucket adını "products" olarak girin 
5. "Public bucket" seçeneğini işaretleyin
6. "Create bucket" butonuna tıklayarak bucketi oluşturun

### 2. Row Level Security (RLS) Politikası Ayarlama

"new row violates row-level security policy" hatası alıyorsanız, Supabase'in varsayılan olarak uygulanan güvenlik politikaları nedeniyle dosya yükleyemiyorsunuz demektir. Bu sorunu çözmek için:

1. Supabase panelinizde "Storage" bölümüne gidin
2. "products" bucket'ına tıklayın
3. "Policies" sekmesine tıklayın
4. "Add Policy" butonuna tıklayın ve şu ayarları yapın:
   - Policy Type: INSERT (Dosya yükleme)
   - Policy Name: "Allow file uploads"
   - Definition: `true` (herkes dosya yükleyebilir)
   - Roles: Tüm roller seçili olmalı

Bu basit politika herkesin dosya yüklemesine izin verecektir. Üretim ortamında daha kısıtlayıcı bir politika kullanmak isteyebilirsiniz.

### 3. Service Role Key Kullanımı

Alternatif olarak, RLS politikalarını atlamak için `service_role` API key'ini kullanabilirsiniz:

1. Supabase panelinizde "Settings" > "API" sayfasına gidin
2. "service_role secret" bölümünde API anahtarını bulun
3. Bu anahtarı `.env` dosyanızdaki `SUPABASE_KEY` değişkenine atayın:

```
SUPABASE_URL=https://your-project-url.supabase.co
SUPABASE_KEY=your-service-role-key
```

**Önemli Uyarı:** `service_role` anahtarı RLS politikalarını atlar ve tam yönetici erişimi sağlar. Bu anahtarı güvenli tutun ve istemci tarafı kodunda ASLA kullanmayın!

## Sorun Giderme

Eğer "403 Forbidden" veya "Unauthorized" hataları almaya devam ediyorsanız:

1. `service_role` anahtarını kullandığınızdan emin olun
2. Bucket ismini doğru yazdığınızdan emin olun ("products")
3. Supabase proje URL'nizin doğru olduğundan emin olun
4. Supabase projenizdeki Storage özelliğinin aktif olduğundan emin olun

Daha fazla bilgi için [Supabase Storage dokümantasyonu](https://supabase.com/docs/guides/storage)nu inceleyebilirsiniz. 