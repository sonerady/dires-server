const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// Supabase connection
const supabaseUrl =
  process.env.SUPABASE_URL || "https://egpfenrpripkjpemjxtg.supabase.co";
const supabaseKey =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVncGZlbnJwcmlwa2pwZW1qeHRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjEzMDA3NjMsImV4cCI6MjAzNjg3Njc2M30.ggmJVDvJCx4m6-K7wqaMm_8RcgYR9HdSXjNu6KNY8J4";

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupFavoritesTable() {
  try {
    console.log("🚀 Setting up Favorites table...");

    // Read SQL file
    const sqlPath = path.join(__dirname, "create-favorites-table.sql");
    const sqlContent = fs.readFileSync(sqlPath, "utf8");

    // Split SQL into individual statements (rough approach)
    const statements = sqlContent
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0 && !stmt.startsWith("--"));

    console.log(`📄 Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.length > 10) {
        // Skip very short statements
        try {
          console.log(
            `⚡ Executing statement ${i + 1}/${statements.length}...`
          );
          const { error } = await supabase.rpc("exec_sql", { sql: statement });

          if (error) {
            console.error(`❌ Error in statement ${i + 1}:`, error);
            // Continue with other statements
          } else {
            console.log(`✅ Statement ${i + 1} executed successfully`);
          }
        } catch (err) {
          console.error(`❌ Exception in statement ${i + 1}:`, err.message);
        }
      }
    }

    // Test the table
    console.log("🧪 Testing table access...");
    const { data, error } = await supabase
      .from("user_favorite_locations")
      .select("count")
      .limit(1);

    if (error) {
      console.error("❌ Table access test failed:", error);
    } else {
      console.log("✅ Table access test passed");
    }

    console.log("🎉 Favorites table setup completed!");
  } catch (error) {
    console.error("❌ Setup failed:", error);
    process.exit(1);
  }
}

// Alternative manual setup function
async function manualSetup() {
  console.log("🔧 Running manual table setup...");

  try {
    // Create table with basic structure
    const { error } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS user_favorite_locations (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID NOT NULL,
          location_id VARCHAR(255) NOT NULL,
          location_type VARCHAR(50) NOT NULL,
          location_title VARCHAR(255),
          location_image_url TEXT,
          location_category VARCHAR(100),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT unique_user_location UNIQUE (user_id, location_id)
        );
      `,
    });

    if (error) {
      console.error("❌ Manual setup failed:", error);
    } else {
      console.log("✅ Manual setup completed successfully");
    }
  } catch (err) {
    console.error("❌ Manual setup exception:", err);
  }
}

// Run setup
if (require.main === module) {
  const useManual = process.argv.includes("--manual");

  if (useManual) {
    manualSetup();
  } else {
    setupFavoritesTable();
  }
}

module.exports = { setupFavoritesTable, manualSetup };
