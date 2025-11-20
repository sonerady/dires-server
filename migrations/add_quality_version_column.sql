-- Migration: Add quality_version column to reference_results table
-- This column stores the quality version (v1 or v2) for each generation
-- Safe to run multiple times - checks if column exists before adding

DO $$
BEGIN
    -- Check if column already exists
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public'
        AND table_name = 'reference_results' 
        AND column_name = 'quality_version'
    ) THEN
        -- Add quality_version column with default value 'v1'
        ALTER TABLE reference_results 
        ADD COLUMN quality_version VARCHAR(10) DEFAULT 'v1';
        
        RAISE NOTICE 'quality_version column added successfully';
    ELSE
        RAISE NOTICE 'quality_version column already exists, skipping...';
    END IF;
END $$;

-- Add comment to column (safe to run multiple times)
COMMENT ON COLUMN reference_results.quality_version IS 'Quality version used for generation: v1 (standard) or v2 (4K quality)';

-- Update existing records: if settings contains qualityVersion, use it; otherwise keep default 'v1'
-- Only update records where quality_version is NULL or empty
UPDATE reference_results 
SET quality_version = COALESCE(
    NULLIF(settings->>'qualityVersion', ''),
    NULLIF(settings->>'quality_version', ''),
    'v1'
)
WHERE quality_version IS NULL 
   OR quality_version = ''
   OR (quality_version = 'v1' AND (settings->>'qualityVersion' = 'v2' OR settings->>'quality_version' = 'v2'));

