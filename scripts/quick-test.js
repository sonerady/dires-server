const fs = require("fs");
const path = require("path");

// .env dosyasının doğru path'ini belirt
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const REPLICATE_API_TOKEN = "r8_VOZ18ZqNu1sgLJnZS7Py83sD9HGmYML0uXYyS";
const OUTPUT_DIR = path.join(__dirname, "../generated-icons");

// Çıktı klasörünü oluştur
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Basit test fonksiyonu
async function quickTest() {
    console.log('🧪 Hızlı test başlatılıyor...');
    
    const prompt = `Draw a simple flat icon of sunglasses:
- clean outline illustration with bold lines
- single color stroke in #FF6B6B color
- no shading, no gradients, no 3D effects
- white background
- minimalist, sticker-like style`;

    const requestBody = {
        input: {
            prompt: prompt,
            output_format: "jpg"
        }
    };

    try {
        console.log('📡 API isteği gönderiliyor...');
        const response = await fetch('https://api.replicate.com/v1/models/google/nano-banana/predictions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
                'Content-Type': 'application/json',
                'Prefer': 'wait'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API hatası: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        console.log('📄 API yanıtı:', result);
        
        if (result.status === 'succeeded' && result.output && result.output.length > 0) {
            const imageUrl = result.output[0];
            console.log('✅ Görüntü URL\'si alındı:', imageUrl);
            
            // Resmi indir
            const imgResponse = await fetch(imageUrl);
            const buffer = await imgResponse.arrayBuffer();
            
            const fileName = 'test_sunglasses.jpg';
            const filePath = path.join(OUTPUT_DIR, fileName);
            
            fs.writeFileSync(filePath, Buffer.from(buffer));
            console.log(`💾 ${fileName} kaydedildi: ${filePath}`);
            console.log('🎉 Test başarılı!');
            
        } else {
            console.error('❌ Görüntü oluşturulamadı:', result.error || 'Bilinmeyen hata');
        }

    } catch (error) {
        console.error('❌ Test hatası:', error.message);
    }
}

quickTest();
