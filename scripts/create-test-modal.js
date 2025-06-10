const mysql = require("mysql2/promise");

async function createTestModal() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "password",
    database: "diress",
  });

  const modalData = {
    content: JSON.stringify({
      tr: {
        title: "Test Modal - AsyncStorage Testi",
        html: `
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; color: white; margin-bottom: 20px;">
            <h2 style="color: white; margin-top: 0;">🧪 AsyncStorage Dismiss Testi</h2>
            <p>Bu modal, güçlü dismiss sistemini test eder!</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #28a745;">
            <p><strong>✅ Test Özellikleri:</strong></p>
            <ul>
              <li>API dismiss + AsyncStorage backup</li>
              <li>Her türlü kapanma durumu (X, Got it, back gesture)</li>
              <li>Bir daha gösterilmeme garantisi</li>
            </ul>
          </div>
          
          <p>Bu modal'ı kapatınca bir daha görmemelisiniz!</p>
        `,
        dismiss_text: "Test Tamamlandı!",
      },
      en: {
        title: "Test Modal - AsyncStorage Test",
        html: `
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 12px; color: white; margin-bottom: 20px;">
            <h2 style="color: white; margin-top: 0;">🧪 AsyncStorage Dismiss Test</h2>
            <p>This modal tests the strong dismiss system!</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 10px 0; border-left: 4px solid #28a745;">
            <p><strong>✅ Test Features:</strong></p>
            <ul>
              <li>API dismiss + AsyncStorage backup</li>
              <li>All close scenarios (X, Got it, back gesture)</li>
              <li>Never show again guarantee</li>
            </ul>
          </div>
          
          <p>Once you close this modal, you should never see it again!</p>
        `,
        dismiss_text: "Test Complete!",
      },
    }),
    target_audience: "all",
    priority: 1,
    start_date: new Date().toISOString().split("T")[0],
    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    is_active: 1,
  };

  const [result] = await connection.execute(
    "INSERT INTO info_modals (content, target_audience, priority, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?)",
    [
      modalData.content,
      modalData.target_audience,
      modalData.priority,
      modalData.start_date,
      modalData.end_date,
      modalData.is_active,
    ]
  );

  console.log("✅ Test modal oluşturuldu! ID:", result.insertId);
  console.log("🎯 Modal içeriği:", modalData.content);

  await connection.end();
}

createTestModal().catch(console.error);
