-- Add tags column to custom_locations table
-- Tags will be stored as JSONB with structure:
-- Each language has exactly 5 tags, each tag is exactly 5 words
-- {
--   "en": ["5 word tag describing location", ...],  -- English
--   "es": ["tag de 5 palabras describiendo ubicación", ...],  -- Spanish
--   "pt": ["tag de 5 palavras descrevendo localização", ...],  -- Portuguese
--   "fr": ["tag de 5 mots décrivant lieu", ...],  -- French
--   "de": ["5 Wörter Tag der Ort beschreibt", ...],  -- German
--   "it": ["tag di 5 parole che descrive posizione", ...],  -- Italian
--   "tr": ["bu mekanı anlatan 5 kelimelik tag", ...],  -- Turkish
--   "ru": ["тег из 5 слов описывающий место", ...],  -- Russian
--   "uk": ["тег з 5 слів що описує місце", ...],  -- Ukrainian
--   "ar": ["علامة من 5 كلمات تصف المكان", ...],  -- Arabic
--   "fa": ["تگ 5 کلمه‌ای که مکان را توصیف می‌کند", ...],  -- Persian/Farsi
--   "zh": ["描述此位置的5字标签", ...],  -- Chinese Simplified
--   "zh-tw": ["描述此位置的5字標籤", ...],  -- Chinese Traditional
--   "ja": ["この場所を説明する5語のタグ", ...],  -- Japanese
--   "ko": ["이 위치를 설명하는 5단어 태그", ...],  -- Korean
--   "hi": ["इस स्थान का वर्णन करने वाला 5 शब्द टैग", ...],  -- Hindi
--   "id": ["tag 5 kata yang menjelaskan lokasi", ...]  -- Indonesian
-- }

-- Add tags column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'custom_locations' 
        AND column_name = 'tags'
    ) THEN
        ALTER TABLE custom_locations 
        ADD COLUMN tags JSONB DEFAULT NULL;
        
        -- Add index for better search performance
        CREATE INDEX IF NOT EXISTS idx_custom_locations_tags_gin 
        ON custom_locations USING GIN (tags);
        
        RAISE NOTICE 'Column tags added successfully';
    ELSE
        RAISE NOTICE 'Column tags already exists';
    END IF;
END $$;

-- Add comment to column
COMMENT ON COLUMN custom_locations.tags IS 'Multi-language tags for location search. JSONB format with language codes as keys and arrays of 5 tags as values.';


