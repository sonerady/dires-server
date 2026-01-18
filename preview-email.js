/**
 * Email Template Preview Script
 * Run: node preview-email.js
 */

const fs = require('fs');
const path = require('path');
const {
  getVerificationEmailTemplate,
  getMobileVerificationEmailTemplate,
  getWelcomeEmailTemplate,
  getPasswordResetTemplate
} = require('./src/lib/emailTemplates.js');

// Create previews directory
const previewDir = path.join(__dirname, 'email-previews');
if (!fs.existsSync(previewDir)) {
  fs.mkdirSync(previewDir);
}

// Generate all email previews
const templates = [
  {
    name: 'welcome',
    html: getWelcomeEmailTemplate('John Doe', 40),
    description: 'Welcome Email (after verification)'
  },
  {
    name: 'verification-web',
    html: getVerificationEmailTemplate('123456', 'https://app.diress.ai/verify?token=abc123', 'John'),
    description: 'Email Verification (Web - Button)'
  },
  {
    name: 'verification-mobile',
    html: getMobileVerificationEmailTemplate('847291', 'John'),
    description: 'Email Verification (Mobile - 6-digit Code)'
  },
  {
    name: 'password-reset',
    html: getPasswordResetTemplate('https://app.diress.ai/reset-password?token=xyz789', 'John Doe'),
    description: 'Password Reset Email'
  }
];

console.log('\n📧 Email Template Previews Generated:\n');
console.log('─'.repeat(50));

templates.forEach(template => {
  const filePath = path.join(previewDir, `${template.name}.html`);
  fs.writeFileSync(filePath, template.html);
  console.log(`✅ ${template.description}`);
  console.log(`   → ${filePath}\n`);
});

console.log('─'.repeat(50));
console.log('\n🚀 Open in browser:');
console.log(`   open ${previewDir}/welcome.html\n`);
