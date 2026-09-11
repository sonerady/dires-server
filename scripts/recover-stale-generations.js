#!/usr/bin/env node
// Scoped operator repair; dry run unless --apply is explicitly supplied.
require("dotenv").config({ quiet: true });
const { createClient } = require("@supabase/supabase-js");
const { recoverStaleGenerations } = require("../src/services/generationRecovery");

async function main() {
  const args = process.argv.slice(2);
  const generationIds = [];
  let userId, apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--user-id") userId = args[++i];
    else if (args[i] === "--generation-id") generationIds.push(args[++i]);
    else if (args[i] === "--apply") apply = true;
    else throw new Error("Usage: node scripts/recover-stale-generations.js --user-id UUID --generation-id ID [--generation-id ID ...] [--apply]");
  }
  if (!userId || !generationIds.length || generationIds.some(id => !id || id.startsWith("--"))) throw new Error("An explicit user ID and generation IDs are required.");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
  const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(JSON.stringify(await recoverStaleGenerations(db, { userId, generationIds, dryRun: !apply }), null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
