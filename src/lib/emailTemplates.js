/**
 * Email Templates for Resend
 * Modern, responsive HTML email templates
 */

/**
 * Generate HTML email template for email verification
 * @param {string} verificationCode - 6-digit verification code (not used in template)
 * @param {string} verificationUrl - Verification URL: https://app.diress.ai/verify?token=xxx
 * @param {string} userName - User's name (optional)
 * @returns {string} HTML email template
 */
function getVerificationEmailTemplate(verificationCode, verificationUrl, userName = '') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Your Account</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- White Card Container -->
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; padding: 48px 40px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">
          
          <!-- Logo and Brand -->
          <tr>
            <td align="left" style="padding-bottom: 32px;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align: middle;">
                    <span style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px;">
                      Diress<span style="color: #ef4444;">.</span>
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Heading -->
          <tr>
            <td style="padding-bottom: 16px;">
              <h1 style="font-family: 'Poppins', sans-serif; font-size: 32px; font-weight: 700; color: #1a1a1a; margin: 0; line-height: 1.2;">
                Confirm your account
              </h1>
            </td>
          </tr>

          <!-- Description -->
          <tr>
            <td style="padding-bottom: 40px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0;">
                Please click the button below to confirm your email address and finish setting up your account. This link is valid for 24 hours.
              </p>
            </td>
          </tr>

          <!-- Confirm Button -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <a href="${verificationUrl}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 48px; border-radius: 50px; letter-spacing: 0.3px;">
                CONFIRM
              </a>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #f3f4f6;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0;">
                Didn't register on Diress? <a href="#" style="color: #1a1a1a; text-decoration: none; font-weight: 600;">Click here to let us know.</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Get welcome email template (sent after successful verification)
 * @param {string} userName - User's name or email
 * @param {number} initialCredits - Initial credit amount
 * @returns {string} HTML email template
 */
function getWelcomeEmailTemplate(userName = '', initialCredits = 40) {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Diress</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 50px 40px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0 0 15px;">
                🎉 Hoş Geldiniz!
              </h1>
              <p style="color: rgba(255, 255, 255, 0.95); font-size: 18px; margin: 0;">
                Diress ailesine katıldınız
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              ${userName ? `<p style="font-size: 18px; color: #333333; margin: 0 0 20px; font-weight: 600;">Merhaba ${userName},</p>` : ''}
              
              <p style="font-size: 16px; color: #555555; line-height: 1.8; margin: 0 0 30px;">
                Email adresiniz başarıyla doğrulandı! 🎊 Artık tüm Diress özelliklerine erişebilirsiniz.
              </p>

              <!-- Credit Box -->
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 30px; text-align: center; margin: 0 0 30px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                <div style="font-size: 16px; color: rgba(255, 255, 255, 0.9); margin-bottom: 10px; font-weight: 600;">
                  🎁 Hoşgeldin Hediyesi
                </div>
                <div style="font-size: 48px; font-weight: 700; color: #ffffff; margin-bottom: 5px;">
                  ${initialCredits}
                </div>
                <div style="font-size: 16px; color: rgba(255, 255, 255, 0.9);">
                  Ücretsiz Kredi
                </div>
              </div>

              <h2 style="font-size: 20px; color: #1e293b; margin: 0 0 20px; font-weight: 600;">
                Diress ile neler yapabilirsiniz?
              </h2>

              <ul style="list-style: none; padding: 0; margin: 0 0 30px;">
                <li style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #475569;">
                  ✨ <strong>AI Ürün Fotoğrafları:</strong> Profesyonel arka planlar oluşturun
                </li>
                <li style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #475569;">
                  👗 <strong>Sanal Manken:</strong> Ürünlerinizi AI modellerle tanıtın
                </li>
                <li style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; font-size: 15px; color: #475569;">
                  🎨 <strong>Renk Değiştirme:</strong> Ürün renklerini anında değiştirin
                </li>
                <li style="padding: 12px 0; font-size: 15px; color: #475569;">
                  📸 <strong>Retouch:</strong> Fotoğraflarınızı mükemmelleştirin
                </li>
              </ul>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 0 0 20px;">
                <a href="diress://home" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);">
                  Hemen Başla
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="font-size: 14px; color: #64748b; margin: 0 0 10px;">
                Sorularınız mı var? <a href="mailto:support@diress.ai" style="color: #667eea; text-decoration: none;">Bize ulaşın</a>
              </p>
              <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                © ${new Date().getFullYear()} Diress.ai. Tüm hakları saklıdır.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Get password reset email template
 * @param {string} resetUrl - Password reset URL
 * @param {string} userName - User's name or email
 * @returns {string} HTML email template
 */
function getPasswordResetTemplate(resetUrl, userName = '') {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); padding: 40px 40px 30px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 28px; font-weight: 600; margin: 0 0 10px;">
                🔑 Şifre Sıfırlama
              </h1>
              <p style="color: rgba(255, 255, 255, 0.9); font-size: 16px; margin: 0;">
                Şifrenizi sıfırlama talebiniz alındı
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              ${userName ? `<p style="font-size: 16px; color: #333333; margin: 0 0 20px;">Merhaba ${userName},</p>` : ''}
              
              <p style="font-size: 16px; color: #555555; line-height: 1.6; margin: 0 0 30px;">
                Hesabınız için şifre sıfırlama talebinde bulundunuz. Şifrenizi sıfırlamak için aşağıdaki butona tıklayın:
              </p>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 0 0 30px;">
                <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);">
                  Şifreyi Sıfırla
                </a>
              </div>

              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 0 0 20px;">
                <p style="font-size: 14px; color: #92400e; margin: 0; line-height: 1.5;">
                  ⚠️ <strong>Güvenlik Uyarısı:</strong> Bu link <strong>1 saat</strong> geçerlidir. Eğer bu talebi siz yapmadıysanız, bu email'i görmezden gelebilirsiniz.
                </p>
              </div>

              <p style="font-size: 14px; color: #94a3b8; line-height: 1.6; margin: 0;">
                Link çalışmıyorsa, aşağıdaki URL'yi tarayıcınıza kopyalayabilirsiniz:<br>
                <a href="${resetUrl}" style="color: #667eea; word-break: break-all; text-decoration: none;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 30px 40px; text-align: center; border-top: 1px solid #e2e8f0;">
              <p style="font-size: 14px; color: #64748b; margin: 0 0 10px;">
                <strong>Diress AI</strong> - Professional Product Photography
              </p>
              <p style="font-size: 12px; color: #94a3b8; margin: 0;">
                © ${new Date().getFullYear()} Diress.ai. Tüm hakları saklıdır.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

module.exports = {
  getVerificationEmailTemplate,
  getWelcomeEmailTemplate,
  getPasswordResetTemplate,
};
