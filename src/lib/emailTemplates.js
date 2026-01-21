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
 * Generate HTML email template for MOBILE verification (6-digit code)
 * @param {string} verificationCode - 6-digit verification code
 * @param {string} userName - User's name (optional)
 * @returns {string} HTML email template
 */
function getMobileVerificationEmailTemplate(verificationCode, userName = '') {
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
            <td style="padding-bottom: 24px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0;">
                Enter this verification code in the Diress app to confirm your email address. This code is valid for 24 hours.
              </p>
            </td>
          </tr>

          <!-- Verification Code Box -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <div style="background-color: #f3f4f6; border-radius: 12px; padding: 24px 40px; display: inline-block;">
                <span style="font-family: 'Poppins', monospace; font-size: 36px; font-weight: 700; color: #1a1a1a; letter-spacing: 8px;">
                  ${verificationCode}
                </span>
              </div>
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Diress</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; padding: 48px 40px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">

          <!-- Logo -->
          <tr>
            <td align="left" style="padding-bottom: 40px;">
              <span style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px;">
                Diress<span style="color: #ef4444;">.</span>
              </span>
            </td>
          </tr>

          <!-- Welcome Heading -->
          <tr>
            <td style="padding-bottom: 16px;">
              <h1 style="font-family: 'Poppins', sans-serif; font-size: 28px; font-weight: 700; color: #1a1a1a; margin: 0; line-height: 1.3;">
                Welcome to Diress
              </h1>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0;">
                ${userName ? `Hi ${userName}, your` : 'Your'} email has been verified. You now have full access to all Diress features.
              </p>
            </td>
          </tr>

          <!-- Credit Box - Minimal -->
          <tr>
            <td style="padding-bottom: 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fafafa; border: 1px solid #e5e5e5; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td>
                          <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #6b7280; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px;">
                            Welcome Gift
                          </p>
                          <p style="font-family: 'Poppins', sans-serif; font-size: 32px; font-weight: 700; color: #1a1a1a; margin: 0;">
                            🎁 ${initialCredits} <span style="font-size: 16px; font-weight: 500; color: #6b7280;">credits</span>
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Features Section -->
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 600; color: #1a1a1a; margin: 0 0 16px;">
                What you can do with Diress
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #374151; margin: 0;">
                      <strong>AI Product Photos</strong> — Create professional backgrounds
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #374151; margin: 0;">
                      <strong>Virtual Model</strong> — Showcase products with AI models
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #f3f4f6;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #374151; margin: 0;">
                      <strong>Color Change</strong> — Instantly change product colors
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #374151; margin: 0;">
                      <strong>Retouch</strong> — Perfect your photos
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding-bottom: 40px;">
              <a href="https://app.diress.ai" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 48px; border-radius: 50px; letter-spacing: 0.3px;">
                GET STARTED
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #f3f4f6;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0;">
                Questions? <a href="mailto:support@diress.ai" style="color: #1a1a1a; text-decoration: none; font-weight: 500;">Contact us</a>
              </p>
              <p style="font-family: 'Poppins', sans-serif; font-size: 12px; color: #d1d5db; margin: 16px 0 0;">
                © ${new Date().getFullYear()} Diress.ai
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; padding: 48px 40px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">

          <!-- Logo -->
          <tr>
            <td align="left" style="padding-bottom: 40px;">
              <span style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px;">
                Diress<span style="color: #ef4444;">.</span>
              </span>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding-bottom: 16px;">
              <h1 style="font-family: 'Poppins', sans-serif; font-size: 28px; font-weight: 700; color: #1a1a1a; margin: 0; line-height: 1.3;">
                Reset Your Password
              </h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0;">
                ${userName ? `Hi ${userName}, we` : 'We'} received a request to reset your password. Click the button below to create a new password.
              </p>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <a href="${resetUrl}" style="display: inline-block; background-color: #1a1a1a; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 48px; border-radius: 50px; letter-spacing: 0.3px;">
                RESET PASSWORD
              </a>
            </td>
          </tr>

          <!-- Security Notice -->
          <tr>
            <td style="padding-bottom: 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fafafa; border: 1px solid #e5e5e5; border-radius: 12px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #6b7280; margin: 0; line-height: 1.6;">
                      This link expires in <strong style="color: #1a1a1a;">1 hour</strong>. If you didn't request this, you can safely ignore this email.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Alternative Link -->
          <tr>
            <td style="padding-bottom: 40px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.6; margin: 0;">
                If the button doesn't work, copy and paste this link:<br>
                <a href="${resetUrl}" style="color: #1a1a1a; word-break: break-all; text-decoration: none; font-weight: 500;">${resetUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #f3f4f6;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0;">
                Questions? <a href="mailto:support@diress.ai" style="color: #1a1a1a; text-decoration: none; font-weight: 500;">Contact us</a>
              </p>
              <p style="font-family: 'Poppins', sans-serif; font-size: 12px; color: #d1d5db; margin: 16px 0 0;">
                © ${new Date().getFullYear()} Diress.ai
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
 * Get team invitation email template
 * @param {string} inviterName - Name or email of the person inviting
 * @param {string} inviterCompany - Company name of the inviter (optional)
 * @param {string} acceptUrl - URL to accept the invitation
 * @param {string} declineUrl - URL to decline the invitation
 * @param {string} signupUrl - URL for users without account to sign up (optional)
 * @returns {string} HTML email template
 */
function getTeamInvitationTemplate(inviterName, inviterCompany, acceptUrl, declineUrl, signupUrl = null) {
  const companyText = inviterCompany ? ` (${inviterCompany})` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; font-family: 'Poppins', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; padding: 48px 40px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);">

          <!-- Logo -->
          <tr>
            <td align="left" style="padding-bottom: 40px;">
              <span style="font-family: 'Poppins', sans-serif; font-size: 24px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px;">
                Diress<span style="color: #ef4444;">.</span>
              </span>
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td style="padding-bottom: 16px;">
              <h1 style="font-family: 'Poppins', sans-serif; font-size: 28px; font-weight: 700; color: #1a1a1a; margin: 0; line-height: 1.3;">
                You're Invited to Join a Team
              </h1>
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 15px; color: #6b7280; line-height: 1.6; margin: 0;">
                <strong style="color: #1a1a1a;">${inviterName}</strong>${companyText} has invited you to join their team on Diress.
              </p>
            </td>
          </tr>

          <!-- Benefits Box -->
          <tr>
            <td style="padding-bottom: 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #fafafa; border: 1px solid #e5e5e5; border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 600; color: #1a1a1a; margin: 0 0 12px;">
                      As a team member, you'll get:
                    </p>
                    <ul style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #6b7280; margin: 0; padding-left: 20px; line-height: 1.8;">
                      <li>Access to Pro features</li>
                      <li>Shared credits with the team</li>
                      <li>All AI generation tools</li>
                    </ul>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <a href="${acceptUrl}" style="display: inline-block; background-color: #22c55e; color: #ffffff; font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; text-decoration: none; padding: 16px 56px; border-radius: 50px; letter-spacing: 0.3px;">
                ✓ ACCEPT
              </a>
            </td>
          </tr>

          <!-- Decline Link -->
          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <a href="${declineUrl}" style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; text-decoration: underline;">
                or decline this invitation
              </a>
            </td>
          </tr>

          <!-- Expiration Notice -->
          <tr>
            <td style="padding-bottom: 32px;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0; text-align: center;">
                This invitation will expire in <strong style="color: #6b7280;">7 days</strong>.
              </p>
            </td>
          </tr>

          ${signupUrl ? `
          <!-- No Account Notice -->
          <tr>
            <td style="padding-bottom: 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px;">
                <tr>
                  <td style="padding: 20px;">
                    <p style="font-family: 'Poppins', sans-serif; font-size: 14px; color: #0369a1; margin: 0; line-height: 1.6;">
                      <strong>Don't have a Diress account?</strong><br>
                      <a href="${signupUrl}" style="color: #0284c7; text-decoration: underline; font-weight: 500;">Click here to sign up</a> and the invitation will be accepted automatically.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td style="padding-top: 24px; border-top: 1px solid #f3f4f6;">
              <p style="font-family: 'Poppins', sans-serif; font-size: 13px; color: #9ca3af; line-height: 1.5; margin: 0;">
                Questions? <a href="mailto:support@diress.ai" style="color: #1a1a1a; text-decoration: none; font-weight: 500;">Contact us</a>
              </p>
              <p style="font-family: 'Poppins', sans-serif; font-size: 12px; color: #d1d5db; margin: 16px 0 0;">
                © ${new Date().getFullYear()} Diress.ai
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
  getMobileVerificationEmailTemplate,
  getWelcomeEmailTemplate,
  getPasswordResetTemplate,
  getTeamInvitationTemplate,
};
