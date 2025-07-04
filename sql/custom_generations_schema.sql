-- Custom Generations Table Schema
-- Background generation tracking için

CREATE TABLE IF NOT EXISTS custom_generations (
    id BIGSERIAL PRIMARY KEY,
    
    -- Generation identification
    generation_id VARCHAR(255) UNIQUE NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL DEFAULT 'photoshoot', -- 'photoshoot', 'changeColor', 'editRoom', etc.
    
    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'processing', -- 'processing', 'completed', 'failed'
    progress INTEGER DEFAULT 0, -- 0-100 percentage
    
    -- Result data
    result_url TEXT, -- Final image URL when completed
    error_message TEXT, -- Error details if failed
    
    -- Metadata (JSON format)
    metadata JSONB DEFAULT '{}', -- Prompt, settings, etc.
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ, -- When generation finished (success or fail)
    
    -- Indexes for performance
    CONSTRAINT unique_generation_id UNIQUE (generation_id)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_custom_generations_user_id ON custom_generations (user_id);
CREATE INDEX IF NOT EXISTS idx_custom_generations_status ON custom_generations (status);
CREATE INDEX IF NOT EXISTS idx_custom_generations_type ON custom_generations (type);
CREATE INDEX IF NOT EXISTS idx_custom_generations_created_at ON custom_generations (created_at);
CREATE INDEX IF NOT EXISTS idx_custom_generations_updated_at ON custom_generations (updated_at);
CREATE INDEX IF NOT EXISTS idx_custom_generations_user_status ON custom_generations (user_id, status);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_custom_generations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_custom_generations_updated_at
    BEFORE UPDATE ON custom_generations
    FOR EACH ROW
    EXECUTE FUNCTION update_custom_generations_updated_at();

-- Cleanup function for old generations (24+ hours old)
CREATE OR REPLACE FUNCTION cleanup_old_custom_generations(hours_old INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM custom_generations 
        WHERE created_at < NOW() - INTERVAL '1 hour' * hours_old
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_count FROM deleted;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Example usage of cleanup function:
-- SELECT cleanup_old_custom_generations(24); -- Clean generations older than 24 hours

-- Enable Row Level Security (RLS) if needed
-- ALTER TABLE custom_generations ENABLE ROW LEVEL SECURITY;

-- Policy for users to see only their own generations (optional)
-- CREATE POLICY custom_generations_user_policy ON custom_generations
--     FOR ALL USING (user_id = current_setting('app.current_user_id', true));

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_generations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE custom_generations_id_seq TO authenticated;

-- Sample data for testing (optional)
-- INSERT INTO custom_generations (generation_id, user_id, type, status, metadata) 
-- VALUES 
--   ('test_gen_001', 'test_user_001', 'photoshoot', 'processing', '{"prompt": "test prompt"}'),
--   ('test_gen_002', 'test_user_001', 'photoshoot', 'completed', '{"prompt": "test prompt", "result": "success"}'),
--   ('test_gen_003', 'test_user_002', 'changeColor', 'failed', '{"prompt": "test prompt", "error": "test error"}');

-- Query examples:
-- 
-- -- Get all active generations for a user
-- SELECT * FROM custom_generations 
-- WHERE user_id = 'user123' AND status = 'processing' 
-- ORDER BY created_at DESC;
-- 
-- -- Get recent completed generations
-- SELECT * FROM custom_generations 
-- WHERE status = 'completed' AND created_at > NOW() - INTERVAL '1 day'
-- ORDER BY completed_at DESC;
-- 
-- -- Update generation status
-- UPDATE custom_generations 
-- SET status = 'completed', result_url = 'https://example.com/result.jpg', completed_at = NOW()
-- WHERE generation_id = 'gen_123';
-- 
-- -- Get generation statistics
-- SELECT 
--     type,
--     status,
--     COUNT(*) as count,
--     AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
-- FROM custom_generations 
-- WHERE completed_at IS NOT NULL
-- GROUP BY type, status; 