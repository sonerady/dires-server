const { createClient } = require('@supabase/supabase-js');
const { DEFAULT_MODEL_CREATION_PROVIDER, isModelCreationV1 } = require('../utils/modelCreationModel');
const logger = require('../utils/logger');

function createModelCreationConfigReader(supabase, log = logger) {
  return async function getModelCreationProvider(options) {
    if (!isModelCreationV1(options)) return null;
    try {
      const { data, error } = await supabase
        .from('app_model_generation_config')
        .select('provider')
        .eq('id', 'v1')
        .abortSignal(AbortSignal.timeout(3000))
        .maybeSingle();
      if (error) throw error;
      if (data?.provider === 'gpt' || data?.provider === 'gemini') return data.provider;
      throw new Error('Missing or invalid V1 provider');
    } catch {
      log.warn('[MODEL_CONFIG] V1 provider unavailable; using gpt');
      return DEFAULT_MODEL_CREATION_PROVIDER;
    }
  };
}

let readConfig;
async function getModelCreationProvider(options) {
  if (!isModelCreationV1(options)) return null;
  if (!readConfig) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      logger.warn('[MODEL_CONFIG] Backend service credentials unavailable; using gpt');
      return DEFAULT_MODEL_CREATION_PROVIDER;
    }
    readConfig = createModelCreationConfigReader(createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }));
  }
  // Reuse the connection, never the value: the next generation sees DB changes.
  return readConfig(options);
}

module.exports = { createModelCreationConfigReader, getModelCreationProvider };
