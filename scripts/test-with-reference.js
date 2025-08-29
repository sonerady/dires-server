const fs = require("fs");
const path = require("path");

// .env dosyasının doğru path'ini belirt
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const REPLICATE_API_TOKEN = "r8_VOZ18ZqNu1sgLJnZS7Py83sD9HGmYML0uXYyS";
const OUTPUT_DIR = path.join(__dirname, "../generated-icons");
const REFERENCE_IMAGE_PATH = path.join(__dirname, "../example_nano.png");

// Çıktı klasörünü oluştur
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Delay fonksiyonu
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Prediction durumunu kontrol et
async function checkPrediction(predictionId) {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
            'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
        }
    });
    
    return await response.json();
}

// Referans resim ile test
async function testWithReference() {
    console.log('🧪 Referans resim ile test başlatılıyor...');
    
    const prompt = `Draw a simple flat icon of sunglasses in the same style as the reference:
- clean outline illustration with bold lines
- single color stroke in #FF6B6B color
- no shading, no gradients, no 3D effects
- white background
- minimalist, sticker-like style
- maintain the same artistic style as the reference image`;

    const requestBody = {
        input: {
            prompt: prompt,
            output_format: "jpg"
        }
    };

    // Referans resim ekle
    if (fs.existsSync(REFERENCE_IMAGE_PATH)) {
        requestBody.input.image_input = ["example_nano.png"];
        console.log(`📷 Referans resim eklendi: example_nano.png`);
    } else {
        console.log(`⚠️ Referans resim bulunamadı: ${REFERENCE_IMAGE_PATH}`);
    }

    try {
        console.log('📡 API isteği gönderiliyor...');
        console.log('🔧 Request body:', JSON.stringify(requestBody, null, 2));
        
        const response = await fetch('https://api.replicate.com/v1/models/google/nano-banana/predictions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API hatası: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('📄 İlk yanıt alındı, prediction ID:', result.id);
        console.log('⏳ Durum:', result.status);
        
        // Processing durumunu bekle
        let prediction = result;
        let attempts = 0;
        const maxAttempts = 20; // 3-4 dakika
        
        while (prediction.status === 'processing' && attempts < maxAttempts) {
            console.log(`⏳ Bekleniyor... (${attempts + 1}/${maxAttempts})`);
            await delay(10000); // 10 saniye bekle
            
            prediction = await checkPrediction(result.id);
            attempts++;
        }
        
        console.log('📄 Final durum:', prediction.status);
        
        if (prediction.status === 'succeeded' && prediction.output) {
            const imageUrl = prediction.output;
            console.log('✅ Görüntü URL\'si alındı:', imageUrl);
            
            // Resmi indir
            const imgResponse = await fetch(imageUrl);
            const buffer = await imgResponse.arrayBuffer();
            
            const fileName = 'test_with_reference.jpg';
            const filePath = path.join(OUTPUT_DIR, fileName);
            
            fs.writeFileSync(filePath, Buffer.from(buffer));
            console.log(`💾 ${fileName} kaydedildi: ${filePath}`);
            console.log('🎉 Test başarılı!');
            
        } else if (prediction.status === 'failed') {
            console.error('❌ Görüntü oluşturulamadı:', prediction.error);
        } else {
            console.error('❌ Timeout veya bilinmeyen durum:', prediction.status);
        }

    } catch (error) {
        console.error('❌ Test hatası:', error.message);
    }
}

testWithReference();
