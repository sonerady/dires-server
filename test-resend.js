// Test script for Resend email service
require('dotenv').config();
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function testResendEmail() {
    console.log('🔍 Testing Resend email service...\n');

    // ✅ Domain doğrulandı! Artık diress.ai kullanabiliriz
    const fromEmail = 'Diress <noreply@diress.ai>';
    // Domain doğrulandıktan sonra: 'Diress <noreply@diress.ai>'

    const toEmail = 'skozayy@gmail.com'; // Test email adresi

    if (toEmail === 'YOUR_EMAIL_HERE@gmail.com') {
        console.error('❌ HATA: Lütfen "toEmail" değişkenine kendi email adresini yaz!');
        console.error('   test-resend.js dosyasını düzenle, satır 10\n');
        return;
    }

    try {
        console.log(`📧 Email gönderiliyor: ${fromEmail} → ${toEmail}\n`);

        // Actual verification template'i kullan
        const { getVerificationEmailTemplate } = require('./src/lib/emailTemplates');
        const testCode = '123456';
        const testUrl = 'https://app.diress.ai/verify?token=test&userId=test-user-id';

        const { data, error } = await resend.emails.send({
            from: fromEmail,
            to: [toEmail],
            subject: 'Confirm your account - Diress',
            html: getVerificationEmailTemplate(testCode, testUrl, 'Test User'),
        });

        if (error) {
            console.error('❌ Resend API Error:', error);
            console.error('\n📋 Hata Detayları:');
            console.error('   - Mesaj:', error.message);
            console.error('   - Kod:', error.statusCode || 'N/A');

            if (error.message && error.message.includes('Domain')) {
                console.error('\n💡 Çözüm: Domain doğrulaması yapman gerekiyor!');
                console.error('   1. https://resend.com/domains adresine git');
                console.error('   2. "diress.ai" domain\'ini ekle ve doğrula');
                console.error('   3. RESEND_SETUP.md dosyasını oku\n');
            }
        } else {
            console.log('✅ Email başarıyla gönderildi!\n');
            console.log('📋 Response Data:', data);
            console.log('\n📬 Email\'i kontrol et:', toEmail);
            console.log('   - Inbox klasörünü kontrol et');
            console.log('   - Spam/Junk klasörünü kontrol et');
            console.log('   - Birkaç dakika beklemen gerekebilir\n');
        }
    } catch (exception) {
        console.error('❌ Exception:', exception);

        if (exception.message && exception.message.includes('API')) {
            console.error('\n💡 Çözüm: RESEND_API_KEY kontrol et!');
            console.error('   1. server/.env dosyasını aç');
            console.error('   2. RESEND_API_KEY değerinin doğru olduğundan emin ol');
            console.error('   3. https://resend.com/api-keys adresinden yeni key oluşturabilirsin\n');
        }
    }
}

// Script'i çalıştır
testResendEmail();
